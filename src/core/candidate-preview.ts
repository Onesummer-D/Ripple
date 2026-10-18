import { spawn } from 'node:child_process'
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
}

const previews = new Map<string, CandidatePreview>()
const starting = new Map<string, Promise<CandidatePreview>>()
const rippleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const image = 'node:22-bookworm-slim'

function docker(args: string[], timeoutMs = 20_000): Promise<string> {
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
      if (code === 0) return resolve(stdout.trim())
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

async function waitUntilReady(preview: CandidatePreview): Promise<void> {
  const deadline = Date.now() + 60_000
  let inspectAt = 0
  let lastResponse = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(preview.url, { signal: AbortSignal.timeout(1_500) })
      if (response.ok) return
      lastResponse = `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`
    } catch (error) {
      lastResponse = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() >= inspectAt) {
      inspectAt = Date.now() + 2_000
      const state = await docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}|{{.State.OOMKilled}}', preview.containerName]).catch(() => 'missing')
      if (!state.startsWith('running|')) {
        const logs = await docker(['logs', '--tail', '80', preview.containerName], 10_000).catch(error => error instanceof Error ? error.message : 'no container logs')
        throw new CandidatePreviewError(`隔离预演容器提前停止（${state}）：${logs.slice(-4000)}`)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const [state, logs] = await Promise.all([
    docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}|{{.State.OOMKilled}}', preview.containerName]).catch(() => 'missing'),
    docker(['logs', '--tail', '80', preview.containerName], 10_000).catch(error => error instanceof Error ? error.message : 'no container logs'),
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
      await waitUntilReady(existing)
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
    await waitUntilReady(preview)
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
