import { spawn } from 'node:child_process'
import { Agent, createServer, request as httpRequest, type Server } from 'node:http'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { CandidateRecord } from './candidate'
import { assertCandidateCurrent } from './candidate'

export class CandidatePreviewError extends Error {
  constructor(message: string) { super(message); this.name = 'CandidatePreviewError' }
}

export interface CandidatePreview {
  candidateId: string
  url: string
  containerName: string
  networkName: string
  authorizedResourceUrls: string[]
}

export interface CandidateBaselinePreview {
  candidateId: string
  containerName: string
  networkName: string
  address: string
}

export interface ProjectSourcePreview {
  projectId: string
  previewId: string
  sourceDigest: string
  url: string
}

export function addressOnPreviewNetwork(networksJson: string, networkName: string): string {
  const networks = JSON.parse(networksJson) as Record<string, { IPAddress?: string }>
  const address = networks[networkName]?.IPAddress
  if (!address || net.isIP(address) !== 4) throw new CandidatePreviewError(`候选容器未加入预期的 IPv4 预演网络：${networkName}`)
  return address
}

export interface PreviewContainerInspection {
  status: string
  exitCode: number
  error: string
  oomKilled: boolean
  networks: Record<string, { IPAddress?: string }>
}

export function parsePreviewContainerInspection(value: string): PreviewContainerInspection {
  const separator = value.indexOf('|')
  if (separator < 0) throw new CandidatePreviewError('Docker inspect 没有返回预演容器状态与网络')
  try {
    const state = JSON.parse(value.slice(0, separator)) as { Status?: unknown; ExitCode?: unknown; Error?: unknown; OOMKilled?: unknown }
    const networks = JSON.parse(value.slice(separator + 1)) as Record<string, { IPAddress?: string }>
    if (typeof state.Status !== 'string' || typeof state.ExitCode !== 'number' || typeof state.Error !== 'string' || typeof state.OOMKilled !== 'boolean' || !networks || typeof networks !== 'object') {
      throw new Error('invalid state fields')
    }
    return { status: state.Status, exitCode: state.ExitCode, error: state.Error, oomKilled: state.OOMKilled, networks }
  } catch (error) {
    throw new CandidatePreviewError(`Docker inspect 返回了无效的预演状态：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function waitForPreviewNetworkAddress(networkName: string, containerName: string, inspectContainer: () => Promise<PreviewContainerInspection>, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastNetworks: Record<string, { IPAddress?: string }> = {}
  while (Date.now() < deadline) {
    const inspection = await inspectContainer()
    lastNetworks = inspection.networks
    if (inspection.status !== 'running') {
      throw new CandidatePreviewError(`预演容器 ${containerName} 未处于 running 状态（status=${inspection.status}, exit=${inspection.exitCode}, oom=${inspection.oomKilled}, error=${inspection.error || 'none'}, attached=${Object.keys(lastNetworks).join(',') || 'none'}）`)
    }
    try { return addressOnPreviewNetwork(JSON.stringify(inspection.networks), networkName) }
    catch (error) {
      if (!(error instanceof CandidatePreviewError) || !/未加入预期/.test(error.message)) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new CandidatePreviewError(`预演容器 ${containerName} 仍在运行，但没有分配到预期网络 ${networkName} 的 IPv4 地址（attached=${Object.keys(lastNetworks).join(',') || 'none'}；等待 ${timeoutMs} ms）`)
}

export interface PreviewReadinessOptions {
  requiredStableInspections?: number
  intervalMs?: number
  timeoutMs?: number
}

export interface PreviewReadinessObservation {
  address: string
  stableInspections: number
  inspections: number
  addressChanges: number
  probeFailures: number
  elapsedMs: number
}

export interface PreviewReadiness extends PreviewReadinessObservation {
  settled: true
}

/**
 * A single HTTP 200 from the container only proves Vite answered once. It does
 * not prove the container's network namespace finished settling: `docker run`
 * returns as soon as the container is created, and the bridge endpoint, veth
 * pair and IP address are attached asynchronously afterwards. Pointing a
 * browser at the preview during that window lets a host network-configuration
 * event abort the browser's in-flight requests.
 *
 * This gate therefore requires *observed stability* — the same IPv4 address and
 * a successful endpoint probe across N consecutive inspections — before the
 * preview URL may be handed to a browser. A changed address resets the count,
 * which is exactly the instability being detected.
 */
export async function waitForPreviewReadiness(
  networkName: string,
  containerName: string,
  inspectContainer: () => Promise<PreviewContainerInspection>,
  probeEndpoint: () => Promise<boolean>,
  options: PreviewReadinessOptions = {},
): Promise<PreviewReadiness> {
  const required = Math.max(1, options.requiredStableInspections ?? 3)
  const intervalMs = options.intervalMs ?? 200
  const timeoutMs = options.timeoutMs ?? 30_000
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  let inspections = 0
  let probeFailures = 0
  let addressChanges = 0
  let stable = 0
  let address = ''
  while (Date.now() < deadline) {
    const inspection = await inspectContainer()
    inspections += 1
    if (inspection.status !== 'running') {
      throw new CandidatePreviewError(`预演容器 ${containerName} 在网络稳定等待期间停止（status=${inspection.status}, exit=${inspection.exitCode}, oom=${inspection.oomKilled}, error=${inspection.error || 'none'}）`)
    }
    let observed = ''
    try { observed = addressOnPreviewNetwork(JSON.stringify(inspection.networks), networkName) }
    catch (error) {
      if (!(error instanceof CandidatePreviewError) || !/未加入预期/.test(error.message)) throw error
    }
    if (observed && address && observed !== address) {
      addressChanges += 1
      stable = 0
    }
    if (observed) address = observed
    const probed = observed ? await probeEndpoint().catch(() => false) : false
    if (!probed) {
      probeFailures += 1
      stable = 0
    } else if (observed) {
      stable += 1
      if (stable >= required) {
        return {
          settled: true,
          address,
          stableInspections: stable,
          inspections,
          addressChanges,
          probeFailures,
          elapsedMs: Date.now() - startedAt,
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new CandidatePreviewError(
    `隔离预演容器 ${containerName} 的网络在 ${timeoutMs} ms 内未观测到稳定（需要连续 ${required} 次一致检查；已检查 ${inspections} 次，地址变更 ${addressChanges} 次，探测失败 ${probeFailures} 次，最后地址=${address || 'none'}）`,
  )
}

export async function resolveCandidatePreviewAddress(preview: CandidatePreview): Promise<string> {
  try {
    return await waitForPreviewNetworkAddress(preview.networkName, preview.containerName, async () => parsePreviewContainerInspection(
      await docker(['inspect', '--format', '{{json .State}}|{{json .NetworkSettings.Networks}}', preview.containerName]),
    ))
  } catch (error) {
    const [state, network, logs] = await Promise.all([
      docker(['inspect', '--format', '{{json .State}}|{{json .NetworkSettings.Networks}}', preview.containerName]).catch(failure => failure instanceof Error ? failure.message : 'unknown'),
      docker(['network', 'inspect', '--format', '{{json .Containers}}', preview.networkName]).catch(failure => failure instanceof Error ? failure.message : 'network inspect unavailable'),
      docker(['logs', '--tail', '80', preview.containerName], 10_000, true).catch(failure => failure instanceof Error ? failure.message : 'no container logs'),
    ])
    throw new CandidatePreviewError(`${error instanceof Error ? error.message : '无法取得预演容器网络地址'}（容器状态/端点=${state}；网络端点=${network}）：${logs.slice(-4000)}`)
  }
}

export type PreviewRelayOutcome = 'completed' | 'denied' | 'client-aborted' | 'upstream-failed'

export interface PreviewRelayEvent {
  sequence: number
  path: string
  outcome: PreviewRelayOutcome
  status: number
  detail: string
  durationMs: number
}

export interface PreviewRelayAccounting {
  started: number
  outcomes: Record<PreviewRelayOutcome, number>
  events: PreviewRelayEvent[]
}

const defaultRelayEventLimit = 64

export function createPreviewRelayAccounting(): PreviewRelayAccounting {
  return { started: 0, outcomes: { completed: 0, denied: 0, 'client-aborted': 0, 'upstream-failed': 0 }, events: [] }
}

export function recordPreviewRelayEvent(accounting: PreviewRelayAccounting, event: PreviewRelayEvent, limit = defaultRelayEventLimit): void {
  accounting.outcomes[event.outcome] += 1
  accounting.events.push(event)
  if (accounting.events.length > limit) accounting.events.splice(0, accounting.events.length - limit)
}

/**
 * Distinguishes "the browser never got a response" from "the preview produced a response".
 * Requests that never settled are the only class a healthy upstream can lose silently, so
 * they are reported separately instead of being folded into a generic failure count. That
 * split is what separates a browser-side transport abort from a preview-side defect.
 */
export function summarizePreviewRelayAccounting(accounting: PreviewRelayAccounting): string {
  const outcomes = accounting.outcomes
  const settled = outcomes.completed + outcomes.denied + outcomes['client-aborted'] + outcomes['upstream-failed']
  return `started=${accounting.started} completed=${outcomes.completed} denied=${outcomes.denied} client-aborted=${outcomes['client-aborted']} upstream-failed=${outcomes['upstream-failed']} unsettled=${Math.max(0, accounting.started - settled)}`
}

export function previewRelayRejection(request: { method?: string; url?: string; host?: string; origin?: string }, expectedHost: string): { status: number; message: string } | undefined {
  if (request.host?.toLowerCase() !== expectedHost.toLowerCase()) return { status: 403, message: 'Invalid preview host' }
  if (request.origin && request.origin !== 'null' && request.origin !== `http://${expectedHost}`) return { status: 403, message: 'Cross-origin preview request denied' }
  if (request.method !== 'GET' && request.method !== 'HEAD') return { status: 405, message: 'Preview relay allows GET and HEAD only' }
  if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) return { status: 400, message: 'Invalid preview path' }
  let target: URL
  try { target = new URL(request.url, `http://${expectedHost}`) }
  catch { return { status: 400, message: 'Invalid preview path' } }
  let decodedPath: string
  try { decodedPath = decodeURIComponent(target.pathname) }
  catch { return { status: 400, message: 'Invalid preview path' } }
  if (target.origin !== `http://${expectedHost}` || decodedPath.startsWith('//') || decodedPath.includes('\\') || decodedPath.split('/').includes('..')) return { status: 400, message: 'Invalid preview path' }
  return undefined
}

const previews = new Map<string, CandidatePreview>()
const relays = new Map<string, Server>()
const relayAccounting = new Map<string, PreviewRelayAccounting>()
const starting = new Map<string, Promise<CandidatePreview>>()
const projectSourcePreviews = new Map<string, { previewId: string; sourceDigest: string; preview: CandidatePreview; ready: boolean }>()
const projectSourceStarting = new Map<string, Promise<ProjectSourcePreview>>()
const previewNetworkPool = new Map<string, 'available' | 'leased'>()
let previewNetworkPoolReady: Promise<void> | undefined
const rippleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const image = 'node:22-bookworm-slim'

function docker(args: string[], timeoutMs = 20_000, includeStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      clearTimeout(timer)
      reject(new CandidatePreviewError(`无法启动 Docker 隔离预演：${error.message}`))
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve([stdout, ...(includeStderr ? [stderr] : [])].filter(Boolean).join('\n').trim())
      const detail = (stderr || stdout).trim().slice(-4000)
      reject(new CandidatePreviewError(detail || `Docker 命令失败（exit ${String(code)}）`))
    })
  })
}

export async function preparePreviewNetworkPool(size = 4): Promise<void> {
  if (process.platform !== 'linux') return
  if (previewNetworkPoolReady) return previewNetworkPoolReady
  previewNetworkPoolReady = (async () => {
    const created: string[] = []
    try {
      await docker(['version', '--format', '{{.Server.Version}}'])
      for (let index = 0; index < size; index += 1) {
        const name = `ripple-preview-pool-${randomUUID()}`
        await docker(['network', 'create', '--driver', 'bridge', '--internal', '--label', 'com.ripple.preview=true', '--label', 'com.ripple.preview.pool=true', name])
        created.push(name)
        previewNetworkPool.set(name, 'available')
      }
    } catch (error) {
      await Promise.all(created.map(name => docker(['network', 'rm', name]).catch(() => undefined)))
      previewNetworkPool.clear()
      previewNetworkPoolReady = undefined
      throw new CandidatePreviewError(`无法准备隔离预演网络池：${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  return previewNetworkPoolReady
}

async function acquirePreviewNetwork(): Promise<string> {
  // The whole pool is created in one go and reused afterwards, so a network is
  // created before the container it belongs to is launched - which is also
  // before any browser is handed the preview URL. The Vite plugin warms the
  // pool while the server starts; preparing it here is the fallback for entry
  // points that start a preview without that server (the E2E helpers import
  // this module directly). Once the pool exists it is never grown, so a
  // Docker network is never created while a preview page is loading.
  await preparePreviewNetworkPool()
  if (!previewNetworkPool.size) throw new CandidatePreviewError('隔离预演网络池为空；请确认本机 Docker 可用后重新启动预演服务')
  const available = [...previewNetworkPool].find(([, state]) => state === 'available')?.[0]
  if (!available) throw new CandidatePreviewError('隔离预演网络池已耗尽，请等待其他预演结束后重试')
  previewNetworkPool.set(available, 'leased')
  return available
}

function releasePreviewNetwork(networkName: string): void {
  if (previewNetworkPool.has(networkName)) previewNetworkPool.set(networkName, 'available')
}

export async function stopPreviewNetworkPool(): Promise<void> {
  const names = [...previewNetworkPool.keys()]
  previewNetworkPool.clear()
  previewNetworkPoolReady = undefined
  await Promise.all(names.map(name => docker(['network', 'rm', name]).catch(error => {
    if (!(error instanceof CandidatePreviewError) || !/not found|No such network/i.test(error.message)) throw error
  })))
}

function mount(source: string, target: string, readonly = true): string {
  if (source.includes(',')) throw new CandidatePreviewError('预演目录不能包含逗号；Docker 挂载参数无法安全表达此路径')
  return `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`
}

async function waitForEndpoint(endpoint: string, preview: CandidatePreview, containerIp: string): Promise<void> {
  const deadline = Date.now() + 60_000
  let inspectAt = 0
  let lastResponse = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_500) })
      if (response.ok) return
      lastResponse = `${endpoint}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`
    } catch (error) {
      const cause = error instanceof Error && 'cause' in error ? String(error.cause) : ''
      lastResponse = `${endpoint}: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ''}`
    }
    if (Date.now() >= inspectAt) {
      inspectAt = Date.now() + 2_000
      const state = await docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}|{{.State.OOMKilled}}', preview.containerName]).catch(() => 'missing')
      if (!state.startsWith('running|')) {
        const logs = await docker(['logs', '--tail', '80', preview.containerName], 10_000, true).catch(error => error instanceof Error ? error.message : 'no container logs')
        throw new CandidatePreviewError(`隔离预演容器提前停止（${state}）：${logs.slice(-4000)}`)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const [state, logs] = await Promise.all([
    docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}|{{.State.OOMKilled}}', preview.containerName]).catch(() => 'missing'),
    docker(['logs', '--tail', '80', preview.containerName], 10_000, true).catch(error => error instanceof Error ? error.message : 'no container logs'),
  ])
  throw new CandidatePreviewError(`隔离预演未能在 60 秒内启动（${state}，${lastResponse}，容器 ${containerIp}）：${logs.slice(-4000)}`)
}

/**
 * One keep-alive agent per relay. The upstream used to be opened with
 * `connection: close`, so every module request paid a fresh TCP handshake
 * against the container. That kept the browser's six-socket HTTP/1.1 pool
 * saturated for far longer, which widened the window in which module requests
 * sat queued instead of connected.
 */
const relayUpstreamAgents = new WeakMap<Server, Agent>()

export function startHostRelay(
  containerIp: string,
  upstreamPort = 5173,
  accounting = createPreviewRelayAccounting(),
): Promise<{ server: Server; url: string; accounting: PreviewRelayAccounting }> {
  const agent = new Agent({ keepAlive: true, keepAliveMsecs: 5_000, maxSockets: 8, scheduling: 'lifo' })
  let sequence = 0
  const server = createServer((request, response) => {
    const startedAt = Date.now()
    const path = request.url ?? '/'
    const eventSequence = (sequence += 1)
    accounting.started = sequence
    let settled = false
    let deniedStatus = 0
    const settle = (outcome: PreviewRelayOutcome, status: number, detail = ''): void => {
      if (settled) return
      settled = true
      recordPreviewRelayEvent(accounting, {
        sequence: eventSequence,
        path,
        outcome,
        status,
        detail,
        durationMs: Date.now() - startedAt,
      })
    }
    request.once('aborted', () => settle('client-aborted', 0, 'the browser closed the connection before a response was produced'))
    response.once('finish', () => settle(deniedStatus ? 'denied' : 'completed', deniedStatus || response.statusCode, deniedStatus ? 'rejected by the relay boundary' : ''))
    response.once('close', () => settle(
      deniedStatus ? 'denied' : response.writableFinished ? 'completed' : 'client-aborted',
      deniedStatus || response.statusCode,
      deniedStatus ? 'rejected by the relay boundary' : response.writableFinished ? '' : 'the response never finished',
    ))
    const address = server.address()
    const expectedHost = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : ''
    const denied = previewRelayRejection({ method: request.method, url: request.url, host: request.headers.host, origin: request.headers.origin }, expectedHost)
    if (denied) {
      deniedStatus = denied.status
      response.writeHead(denied.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end(denied.message)
      return
    }
    const headers: Record<string, string | string[] | undefined> = {
      host: `${containerIp}:${upstreamPort}`,
      origin: 'null',
      accept: request.headers.accept,
      'accept-encoding': request.headers['accept-encoding'],
      'accept-language': request.headers['accept-language'],
      'cache-control': request.headers['cache-control'],
      'if-none-match': request.headers['if-none-match'],
      'if-modified-since': request.headers['if-modified-since'],
      range: request.headers.range,
      'user-agent': request.headers['user-agent'],
    }
    const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined))
    const upstream = httpRequest({
      host: containerIp,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: safeHeaders,
      agent,
    }, upstreamResponse => {
      const upstreamHeaders = { ...upstreamResponse.headers }
      delete upstreamHeaders['set-cookie']
      delete upstreamHeaders.refresh
      if (upstreamHeaders.location) {
        const location = Array.isArray(upstreamHeaders.location) ? upstreamHeaders.location[0] : upstreamHeaders.location
        try {
          const destination = new URL(location, `http://${containerIp}:${upstreamPort}`)
          if (destination.origin !== `http://${containerIp}:${upstreamPort}`) {
            upstreamResponse.resume()
            deniedStatus = 403
            response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            response.end('External preview redirects are blocked')
            return
          }
          upstreamHeaders.location = `${destination.pathname}${destination.search}${destination.hash}`
        } catch {
          upstreamResponse.resume()
          settle('upstream-failed', 502, 'the preview produced an unparseable redirect')
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
          response.end('Invalid preview redirect')
          return
        }
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamHeaders)
      upstreamResponse.pipe(response)
    })
    upstream.once('error', (error: NodeJS.ErrnoException) => {
      // A keep-alive socket that broke mid-response must not return to the
      // pool, otherwise the next module request inherits a dead connection.
      upstream.destroy()
      const cause = error?.code ?? (error instanceof Error ? error.message : String(error))
      settle('upstream-failed', 502, cause)
      if (request.destroyed || request.aborted) return
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-ripple-relay-error': cause })
      response.end('Candidate preview is unavailable')
    })
    // The browser abandons in-flight module requests whenever its network
    // stack signals a change. Tear the upstream down instead of leaving a
    // half-written response on a pooled socket.
    request.once('aborted', () => upstream.destroy())
    response.once('close', () => { if (!response.writableEnded) upstream.destroy() })
    request.pipe(upstream)
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 35_000
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        agent.destroy()
        server.close()
        return reject(new CandidatePreviewError('无法启动本机预演转发器'))
      }
      relayUpstreamAgents.set(server, agent)
      resolve({ server, url: `http://127.0.0.1:${address.port}/`, accounting })
    })
  })
}

async function closeHostRelay(server: Server | undefined): Promise<void> {
  if (!server?.listening) return
  const agent = relayUpstreamAgents.get(server)
  relayUpstreamAgents.delete(server)
  agent?.destroy()
  const closed = new Promise<void>(resolve => server.close(() => resolve()))
  server.closeAllConnections()
  await closed
}

async function removeContainer(name: string): Promise<void> {
  try { await docker(['rm', '--force', name]) }
  catch (error) {
    if (!(error instanceof CandidatePreviewError) || !/No such container|No such object|not found/i.test(error.message)) throw error
  }
}

async function closePreviewResources(candidateId: string, preview: CandidatePreview): Promise<void> {
  await closeHostRelay(relays.get(candidateId))
  relays.delete(candidateId)
  relayAccounting.delete(candidateId)
  await removeContainer(preview.containerName)
  releasePreviewNetwork(preview.networkName)
  previews.delete(candidateId)
}

async function launchProjectContainer(candidateId: string, projectRoot: string, sourceRoot: string, networkName: string, containerName: string, authorizedResourceUrls: string[], role: 'candidate' | 'baseline' | 'source'): Promise<string> {
  if (process.platform !== 'linux') throw new CandidatePreviewError('隔离预演使用 Linux 容器并挂载原生依赖；请在 Linux 或 WSL2 中运行 Ripple 与目标项目，并将两者放在 Linux 文件系统中')
  const dependencyPath = path.join(projectRoot, 'node_modules')
  if (!fs.existsSync(dependencyPath)) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const dependencies = fs.realpathSync(dependencyPath)
  if (!fs.statSync(dependencies).isDirectory()) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const coreRoot = fs.realpathSync(path.join(rippleRoot, 'src', 'core'))
  const rippleDependencies = fs.realpathSync(path.join(rippleRoot, 'node_modules'))
  const probe: CandidatePreview = { candidateId, url: '', containerName, networkName, authorizedResourceUrls }
  await docker([
    'run', '--detach', '--name', containerName,
    '--label', 'com.ripple.preview=true', '--label', `com.ripple.candidate=${candidateId}`, '--label', `com.ripple.preview.role=${role}`,
    '--network', networkName,
    '--env', `RIPPLE_PREVIEW_RESOURCE_URLS=${JSON.stringify(authorizedResourceUrls)}`,
    '--read-only', '--user', '1000:1000',
    '--memory', '1g', '--cpus', '2', '--pids-limit', '128',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--tmpfs', '/work:rw,nosuid,nodev,noexec,size=1073741824,uid=1000,gid=1000',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=536870912,uid=1000,gid=1000',
    '--mount', mount(sourceRoot, '/source'),
    '--mount', mount(dependencies, '/work/node_modules'),
    '--mount', mount(coreRoot, '/ripple/core'),
    '--mount', mount(rippleDependencies, '/ripple/node_modules'),
    '--workdir', '/work', image,
    'sh', '-lc', 'printf "ripple-preview bootstrap\\n" && find /source -mindepth 1 -maxdepth 1 ! -name .git ! -name node_modules ! -name .ripple-candidate.json -exec cp -R -t /work/ {} + && printf "ripple-preview launching vite\\n" && exec node /ripple/core/candidate-preview-runner.mjs',
  ], 120_000)
  const address = await resolveCandidatePreviewAddress(probe)
  const endpoint = `http://${address}:5173/`
  await waitForEndpoint(endpoint, probe, address)
  await waitForPreviewReadiness(networkName, containerName, async () => parsePreviewContainerInspection(
    await docker(['inspect', '--format', '{{json .State}}|{{json .NetworkSettings.Networks}}', containerName]),
  ), async () => {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_500) })
      return response.ok
    } catch { return false }
  })
  return address
}

export function isCurrentProjectSourcePreview(projectId: string, previewId: string, sourceDigest: string): boolean {
  const current = projectSourcePreviews.get(projectId)
  return current?.ready === true && current.previewId === previewId && current.sourceDigest === sourceDigest && previews.get(previewId) === current.preview
}

export async function startProjectSourcePreview(projectId: string, projectRoot: string, sourceDigest: string, authorizedResourceUrls: string[] = []): Promise<ProjectSourcePreview> {
  const pending = projectSourceStarting.get(projectId)
  if (pending) {
    const active = await pending
    const current = projectSourcePreviews.get(projectId)
    if (active.sourceDigest !== sourceDigest || JSON.stringify(current?.preview.authorizedResourceUrls) !== JSON.stringify(authorizedResourceUrls)) {
      throw new CandidatePreviewError('当前项目已有不同源码版本或资源授权的预览正在启动')
    }
    return active
  }
  const operation = launchProjectSourcePreview(projectId, projectRoot, sourceDigest, authorizedResourceUrls)
  projectSourceStarting.set(projectId, operation)
  try { return await operation }
  finally { if (projectSourceStarting.get(projectId) === operation) projectSourceStarting.delete(projectId) }
}

async function launchProjectSourcePreview(projectId: string, projectRoot: string, sourceDigest: string, authorizedResourceUrls: string[]): Promise<ProjectSourcePreview> {
  const current = projectSourcePreviews.get(projectId)
  if (current?.ready && current.sourceDigest === sourceDigest && JSON.stringify(current.preview.authorizedResourceUrls) === JSON.stringify(authorizedResourceUrls)) {
    const running = await docker(['inspect', '--format', '{{.State.Running}}', current.preview.containerName]).catch(error => {
      if (error instanceof CandidatePreviewError && /No such container|No such object|not found/i.test(error.message)) return 'false'
      throw error
    })
    if (running === 'true' && relays.get(current.previewId)?.listening) {
      const containerIp = await resolveCandidatePreviewAddress(current.preview)
      await waitForEndpoint(current.preview.url, current.preview, containerIp)
      return { projectId, previewId: current.previewId, sourceDigest, url: current.preview.url }
    }
  }
  if (current) {
    await closePreviewResources(current.previewId, current.preview)
    projectSourcePreviews.delete(projectId)
  }

  const projectRootReal = fs.realpathSync(projectRoot)
  const previewId = `project-preview-${randomUUID()}`
  const networkName = await acquirePreviewNetwork()
  const containerName = `ripple-source-preview-${randomUUID().slice(0, 12)}`
  const preview: CandidatePreview = { candidateId: previewId, url: '', containerName, networkName, authorizedResourceUrls: [...authorizedResourceUrls] }
  try {
    previews.set(previewId, preview)
    const containerIp = await launchProjectContainer(previewId, projectRootReal, projectRootReal, networkName, containerName, authorizedResourceUrls, 'source')
    const relay = await startHostRelay(containerIp)
    preview.url = relay.url
    relays.set(previewId, relay.server)
    relayAccounting.set(previewId, relay.accounting)
    await waitForEndpoint(preview.url, preview, containerIp)
    const result = { projectId, previewId, sourceDigest, url: preview.url }
    projectSourcePreviews.set(projectId, { previewId, sourceDigest, preview, ready: true })
    return result
  } catch (error) {
    const cleanupFailures: string[] = []
    try { await closeHostRelay(relays.get(previewId)); relays.delete(previewId) }
    catch (cleanupError) { cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) }
    try { await removeContainer(containerName) }
    catch (cleanupError) { cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) }
    releasePreviewNetwork(networkName)
    if (!cleanupFailures.length) previews.delete(previewId)
    else projectSourcePreviews.set(projectId, { previewId, sourceDigest, preview, ready: false })
    const message = error instanceof Error ? error.message : '项目预览启动失败'
    throw new CandidatePreviewError(cleanupFailures.length ? `${message}；清理仍需重试：${cleanupFailures.join('；')}` : message)
  }
}

export interface ProjectSourcePreviewDiagnostics {
  projectId: string
  previewId: string
  current: boolean
  url: string
  relayListening: boolean
  relaySummary: string
  relayEvents: PreviewRelayEvent[]
  container: string
  upstream: string
}

/**
 * Evidence about one source preview after the fact. A browser that reports transport failures
 * against a preview that never settled those requests is a different defect from one whose
 * upstream answered, so both sides are recorded instead of collapsing them into "failed".
 */
export async function readProjectSourcePreviewDiagnostics(projectId: string, previewId: string): Promise<ProjectSourcePreviewDiagnostics> {
  const entry = projectSourcePreviews.get(projectId)
  const accounting = relayAccounting.get(previewId) ?? createPreviewRelayAccounting()
  const current = entry?.previewId === previewId && previews.get(previewId) === entry?.preview
  const preview = entry?.preview
  const base: ProjectSourcePreviewDiagnostics = {
    projectId,
    previewId,
    current,
    url: preview?.url ?? '',
    relayListening: relays.get(previewId)?.listening ?? false,
    relaySummary: summarizePreviewRelayAccounting(accounting),
    relayEvents: accounting.events.map(event => ({ ...event })),
    container: 'no preview record for this project',
    upstream: 'not probed',
  }
  if (!preview) return base
  const inspection = await docker(['inspect', '--format', '{{json .State}}|{{json .NetworkSettings.Networks}}', preview.containerName], 10_000).catch(error => error instanceof Error ? error.message : 'inspect unavailable')
  if (typeof inspection === 'string' && inspection.includes('|')) {
    try {
      const state = parsePreviewContainerInspection(inspection)
      base.container = `status=${state.status} exit=${state.exitCode} oom=${state.oomKilled} error=${state.error || 'none'} networks=${Object.keys(state.networks).join(',') || 'none'}`
    } catch {
      base.container = inspection.slice(-400)
    }
  } else base.container = String(inspection).slice(-400)
  if (!current) return base
  try {
    const containerIp = await resolveCandidatePreviewAddress(preview)
    const probe = await fetch(`http://${containerIp}:5173/`, { signal: AbortSignal.timeout(2_000) })
    base.upstream = `container ${containerIp}:5173 answered HTTP ${probe.status}`
    await probe.arrayBuffer().catch(() => undefined)
  } catch (error) {
    base.upstream = `container probe failed: ${error instanceof Error ? error.message : String(error)}`
  }
  return base
}

export async function stopProjectSourcePreview(projectId: string, previewId?: string): Promise<void> {
  const pending = projectSourceStarting.get(projectId)
  if (pending) await pending.catch(() => undefined)
  const current = projectSourcePreviews.get(projectId)
  if (!current) return
  if (previewId && current.previewId !== previewId) throw new CandidatePreviewError('项目预览已被替换，拒绝停止新的预览实例')
  await closePreviewResources(current.previewId, current.preview)
  projectSourcePreviews.delete(projectId)
}

export async function startCandidateBaseline(candidate: CandidateRecord, preview: CandidatePreview): Promise<CandidateBaselinePreview> {
  assertCandidateCurrent(candidate)
  if (preview.candidateId !== candidate.id || previews.get(candidate.id) !== preview) throw new CandidatePreviewError('候选基线预演必须使用当前候选的活动网络')
  const projectRoot = fs.realpathSync(candidate.projectRoot)
  const containerName = `ripple-baseline-${candidate.id.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(-40)}-${randomUUID().slice(0, 8)}`
  try {
    const address = await launchProjectContainer(candidate.id, projectRoot, projectRoot, preview.networkName, containerName, preview.authorizedResourceUrls, 'baseline')
    assertCandidateCurrent(candidate)
    return { candidateId: candidate.id, containerName, networkName: preview.networkName, address }
  } catch (error) {
    await removeContainer(containerName).catch(() => undefined)
    throw error
  }
}

export async function stopCandidateBaseline(baseline: CandidateBaselinePreview): Promise<void> {
  await removeContainer(baseline.containerName)
}

export async function startCandidatePreview(candidate: CandidateRecord, authorizedResourceUrls: string[] = []): Promise<CandidatePreview> {
  const pending = starting.get(candidate.id)
  if (pending) return pending
  const operation = launchCandidatePreview(candidate, authorizedResourceUrls)
  starting.set(candidate.id, operation)
  try { return await operation }
  finally { if (starting.get(candidate.id) === operation) starting.delete(candidate.id) }
}

async function launchCandidatePreview(candidate: CandidateRecord, authorizedResourceUrls: string[]): Promise<CandidatePreview> {
  assertCandidateCurrent(candidate)
  const existing = previews.get(candidate.id)
  if (existing) {
    const running = await docker(['inspect', '--format', '{{.State.Running}}', existing.containerName]).catch(error => {
      if (error instanceof CandidatePreviewError && /No such container|No such object|not found/i.test(error.message)) return 'false'
      throw error
    })
    if (running === 'true') {
      if (JSON.stringify(existing.authorizedResourceUrls) !== JSON.stringify(authorizedResourceUrls)) {
        await closePreviewResources(candidate.id, existing)
      } else {
        const containerIp = await resolveCandidatePreviewAddress(existing)
        const relay = relays.get(candidate.id)
        if (!relay?.listening) throw new CandidatePreviewError('候选预演转发器已停止，请重新启动预演')
        await waitForEndpoint(existing.url, existing, containerIp)
        assertCandidateCurrent(candidate)
        return existing
      }
    }
    const stalePreview = previews.get(candidate.id)
    if (stalePreview) await closePreviewResources(candidate.id, stalePreview)
  }

  const projectRoot = fs.realpathSync(candidate.projectRoot)
  const dependencyPath = path.join(projectRoot, 'node_modules')
  if (!fs.existsSync(dependencyPath)) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const dependencies = fs.realpathSync(dependencyPath)
  if (!fs.statSync(dependencies).isDirectory()) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const candidateRoot = fs.realpathSync(candidate.candidateRoot!)
  for (const file of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
    const baseFile = path.join(projectRoot, file)
    const candidateFile = path.join(candidateRoot, file)
    if (fs.existsSync(baseFile) !== fs.existsSync(candidateFile) || (fs.existsSync(baseFile) && !fs.readFileSync(baseFile).equals(fs.readFileSync(candidateFile)))) {
      throw new CandidatePreviewError(`候选修改了依赖清单 ${file}；请先在隔离依赖准备流程中安装候选依赖`)
    }
  }
  const networkName = await acquirePreviewNetwork()
  const containerName = `ripple-preview-${candidate.id.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(-48)}-${randomUUID().slice(0, 8)}`
  const preview: CandidatePreview = { candidateId: candidate.id, url: '', containerName, networkName, authorizedResourceUrls: [...authorizedResourceUrls] }
  try {
    previews.set(candidate.id, preview)
    const containerIp = await launchProjectContainer(candidate.id, projectRoot, candidateRoot, networkName, containerName, authorizedResourceUrls, 'candidate')
    const relay = await startHostRelay(containerIp)
    preview.url = relay.url
    relays.set(candidate.id, relay.server)
    previews.set(candidate.id, preview)
    await waitForEndpoint(preview.url, preview, containerIp)
    assertCandidateCurrent(candidate)
    return preview
  } catch (error) {
    const cleanupFailures: string[] = []
    const relay = relays.get(candidate.id)
    try { await closeHostRelay(relay); relays.delete(candidate.id) }
    catch (cleanupError) { cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) }
    try { await removeContainer(containerName) }
    catch (cleanupError) { cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) }
    releasePreviewNetwork(networkName)
    if (!cleanupFailures.length) previews.delete(candidate.id)
    const message = error instanceof Error ? error.message : '候选预演启动失败'
    throw new CandidatePreviewError(cleanupFailures.length ? `${message}；清理仍需重试：${cleanupFailures.join('；')}` : message)
  }
}

export async function stopCandidatePreview(candidateId: string): Promise<void> {
  const pending = starting.get(candidateId)
  if (pending) await pending.catch(() => undefined)
  const preview = previews.get(candidateId)
  if (!preview) return
  await closePreviewResources(candidateId, preview)
}
