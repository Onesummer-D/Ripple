/** Issue #6 — codescandy TEXT candidate gate contract test (hardened).
 *
 *  Modes:
 *    node b-thirdparty-candidate-gate.mjs <repo> [--expect rejected|accepted] [--artifacts <dir>]
 *    node b-thirdparty-candidate-gate.mjs <repo> --selftest [--artifacts <dir>]
 *
 *  --expect rejected (default): asserts the TEXT candidate is rejected with the
 *    CURRENT expected provenance reasons (composite-jsx-child + data-router
 *    coverage), that the rejection is a CandidateError (not any exception), and
 *    that no CandidatePatch / marker / stray worktree / repo mutation survives.
 *  --expect accepted: entry ready for after AC-P2a/AC-P2b land — asserts a real
 *    CandidateRecord is created; downstream lifecycle stays NOT RUN.
 *  --selftest: injects unrelated errors and asserts the strict matcher does NOT
 *    misreport them as the expected gate rejection (no false green).
 *
 *  Safety: all scratch work happens under an mkdtemp-owned directory; only that
 *  directory is ever removed. The audit JSON is written to the artifacts dir
 *  BEFORE any cleanup.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate, CandidateError } from '../src/core/candidate.ts'

const argv = process.argv.slice(2)
const repo = argv[0]
const flag = (name) => argv.includes(name)
const flagValue = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}
const expectMode = flagValue('--expect') ?? 'rejected'
const artifactsDir = path.resolve(flagValue('--artifacts') ?? 'test-results')
const selftest = flag('--selftest')
if (!repo) throw new Error('usage: b-thirdparty-candidate-gate.mjs <repo> [--expect rejected|accepted] [--selftest] [--artifacts <dir>]')
if (!['rejected', 'accepted'].includes(expectMode)) throw new Error(`unknown --expect mode: ${expectMode}`)

const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

/** Strict matcher: the CURRENT expected provenance rejection, nothing else. */
const EXPECTED_REASON_PARTS = ['composite-jsx-child', 'data-router']
const isExpectedGateRejection = (error) => {
  if (!(error instanceof CandidateError)) return false
  const message = error.message
  return EXPECTED_REASON_PARTS.every(part => message.includes(part))
}

const findOverviewTarget = (graph) => graph.nodes.find(n =>
  n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))

const buildRequest = (graph, target, overrides = {}) => ({
  projectRoot: repo,
  candidateRoot: overrides.candidateRoot,
  artifactRoot: overrides.artifactRoot,
  graph,
  scope: overrides.scope ?? {
    id: 'scope-reprobe-1', version: 1, decidedBy: 'b-reprobe', decidedAt: new Date().toISOString(),
    strategy: 'shared', includedRefs: [target.id], excludedRefs: [], protectedRefs: [],
  },
  operations: overrides.operations ?? [{
    id: 'op-overview-text', kind: 'TEXT', targetRef: target.id,
    before: target.value, after: target.value.replace('Overview', 'Overview (reprobe)'),
  }],
})

/** Own ONLY this directory. Created via mkdtemp; verified by prefix before removal. */
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-gate-'))
const cleanup = () => {
  try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* best effort */ }
  const resolved = fs.realpathSync.native ? fs.realpathSync.native(tempRoot) : tempRoot
  if (path.basename(resolved).startsWith('ripple-b-gate-') && resolved !== path.dirname(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

const attempt = (graph, overrides = {}) => {
  const target = findOverviewTarget(graph)
  if (!target) throw new Error('Overview TEXT target not found')
  const candidateRoot = path.join(tempRoot, overrides.slot ?? 'candidate-worktree')
  const artifactRoot = path.join(tempRoot, overrides.slot ? `${overrides.slot}-artifacts` : 'artifacts')
  fs.mkdirSync(artifactRoot, { recursive: true })
  const t0 = Date.now()
  try {
    const record = createCandidate(buildRequest(graph, target, { candidateRoot, artifactRoot, ...overrides }))
    return { outcome: 'created', record, elapsedMs: Date.now() - t0 }
  } catch (error) {
    return {
      outcome: 'threw',
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      isCandidateError: error instanceof CandidateError,
      matchesExpectedRejection: isExpectedGateRejection(error),
      elapsedMs: Date.now() - t0,
    }
  } finally {
    // remove any worktree this attempt may have created, then the slot dir
    try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', candidateRoot], { stdio: 'pipe' }) } catch { /* not created */ }
    fs.rmSync(candidateRoot, { recursive: true, force: true })
    fs.rmSync(artifactRoot, { recursive: true, force: true })
  }
}

/** Post-checks: repo untouched, no stray worktree, no patch/marker artifacts. */
const postChecks = () => {
  const checks = {}
  checks.repoClean = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === ''
  const worktrees = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  checks.worktreeCount = worktrees.split('\n').filter(line => line.startsWith('worktree ')).length
  const patchScan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (patchScan(full)) return true }
      else if (entry.name.endsWith('.patch')) return true
    }
    return false
  }
  checks.noPatchArtifact = !patchScan(tempRoot)
  checks.noMarkerFile = !fs.existsSync(path.join(tempRoot, '.ripple-candidate.json'))
  return checks
}

const graph = analyzeProject(repo, true)
const target = findOverviewTarget(graph)
const impact = sourceProvenPageImpact(graph, target.id)

let result
try {
  if (selftest) {
    const cases = []
    // 1. live base case → must match expected rejection
    const base = attempt(graph, { slot: 'base' })
    cases.push({ case: 'base-rejection', pass: base.outcome === 'threw' && base.matchesExpectedRejection === true, detail: base })
    // 2. live negative: candidateRoot inside project → CandidateError, WRONG reason → matcher must say no
    const inside = attempt(graph, { slot: 'inside', candidateRoot: path.join(repo, '.gate-inside'), artifactRoot: path.join(tempRoot, 'inside-artifacts') })
    cases.push({ case: 'negative-wrong-location', pass: inside.outcome === 'threw' && inside.isCandidateError === true && inside.matchesExpectedRejection === false, detail: inside })
    // 3. live negative: non-array operations → CandidateError, WRONG reason → matcher must say no
    const badOps = attempt(graph, { slot: 'badops', operations: 'not-an-array' })
    cases.push({ case: 'negative-malformed-operations', pass: badOps.outcome === 'threw' && badOps.isCandidateError === true && badOps.matchesExpectedRejection === false, detail: badOps })
    // 4. synthetic: unrelated non-CandidateError must never match
    cases.push({ case: 'negative-foreign-exception', pass: isExpectedGateRejection(new TypeError('composite-jsx-child data-router coincidence')) === false, detail: { note: 'foreign TypeError sharing reason substrings' } })
    const checks = postChecks()
    const allPass = cases.every(c => c.pass) && Object.values(checks).every(v => v === true || (typeof v === 'number' && v >= 1))
    result = { schemaVersion: 2, mode: 'selftest', codescandySha: actual, target: { id: target.id, path: target.location.path }, impact, cases, postChecks: checks, allPass }
  } else if (expectMode === 'rejected') {
    const attemptResult = attempt(graph, { slot: 'main' })
    const checks = postChecks()
    const pass = attemptResult.outcome === 'threw'
      && attemptResult.isCandidateError === true
      && attemptResult.matchesExpectedRejection === true
      && checks.repoClean && checks.noPatchArtifact && checks.noMarkerFile
    result = {
      schemaVersion: 2, mode: 'expect-rejected', codescandySha: actual,
      target: { id: target.id, path: target.location.path, value: JSON.stringify(target.value) },
      impact, gate: attemptResult, postChecks: checks, pass,
      note: '拒绝语义正确的绿色不代表真实编辑成功；--expect accepted 供 AC-P2a/AC-P2b 修复后切换。',
    }
  } else {
    const attemptResult = attempt(graph, { slot: 'main' })
    const checks = postChecks()
    const pass = attemptResult.outcome === 'created'
      && attemptResult.record && Array.isArray(attemptResult.record.modifiedPaths) && attemptResult.record.modifiedPaths.length > 0
    result = {
      schemaVersion: 2, mode: 'expect-accepted', codescandySha: actual,
      target: { id: target.id, path: target.location.path },
      impact, gate: attemptResult, postChecks: checks, pass,
      note: '候选创建成功仅证明门控放行；preview/approval/apply/rollback 仍为独立 NOT RUN 项。',
    }
  }
} finally {
  fs.mkdirSync(artifactsDir, { recursive: true })
  fs.writeFileSync(path.join(artifactsDir, 'candidate-gate.json'), JSON.stringify(result, null, 2) + '\n')
  cleanup()
}

console.log(JSON.stringify(result, null, 2))
process.exitCode = result.allPass === false || result.pass === false ? 1 : 0
