import { describe, expect, it } from 'vitest'
import type { Approval, CandidatePatch, EditSession, ProjectRevision, ScopeDecision, VerificationRun } from './model'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate } from './session'

const revision: ProjectRevision = { projectId: 'bolt-shop', sourceDigest: 'tree-old', runtimeFingerprint: 'lock+vite+mock-data' }
const scope = (version = 1, id = 'scope-1'): ScopeDecision => ({ id, version, includedRefs: ['home.title', 'autumn.title'], excludedRefs: ['product.price'], protectedRefs: ['story.2018'], decidedBy: 'user', decidedAt: '2026-10-18T00:00:00Z' })
const candidate = (s: ScopeDecision): CandidatePatch => ({ id: `candidate-${s.version}`, baseSourceDigest: revision.sourceDigest, scopeDecisionId: s.id, scopeVersion: s.version, patchHash: `patch-${s.version}`, candidateTreeDigest: `tree-${s.version}`, diffArtifact: '/sandbox/candidate.patch', operations: [{ id: 'edit-1', kind: 'TEXT', targetRef: 'home.title', before: '旧名称', after: '新名称' }, { id: 'edit-2', kind: 'TEXT', targetRef: 'autumn.title', before: '旧名称', after: '新名称' }] })
const runFor = (p: CandidatePatch, result: 'pass' | 'risk' | 'unknown' = 'pass'): VerificationRun => ({ id: `run-${p.id}`, candidateId: p.id, baseSourceDigest: p.baseSourceDigest, patchHash: p.patchHash, candidateTreeDigest: p.candidateTreeDigest, runtimeFingerprint: revision.runtimeFingerprint, startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z', checks: [{ id: 'desktop', route: '/', viewport: { width: 1440, height: 900 }, state: 'loaded', mandatory: true, description: 'title visible' }], evidence: [{ id: `e-${p.id}`, checkId: 'desktop', result, pageUrl: 'http://127.0.0.1:5173/', capturedAt: '2026-10-18T00:00:30Z', viewport: { width: 1440, height: 900 }, runtimeState: 'loaded', elementRefs: ['home.title'], artifactPath: result === 'pass' ? 'screens/candidate-home-1440.png' : undefined }], status: 'incomplete' })
const approvalFor = (p: CandidatePatch, run: VerificationRun): Approval => ({ candidateId: p.id, verificationRunId: run.id, by: 'user', at: '2026-10-18T00:02:00Z' })
const analyzed = () => recordSourceGraph(openSession('session-1', revision, '更新本季活动，保留历史'), 'graph-1', revision.sourceDigest)
const staged = () => { const s = scope(); return stageCandidate(chooseScope(analyzed(), s), candidate(s)) }

describe('Project-first session invariants', () => {
  it('retains raw intent and accepts multiple operations under explicit scope', () => {
    const s = staged()
    expect(s.rawIntent).toBe('更新本季活动，保留历史')
    expect(s.candidate?.operations).toHaveLength(2)
    expect(s.scope?.protectedRefs).toEqual(['story.2018'])
  })
  it('rejects protected/included overlap', () => {
    expect(() => chooseScope(analyzed(), { ...scope(), protectedRefs: ['home.title'] })).toThrow(/conflicts/)
  })
  it('blocks an operation against protected or unapproved target', () => {
    const s = scope()
    expect(() => stageCandidate(chooseScope(analyzed(), s), { ...candidate(s), operations: [{ id: 'bad', kind: 'TEXT', targetRef: 'story.2018', before: 'a', after: 'b' }] })).toThrow(/forbidden/)
  })
  it('rejects evidence from another patch or runtime environment', () => {
    const s = staged()
    expect(() => registerVerification(s, { ...runFor(s.candidate!), patchHash: 'old-patch' })).toThrow(/does not match/)
    expect(() => registerVerification(s, { ...runFor(s.candidate!), runtimeFingerprint: 'different-env' })).toThrow(/does not match/)
  })
  it('does not allow passing checks without an evidence artifact', () => {
    const s = staged(), run = runFor(s.candidate!)
    expect(() => registerVerification(s, { ...run, evidence: run.evidence.map(e => ({ ...e, artifactPath: undefined })) })).toThrow(/artifacts/)
  })
  it('rejects approval for risk/unknown and incomplete verification', () => {
    for (const result of ['risk', 'unknown'] as const) {
      const s = staged(), run = runFor(s.candidate!, result)
      const verified = registerVerification(s, run)
      expect(verified.status).toBe('candidate')
      expect(() => approve(verified, approvalFor(s.candidate!, run))).toThrow(/Only a verified/)
    }
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
})
