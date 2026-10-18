import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Approval, CandidatePatch, EditSession, ProjectRevision, ScopeDecision, VerificationRun } from './model'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from './session'
import { attestBrowserExecution } from './verification-receipt'

const revision: ProjectRevision = { projectId: 'bolt-shop', sourceDigest: 'tree-old', runtimeFingerprint: 'lock+vite+mock-data' }
const scope = (version = 1, id = 'scope-1'): ScopeDecision => ({ id, version, includedRefs: ['home.title', 'autumn.title'], excludedRefs: ['product.price'], protectedRefs: ['story.2018'], decidedBy: 'user', decidedAt: '2026-10-18T00:00:00Z' })
const candidate = (s: ScopeDecision): CandidatePatch => ({ id: `candidate-${s.version}`, baseSourceDigest: revision.sourceDigest, scopeDecisionId: s.id, scopeVersion: s.version, patchHash: `patch-${s.version}`, candidateTreeDigest: `tree-${s.version}`, diffArtifact: '/sandbox/candidate.patch', operations: [{ id: 'edit-1', kind: 'TEXT', targetRef: 'home.title', before: '旧名称', after: '新名称' }, { id: 'edit-2', kind: 'TEXT', targetRef: 'autumn.title', before: '旧名称', after: '新名称' }] })
const artifactRoots: string[] = []
const assertionIds = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']
const runFor = (p: CandidatePatch, result: 'pass' | 'risk' | 'unknown' = 'pass', assertionResult: 'pass' | 'risk' | 'unknown' = 'pass'): VerificationRun => {
  const id = `run-${p.id}`
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-verification-test-'))
  artifactRoots.push(artifactRoot)
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
  const artifactPath = path.join(artifactRoot, 'candidate.png')
  fs.writeFileSync(artifactPath, screenshot)
  const assertions = assertionIds.map(assertionId => ({ id: assertionId, result: assertionId === 'interaction' ? assertionResult : 'pass' as const, detail: `${assertionId} asserted by browser runner` }))
  const run: VerificationRun = {
    id, candidateId: p.id, scopeDecisionId: p.scopeDecisionId, scopeVersion: p.scopeVersion,
    baseSourceDigest: p.baseSourceDigest, patchHash: p.patchHash, candidateTreeDigest: p.candidateTreeDigest,
    runtimeFingerprint: revision.runtimeFingerprint, startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z',
    checks: [{ id: 'desktop', route: '/', viewport: { width: 1440, height: 900 }, state: 'loaded', mandatory: true, description: 'title visible' }],
    assertions,
    evidence: [{ id: `e-${p.id}`, checkId: 'desktop', result, pageUrl: 'http://127.0.0.1:5173/', capturedAt: '2026-10-18T00:00:30Z', viewport: { width: 1440, height: 900 }, runtimeState: 'loaded', elementRefs: ['home.title'], artifactPath: result === 'pass' ? artifactPath : undefined, artifactHash: result === 'pass' ? createHash('sha256').update(screenshot).digest('hex') : undefined }],
    status: 'incomplete',
  }
  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 1, executor: 'playwright', completed: true, runId: run.id, candidateId: run.candidateId,
    scopeDecisionId: run.scopeDecisionId, scopeVersion: run.scopeVersion,
    baseSourceDigest: run.baseSourceDigest, patchHash: run.patchHash, candidateTreeDigest: run.candidateTreeDigest,
    runtimeFingerprint: run.runtimeFingerprint,
    checks: run.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: result === 'pass' })),
    assertions, evidence: run.evidence.map(item => ({ ...item, ...(item.artifactPath ? { artifactPath: path.basename(item.artifactPath) } : {}) })),
    artifacts: result === 'pass' ? [{ checkId: 'desktop', path: path.basename(artifactPath), sha256: createHash('sha256').update(screenshot).digest('hex') }] : [],
  }))
  return attestBrowserExecution(run, recordPath)
}
const approvalFor = (p: CandidatePatch, run: VerificationRun): Approval => ({ candidateId: p.id, verificationRunId: run.id, by: 'user', at: '2026-10-18T00:02:00Z' })
const analyzed = () => recordSourceGraph(openSession('session-1', revision, '更新本季活动，保留历史'), 'graph-1', revision.sourceDigest)
const staged = () => { const s = scope(); const withScope = chooseScope(analyzed(), s); return stageCandidate(stageOperations(withScope, candidate(s).operations), candidate(s)) }

describe('Project-first session invariants', () => {
  afterEach(() => { for (const root of artifactRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
  it('retains raw intent and accepts multiple operations under explicit scope', () => {
    const decision = scope()
    const operations = candidate(decision).operations
    const edited = stageOperations(chooseScope(analyzed(), decision), operations)
    expect(edited.operations).toEqual(operations)
    const s = stageCandidate(edited, candidate(decision))
    expect(s.rawIntent).toBe('更新本季活动，保留历史')
    expect(s.candidate?.operations).toHaveLength(2)
    expect(s.scope?.protectedRefs).toEqual(['story.2018'])
  })
  it('rejects protected/included overlap', () => {
    expect(() => chooseScope(analyzed(), { ...scope(), protectedRefs: ['home.title'] })).toThrow(/conflicts/)
  })
  it('blocks an operation against protected or unapproved target', () => {
    const s = scope()
    expect(() => stageOperations(chooseScope(analyzed(), s), [{ id: 'bad', kind: 'TEXT', targetRef: 'story.2018', before: 'a', after: 'b' }])).toThrow(/unscoped/)
  })
  it('rejects a candidate whose operations differ from the current EditSession', () => {
    const decision = scope()
    const edited = stageOperations(chooseScope(analyzed(), decision), candidate(decision).operations)
    expect(() => stageCandidate(edited, { ...candidate(decision), operations: [{ ...candidate(decision).operations[0], after: 'regenerated edit' }] })).toThrow(/exact operations/)
  })
  it('rejects evidence from another patch or runtime environment', () => {
    const s = staged()
    expect(() => registerVerification(s, { ...runFor(s.candidate!), patchHash: 'old-patch' })).toThrow(/does not match/)
    expect(() => registerVerification(s, { ...runFor(s.candidate!), runtimeFingerprint: 'different-env' })).toThrow(/does not match/)
  })
  it('rejects trusted browser records that carry another Scope decision/version', () => {
    const s = staged()
    const patch = s.candidate!
    const run = runFor({ ...patch, scopeDecisionId: 'another-scope', scopeVersion: patch.scopeVersion + 1 })
    expect(() => registerVerification(s, run)).toThrow(/candidate scope/)
  })
  it('does not allow passing checks without an evidence artifact', () => {
    const s = staged(), run = runFor(s.candidate!)
    expect(() => registerVerification(s, { ...run, evidence: run.evidence.map(e => ({ ...e, artifactPath: undefined, artifactHash: undefined })) })).toThrow(/trusted Playwright executor/)
  })
  it('rejects evidence with the wrong page, missing artifact hash, or capture outside its run', () => {
    const s = staged(), run = runFor(s.candidate!)
    expect(() => registerVerification(s, { ...run, evidence: run.evidence.map(e => ({ ...e, pageUrl: 'http://127.0.0.1:5173/autumn' })) })).toThrow(/trusted Playwright executor/)
    expect(() => registerVerification(s, { ...run, evidence: run.evidence.map(e => ({ ...e, artifactHash: undefined })) })).toThrow(/trusted Playwright executor/)
    expect(() => registerVerification(s, { ...run, evidence: run.evidence.map(e => ({ ...e, capturedAt: '2026-10-18T00:02:00Z' })) })).toThrow(/trusted Playwright executor/)
  })
  it('rejects approval for risk/unknown and incomplete verification', () => {
    for (const result of ['risk', 'unknown'] as const) {
      const s = staged(), run = runFor(s.candidate!, result)
      const verified = registerVerification(s, run)
      expect(verified.status).toBe('candidate')
      expect(() => approve(verified, approvalFor(s.candidate!, run))).toThrow(/Only a verified/)
    }
  })
  it('does not mark a candidate passed when required browser assertions remain unknown', () => {
    const s = staged(), run = runFor(s.candidate!, 'pass', 'unknown')
    const verified = registerVerification(s, run)
    expect(verified.status).toBe('candidate')
    expect(verified.runs.at(-1)?.status).toBe('incomplete')
    expect(() => approve(verified, approvalFor(s.candidate!, run))).toThrow(/Only a verified/)
  })
  it('marks previous evidence stale and clears candidate on scope adjustment', () => {
    const original = staged(), run = runFor(original.candidate!)
    const verified = registerVerification(original, run)
    expect(verified.status).toBe('verified')
    const revised = chooseScope(verified, scope(2, 'scope-2'))
    expect(revised.runs[0].status).toBe('stale')
    expect(revised.candidate).toBeUndefined()
    expect(() => approve(revised, approvalFor(original.candidate!, run))).toThrow()
  })
  it('allows applied revision only for exact candidate tree and approval', () => {
    const s = staged(), run = runFor(s.candidate!)
    const verified = registerVerification(s, run)
    const accepted = approve(verified, approvalFor(s.candidate!, run))
    const applied = { candidateId: s.candidate!.id, approval: accepted.approval!, appliedPatchHash: s.candidate!.patchHash, baseSourceDigest: revision.sourceDigest, targetSourceDigest: s.candidate!.candidateTreeDigest, appliedAt: '2026-10-18T00:03:00Z' }
    expect(() => recordAppliedRevision(accepted, { ...applied, targetSourceDigest: 'different-tree' })).toThrow(/exactly/)
    expect(recordAppliedRevision(accepted, applied).status).toBe('applied')
    expect(() => chooseScope(recordAppliedRevision(accepted, applied), scope(2, 'scope-2'))).toThrow(/immutable/)
  })
  it('invalidates a candidate when analysis is refreshed', () => {
    const s: EditSession = staged()
    expect(recordSourceGraph(s, 'new-graph', revision.sourceDigest).candidate).toBeUndefined()
    expect(() => recordSourceGraph(s, 'bad-graph', 'other-source')).toThrow(/must match/)
  })
  it('refuses vacuous passing status when no mandatory check ran', () => {
    const s = staged(), run = runFor(s.candidate!)
    expect(() => registerVerification(s, { ...run, checks: run.checks.map(c => ({ ...c, mandatory: false })) })).toThrow(/trusted Playwright executor/)
  })
  it('refuses contradictory duplicate evidence for one browser check', () => {
    const s = staged(), run = runFor(s.candidate!)
    expect(() => registerVerification(s, { ...run, evidence: [...run.evidence, { ...run.evidence[0], id: 'duplicate-evidence', result: 'unknown' }] })).toThrow(/trusted Playwright executor/)
  })
  it('rechecks screenshot bytes and rejects a run after evidence is tampered with', () => {
    const s = staged(), run = runFor(s.candidate!)
    fs.appendFileSync(run.evidence[0].artifactPath!, 'tampered')
    expect(() => registerVerification(s, run)).toThrow(/artifact hash mismatch/)
  })
})
