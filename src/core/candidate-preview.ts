import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { CandidateRecord } from './candidate'
import { assertCandidateCurrent } from './candidate'
import { trackedProjectFiles } from './project'

export class CandidatePreviewError extends Error {
  constructor(message: string) { super(message); this.name = 'CandidatePreviewError' }
}

export interface CandidatePreview {
  candidateId: string
  url: string
  containerName: string
  networkName: string
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

export function trustedOriginsFromSources(sources: string[]): string[] {
  const origins = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(/https:\/\/[^\s"'`<>()[\]{}]+/g)) {
      try {
        const url = new URL(match[0].replace(/[),.;]+$/, ''))
        if (url.protocol === 'https:' && !url.username && !url.password) origins.add(url.origin)
      } catch { /* Non-URL text is not a trusted origin. */ }
    }
  }
  if (origins.has('https://fonts.googleapis.com')) origins.add('https://fonts.gstatic.com')
  return [...origins].sort()
}

export function trustedPreviewResourceOrigins(projectRoot: string): string[] {
  const sources: string[] = []
  for (const relative of trackedProjectFiles(projectRoot)) {
    if (!/\.(?:[cm]?[jt]sx?|css|html?|svg|json)$/i.test(relative)) continue
    const file = path.join(projectRoot, relative)
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) continue
    sources.push(fs.readFileSync(file, 'utf8'))
  }
  return trustedOriginsFromSources(sources)
}

const previews = new Map<string, CandidatePreview>()
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

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new CandidatePreviewError('无法分配本机预演端口'))
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitUntilReady(preview: CandidatePreview, containerIp: string): Promise<void> {
  const deadline = Date.now() + 60_000
  const endpoints = [preview.url, ...(containerIp ? [`http://${containerIp}:5173/`] : [])]
  let inspectAt = 0
  let lastResponse = 'no response'
  while (Date.now() < deadline) {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_500) })
        if (response.ok && endpoint === preview.url) return
        if (response.ok) continue
        lastResponse = `${endpoint}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`
      } catch (error) {
        const cause = error instanceof Error && 'cause' in error ? String(error.cause) : ''
        lastResponse = `${endpoint}: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ''}`
      }
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
  throw new CandidatePreviewError(`隔离预演未能在 60 秒内启动（${state}，${lastResponse}）：${logs.slice(-4000)}`)
}

async function removeContainer(name: string): Promise<void> {
  try { await docker(['rm', '--force', name]) }
  catch (error) {
    if (!(error instanceof CandidatePreviewError) || !/No such container|No such object|not found/i.test(error.message)) throw error
  }
}

export async function startCandidatePreview(candidate: CandidateRecord): Promise<CandidatePreview> {
  const pending = starting.get(candidate.id)
  if (pending) return pending
  const operation = launchCandidatePreview(candidate)
  starting.set(candidate.id, operation)
  try { return await operation }
  finally { if (starting.get(candidate.id) === operation) starting.delete(candidate.id) }
}

async function launchCandidatePreview(candidate: CandidateRecord): Promise<CandidatePreview> {
  assertCandidateCurrent(candidate)
  const existing = previews.get(candidate.id)
  if (existing) {
    const running = await docker(['inspect', '--format', '{{.State.Running}}', existing.containerName])
    if (running === 'true') {
      const containerIp = await docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', existing.containerName])
      await waitUntilReady(existing, containerIp)
      assertCandidateCurrent(candidate)
      return existing
    }
    await stopCandidatePreview(candidate.id)
  }

  const projectRoot = fs.realpathSync(candidate.projectRoot)
  const dependencyPath = path.join(projectRoot, 'node_modules')
  if (!fs.existsSync(dependencyPath)) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  const dependencies = fs.realpathSync(dependencyPath)
  if (!fs.statSync(dependencies).isDirectory()) throw new CandidatePreviewError('真实浏览器预演需要已安装的项目 node_modules；请先在受信任环境准备依赖')
  if (process.platform !== 'linux') throw new CandidatePreviewError('隔离预演使用 Linux 容器并挂载原生依赖；请在 Linux 或 WSL2 中运行 Ripple 与目标项目，并将两者放在 Linux 文件系统中')
  const candidateRoot = fs.realpathSync(candidate.candidateRoot!)
  for (const file of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
    const baseFile = path.join(projectRoot, file)
    const candidateFile = path.join(candidateRoot, file)
    if (fs.existsSync(baseFile) !== fs.existsSync(candidateFile) || (fs.existsSync(baseFile) && !fs.readFileSync(baseFile).equals(fs.readFileSync(candidateFile)))) {
      throw new CandidatePreviewError(`候选修改了依赖清单 ${file}；请先在隔离依赖准备流程中安装候选依赖`)
    }
  }
  const coreRoot = fs.realpathSync(path.join(rippleRoot, 'src', 'core'))
  const rippleDependencies = fs.realpathSync(path.join(rippleRoot, 'node_modules'))

  const networkName = `ripple-preview-net-${randomUUID()}`
  const containerName = `ripple-preview-${candidate.id.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(-48)}-${randomUUID().slice(0, 8)}`
  const preview: CandidatePreview = { candidateId: candidate.id, url: '', containerName, networkName }
  let networkCreated = false
  try {
    const port = await availablePort()
    preview.url = `http://127.0.0.1:${port}/`
    previews.set(candidate.id, preview)
    await docker(['version', '--format', '{{.Server.Version}}'])
    await docker(['network', 'create', '--driver', 'bridge', '--internal', '--label', 'com.ripple.preview=true', '--label', `com.ripple.candidate=${candidate.id}`, networkName])
    networkCreated = true
    await docker([
      'run', '--detach', '--name', containerName,
      '--label', 'com.ripple.preview=true',
      '--label', `com.ripple.candidate=${candidate.id}`,
      '--network', networkName,
      '--publish', `127.0.0.1:${port}:5173`,
      '--env', `RIPPLE_PREVIEW_RESOURCE_ORIGINS=${JSON.stringify(trustedPreviewResourceOrigins(projectRoot))}`,
      '--read-only', '--user', '1000:1000',
      '--memory', '1g', '--cpus', '2', '--pids-limit', '128',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--tmpfs', '/work:rw,nosuid,nodev,noexec,size=1073741824,uid=1000,gid=1000',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=536870912,uid=1000,gid=1000',
      '--mount', mount(candidateRoot, '/source'),
      '--mount', mount(dependencies, '/deps'),
      '--mount', mount(coreRoot, '/ripple/core'),
      '--mount', mount(rippleDependencies, '/ripple/node_modules'),
      '--workdir', '/work',
      image,
      'sh', '-lc', 'printf "ripple-preview bootstrap\\n" && cp -R /source/. /work/ && rm -f /work/.git /work/.ripple-candidate.json && rm -rf /work/node_modules && ln -s /deps /work/node_modules && printf "ripple-preview launching vite\\n" && exec node /ripple/core/candidate-preview-runner.mjs',
    ], 120_000)
    const containerIp = await docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', containerName])
    await waitUntilReady(preview, containerIp)
    assertCandidateCurrent(candidate)
    return preview
  } catch (error) {
    await removeContainer(containerName).catch(() => undefined)
    if (networkCreated) await docker(['network', 'rm', networkName]).catch(() => undefined)
    previews.delete(candidate.id)
    if (error instanceof CandidatePreviewError) throw error
    throw new CandidatePreviewError(error instanceof Error ? error.message : '候选预演启动失败')
  }
}

export async function stopCandidatePreview(candidateId: string): Promise<void> {
  const pending = starting.get(candidateId)
  if (pending) await pending.catch(() => undefined)
  const preview = previews.get(candidateId)
  if (!preview) return
  await removeContainer(preview.containerName)
  try { await docker(['network', 'rm', preview.networkName]) }
  catch (error) {
    if (!(error instanceof CandidatePreviewError) || !/not found|No such network/i.test(error.message)) throw error
  }
  previews.delete(candidateId)
}
