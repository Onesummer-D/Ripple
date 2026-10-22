/** Issue #6 — codescandy TEXT candidate gate contract test (v3, file-safety hardened).
 *
 *  Ownership invariant: the passed repo is READ-ONLY. Every physical artifact
 *  lives under an mkdtemp-owned root (prefix 'ripple-b-gate-'); only paths
 *  verified to be inside that root may ever be created/removed by this script.
 *  Illegal candidate locations are only ever PROPOSED to createCandidate
 *  (which rejects them before touching disk) and are never created or deleted
 *  by us.
 *
 *  Modes:
 *    node b-thirdparty-candidate-gate.mjs <repo> [--expect rejected|accepted] [--artifacts <dir>]
 *    node b-thirdparty-candidate-gate.mjs <repo> --selftest [--artifacts <dir>]
 *
 *  --expect rejected (default): the TEXT candidate must be rejected with the
 *    CURRENT expected provenance reasons (composite-jsx-child + data-router
 *    coverage), as a CandidateError, leaving no patch/worktree/mutation.
 *  --expect accepted: for after AC-P2a/AC-P2b — must produce a real
 *    CandidateRecord whose patch AND candidate-worktree bytes demonstrably
 *    contain the replacement (not just a non-empty modifiedPaths list).
 *  --selftest: negative injections (wrong location, malformed ops, foreign
 *    exception), sentinel byte-invariance for pre-existing non-owned paths,
 *    crash-path and double-cleanup safety.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { analyzeProject, digestTrackedTree } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate, CandidateError } from '../src/core/candidate.ts'

const argv = process.argv.slice(2)
const repo = path.resolve(argv[0])
const flagValue = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const expectMode = flagValue('--expect') ?? 'rejected'
const artifactsDir = path.resolve(flagValue('--artifacts') ?? 'test-results')
const selftest = argv.includes('--selftest')
if (!argv[0]) throw new Error('usage: b-thirdparty-candidate-gate.mjs <repo> [--expect rejected|accepted] [--selftest] [--artifacts <dir>]')
if (!['rejected', 'accepted'].includes(expectMode)) throw new Error(`unknown --expect mode: ${expectMode}`)

const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

/** Strict matcher: the CURRENT expected provenance rejection, nothing else. */
const EXPECTED_REASON_PARTS = ['composite-jsx-child', 'data-router']
const isExpectedGateRejection = (error) => {
  if (!(error instanceof CandidateError)) return false
  return EXPECTED_REASON_PARTS.every(part => error.message.includes(part))
}

const findOverviewTarget = (graph) => graph.nodes.find(n =>
  n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))

const REPLACEMENT = 'Overview (reprobe)'
const buildRequest = (graph, target, candidateRoot, artifactRoot, overrides = {}) => ({
  projectRoot: repo,
  candidateRoot,
  artifactRoot,
  graph,
  scope: overrides.scope ?? {
    id: 'scope-reprobe-1', version: 1, decidedBy: 'b-reprobe', decidedAt: new Date().toISOString(),
    strategy: 'shared', includedRefs: [target.id], excludedRefs: [], protectedRefs: [],
  },
  operations: overrides.operations ?? [{
    id: 'op-overview-text', kind: 'TEXT', targetRef: target.id,
    before: target.value, after: target.value.replace('Overview', REPLACEMENT),
  }],
  candidateId: overrides.candidateId,
})

/** The ONLY directory this script may write/remove. */
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-gate-'))
const tempRootReal = fs.realpathSync(tempRoot)
const isOwned = (p) => {
  try {
    const resolved = fs.existsSync(p) ? fs.realpathSync(p) : fs.realpathSync(path.dirname(p)) + path.sep + path.basename(p)
    return resolved === tempRootReal || resolved.startsWith(tempRootReal + path.sep)
  } catch { return false }
}
const removeOwned = (p) => { if (isOwned(p)) fs.rmSync(p, { recursive: true, force: true }) }
let cleanedUp = false
const cleanup = () => {
  if (cleanedUp) return
  cleanedUp = true
  try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* best effort */ }
  if (path.basename(tempRootReal).startsWith('ripple-b-gate-') && tempRootReal !== path.dirname(tempRootReal)) {
    fs.rmSync(tempRootReal, { recursive: true, force: true })
  }
}

/** One attempt. Physical dirs are ALWAYS tempRoot slots; `proposal` fields only
 *  change what we PROPOSE to createCandidate (e.g. an illegal in-repo path,
 *  which createCandidate rejects before any write). */
const attempt = (graph, { slot = 'main', proposal = {}, blockArtifactDir = false, preserveOnCreate = false } = {}) => {
  const target = findOverviewTarget(graph)
  if (!target) throw new Error('Overview TEXT target not found')
  const slotRoot = path.join(tempRoot, slot)
  const localCandidateRoot = path.join(slotRoot, 'candidate-worktree')
  const localArtifactRoot = path.join(slotRoot, 'artifacts')
  if (blockArtifactDir) {
    // simulate a pre-existing FOREIGN file blocking the artifact dir (crash path)
    fs.mkdirSync(slotRoot, { recursive: true })
    fs.writeFileSync(localArtifactRoot, 'foreign-blocker')
  } else {
    fs.mkdirSync(localArtifactRoot, { recursive: true })
  }
  const proposedCandidateRoot = proposal.candidateRoot ?? localCandidateRoot
  const proposedArtifactRoot = proposal.artifactRoot ?? localArtifactRoot
  const t0 = Date.now()
  let outcome
  try {
    const record = createCandidate(buildRequest(graph, target, proposedCandidateRoot, proposedArtifactRoot, proposal))
    outcome = { outcome: 'created', record, elapsedMs: Date.now() - t0 }
  } catch (error) {
    outcome = {
      outcome: 'threw',
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      isCandidateError: error instanceof CandidateError,
      matchesExpectedRejection: isExpectedGateRejection(error),
      elapsedMs: Date.now() - t0,
    }
  }
  // physical cleanup ONLY of owned slot dirs; proposals that were rejected
  // pre-write are never touched (and we assert they do not exist). A created
  // candidate's slots are preserved when the caller must collect evidence.
  const preserve = preserveOnCreate && outcome.outcome === 'created'
  try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', localCandidateRoot], { stdio: 'pipe' }) } catch { /* not registered */ }
  if (!preserve) {
    removeOwned(localCandidateRoot)
    if (!blockArtifactDir) removeOwned(localArtifactRoot)
  }
  outcome.proposalNeverCreated = proposal.candidateRoot ? !fs.existsSync(proposal.candidateRoot) : undefined
  outcome.blockerPreserved = blockArtifactDir ? fs.existsSync(localArtifactRoot) && fs.readFileSync(localArtifactRoot, 'utf8') === 'foreign-blocker' : undefined
  if (blockArtifactDir) removeOwned(localArtifactRoot)
  return outcome
}

const worktreePathSet = () => new Set(
  execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    .split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length).trim()))

const main = () => {
  const graph = analyzeProject(repo, true)
  const target = findOverviewTarget(graph)
  const impact = sourceProvenPageImpact(graph, target.id)
  const repoDigestBefore = digestTrackedTree(repo)
  const worktreesBefore = worktreePathSet()

  if (selftest) {
    const cases = []
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-gate-foreign-'))
    const sentinelFile = path.join(foreign, 'sentinel.bin')
    fs.writeFileSync(sentinelFile, Buffer.from('do-not-touch-' + Date.now()))
    const sentinelBytes = fs.readFileSync(sentinelFile)
    try {
      const base = attempt(graph, { slot: 'base' })
      cases.push({ case: 'base-rejection', pass: base.outcome === 'threw' && base.matchesExpectedRejection === true, detail: base })

      const illegalInRepo = path.join(repo, '.gate-inside')
      const inside = attempt(graph, { slot: 'inside', proposal: { candidateRoot: illegalInRepo } })
      cases.push({
        case: 'negative-wrong-location',
        pass: inside.outcome === 'threw' && inside.isCandidateError === true && inside.matchesExpectedRejection === false
          && inside.proposalNeverCreated === true,
        detail: inside,
      })

      const badOps = attempt(graph, { slot: 'badops', proposal: { operations: 'not-an-array' } })
      cases.push({ case: 'negative-malformed-operations', pass: badOps.outcome === 'threw' && badOps.isCandidateError === true && badOps.matchesExpectedRejection === false, detail: badOps })

      cases.push({ case: 'negative-foreign-exception', pass: isExpectedGateRejection(new TypeError('composite-jsx-child data-router coincidence')) === false, detail: { note: 'foreign TypeError sharing reason substrings' } })

      const crash = attempt(graph, { slot: 'crash', blockArtifactDir: true })
      cases.push({ case: 'crash-path-blocked-artifact-dir', pass: crash.outcome === 'threw' && crash.matchesExpectedRejection === false && crash.blockerPreserved === true, detail: { errorName: crash.errorName, message: crash.message.slice(0, 120) } })

      // double cleanup must be a no-op the second time and must not touch foreign dirs
      cleanup()
      const sentinelAfterFirstCleanup = fs.existsSync(sentinelFile) && fs.readFileSync(sentinelFile).equals(sentinelBytes)
      const foreignIntactAfterCleanup = fs.existsSync(foreign)
      cleanup()
      const sentinelAfterDoubleCleanup = fs.existsSync(sentinelFile) && fs.readFileSync(sentinelFile).equals(sentinelBytes)

      const repoDigestAfter = digestTrackedTree(repo)
      const worktreesAfter = worktreePathSet()
      const postChecks = {
        repoDigestUnchanged: repoDigestAfter === repoDigestBefore,
        worktreeSetUnchanged: worktreesAfter.size === worktreesBefore.size && [...worktreesAfter].every(p => worktreesBefore.has(p)),
        sentinelBytesUnchanged: sentinelAfterFirstCleanup && sentinelAfterDoubleCleanup,
        foreignDirNeverRemoved: foreignIntactAfterCleanup,
        tempRootRemoved: !fs.existsSync(tempRootReal),
      }
      fs.rmSync(foreign, { recursive: true, force: true }) // test-owned sentinel
      const allPass = cases.every(c => c.pass) && Object.values(postChecks).every(v => v === true)
      return { schemaVersion: 3, mode: 'selftest', codescandySha: actual, target: { id: target.id, path: target.location.path }, cases, postChecks, allPass }
    } finally {
      if (fs.existsSync(foreign)) fs.rmSync(foreign, { recursive: true, force: true })
    }
  }

  if (expectMode === 'rejected') {
    const gateResult = attempt(graph, { slot: 'main' })
    const repoDigestAfter = digestTrackedTree(repo)
    const worktreesAfter = worktreePathSet()
    const postChecks = {
      repoDigestUnchanged: repoDigestAfter === repoDigestBefore,
      worktreeSetUnchanged: worktreesAfter.size === worktreesBefore.size && [...worktreesAfter].every(p => worktreesBefore.has(p)),
      noPatchArtifact: !fs.existsSync(tempRootReal) || !scanForPatch(tempRootReal),
      noMarkerFile: !fs.existsSync(path.join(tempRootReal, '.ripple-candidate.json')),
    }
    const pass = gateResult.outcome === 'threw' && gateResult.isCandidateError === true
      && gateResult.matchesExpectedRejection === true
      && Object.values(postChecks).every(v => v === true)
    return { schemaVersion: 3, mode: 'expect-rejected', codescandySha: actual, target: { id: target.id, path: target.location.path, value: JSON.stringify(target.value) }, impact, gate: gateResult, postChecks, pass, note: '拒绝语义正确的绿色不代表真实编辑成功；--expect accepted 供 AC-P2a/AC-P2b 修复后切换。' }
  }

  // expect accepted — real success contract (patch AND candidate bytes verified)
  const gateResult = attempt(graph, { slot: 'main-accepted', preserveOnCreate: true })
  let acceptance = { created: gateResult.outcome === 'created' }
  if (acceptance.created) {
    const record = gateResult.record
    const slotRoot = path.join(tempRoot, 'main-accepted')
    const candidateRoot = path.join(slotRoot, 'candidate-worktree')
    const artifactRoot = path.join(slotRoot, 'artifacts')
    const patchPath = path.join(artifactRoot, `${record.id}.patch`)
    const targetRel = target.location.path
    const candidateFile = path.join(candidateRoot, targetRel)
    const patchText = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : ''
    const candidateText = fs.existsSync(candidateFile) ? fs.readFileSync(candidateFile, 'utf8') : ''
    acceptance = {
      ...acceptance,
      recordShapeOk: typeof record.id === 'string' && record.markerPath.startsWith(candidateRoot) && Array.isArray(record.modifiedPaths),
      modifiedTarget: record.modifiedPaths.includes(targetRel),
      patchContainsReplacement: patchText.includes(REPLACEMENT) && patchText.includes(targetRel),
      candidateBytesContainReplacement: candidateText.includes(REPLACEMENT),
    }
    // cleanup owned slots ONLY AFTER evidence collection
    try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', candidateRoot], { stdio: 'pipe' }) } catch { /* best effort */ }
    removeOwned(candidateRoot)
    removeOwned(artifactRoot)
  }
  const postChecks = {
    repoDigestUnchanged: digestTrackedTree(repo) === repoDigestBefore,
    worktreeSetUnchanged: (() => { const after = worktreePathSet(); return after.size === worktreesBefore.size && [...after].every(p => worktreesBefore.has(p)) })(),
  }
  const pass = acceptance.created && Object.values(acceptance).every(v => v === true) && Object.values(postChecks).every(v => v === true)
  return { schemaVersion: 3, mode: 'expect-accepted', codescandySha: actual, target: { id: target.id, path: target.location.path }, impact, gate: { outcome: gateResult.outcome }, acceptance, postChecks, pass, note: '候选创建成功仅证明门控放行；preview/approval/apply/rollback 仍为独立 NOT RUN 项。' }
}

const scanForPatch = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (scanForPatch(full)) return true }
    else if (entry.name.endsWith('.patch')) return true
  }
  return false
}

let result
try {
  result = main()
} finally {
  fs.mkdirSync(artifactsDir, { recursive: true })
  if (result) fs.writeFileSync(path.join(artifactsDir, 'candidate-gate.json'), JSON.stringify(result, null, 2) + '\n')
  cleanup()
}

console.log(JSON.stringify(result, null, 2))
process.exitCode = result && (result.allPass === false || result.pass === false) ? 1 : 0
