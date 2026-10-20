import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CandidateRecord } from './candidate'
import { assertCandidateCurrent } from './candidate'
import { analyzeProject } from './project'
import { REQUIRED_VERIFICATION_ASSERTION_IDS, type BaselineComparison, type EditSession, type InteractionObservation, type ScopePropagationObservation, type SourceGraph, type VerificationAssertion, type VerificationEvidence, type VerificationRun } from './model'
import { resolveCandidatePreviewAddress, startCandidateBaseline, stopCandidateBaseline, type CandidatePreview } from './candidate-preview'
import { attestBrowserExecution } from './verification-receipt'
import { expectedTextForPage, sourceProvenPageImpact } from './scope'
import { verificationContractHash } from './verification-contract'
import { projectPreviewViewports } from './project-viewports'
import { snapshotAuthorizedPreviewResources, type PreviewResourceSnapshot } from './preview-resource-snapshot'

export class VerificationRunnerError extends Error {
  constructor(message: string) { super(message); this.name = 'VerificationRunnerError' }
}

export const playwrightImage = 'mcr.microsoft.com/playwright:v1.64.0-noble'
const rippleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function docker(args: string[], timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      clearTimeout(timer)
      reject(new VerificationRunnerError(`无法启动隔离 Playwright 执行器：${error.message}`))
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (timedOut) return reject(new VerificationRunnerError(`隔离 Playwright 执行超过 ${timeoutMs}ms；本次验证未产生可信证据`))
      if (code === 0) return resolve()
      const detail = (stderr || stdout).trim().slice(-4000)
      reject(new VerificationRunnerError(detail || `Playwright 执行器失败（exit ${String(code)}）`))
    })
  })
}

function mount(source: string, target: string, readonly = true): string {
  if (source.includes(',')) throw new VerificationRunnerError('验证证据路径不能包含逗号；Docker 挂载参数无法安全表达此路径')
  return `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`
}

function ensureDirectory(directory: string): void {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new VerificationRunnerError('验证证据路径必须由普通目录组成')
}

async function removeExecutor(name: string): Promise<void> {
  await docker(['rm', '--force', name], 10_000).catch(() => undefined)
}

function renderedSourceRefs(graph: SourceGraph, target: SourceGraph['nodes'][number]): string[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  let refs = graph.edges.filter(edge => edge.kind === 'reads' && edge.to === target.id)
    .map(edge => nodes.get(edge.from))
    .filter((node): node is NonNullable<typeof node> => node?.kind === 'jsx-element')
  if (!refs.length && target.location?.start !== undefined && target.location.end !== undefined) {
    const containing = graph.nodes.filter(node => node.kind === 'jsx-element' && node.location?.path === target.location!.path &&
      node.location.start !== undefined && node.location.end !== undefined && node.location.start <= target.location!.start! && node.location.end >= target.location!.end!)
    containing.sort((left, right) => (left.location!.end! - left.location!.start!) - (right.location!.end! - right.location!.start!))
    if (containing.length) refs = [containing[0]]
  }
  const sourceRefs = [...new Set(refs.map(node => `jsx:${node.location!.path}#${node.location!.start}`))]
  return sourceRefs.length === 1 ? sourceRefs : []
}

export function sourceBindings(candidate: CandidateRecord, baseGraph: SourceGraph, candidateGraph: SourceGraph, session: EditSession): Array<{ operationId: string; beforeText: string; expectedText: string; baselineSourceRefs: string[]; sourceRefs: string[]; pageExpectations: Record<string, ReturnType<typeof expectedTextForPage>> }> {
  const baseNodes = new Map(baseGraph.nodes.map(node => [node.id, node]))
  const candidateNodes = new Map(candidateGraph.nodes.map(node => [node.id, node]))
  return session.operations.map(operation => {
    const original = baseNodes.get(operation.targetRef)
    const empty = { operationId: operation.id, beforeText: operation.before, expectedText: operation.after, baselineSourceRefs: [], sourceRefs: [], pageExpectations: {} }
    if (operation.kind !== 'TEXT' || !operation.before.trim() || !operation.after.trim() || original?.kind !== 'data' || !original.location?.path) return empty
    const candidateRef = candidate.operationTargetRefs[operation.id]
    const mapped = candidateRef ? candidateNodes.get(candidateRef) : undefined
    const restoredLiteral = operation.overrideAction === 'remove' && !mapped
      ? candidateGraph.nodes.filter(node => node.kind === 'data' && node.id.startsWith('literal:') &&
        node.location?.path === original.location!.path && node.value?.trim() === original.value?.trim() &&
        JSON.stringify(sourceProvenPageImpact(candidateGraph, node.id).pageRefs) === JSON.stringify(sourceProvenPageImpact(baseGraph, original.id).pageRefs))
      : []
    const data = mapped ?? (restoredLiteral.length === 1 ? restoredLiteral[0] : undefined)
    const removalAnchor = operation.overrideAction === 'remove' && session.scope?.strategy === 'page-override' && (
      (data?.id === operation.targetRef && data.pageOverrides?.[session.scope.localPageRef!] === undefined) ||
      data?.id.startsWith('literal:')
    ) && data?.value?.trim() === original.value?.trim()
    const unchangedAnchor = data?.kind === 'data' && data.location?.path === original.location.path && (
      operation.overrideAction === 'remove'
        ? removalAnchor
        : session.scope?.strategy === 'page-override'
          ? data.id.startsWith('override:') && data.value?.trim() === original.value?.trim() && data.pageOverrides?.[session.scope.localPageRef!] === operation.after
          : data.value?.trim() === operation.after.trim()
    )
    if (!unchangedAnchor || !data) return empty
    const pageRefs = sourceProvenPageImpact(baseGraph, original.id).pageRefs
    const pageExpectations = Object.fromEntries(pageRefs.map(pageRef => [pageRef, expectedTextForPage(original, operation, session.scope!, pageRef)]))
    return { ...empty, baselineSourceRefs: renderedSourceRefs(baseGraph, original), sourceRefs: renderedSourceRefs(candidateGraph, data), pageExpectations }
  })
}

interface ExecutionManifest {
  schemaVersion: 4
  executor: 'playwright'
  completed: true
  runId: string
  candidateId: string
  scopeDecisionId: string
  scopeVersion: number
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  verificationContractHash?: string
  viewports: Array<{ name: string; width: number; height: number }>
  checks: Array<{ id: string; route: string; viewport: { width: number; height: number }; state: string; passed: boolean }>
  baselineComparisons: BaselineComparison[]
  scopeObservations: ScopePropagationObservation[]
  interactionObservations: InteractionObservation[]
  assertions: VerificationAssertion[]
  evidence: Array<Omit<VerificationEvidence, 'artifactPath'> & { artifactPath?: string }>
  artifacts: Array<{ checkId: string; path: string; sha256: string }>
  resourceSnapshots: PreviewResourceSnapshot[]
  unavailableResources: Array<{ url: string; reason: string }>
  loadedExternalResourceUrls: string[]
  blockedExternalResourceUrls: string[]
}

function evidenceFile(runRoot: string, relativePath: string): string {
  const absolute = path.resolve(runRoot, relativePath)
  const relative = path.relative(runRoot, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new VerificationRunnerError('隔离浏览器工件路径超出本次验证目录')
  return absolute
}

function exportResourceSnapshots(runDirectory: string, runId: string, snapshots: PreviewResourceSnapshot[]): void {
  const configuredRoot = process.env.RIPPLE_BROWSER_ARTIFACT_DIR
  if (!configuredRoot || snapshots.length === 0) return
  const exportRoot = path.resolve(process.cwd(), configuredRoot)
  const relativeRoot = path.relative(process.cwd(), exportRoot)
  if (!relativeRoot || relativeRoot === '..' || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
    throw new VerificationRunnerError('资源快照导出目录必须位于当前测试工作区内')
  }
  const destination = path.join(exportRoot, 'resource-snapshots', runId)
  fs.mkdirSync(exportRoot, { recursive: true, mode: 0o700 })
  const realExportRoot = fs.realpathSync(exportRoot)
  const relativeExportRoot = path.relative(process.cwd(), realExportRoot)
  if (!relativeExportRoot || relativeExportRoot === '..' || relativeExportRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeExportRoot)) {
    throw new VerificationRunnerError('资源快照导出目录不能解析到测试工作区之外')
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(destination)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new VerificationRunnerError('资源快照导出目录无效')
  for (const snapshot of snapshots) {
    const source = evidenceFile(runDirectory, snapshot.artifactPath)
    const target = path.join(destination, snapshot.sha256)
    if (fs.existsSync(target)) {
      const existing = fs.lstatSync(target)
      if (existing.isSymbolicLink() || !existing.isFile() || createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== snapshot.sha256) {
        throw new VerificationRunnerError('已有导出资源快照与内容哈希不匹配')
      }
      continue
    }
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  }
}

export async function runCandidateVerification(candidate: CandidateRecord, session: EditSession, baseGraph: SourceGraph, preview: CandidatePreview): Promise<VerificationRun> {
  assertCandidateCurrent(candidate)
  if (!candidate.artifactPath || !candidate.candidateRoot || session.candidate?.id !== candidate.id || !session.scope) throw new VerificationRunnerError('候选、Scope 和补丁工件必须在当前 EditSession 中')
  const candidateGraph = analyzeProject(candidate.candidateRoot, false)
  if (candidateGraph.revision.sourceDigest !== candidate.candidateTreeDigest) throw new VerificationRunnerError('浏览器验证源码图与当前候选补丁摘要不一致')
  const playwrightPackage = JSON.parse(fs.readFileSync(path.join(rippleRoot, 'node_modules', 'playwright', 'package.json'), 'utf8')) as { version?: string }
  if (playwrightPackage.version !== '1.64.0') throw new VerificationRunnerError(`Playwright 容器版本 1.64.0 与本机执行器 ${playwrightPackage.version ?? 'unknown'} 不一致`)
  try {
    await docker(['image', 'inspect', playwrightImage], 10_000)
  } catch (error) {
    throw new VerificationRunnerError(`隔离 Playwright 镜像 ${playwrightImage} 尚未就绪；请先在受信任的运行环境中预拉取并检查镜像。${error instanceof Error ? ` ${error.message}` : ''}`)
  }

  const runId = `verification-${randomUUID()}`
  const artifactParent = fs.realpathSync(path.dirname(candidate.artifactPath))
  const artifactParentStat = fs.lstatSync(artifactParent)
  if (artifactParentStat.isSymbolicLink() || !artifactParentStat.isDirectory()) throw new VerificationRunnerError('候选工件目录不是普通目录')
  const verificationRoot = path.join(artifactParent, 'verification')
  const candidateEvidenceRoot = path.join(verificationRoot, candidate.id)
  ensureDirectory(verificationRoot)
  ensureDirectory(candidateEvidenceRoot)
  const artifactRoot = path.join(candidateEvidenceRoot, runId)
  fs.mkdirSync(artifactRoot, { mode: 0o700 })
  const hostUid = typeof process.getuid === 'function' ? process.getuid() : undefined
  const hostGid = typeof process.getgid === 'function' ? process.getgid() : undefined
  const browserUid = hostUid === undefined || hostUid === 0 ? 1000 : hostUid
  const browserGid = hostGid === undefined || hostUid === 0 ? 1000 : hostGid
  if (process.platform !== 'win32' && hostUid === 0) fs.chownSync(artifactRoot, browserUid, browserGid)
  const inputPath = path.join(artifactRoot, 'input.json')
  const recordPath = path.join(artifactRoot, 'execution.json')
  const containerName = `ripple-verify-${randomUUID().slice(0, 12)}`
  const scriptRoot = fs.realpathSync(path.join(rippleRoot, 'src', 'core'))
  const dependencies = fs.realpathSync(path.join(rippleRoot, 'node_modules'))
  let baseline: Awaited<ReturnType<typeof startCandidateBaseline>> | undefined
  let resourceSnapshotResult: Awaited<ReturnType<typeof snapshotAuthorizedPreviewResources>>
  try {
    resourceSnapshotResult = await snapshotAuthorizedPreviewResources(preview.authorizedResourceUrls, artifactRoot)
    exportResourceSnapshots(artifactRoot, runId, resourceSnapshotResult.snapshots)
    baseline = await startCandidateBaseline(candidate, preview)
    fs.writeFileSync(inputPath, JSON.stringify({
      runId, candidateId: candidate.id, scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
      baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
      runtimeFingerprint: session.projectRevision.runtimeFingerprint,
      verificationContractHash: verificationContractHash(session.verificationContract),
      viewports: projectPreviewViewports.map(({ name, width, height }) => ({ name, width, height })),
      previewHost: await resolveCandidatePreviewAddress(preview), baselineHost: baseline.address,
      targetBindings: sourceBindings(candidate, baseGraph, candidateGraph, session),
      baselineComparisonPageRef: session.verificationContract?.pages.filter(page => page.path === '/' && !page.navigateBy).length === 1
        ? session.verificationContract.pages.find(page => page.path === '/' && !page.navigateBy)!.pageRef
        : undefined,
      routeRefs: baseGraph.nodes.filter(node => node.kind === 'route').map(node => node.id),
      scope: session.scope,
      operations: session.operations,
      scopeTargetPageRefs: Object.fromEntries(session.operations.map(operation => [operation.id, sourceProvenPageImpact(baseGraph, operation.targetRef).pageRefs])),
      verificationContract: session.verificationContract,
      resourceSnapshots: resourceSnapshotResult.snapshots,
      unavailableResources: resourceSnapshotResult.unavailable,
    }), { flag: 'wx' })
    await docker([
      'run', '--rm', '--pull=never', '--init', '--name', containerName,
      '--label', 'com.ripple.verification=true', '--label', `com.ripple.candidate=${candidate.id}`,
      '--network', preview.networkName,
      '--read-only', '--user', `${browserUid}:${browserGid}`, '--env', 'HOME=/tmp', '--env', 'XDG_CACHE_HOME=/tmp/.cache', '--memory', '1g', '--cpus', '2', '--pids-limit', '128',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--shm-size', '256m',
      '--tmpfs', `/tmp:rw,nosuid,nodev,size=1073741824,uid=${browserUid},gid=${browserGid}`,
      '--mount', mount(scriptRoot, '/ripple/core'), '--mount', mount(dependencies, '/ripple/node_modules'),
      '--mount', mount(artifactRoot, '/evidence', false),
      '--workdir', '/ripple', playwrightImage,
      'node', '/ripple/core/candidate-verification-runner.mjs', '/evidence/input.json',
    ])
  } catch (error) {
    throw error instanceof VerificationRunnerError ? error : new VerificationRunnerError(error instanceof Error ? error.message : 'Playwright 执行失败')
  } finally {
    await removeExecutor(containerName)
    if (baseline) await stopCandidateBaseline(baseline)
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
  }

  assertCandidateCurrent(candidate)
  const recordStat = fs.lstatSync(recordPath)
  if (recordStat.isSymbolicLink() || !recordStat.isFile()) throw new VerificationRunnerError('Playwright 执行记录不是普通文件')
  const manifest = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as ExecutionManifest
  const plannedViewports = projectPreviewViewports.map(({ name, width, height }) => ({ name, width, height }))
  if (manifest.schemaVersion !== 4 || manifest.executor !== 'playwright' || manifest.completed !== true || manifest.runId !== runId || manifest.candidateId !== candidate.id ||
    manifest.scopeDecisionId !== candidate.scopeDecisionId || manifest.scopeVersion !== candidate.scopeVersion || manifest.baseSourceDigest !== candidate.baseSourceDigest ||
    manifest.patchHash !== candidate.patchHash || manifest.candidateTreeDigest !== candidate.candidateTreeDigest || manifest.runtimeFingerprint !== session.projectRevision.runtimeFingerprint ||
    manifest.verificationContractHash !== verificationContractHash(session.verificationContract) || JSON.stringify(manifest.viewports) !== JSON.stringify(plannedViewports)) {
    throw new VerificationRunnerError('隔离浏览器返回的执行记录与候选、Scope 或源码版本不匹配')
  }
  const actualAssertionIds = new Set(manifest.assertions.map(assertion => assertion.id))
  if (REQUIRED_VERIFICATION_ASSERTION_IDS.some(id => !actualAssertionIds.has(id))) throw new VerificationRunnerError('浏览器执行记录缺少必需断言')
  if (JSON.stringify(manifest.resourceSnapshots) !== JSON.stringify(resourceSnapshotResult.snapshots) ||
    JSON.stringify(manifest.unavailableResources) !== JSON.stringify(resourceSnapshotResult.unavailable)) {
    throw new VerificationRunnerError('隔离浏览器资源快照记录与本次授权资源不匹配')
  }
  const availableResources = new Map(resourceSnapshotResult.snapshots.map(snapshot => [snapshot.url, snapshot]))
  if (manifest.loadedExternalResourceUrls.some(url => !availableResources.has(url)) ||
    manifest.blockedExternalResourceUrls.some(url => !url || availableResources.has(url))) {
    throw new VerificationRunnerError('浏览器使用或阻止的外部资源与授权快照不一致')
  }
  for (const snapshot of resourceSnapshotResult.snapshots) {
    const file = evidenceFile(artifactRoot, snapshot.artifactPath)
    const bytes = fs.readFileSync(file)
    if (bytes.length !== snapshot.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) {
      throw new VerificationRunnerError('候选浏览器资源快照哈希或字节长度不匹配')
    }
  }
  const checks: VerificationRun['checks'] = manifest.checks.map(check => ({
    id: check.id, route: check.route, viewport: check.viewport, state: check.state,
    description: check.state, mandatory: true,
  }))
  const evidence: VerificationEvidence[] = manifest.evidence.map(item => ({
    ...item,
    ...(item.artifactPath ? { artifactPath: evidenceFile(artifactRoot, item.artifactPath) } : {}),
  }))
  const baselineComparisons: BaselineComparison[] = manifest.baselineComparisons.map(item => ({
    ...item,
    ...(item.artifactPath ? { artifactPath: evidenceFile(artifactRoot, item.artifactPath) } : {}),
  }))
  const scopeObservations = manifest.scopeObservations
  const interactionObservations = manifest.interactionObservations
  const run: VerificationRun = {
    id: runId, candidateId: candidate.id, scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint: session.projectRevision.runtimeFingerprint,
    verificationContractHash: manifest.verificationContractHash,
    startedAt: evidence.length ? evidence[0].capturedAt : new Date().toISOString(),
    completedAt: evidence.length ? evidence[evidence.length - 1].capturedAt : new Date().toISOString(),
    checks, assertions: manifest.assertions, evidence, baselineComparisons, scopeObservations, interactionObservations, status: 'incomplete',
  }
  return attestBrowserExecution(run, recordPath)
}
