/** Issue #6 — codescandy TEXT candidate gate contract test (v4).
 *
 *  Read-only boundary: the passed repo is NEVER written to or git-mutated —
 *  we only run read commands against it (rev-parse, status, worktree list,
 *  digestTrackedTree). All candidate operations run against a script-owned
 *  clone of the pinned HEAD inside an mkdtemp root (prefix 'ripple-b-gate-');
 *  only realpath-verified paths inside that root are ever created/removed.
 *  Illegal candidate locations are refused by the harness pre-flight
 *  ('unsafe-proposal') and NEVER passed to createCandidate, so the core can
 *  never write outside the owned root regardless of its validation order.
 *
 *  Modes:
 *    node b-thirdparty-candidate-gate.mjs <repo> [--expect rejected|accepted] [--artifacts <dir>]
 *    node b-thirdparty-candidate-gate.mjs <repo> --selftest [--artifacts <dir>]
 *
 *  --expect rejected (default): the TEXT candidate must be rejected with the
 *    CURRENT expected provenance reasons (composite-jsx-child + data-router
 *    coverage), as a CandidateError, leaving no patch/worktree/mutation.
 *    The default request intentionally keeps the INCOMPLETE scope
 *    (includedRefs: [target.id]) — this frozen negative proves the gate.
 *  --expect accepted: run only on A's PUBLICLY INTEGRATED core — requires
 *    --core-sha <SHA> (or B_GATE_CORE_SHA) naming that core. Builds the FULL
 *    scope from the actual PageImpact (target + every impacted page included,
 *    all other routes explicitly excluded), passes it to createCandidate,
 *    verifies the Scope the core actually received, then checks the real
 *    CandidateRecord: patch bytes vs record.patchHash, marker consistency, and
 *    that the candidate worktree bytes equal the exact source edit
 *    (original[0:start] + after + original[end:]) before cleanup.
 *  --selftest: negative injections, sentinel byte-invariance, crash path,
 *    double cleanup (rejected-mode contract; unchanged). For a positive
 *    end-to-end see scripts/b-candidate-accepted-fixture.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
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

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')
const gitRead = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const worktreeList = (root) => gitRead(root, ['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).trim())

/** Strict matcher: the CURRENT expected provenance rejection, nothing else. */
const EXPECTED_REASON_PARTS = ['composite-jsx-child', 'data-router']
const isExpectedGateRejection = (error) => {
  if (!(error instanceof CandidateError)) return false
  return EXPECTED_REASON_PARTS.every(part => error.message.includes(part))
}

const findOverviewTarget = (graph) => graph.nodes.find(n =>
  n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))

const REPLACEMENT = 'Overview (reprobe)'

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

/** Script-owned clone of the pinned HEAD — the candidate projectRoot. */
const project = path.join(tempRoot, 'project-clone')
const registeredWorktrees = new Set()
let cleanedUp = false
const cleanup = () => {
  if (cleanedUp) return
  cleanedUp = true
  // remove ONLY worktrees this script registered, from the OWNED clone
  for (const wt of registeredWorktrees) {
    try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', project, 'worktree', 'remove', '--force', wt], { stdio: 'pipe' }) } catch { /* not registered */ }
  }
  if (path.basename(tempRootReal).startsWith('ripple-b-gate-') && tempRootReal !== path.dirname(tempRootReal)) {
    fs.rmSync(tempRootReal, { recursive: true, force: true })
  }
}

try {
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--', repo, project], { stdio: ['ignore', 'ignore', 'pipe'] })
  execFileSync('git', ['-C', project, 'config', 'core.autocrlf', 'false'], { stdio: 'pipe' })
  if (gitRead(project, ['rev-parse', 'HEAD']) !== expected) throw new Error('clone HEAD mismatch')
  if (gitRead(project, ['status', '--porcelain']) !== '') throw new Error('clone is dirty')
} catch (error) {
  console.error('[gate] project clone failed:', error instanceof Error ? error.message : error)
  cleanup() // never leak the script-owned temp root on init failure
  throw error
}

const graph = analyzeProject(project, true)
const target = findOverviewTarget(graph)
if (!target) throw new Error('Overview TEXT target not found')
const impact = sourceProvenPageImpact(graph, target.id)

/** Full legitimate Scope for the accepted path — derived from the ACTUAL
 *  PageImpact: the operation target plus every impacted page is INCLUDED;
 *  every other route is explicitly EXCLUDED (a real decision, not an omission).
 *  This is the wiring the analysis report promised: the accepted run must
 *  never reuse the incomplete default scope below (the frozen negative).
 *  Formal execution requires A's publicly integrated core, recorded via
 *  --core-sha (or B_GATE_CORE_SHA) so the evidence names the core it ran on. */
const coreSha = flagValue('--core-sha') ?? process.env.B_GATE_CORE_SHA ?? ''
const buildFullScope = () => {
  const impacted = new Set(impact.pageRefs)
  return {
    id: 'scope-reprobe-full-1', version: 1, decidedBy: 'b-reprobe', decidedAt: new Date().toISOString(),
    strategy: 'shared',
    includedRefs: [target.id, ...impact.pageRefs],
    excludedRefs: graph.nodes.filter(n => n.kind === 'route').map(n => n.id).filter(id => !impacted.has(id)),
    protectedRefs: [],
  }
}
const fullScope = buildFullScope()

const buildRequest = (candidateRoot, artifactRoot, overrides = {}) => ({
  projectRoot: project,
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

/** One attempt. Physical dirs are ALWAYS tempRoot slots; `proposal` fields only
 *  change what we PROPOSE to createCandidate. With preserveOnCreate, a created
 *  candidate's worktree/artifacts are left in place for evidence collection and
 *  registered for finally-cleanup (removal happens ONLY after verification or
 *  on failure).
 *
 *  Harness pre-flight: createCandidate is ONLY ever invoked with paths inside
 *  the script-owned mkdtemp root. Any proposal touching outside paths is
 *  refused by the harness itself as 'unsafe-proposal' — the core is never
 *  called, so it can never write to a caller/external location regardless of
 *  core validation order or future changes to it (e.g. AC-P2a/b landing). */
const attempt = ({ slot = 'main', proposal = {}, blockArtifactDir = false, preserveOnCreate = false } = {}) => {
  const slotRoot = path.join(tempRoot, slot)
  const localCandidateRoot = path.join(slotRoot, 'candidate-worktree')
  const localArtifactRoot = path.join(slotRoot, 'artifacts')
  if (blockArtifactDir) {
    fs.mkdirSync(slotRoot, { recursive: true })
    fs.writeFileSync(localArtifactRoot, 'foreign-blocker')
  } else {
    fs.mkdirSync(localArtifactRoot, { recursive: true })
  }
  const proposedCandidateRoot = proposal.candidateRoot ?? localCandidateRoot
  const proposedArtifactRoot = proposal.artifactRoot ?? localArtifactRoot
  const t0 = Date.now()
  let outcome
  if (!isOwned(proposedCandidateRoot) || !isOwned(proposedArtifactRoot)) {
    outcome = {
      outcome: 'unsafe-proposal',
      reason: !isOwned(proposedCandidateRoot) ? 'candidateRoot-outside-owned-root' : 'artifactRoot-outside-owned-root',
      coreNotCalled: true,
      elapsedMs: Date.now() - t0,
    }
  } else {
    try {
      const request = buildRequest(proposedCandidateRoot, proposedArtifactRoot, proposal)
      const record = createCandidate(request)
      // Evidence: the exact Scope object the core received (not what we meant to send).
      outcome = { outcome: 'created', record, actualScope: request.scope, slotRoot, localCandidateRoot, localArtifactRoot, elapsedMs: Date.now() - t0 }
    } catch (error) {
      outcome = {
        outcome: 'threw',
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        isCandidateError: error instanceof CandidateError,
        matchesExpectedRejection: isExpectedGateRejection(error),
        coreNotCalled: false,
        elapsedMs: Date.now() - t0,
      }
    }
  }
  const preserve = preserveOnCreate && outcome.outcome === 'created'
  if (preserve) {
    registeredWorktrees.add(localCandidateRoot)
  } else {
    try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', project, 'worktree', 'remove', '--force', localCandidateRoot], { stdio: 'pipe' }) } catch { /* not registered */ }
    removeOwned(localCandidateRoot)
    if (!blockArtifactDir) removeOwned(localArtifactRoot)
  }
  outcome.proposalNeverCreated = proposal.candidateRoot ? !fs.existsSync(proposal.candidateRoot) : undefined
  outcome.blockerPreserved = blockArtifactDir ? fs.existsSync(localArtifactRoot) && fs.readFileSync(localArtifactRoot, 'utf8') === 'foreign-blocker' : undefined
  if (blockArtifactDir) removeOwned(localArtifactRoot)
  return outcome
}

const main = () => {
  const repoDigestBefore = digestTrackedTree(repo)
  const repoWorktreesBefore = worktreeList(repo)

  if (selftest) {
    const cases = []
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-gate-foreign-'))
    const sentinelFile = path.join(foreign, 'sentinel.bin')
    fs.writeFileSync(sentinelFile, Buffer.from('do-not-touch-' + Date.now()))
    const sentinelBytes = fs.readFileSync(sentinelFile)
    try {
      const base = attempt({ slot: 'base' })
      cases.push({ case: 'base-rejection', pass: base.outcome === 'threw' && base.matchesExpectedRejection === true, detail: base })

      // Deterministic location rejection: candidateRoot INSIDE the project clone
      // must be refused by outsideProject on every platform ('项目原目录之外').
      const insideProject = attempt({ slot: 'inside', proposal: { candidateRoot: path.join(project, '.gate-inside') } })
      cases.push({
        case: 'negative-inside-project-location',
        pass: insideProject.outcome === 'threw' && insideProject.isCandidateError === true
          && insideProject.message.includes('项目原目录之外') && insideProject.proposalNeverCreated === true,
        detail: insideProject,
      })

      // Caller-repo proposal must be refused by the HARNESS pre-flight, never
      // reaching createCandidate: the core may write worktrees/markers before
      // its own validation (worktree → marker → assertScope), and once AC-P2a/b
      // land the core could even ACCEPT this location. Distinguish clearly:
      // harness 'unsafe-proposal' = test tool never writes externally; core
      // CandidateError = Ripple public contract (covered by the inside-project
      // case above). Caller-repo integrity is asserted again in postChecks.
      const illegalInRepo = path.join(repo, '.gate-inside')
      const inside = attempt({ slot: 'caller', proposal: { candidateRoot: illegalInRepo } })
      cases.push({
        case: 'negative-caller-repo-proposal',
        pass: inside.outcome === 'unsafe-proposal' && inside.coreNotCalled === true && inside.proposalNeverCreated === true,
        detail: inside,
      })

      const badOps = attempt({ slot: 'badops', proposal: { operations: 'not-an-array' } })
      cases.push({ case: 'negative-malformed-operations', pass: badOps.outcome === 'threw' && badOps.isCandidateError === true && badOps.matchesExpectedRejection === false, detail: badOps })

      cases.push({ case: 'negative-foreign-exception', pass: isExpectedGateRejection(new TypeError('composite-jsx-child data-router coincidence')) === false, detail: { note: 'foreign TypeError sharing reason substrings' } })

      const crash = attempt({ slot: 'crash', blockArtifactDir: true })
      cases.push({ case: 'crash-path-blocked-artifact-dir', pass: crash.outcome === 'threw' && crash.matchesExpectedRejection === false && crash.blockerPreserved === true, detail: { errorName: crash.errorName, message: crash.message.slice(0, 120) } })

      // capture project-clone cleanliness BEFORE cleanup() deletes the clone
      const callerProjectUntouched = gitRead(project, ['status', '--porcelain']) === ''
      cleanup()
      const sentinelAfterFirst = fs.existsSync(sentinelFile) && fs.readFileSync(sentinelFile).equals(sentinelBytes)
      const foreignIntact = fs.existsSync(foreign)
      cleanup()
      const sentinelAfterDouble = fs.existsSync(sentinelFile) && fs.readFileSync(sentinelFile).equals(sentinelBytes)

      const postChecks = {
        callerRepoDigestUnchanged: digestTrackedTree(repo) === repoDigestBefore,
        callerRepoWorktreesUnchanged: (() => { const after = worktreeList(repo); return after.length === repoWorktreesBefore.length && after.every(p => repoWorktreesBefore.includes(p)) })(),
        callerProjectUntouched,
        sentinelBytesUnchanged: sentinelAfterFirst && sentinelAfterDouble,
        foreignDirNeverRemoved: foreignIntact,
        tempRootRemoved: !fs.existsSync(tempRootReal),
      }
      fs.rmSync(foreign, { recursive: true, force: true }) // test-owned sentinel
      const allPass = cases.every(c => c.pass) && Object.values(postChecks).every(v => v === true)
      return { schemaVersion: 4, mode: 'selftest', codescandySha: actual, projectClone: 'script-owned', target: { id: target.id, path: target.location.path }, cases, postChecks, allPass }
    } finally {
      if (fs.existsSync(foreign)) fs.rmSync(foreign, { recursive: true, force: true })
    }
  }

  if (expectMode === 'rejected') {
    const gateResult = attempt({ slot: 'main' })
    const scanForPatch = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { if (scanForPatch(full)) return true }
        else if (entry.name.endsWith('.patch')) return true
      }
      return false
    }
    const postChecks = {
      callerRepoDigestUnchanged: digestTrackedTree(repo) === repoDigestBefore,
      callerRepoWorktreesUnchanged: (() => { const after = worktreeList(repo); return after.length === repoWorktreesBefore.length && after.every(p => repoWorktreesBefore.includes(p)) })(),
      callerProjectUntouched: gitRead(project, ['status', '--porcelain']) === '',
      noPatchArtifactInOwnedRoot: !scanForPatch(tempRootReal),
      noMarkerFile: !fs.existsSync(path.join(tempRootReal, '.ripple-candidate.json')),
    }
    const pass = gateResult.outcome === 'threw' && gateResult.isCandidateError === true
      && gateResult.matchesExpectedRejection === true
      && Object.values(postChecks).every(v => v === true)
    return { schemaVersion: 4, mode: 'expect-rejected', codescandySha: actual, projectClone: 'script-owned', target: { id: target.id, path: target.location.path, value: JSON.stringify(target.value) }, impact, gate: gateResult, postChecks, pass, note: '拒绝语义正确的绿色不代表真实编辑成功；真实成功正例见 scripts/b-candidate-accepted-fixture.mjs。' }
  }

  // ---- expect accepted: real success contract, evidence before cleanup ----
  // Formal-execution guard: the run MUST name the A core SHA it executes on —
  // a rehearsal/pre-integration SHA must never produce an ACCEPTED verdict.
  if (!coreSha) throw new Error('--expect accepted requires --core-sha <A-integrated-SHA> (or B_GATE_CORE_SHA) so the evidence names the core it ran on')
  const gateResult = attempt({ slot: 'main-accepted', proposal: { scope: fullScope }, preserveOnCreate: true })
  const acceptance = { created: gateResult.outcome === 'created' }
  // Scope wiring check: the Scope the core actually received must be the full
  // PageImpact-derived scope (target + every impacted page included), never
  // the incomplete default. Reference identity proves no middleware swapped it.
  const requiredIncluded = [target.id, ...impact.pageRefs]
  acceptance.scopeVerification = {
    coreSha,
    actualScopePresent: !!gateResult.actualScope,
    actualScopeIsFullScope: gateResult.actualScope === fullScope,
    targetIncluded: !!gateResult.actualScope && gateResult.actualScope.includedRefs.includes(target.id),
    allImpactedPagesIncluded: !!gateResult.actualScope && requiredIncluded.every(ref => gateResult.actualScope.includedRefs.includes(ref)),
    unimpactedRoutesExplicitlyExcluded: !!gateResult.actualScope && fullScope.excludedRefs.every(ref => gateResult.actualScope.excludedRefs.includes(ref)),
    noProtectedRefs: !!gateResult.actualScope && gateResult.actualScope.protectedRefs.length === 0,
  }
  try {
    if (acceptance.created) {
      const record = gateResult.record
      const { localCandidateRoot, localArtifactRoot } = gateResult
      const patchPath = path.join(localArtifactRoot, `${record.id}.patch`)
      const targetRel = target.location.path
      const candidateFile = path.join(localCandidateRoot, targetRel)
      const patchBytes = fs.existsSync(patchPath) ? fs.readFileSync(patchPath) : Buffer.alloc(0)
      const marker = fs.existsSync(record.markerPath) ? JSON.parse(fs.readFileSync(record.markerPath, 'utf8')) : null
      const originalBytes = fs.readFileSync(path.join(project, targetRel), 'utf8')
      const candidateBytes = fs.existsSync(candidateFile) ? fs.readFileSync(candidateFile, 'utf8') : ''
      const { start, end } = target.location
      const op = buildRequest(localCandidateRoot, localArtifactRoot).operations[0]
      const expectedCandidate = originalBytes.slice(0, start) + op.after + originalBytes.slice(end)
      acceptance.verification = {
        recordShapeOk: typeof record.id === 'string' && Array.isArray(record.modifiedPaths) && record.markerPath === path.join(localCandidateRoot, '.ripple-candidate.json'),
        modifiedTarget: record.modifiedPaths.includes(targetRel),
        patchHashMatchesBytes: sha256hex(patchBytes) === record.patchHash,
        markerMatchesRecord: !!marker && marker.id === record.id && marker.baseSourceDigest === record.baseSourceDigest,
        candidateBytesExactEdit: candidateBytes === expectedCandidate,
        candidateTreeDigestMatches: digestTrackedTree(localCandidateRoot) === record.candidateTreeDigest,
      }
    }
  } finally {
    // ALWAYS release the preserved candidate after verification (or failure)
    if (gateResult.outcome === 'created') {
      try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', project, 'worktree', 'remove', '--force', gateResult.localCandidateRoot], { stdio: 'pipe' }) } catch { /* best effort */ }
      registeredWorktrees.delete(gateResult.localCandidateRoot)
      removeOwned(gateResult.localCandidateRoot)
      removeOwned(gateResult.localArtifactRoot)
    }
  }
  const postChecks = {
    callerRepoDigestUnchanged: digestTrackedTree(repo) === repoDigestBefore,
    callerRepoWorktreesUnchanged: (() => { const after = worktreeList(repo); return after.length === repoWorktreesBefore.length && after.every(p => repoWorktreesBefore.includes(p)) })(),
    callerProjectCleanAfterCandidateRemoval: gitRead(project, ['status', '--porcelain']) === '',
    noOwnedWorktreeLeft: !fs.existsSync(gateResult.localCandidateRoot ?? path.join(tempRoot, 'none')),
  }
  const pass = acceptance.created
    && Object.values(acceptance.verification ?? {}).every(v => v === true)
    && Object.values(acceptance.scopeVerification).every(v => v === true)
    && Object.values(postChecks).every(v => v === true)
  return {
    schemaVersion: 5, mode: 'expect-accepted', codescandySha: actual, coreSha, projectClone: 'script-owned',
    target: { id: target.id, path: target.location.path },
    impact,
    scope: { proposed: fullScope, actual: gateResult.actualScope },
    gate: { outcome: gateResult.outcome },
    acceptance, postChecks, pass,
    note: '候选创建成功仅证明门控放行；preview/approval/apply/rollback 仍为独立 NOT RUN 项。正式 ACCEPTED 只能在 A 公共集成 SHA（coreSha）上宣告。',
  }
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
