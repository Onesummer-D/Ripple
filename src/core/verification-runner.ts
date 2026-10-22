import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CandidateRecord } from './candidate'
import { assertCandidateCurrent } from './candidate'
import { analyzeProject } from './project'
import { REQUIRED_VERIFICATION_ASSERTION_IDS, type BaselineComparison, type BrowserErrorDetails, type EditSession, type InteractionObservation, type ScopePropagationObservation, type SourceGraph, type VerificationAssertion, type VerificationEvidence, type VerificationRun } from './model'
import { resolveCandidatePreviewAddress, startCandidateBaseline, stopCandidateBaseline, type CandidatePreview } from './candidate-preview'
import { attestBrowserExecution } from './verification-receipt'
import { attachVisualEvidenceSafely } from './visual-verification-attach'
import { expectedTextForPage, sourceProvenPageImpact } from './scope'
import { verificationContractHash } from './verification-contract'
import { projectPreviewViewports } from './project-viewports'
import { snapshotAuthorizedPreviewResources, type PreviewResourceSnapshot } from './preview-resource-snapshot'

export class VerificationRunnerError extends Error {
  constructor(message: string) { super(message); this.name = 'VerificationRunnerError' }
}

export const playwrightImage = 'mcr.microsoft.com/playwright:v1.64.0-noble'
// One budget for the host kill and the runner's own deadline; the runner stops
// early enough to persist runner-diagnostic.json before this expires.
export const VERIFICATION_EXECUTION_BUDGET_MS = 180_000
const rippleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function docker(args: string[], timeoutMs = VERIFICATION_EXECUTION_BUDGET_MS): Promise<void> {
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
  /** Supplementary visual captures (capture-only; analysed by the host, advisory only). */
  visualCaptures?: unknown[]
  resourceSnapshots: PreviewResourceSnapshot[]
  unavailableResources: Array<{ url: string; reason: string }>
  loadedExternalResourceUrls: string[]
  blockedExternalResourceUrls: string[]
  browserErrorDetails?: BrowserErrorDetails
}

function evidenceFile(runRoot: string, relativePath: string): string {
  const absolute = path.resolve(runRoot, relativePath)
  const relative = path.relative(runRoot, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new VerificationRunnerError('隔离浏览器工件路径超出本次验证目录')
  return absolute
}

function resolveEvidenceExportRoot(): string | undefined {
  const configuredRoot = process.env.RIPPLE_BROWSER_ARTIFACT_DIR
  if (!configuredRoot) return undefined
  const exportRoot = path.resolve(process.cwd(), configuredRoot)
  const relativeRoot = path.relative(process.cwd(), exportRoot)
  if (!relativeRoot || relativeRoot === '..' || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
    throw new VerificationRunnerError('资源快照导出目录必须位于当前测试工作区内')
  }
  const realExportRoot = fs.realpathSync(exportRoot)
  const relativeExportRoot = path.relative(process.cwd(), realExportRoot)
  if (!relativeExportRoot || relativeExportRoot === '..' || relativeExportRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeExportRoot)) {
    throw new VerificationRunnerError('资源快照导出目录不能解析到测试工作区之外')
  }
  return exportRoot
}

function exportResourceSnapshots(runDirectory: string, runId: string, snapshots: PreviewResourceSnapshot[]): void {
  const exportRoot = resolveEvidenceExportRoot()
  if (!exportRoot || snapshots.length === 0) return
  const destination = path.join(exportRoot, 'resource-snapshots', runId)
  fs.mkdirSync(exportRoot, { recursive: true, mode: 0o700 })
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

// Timing and per-check progress survive a FAILED TO RUN: the docker budget
// kills the container, so the runner streams progress.jsonl into the mounted
// evidence dir and the snapshot phase writes its own timing here. Both are
// copied into the exported evidence root even when verification throws.
// The verification container can write these files, so only bounded regular
// files are read or exported (never symlinks or devices).
const DIAGNOSTIC_FILE_LIMIT_BYTES = 16 * 1024 * 1024
function readDiagnosticFile(filePath: string, maxBytes = DIAGNOSTIC_FILE_LIMIT_BYTES): Buffer | undefined {
  // Open without following a final symlink and without blocking (a FIFO would
  // otherwise hang the open), then check the opened descriptor, so the file
  // cannot be swapped between the check and the read.
  let fd: number
  try { fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)) } catch { return undefined }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) return undefined
    const bytes = Buffer.alloc(stat.size)
    const read = fs.readSync(fd, bytes, 0, stat.size, 0)
    return bytes.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

function exportRunDiagnostics(artifactRoot: string, runId: string): void {
  const exportRoot = resolveEvidenceExportRoot()
  if (!exportRoot) return
  const destination = path.join(exportRoot, 'diagnostics', runId)
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  for (const name of ['progress.jsonl', 'snapshot-timing.json', 'resource-fetch-log.json', 'runner-diagnostic.json', 'failed-to-run.json']) {
    const bytes = readDiagnosticFile(path.join(artifactRoot, name))
    if (bytes) fs.writeFileSync(path.join(destination, name), bytes)
  }
}

export function buildFailedToRunDiagnostic(input: {
  runId: string
  candidateId: string
  scopeDecisionId: string
  scopeVersion: number
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  reason: string
}, progress: unknown[], recordedAt = new Date().toISOString(), runnerDiagnostic?: unknown): Record<string, unknown> {
  const events = progress.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
  const ofKind = (kind: string) => events.filter(item => item.event === kind)
  // Tasks the runner started but never reported as settled: with a budget kill
  // these are exactly the probes that were still running, per viewport.
  const taskStates = new Map<string, Record<string, unknown>>()
  for (const item of ofKind('task')) taskStates.set(`${String(item.checkId)}\u0000${String(item.task)}`, item)
  return {
    schemaVersion: 1,
    executor: 'playwright',
    // Diagnostics only: never completed, never an execution record.
    ...input,
    completed: false,
    status: 'failed-to-run',
    recordedAt,
    completedChecks: ofKind('check-complete'),
    firstErrors: ofKind('first-error').slice(0, 16),
    viewportLifecycle: ofKind('viewport-lifecycle').slice(0, 16),
    unfinishedTasks: [...taskStates.values()].filter(item => item.state === 'started').slice(0, 32),
    lateEvents: events.filter(item => item.late === true).length,
    // Carried as data only, and never allowed to claim completion.
    ...(runnerDiagnostic !== undefined ? { runnerDiagnostic: typeof runnerDiagnostic === 'object' && runnerDiagnostic !== null ? { ...runnerDiagnostic, completed: false } : { unreadable: true } } : {}),
    lastProgress: events.slice(-24),
  }
}

function writeFailedToRunDiagnostic(artifactRoot: string, input: {
  runId: string
  candidateId: string
  scopeDecisionId: string
  scopeVersion: number
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  reason: string
}): void {
  const diagnosticPath = path.join(artifactRoot, 'failed-to-run.json')
  // The container can write into this directory; the host's diagnostic always
  // replaces anything already there under this name.
  fs.rmSync(diagnosticPath, { force: true })
  const progress: unknown[] = (readDiagnosticFile(path.join(artifactRoot, 'progress.jsonl'))?.toString('utf8') ?? '').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  let runnerDiagnostic: unknown
  const runnerDiagnosticBytes = readDiagnosticFile(path.join(artifactRoot, 'runner-diagnostic.json'), 1024 * 1024)
  if (runnerDiagnosticBytes) {
    try { runnerDiagnostic = JSON.parse(runnerDiagnosticBytes.toString('utf8')) } catch { runnerDiagnostic = { unreadable: true } }
  } else if (fs.existsSync(path.join(artifactRoot, 'runner-diagnostic.json'))) runnerDiagnostic = { unreadable: true }
  fs.writeFileSync(diagnosticPath, JSON.stringify(buildFailedToRunDiagnostic(input, progress, undefined, runnerDiagnostic), null, 2), { flag: 'wx' })
}

function readRunnerProgressTail(artifactRoot: string, maxLines = 24): string {
  const bytes = readDiagnosticFile(path.join(artifactRoot, 'progress.jsonl'))
  return bytes ? bytes.toString('utf8').trim().split('\n').filter(Boolean).slice(-maxLines).join('\n') : ''
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
  // Set only when the run itself already failed, so cleanup failures in the
  // finally block can augment it instead of replacing the original diagnostics.
  let pendingFailure: VerificationRunnerError | undefined
  try {
    const snapshotStarted = Date.now()
    resourceSnapshotResult = await snapshotAuthorizedPreviewResources(preview.authorizedResourceUrls, artifactRoot)
    fs.writeFileSync(path.join(artifactRoot, 'snapshot-timing.json'), JSON.stringify({
      totalMs: Date.now() - snapshotStarted,
      snapshotCount: resourceSnapshotResult.snapshots.length,
      unavailableCount: resourceSnapshotResult.unavailable.length,
      totalBytes: resourceSnapshotResult.snapshots.reduce((sum, snapshot) => sum + snapshot.sizeBytes, 0),
    }, null, 2))
    // Run #9's reasons never reached the artifact: they lived only in this
    // in-memory result and input.json is deleted in the finally block. Persist
    // the full staged fetch log so any failure mode is attributable offline.
    fs.writeFileSync(path.join(artifactRoot, 'resource-fetch-log.json'), JSON.stringify({
      unavailable: resourceSnapshotResult.unavailable,
      diagnostics: resourceSnapshotResult.diagnostics,
    }, null, 2))
    // Declared-degradation semantics stay in force: a fully-unavailable
    // snapshot set does NOT hard-fail here. The verification runs, every
    // blocked request is recorded by the runner as a browser error (so the
    // browser-errors assertion keeps the verdict at RISKS — never PASS), and
    // the full reasons above now survive into the artifact. e2e/project-
    // workbench.spec.ts:122 pins this contract with an intentionally
    // unresolvable authorized host.
    exportResourceSnapshots(artifactRoot, runId, resourceSnapshotResult.snapshots)
    baseline = await startCandidateBaseline(candidate, preview)
    fs.writeFileSync(inputPath, JSON.stringify({
      runId, candidateId: candidate.id, scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
      baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
      runtimeFingerprint: session.projectRevision.runtimeFingerprint,
      verificationContractHash: verificationContractHash(session.verificationContract),
      // Absolute kill time (host clock == container clock); the runner stops
      // before it to persist its diagnostic.
      executionDeadlineAt: Date.now() + VERIFICATION_EXECUTION_BUDGET_MS,
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
    ], VERIFICATION_EXECUTION_BUDGET_MS)
  } catch (error) {
    const wrapped = error instanceof VerificationRunnerError ? error : new VerificationRunnerError(error instanceof Error ? error.message : 'Playwright 执行失败')
    const progressTail = readRunnerProgressTail(artifactRoot)
    try {
      writeFailedToRunDiagnostic(artifactRoot, {
        runId, candidateId: candidate.id, scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
        baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
        runtimeFingerprint: session.projectRevision.runtimeFingerprint, reason: wrapped.message,
      })
    } catch { /* failure diagnostics must never mask the original verification error */ }
    pendingFailure = progressTail ? new VerificationRunnerError(`${wrapped.message}\n隔离执行器进度（最后事件）：\n${progressTail}`) : wrapped
    throw pendingFailure
  } finally {
    try { exportRunDiagnostics(artifactRoot, runId) } catch { /* diagnostics must never mask the original failure */ }
    await removeExecutor(containerName)
    // Cleanup stays fail-closed but never masks the original failure: when the
    // run already failed, a baseline-stop error is appended to its message; a
    // run that succeeded so far fails here instead of silently passing with a
    // leftover baseline preview container.
    let cleanupFailure: string | undefined
    if (baseline) {
      try { await stopCandidateBaseline(baseline) } catch (error) { cleanupFailure = error instanceof Error ? error.message : String(error) }
    }
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
    if (cleanupFailure) {
      if (pendingFailure) pendingFailure.message = `${pendingFailure.message}\n基线预演清理失败（保留原失败原因）：${cleanupFailure}`
      else throw new VerificationRunnerError(`验证执行已结束，但基线预演容器清理失败：${cleanupFailure}`)
    }
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
    ...(manifest.browserErrorDetails ? { browserErrorDetails: manifest.browserErrorDetails } : {}),
  }
  // Supplementary visual evidence: host-side analysis of the container's
  // capture-only records. Attached before attestation; advisory, read-only,
  // never part of assertions, status or the approval gate, and never 'pass'.
  // Failures degrade to not-run / failed-to-run entries and never fail the run.
  const visualBindings = sourceBindings(candidate, baseGraph, candidateGraph, session)
  // Legacy flat union stays for traceability; the precise contract is per-side:
  // baseline refs map against baseline geometry, candidate refs against
  // candidate geometry (a JSX offset shift makes the union fail by design).
  const visualTargetRefs = [...new Set(visualBindings.flatMap(binding => [...binding.sourceRefs, ...binding.baselineSourceRefs]))].sort()
  const dualVisualTargetRefs = {
    baseline: [...new Set(visualBindings.flatMap(binding => binding.baselineSourceRefs))].sort(),
    candidate: [...new Set(visualBindings.flatMap(binding => binding.sourceRefs))].sort(),
  }
  // Hard isolation boundary (attachVisualEvidenceSafely): even an unexpected
  // throw from the supplementary attach path must not fail the formal
  // verification; it degrades to an explicit failed-to-run visual entry plus a
  // best-effort diagnostic file.
  attachVisualEvidenceSafely(run, manifest, artifactRoot, candidate, session.projectRevision, visualTargetRefs, dualVisualTargetRefs)
  return attestBrowserExecution(run, recordPath)
}

