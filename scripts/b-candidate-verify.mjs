/** Ripple B — third-party (codescandy) candidate Verification, formal run.
 *
 * Re-creates the ACCEPTED candidate on A's publicly integrated core and then
 * drives A's REAL browser verification interface end to end:
 *
 *   analyzeProject → Scope → createCandidate → EditSession
 *     → preparePreviewNetworkPool → startCandidatePreview (Docker Vite preview)
 *     → runCandidateVerification (isolated Playwright container, 4 viewports)
 *     → VerificationRun (attested) → evidence copy → cleanup → invariance checks
 *
 * This script adds NO verification logic of its own: every browser assertion
 * (target-change, non-target-preserved, scope-propagation, interaction,
 * responsive-layout, source-mapping, browser-errors) is produced by A's
 * executor inside the container. B only wires the real interfaces, retains
 * evidence, and reports verdicts verbatim — incomplete is never promoted to
 * passed.
 *
 * Usage (Linux + Docker host, from the A-core checkout):
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/b-candidate-verify.mjs <codescandy-repo> [--core-sha <full-sha>] [--artifacts <dir>]
 *
 * Exit codes: 0 = complete VerificationRun produced (verdicts in the report);
 * 2 = environment-blocked (no Linux/Docker/image/project-deps); 1 = tool error.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeProject, digestTrackedTree } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate, removeCandidate } from '../src/core/candidate.ts'
import { openSession, recordSourceGraph, chooseScope, stageOperations, stageCandidate, beginVerification, registerVerification } from '../src/core/session.ts'
import { normalizeVerificationContract } from '../src/core/verification-contract.ts'
import { preparePreviewNetworkPool, startCandidatePreview, stopCandidatePreview, stopPreviewNetworkPool } from '../src/core/candidate-preview.ts'
import { runCandidateVerification } from '../src/core/verification-runner.ts'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const coreRepoRoot = path.resolve(scriptDir, '..')

const argv = process.argv.slice(2)
const repo = path.resolve(argv[0])
const flagValue = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const coreSha = flagValue('--core-sha') ?? process.env.B_GATE_CORE_SHA ?? ''
const artifactsDir = path.resolve(flagValue('--artifacts') ?? 'test-results/verification')
if (!argv[0]) throw new Error('usage: b-candidate-verify.mjs <codescandy-repo> [--core-sha <sha>] [--artifacts <dir>]')

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')
const gitRead = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const worktreeList = (root) => gitRead(root, ['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).trim())

const EXPECTED_CODESCANDY = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const ACP2_LINEAGE = process.env.B_GATE_ACP2_ANCESTOR ?? 'f804c7e0908e6dc8831c46ca55b92d357df72c10'
const PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.64.0-noble'
const PREVIEW_IMAGE = 'node:22-bookworm-slim'
const REPLACEMENT = 'Overview (reprobe)'

const state = {
  schemaVersion: 1,
  task: 'thirdparty-codescandy-verification',
  codescandySha: null,
  coreVerification: null,
  platform: { host: `${process.platform}/${process.arch}`, node: process.version },
  docker: {},
  environment: [],
  candidate: null,
  contract: null,
  preview: null,
  verification: null,
  cleanup: {},
  postChecks: {},
  classification: 'incomplete',
  failure: null,
  remainingIssues: [],
}

const classify = () => {
  if (state.failure && state.failure.kind === 'environment') return 'environment-blocked'
  if (!state.verification?.run) return 'incomplete'
  const assertions = state.verification.run.assertions ?? []
  if (!assertions.length) return 'incomplete'
  // EvidenceResult: 'pass' | 'risk' | 'unknown' | 'not-run' | 'failed-to-run' | 'stale'
  if (assertions.every(a => a.result === 'pass')) return 'passed'
  if (assertions.some(a => a.result === 'failed-to-run')) return 'failed'
  return 'incomplete' // risk / unknown / not-run / stale — never promoted to passed
}

let exitCode = 0
const writeReport = () => {
  state.classification = classify()
  fs.mkdirSync(artifactsDir, { recursive: true })
  fs.writeFileSync(path.join(artifactsDir, 'verification-report.json'), JSON.stringify(state, null, 2) + '\n')
}

const envBlock = (where, message) => {
  const entry = { where, message }
  state.environment.push(entry)
  const error = new Error(message)
  error.kind = 'environment'
  error.where = where
  throw error
}

// --- Pinned-source and executing-core verification (same discipline as the gate) ---
const codescandyHead = gitRead(repo, ['rev-parse', 'HEAD'])
if (codescandyHead !== EXPECTED_CODESCANDY) {
  state.failure = { kind: 'tool', where: 'pin', message: `Refusing unpinned checkout: ${codescandyHead}` }
  writeReport()
  throw new Error(state.failure.message)
}
state.codescandySha = codescandyHead

const coreHead = gitRead(coreRepoRoot, ['rev-parse', 'HEAD'])
const lineagePresent = (() => { try { execFileSync('git', ['-C', coreRepoRoot, 'merge-base', '--is-ancestor', ACP2_LINEAGE, 'HEAD'], { stdio: 'pipe' }); return true } catch { return false } })()
state.coreVerification = {
  declared: coreSha || null, actualHead: coreHead,
  headMatchesDeclared: !!coreSha && coreHead === coreSha,
  acp2Ancestor: ACP2_LINEAGE, acp2LineagePresent: lineagePresent,
}
if (!coreSha) { state.failure = { kind: 'tool', where: 'core-verification', message: '--core-sha <full A-integration SHA> is required' }; writeReport(); throw new Error(state.failure.message) }
if (!state.coreVerification.headMatchesDeclared || !lineagePresent) {
  state.failure = { kind: 'tool', where: 'core-verification', message: `executing core ${coreHead} is not the declared A integration (${coreSha}) with AC-P2a/b lineage` }
  writeReport()
  throw new Error(state.failure.message)
}

// --- Environment preflight: Linux host, Docker, images, project deps ---
try {
  if (process.platform !== 'linux') envBlock('platform', `隔离预演要求 Linux 宿主（当前 ${process.platform}）；请在 Linux 或 WSL2 环境运行`)
  state.docker.serverVersion = execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).trim()
  for (const image of [PLAYWRIGHT_IMAGE, PREVIEW_IMAGE]) {
    try { execFileSync('docker', ['image', 'inspect', image], { stdio: 'pipe' }) }
    catch { envBlock('docker-image', `required image ${image} is not present; pre-pull it in the trusted environment`) }
  }
  if (!fs.existsSync(path.join(repo, 'node_modules'))) envBlock('project-deps', 'codescandy node_modules missing; install project dependencies in the trusted environment first')
  if (!fs.existsSync(path.join(coreRepoRoot, 'node_modules', 'playwright', 'package.json'))) envBlock('core-deps', 'Ripple core node_modules missing; run npm ci in the A-core checkout')
} catch (error) {
  if (error.kind !== 'environment') {
    state.failure = { kind: 'environment', where: 'preflight', message: `environment preflight failed: ${error instanceof Error ? error.message : error}` }
    exitCode = 2
  } else {
    state.failure = { kind: 'environment', where: error.where, message: error.message }
    exitCode = 2
  }
  writeReport()
  process.exit(exitCode)
}

// --- Owned workspace ---
const sourceDigestBefore = digestTrackedTree(repo)
const sourceWorktreesBefore = worktreeList(repo)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-verify-'))
const tempRootReal = fs.realpathSync(tempRoot)
const project = path.join(tempRoot, 'project-clone')
const candidateRoot = path.join(tempRoot, 'candidate')
const artifactRoot = path.join(tempRoot, 'artifacts')
let record
let session
let cleanupSteps = { previewStopped: false, candidateRemoved: false, networkPoolStopped: false, tempRootRemoved: false }

try {
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--', repo, project], { stdio: ['ignore', 'ignore', 'pipe'] })
  execFileSync('git', ['-C', project, 'config', 'core.autocrlf', 'false'], { stdio: 'pipe' })
  if (gitRead(project, ['rev-parse', 'HEAD']) !== EXPECTED_CODESCANDY) throw new Error('clone HEAD mismatch')
  // ANALYSIS BASELINE = the gated ACCEPTED baseline: the dependency-free clone
  // (CI policy: fetch exact source, do not execute/install its dependencies).
  // Measured difference (b-analyze-probe): with node_modules present the
  // analyzer resolves one more consumer edge (composite-jsx-child ProfileHeader
  // #131 → literal #2620) whose provenance cannot be source-proven, dropping
  // PageImpact certainty source-proven → partial and failing createCandidate's
  // proof. Deps are therefore added ONLY for the browser preview runtime, after
  // candidate creation, and are excluded from the tracked snapshot.
  const graph = analyzeProject(project, true)
  const target = graph.nodes.find(n => n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))
  if (!target) throw new Error('Overview TEXT target not found')
  const impact = sourceProvenPageImpact(graph, target.id)
  if (JSON.stringify(impact.pageRefs) !== JSON.stringify(['page:/pages/profile'])) throw new Error(`unexpected PageImpact: ${JSON.stringify(impact.pageRefs)}`)

  const impacted = new Set(impact.pageRefs)
  const scope = {
    id: 'scope-reprobe-full-1', version: 1, decidedBy: 'b-reprobe', decidedAt: new Date().toISOString(),
    strategy: 'shared',
    includedRefs: [target.id, ...impact.pageRefs],
    excludedRefs: graph.nodes.filter(n => n.kind === 'route').map(n => n.id).filter(id => !impacted.has(id)),
    protectedRefs: [],
  }
  const operations = [{ id: 'op-overview-text', kind: 'TEXT', targetRef: target.id, before: target.value, after: target.value.replace('Overview', REPLACEMENT) }]
  const routeRefs = graph.nodes.filter(n => n.kind === 'route').map(n => n.id)
  const contract = normalizeVerificationContract({
    pages: [{ pageRef: 'page:/pages/profile', path: '/pages/profile', markerText: REPLACEMENT }],
    interactions: [],
  }, routeRefs)
  state.contract = contract

  const candidateId = `candidate-${randomUUID()}`
  const sessionId = `session-${candidateId.slice('candidate-'.length)}`
  session = openSession(sessionId, graph.revision, '将 ProfileHeader 的 Overview 标签文案改为 "Overview (reprobe)"（B 第三方 Verification 正式验收）', [target.id], contract)
  session = recordSourceGraph(session, graph.id, graph.revision.sourceDigest)
  session = chooseScope(session, scope)
  session = stageOperations(session, operations, [])
  fs.mkdirSync(artifactRoot, { recursive: true })
  record = createCandidate({ projectRoot: project, candidateRoot, artifactRoot, graph, scope, operations, executors: [], candidateId })
  session = stageCandidate(session, record)
  session = beginVerification(session)
  state.candidate = {
    id: record.id, patchHash: record.patchHash, baseSourceDigest: record.baseSourceDigest,
    candidateTreeDigest: record.candidateTreeDigest, modifiedPaths: record.modifiedPaths,
    scopeDecisionId: record.scopeDecisionId, scopeVersion: record.scopeVersion,
    patchArtifact: record.artifactPath,
  }
  // Browser runtime deps: preview containers mount projectRoot/node_modules.
  // Reuse the trusted pre-installed tree (never run project install scripts);
  // info/exclude keeps the symlink out of the tracked snapshot so
  // assertCandidateCurrent keeps matching the analysis-time digest.
  fs.appendFileSync(path.join(project, '.git', 'info', 'exclude'), 'node_modules\n')
  fs.symlinkSync(fs.realpathSync(path.join(repo, 'node_modules')), path.join(project, 'node_modules'), 'dir')
  state.environment.push({
    where: 'analysis-vs-runtime-deps',
    message: 'analysis baseline is the dependency-free clone (gated ACCEPTED baseline); node_modules added after candidate creation for the browser preview runtime only',
  })

  await preparePreviewNetworkPool()
  const preview = await startCandidatePreview(record, [])
  state.preview = { candidateId: preview.candidateId, url: preview.url, containerName: preview.containerName, networkName: preview.networkName, authorizedResourceUrls: preview.authorizedResourceUrls }

  const run = await runCandidateVerification(record, session, graph, preview)
  session = registerVerification(session, run)

  // --- Evidence retention (B-side only copies bytes; assertions are A's) ---
  const verificationRoot = path.join(artifactRoot, 'verification', record.id)
  const evidenceCopyRoot = path.join(artifactsDir, 'evidence')
  fs.mkdirSync(artifactsDir, { recursive: true })
  fs.cpSync(verificationRoot, evidenceCopyRoot, { recursive: true })
  if (record.artifactPath && fs.existsSync(record.artifactPath)) fs.copyFileSync(record.artifactPath, path.join(artifactsDir, `${record.id}.patch`))
  fs.writeFileSync(path.join(artifactsDir, 'verification-run.json'), JSON.stringify(run, null, 2) + '\n')
  fs.writeFileSync(path.join(artifactsDir, 'candidate-record.json'), JSON.stringify(record, null, 2) + '\n')
  const artifactList = []
  const walk = (dir, rel = '') => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const relPath = rel ? `${rel}/${name}` : name
      const stat = fs.lstatSync(full)
      if (stat.isDirectory()) walk(full, relPath)
      else if (stat.isFile() && artifactList.length < 500) artifactList.push({ path: relPath, bytes: stat.size, sha256: sha256hex(fs.readFileSync(full)) })
    }
  }
  walk(evidenceCopyRoot)
  state.verification = {
    run: {
      id: run.id, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt,
      checks: run.checks, assertions: run.assertions,
      baselineComparisons: run.baselineComparisons, scopeObservations: run.scopeObservations,
      interactionObservations: run.interactionObservations,
      browserErrorDetails: run.browserErrorDetails ?? null,
      execution: run.execution,
    },
    sessionStatus: session.status,
    visualEvidenceCount: Array.isArray(run.visualEvidences) ? run.visualEvidences.length : undefined,
    evidenceArtifacts: artifactList,
  }
} catch (error) {
  state.failure = {
    kind: error?.kind === 'environment' ? 'environment' : (error?.name === 'CandidatePreviewError' || error?.name === 'VerificationRunnerError' ? 'runtime' : 'tool'),
    where: error?.where ?? 'execution',
    name: error?.name ?? typeof error,
    message: error instanceof Error ? error.message : String(error),
  }
  exitCode = state.failure.kind === 'environment' ? 2 : 1
} finally {
  // --- Cleanup + invariance (failure paths included) ---
  if (record) {
    try { await stopCandidatePreview(record.id); cleanupSteps.previewStopped = true } catch (error) { state.remainingIssues.push(`preview stop failed: ${error instanceof Error ? error.message : error}`) }
    try { removeCandidate(record); cleanupSteps.candidateRemoved = true } catch (error) { state.remainingIssues.push(`candidate removal failed: ${error instanceof Error ? error.message : error}`) }
  }
  try { await stopPreviewNetworkPool(); cleanupSteps.networkPoolStopped = true } catch (error) { state.remainingIssues.push(`network pool stop failed: ${error instanceof Error ? error.message : error}`) }
  try {
    if (path.basename(tempRootReal).startsWith('ripple-b-verify-') && tempRootReal !== path.dirname(tempRootReal)) fs.rmSync(tempRootReal, { recursive: true, force: true })
    cleanupSteps.tempRootRemoved = !fs.existsSync(tempRootReal)
  } catch (error) { state.remainingIssues.push(`temp root removal failed: ${error instanceof Error ? error.message : error}`) }
  state.cleanup = cleanupSteps
  state.postChecks = {
    sourceRepoDigestUnchanged: digestTrackedTree(repo) === sourceDigestBefore,
    sourceRepoWorktreesUnchanged: (() => { const after = worktreeList(repo); return after.length === sourceWorktreesBefore.length && after.every(p => sourceWorktreesBefore.includes(p)) })(),
    sourceRepoStillPinned: gitRead(repo, ['rev-parse', 'HEAD']) === EXPECTED_CODESCANDY,
    sourceRepoClean: gitRead(repo, ['status', '--porcelain']) === '',
  }
  if (Object.values(state.postChecks).some(v => !v)) {
    state.remainingIssues.push('post-check failure: source repository invariant broken')
    if (exitCode === 0) exitCode = 1
  }
  if (Object.values(cleanupSteps).some(v => !v) && exitCode === 0) exitCode = 1
  writeReport()
}

console.log(JSON.stringify({
  classification: state.classification, exitCode,
  runId: state.verification?.run?.id ?? null,
  assertions: state.verification?.run?.assertions?.map(a => ({ id: a.id, result: a.result, detail: a.detail })) ?? null,
  evidence: artifactsDir,
}, null, 2))
process.exit(exitCode)
