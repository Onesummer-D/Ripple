import { spawn } from 'node:child_process'
import { createServer, request as httpRequest, type Server } from 'node:http'
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

export function addressOnPreviewNetwork(networksJson: string, networkName: string): string {
  const networks = JSON.parse(networksJson) as Record<string, { IPAddress?: string }>
  const address = networks[networkName]?.IPAddress
  if (!address || net.isIP(address) !== 4) throw new CandidatePreviewError(`候选容器未加入预期的 IPv4 预演网络：${networkName}`)
  return address
}

export async function resolveCandidatePreviewAddress(preview: CandidatePreview): Promise<string> {
  const networks = await docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', preview.containerName])
  return addressOnPreviewNetwork(networks, preview.networkName)
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
const starting = new Map<string, Promise<CandidatePreview>>()
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

export function startHostRelay(containerIp: string, upstreamPort = 5173): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const address = server.address()
    const expectedHost = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : ''
    const denied = previewRelayRejection({ method: request.method, url: request.url, host: request.headers.host, origin: request.headers.origin }, expectedHost)
    if (denied) {
      response.writeHead(denied.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end(denied.message)
      return
    }
    const headers: Record<string, string | string[] | undefined> = {
      host: `${containerIp}:${upstreamPort}`,
      connection: 'close',
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
            response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            response.end('External preview redirects are blocked')
            return
          }
          upstreamHeaders.location = `${destination.pathname}${destination.search}${destination.hash}`
        } catch {
          upstreamResponse.resume()
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
          response.end('Invalid preview redirect')
          return
        }
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamHeaders)
      upstreamResponse.pipe(response)
    })
    upstream.once('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Candidate preview is unavailable')
    })
    request.pipe(upstream)
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 35_000
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        return reject(new CandidatePreviewError('无法启动本机预演转发器'))
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

async function closeHostRelay(server: Server | undefined): Promise<void> {
  if (!server?.listening) return
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

async function launchProjectContainer(candidateId: string, projectRoot: string, sourceRoot: string, networkName: string, containerName: string, authorizedResourceUrls: string[], role: 'candidate' | 'baseline'): Promise<string> {
  if (process.platform !== 'linux') throw new CandidatePreviewError('隔离预演使用 Linux 容器并挂载原生依赖；请在 Linux 或 WSL2 中运行 Ripple 与目标项目，并将两者放在 Linux 文件系统中')
  const dependencyPath = path.join(projectRoot, 'node_modules')
  if (!fs.existsSync(dependencyPath)) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const dependencies = fs.realpathSync(dependencyPath)
  if (!fs.statSync(dependencies).isDirectory()) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const coreRoot = fs.realpathSync(path.join(rippleRoot, 'src', 'core'))
  const rippleDependencies = fs.realpathSync(path.join(rippleRoot, 'node_modules'))
  const probe: CandidatePreview = { candidateId, url: '', containerName, networkName, authorizedResourceUrls }
  await docker([
    'run', '--detach', '--rm', '--name', containerName,
    '--label', 'com.ripple.preview=true', '--label', `com.ripple.candidate=${candidateId}`, '--label', `com.ripple.preview.role=${role}`,
    '--network', networkName,
    '--env', `RIPPLE_PREVIEW_RESOURCE_URLS=${JSON.stringify(authorizedResourceUrls)}`,
    '--read-only', '--user', '1000:1000',
    '--memory', '1g', '--cpus', '2', '--pids-limit', '128',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--tmpfs', '/work:rw,nosuid,nodev,noexec,size=1073741824,uid=1000,gid=1000',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=536870912,uid=1000,gid=1000',
    '--mount', mount(sourceRoot, '/source'),
    '--mount', mount(dependencies, '/deps'),
    '--mount', mount(coreRoot, '/ripple/core'),
    '--mount', mount(rippleDependencies, '/ripple/node_modules'),
    '--workdir', '/work', image,
    'sh', '-lc', 'printf "ripple-preview bootstrap\\n" && cp -R /source/. /work/ && rm -f /work/.git /work/.ripple-candidate.json && rm -rf /work/node_modules && ln -s /deps /work/node_modules && printf "ripple-preview launching vite\\n" && exec node /ripple/core/candidate-preview-runner.mjs',
  ], 120_000)
  const address = await resolveCandidatePreviewAddress(probe)
  await waitForEndpoint(`http://${address}:5173/`, probe, address)
  return address
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
        await stopCandidatePreview(candidate.id)
      } else {
        const containerIp = await resolveCandidatePreviewAddress(existing)
        const relay = relays.get(candidate.id)
        if (!relay?.listening) throw new CandidatePreviewError('候选预演转发器已停止，请重新启动预演')
        await waitForEndpoint(existing.url, existing, containerIp)
        assertCandidateCurrent(candidate)
        return existing
      }
    }
    if (previews.has(candidate.id)) await stopCandidatePreview(candidate.id)
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
  const networkName = `ripple-preview-net-${randomUUID()}`
  const containerName = `ripple-preview-${candidate.id.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(-48)}-${randomUUID().slice(0, 8)}`
  const preview: CandidatePreview = { candidateId: candidate.id, url: '', containerName, networkName, authorizedResourceUrls: [...authorizedResourceUrls] }
  let networkCreated = false
  try {
    await docker(['version', '--format', '{{.Server.Version}}'])
    await docker(['network', 'create', '--driver', 'bridge', '--internal', '--label', 'com.ripple.preview=true', '--label', `com.ripple.candidate=${candidate.id}`, networkName])
    networkCreated = true
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
    if (networkCreated) {
      try { await docker(['network', 'rm', networkName]) }
      catch (cleanupError) {
        if (!(cleanupError instanceof CandidatePreviewError) || !/not found|No such network/i.test(cleanupError.message)) cleanupFailures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
      }
    }
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
  await closeHostRelay(relays.get(candidateId))
  relays.delete(candidateId)
  await removeContainer(preview.containerName)
  try { await docker(['network', 'rm', preview.networkName]) }
  catch (error) {
    if (!(error instanceof CandidatePreviewError) || !/not found|No such network/i.test(error.message)) throw error
  }
  previews.delete(candidateId)
}

