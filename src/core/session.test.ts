import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Approval, BrowserVerificationContract, CandidatePatch, EditOperation, EditSession, ProjectRevision, ScopeDecision, VerificationRun } from './model'
import { approve, beginVerification, chooseScope, openSession, recordAppliedRevision, recordRollback, recordSourceGraph, recordVerificationFailure, registerVerification, SessionInvariantError, stageCandidate, stageOperations } from './session'
import { attestBrowserExecution } from './verification-receipt'
import { verificationContractHash } from './verification-contract'
import { projectPreviewViewports } from './project-viewports'

const revision: ProjectRevision = { projectId: 'bolt-shop', sourceDigest: 'tree-old', runtimeFingerprint: 'lock+vite+mock-data' }
const scope = (version = 1, id = 'scope-1'): ScopeDecision => ({ id, version, includedRefs: ['home.title', 'autumn.title', 'page:home', 'page:autumn'], excludedRefs: ['product.price'], protectedRefs: ['story.2018'], decidedBy: 'user', decidedAt: '2026-10-18T00:00:00Z' })
const candidate = (s: ScopeDecision): CandidatePatch => ({ id: `candidate-${s.version}`, baseSourceDigest: revision.sourceDigest, scopeDecisionId: s.id, scopeVersion: s.version, patchHash: `patch-${s.version}`, candidateTreeDigest: `tree-${s.version}`, diffArtifact: '/sandbox/candidate.patch', operations: [{ id: 'edit-1', kind: 'TEXT', targetRef: 'home.title', before: '旧名称', after: '新名称' }, { id: 'edit-2', kind: 'TEXT', targetRef: 'autumn.title', before: '旧名称', after: '新名称' }] })
const artifactRoots: string[] = []
const contract: BrowserVerificationContract = { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Home page' }, { pageRef: 'page:autumn', path: '/', markerText: 'Autumn page', navigateBy: { role: 'button', name: 'Autumn route' } }], interactions: [{ pageRef: 'page:home', role: 'button', name: 'Home route', expectedText: 'Home page' }] }
const assertionIds = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']
const runFor = (p: CandidatePatch, result: 'pass' | 'risk' | 'unknown' = 'pass', assertionResult: 'pass' | 'risk' | 'unknown' = 'pass'): VerificationRun => {
  const id = `run-${p.id}`
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-verification-test-'))
  artifactRoots.push(artifactRoot)
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
  const artifactPath = path.join(artifactRoot, 'candidate.png')
  fs.writeFileSync(artifactPath, screenshot)
  const assertions = assertionIds.map(assertionId => ({ id: assertionId, result: assertionId === 'interaction' ? assertionResult : 'pass' as const, detail: `${assertionId} asserted by browser runner` }))
  const viewport = { width: 1440, height: 900 }
  const scopeObservations = contract.pages.map(page => ({ pageRef: page.pageRef, route: page.path, viewport, markerText: page.markerText, baselineMarkerVisible: true, candidateMarkerVisible: true, operations: p.operations.map(operation => ({ operationId: operation.id, expectedBaselineText: operation.before, expectedCandidateText: operation.after, baselineValues: [operation.before], candidateValues: [operation.after] })) }))
  const interactionObservations = [{ interactionIndex: 0, pageRef: 'page:home', route: '/', viewport, role: 'button' as const, name: 'Home route', expectedText: 'Home page', baselinePassed: assertionResult === 'pass', candidatePassed: assertionResult === 'pass' }]
  const baselineSnapshot = '<main>unchanged outside edit-1</main>'
  const comparisonPath = path.join(artifactRoot, 'comparison.json')
  const comparisonBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, route: '/', viewport, baselineSnapshot, candidateSnapshot: baselineSnapshot, maskedOperationIds: ['edit-1'] }))
  fs.writeFileSync(comparisonPath, comparisonBytes)
  const comparisonDigest = createHash('sha256').update(baselineSnapshot).digest('hex')
  const baselineComparisons = [{ route: '/', viewport, baselineDigest: comparisonDigest, candidateDigest: comparisonDigest, maskedOperationIds: ['edit-1'], matched: true, artifactPath: comparisonPath, artifactHash: createHash('sha256').update(comparisonBytes).digest('hex') }]
  const run: VerificationRun = {
    id, candidateId: p.id, scopeDecisionId: p.scopeDecisionId, scopeVersion: p.scopeVersion,
    baseSourceDigest: p.baseSourceDigest, patchHash: p.patchHash, candidateTreeDigest: p.candidateTreeDigest,
    runtimeFingerprint: revision.runtimeFingerprint, startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z',
    verificationContractHash: verificationContractHash(contract),
    checks: [{ id: 'desktop', route: '/', viewport, state: 'loaded', mandatory: true, description: 'title visible' }], baselineComparisons, scopeObservations, interactionObservations,
    assertions,
    evidence: [{ id: `e-${p.id}`, checkId: 'desktop', result, pageUrl: 'http://127.0.0.1:5173/', capturedAt: '2026-10-18T00:00:30Z', viewport: { width: 1440, height: 900 }, runtimeState: 'loaded', elementRefs: ['home.title'], artifactPath: result === 'pass' ? artifactPath : undefined, artifactHash: result === 'pass' ? createHash('sha256').update(screenshot).digest('hex') : undefined }],
    status: 'incomplete',
  }
  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 3, executor: 'playwright', completed: true, runId: run.id, candidateId: run.candidateId,
    scopeDecisionId: run.scopeDecisionId, scopeVersion: run.scopeVersion,
    baseSourceDigest: run.baseSourceDigest, patchHash: run.patchHash, candidateTreeDigest: run.candidateTreeDigest,
    runtimeFingerprint: run.runtimeFingerprint,
    verificationContractHash: run.verificationContractHash,
    viewports: [{ name: 'desktop', width: viewport.width, height: viewport.height }],
    checks: run.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: result === 'pass' })),
    baselineComparisons: [{ ...baselineComparisons[0], artifactPath: path.basename(comparisonPath) }],
    assertions, scopeObservations, interactionObservations, evidence: run.evidence.map(item => ({ ...item, ...(item.artifactPath ? { artifactPath: path.basename(item.artifactPath) } : {}) })),
    artifacts: result === 'pass' ? [{ checkId: 'desktop', path: path.basename(artifactPath), sha256: createHash('sha256').update(screenshot).digest('hex') }] : [],
  }))
  return attestBrowserExecution(run, recordPath)
}
const approvalFor = (p: CandidatePatch, run: VerificationRun): Approval => ({ candidateId: p.id, verificationRunId: run.id, by: 'user', at: '2026-10-18T00:02:00Z' })
const analyzed = () => recordSourceGraph(openSession('session-1', revision, '更新本季活动，保留历史', [], contract), 'graph-1', revision.sourceDigest)
const staged = () => { const s = scope(); const withScope = chooseScope(analyzed(), s); return stageCandidate(stageOperations(withScope, candidate(s).operations), candidate(s)) }
function expectSessionError(action: () => unknown, expected: Pick<SessionInvariantError, 'code' | 'path'>): void {
  let caught: unknown
  try { action() } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(SessionInvariantError)
  expect(caught).toMatchObject(expected)
}

function editOperationTypeContract(): void {
  const literalMedia: EditOperation = { id: 'media-literal', kind: 'MEDIA', targetRef: 'media:hero', before: 'old.jpg', after: 'new.jpg' }
  const structuredMedia: EditOperation = {
    id: 'media-structured', kind: 'MEDIA', action: 'asset-swap', targetRef: 'media:hero', before: 'old.jpg', after: 'new.jpg',
    payload: { assetRef: 'assets/new.jpg', assetHash: 'a'.repeat(64) },
  }
  // @ts-expect-error TEXT cannot carry a structured action.
  const textWithAction: EditOperation = { id: 'text-action', kind: 'TEXT', targetRef: 'data:title', before: 'a', after: 'b', action: 'asset-swap' }
  // @ts-expect-error TEXT cannot carry a structured payload.
  const textWithPayload: EditOperation = { id: 'text-payload', kind: 'TEXT', targetRef: 'data:title', before: 'a', after: 'b', payload: {} }
  // @ts-expect-error A structured action requires its matching payload.
  const mediaWithoutPayload: EditOperation = { id: 'media-missing', kind: 'MEDIA', targetRef: 'media:hero', before: 'old.jpg', after: 'new.jpg', action: 'asset-swap' }
  void [literalMedia, structuredMedia, textWithAction, textWithPayload, mediaWithoutPayload]
}

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
  it('keeps all current payloadless operation kinds source-compatible', () => {
    editOperationTypeContract()
    const operations: EditOperation[] = [
      { id: 'text', kind: 'TEXT', targetRef: 'text', before: 'a', after: 'b' },
      { id: 'media', kind: 'MEDIA', targetRef: 'media', before: 'a.jpg', after: 'b.jpg' },
      { id: 'token', kind: 'TOKEN', targetRef: 'token', before: '#111', after: '#222' },
      { id: 'code', kind: 'CODE', targetRef: 'code', before: 'a()', after: 'b()' },
    ]
    const decision = { ...scope(), includedRefs: operations.map(operation => operation.targetRef) }
    expect(stageOperations(chooseScope(analyzed(), decision), operations).operations).toEqual(operations)
  })
  it('rejects accidental payload or action fields on payloadless operations with structured paths', () => {
    const operations: EditOperation[] = [
      { id: 'text', kind: 'TEXT', targetRef: 'text', before: 'a', after: 'b' },
      { id: 'media', kind: 'MEDIA', targetRef: 'media', before: 'a.jpg', after: 'b.jpg' },
      { id: 'token', kind: 'TOKEN', targetRef: 'token', before: '#111', after: '#222' },
      { id: 'code', kind: 'CODE', targetRef: 'code', before: 'a()', after: 'b()' },
    ]
    const decision = { ...scope(), includedRefs: operations.map(operation => operation.targetRef) }
    const session = chooseScope(analyzed(), decision)
    for (const operation of operations) {
      for (const [field, value] of [['action', 'unexpected'], ['payload', { unexpected: true }]] as const) {
        let caught: unknown
        try { stageOperations(session, [{ ...operation, [field]: value } as unknown as EditOperation]) }
        catch (error) { caught = error }
        expect(caught).toBeInstanceOf(SessionInvariantError)
        expect(caught).toMatchObject({ code: 'invalid-operation' })
        expect((caught as SessionInvariantError).path).toMatch(/^operations\[0\]\.(action|payload)$/)
      }
    }
  })
  it('validates structured payload shape and refuses unimplemented execution without string fallback', () => {
    const decision = { ...scope(), includedRefs: ['media:hero'] }
    const session = chooseScope(analyzed(), decision)
    const media = { id: 'asset-swap', kind: 'MEDIA', targetRef: 'media:hero', before: 'old.jpg', after: 'new.jpg', action: 'asset-swap' }
    expectSessionError(() => stageOperations(session, [media as unknown as EditOperation]), { code: 'invalid-operation', path: 'operations[0].payload' })

    const validStructured = { ...media, payload: { assetRef: 'assets/new.jpg', assetHash: 'a'.repeat(64) } } as unknown as EditOperation
    expectSessionError(() => stageOperations(session, [validStructured]), { code: 'unsupported-operation', path: 'operations[0].action' })

    const badHash = { ...validStructured, payload: { assetRef: 'assets/new.jpg', assetHash: 'not-a-hash' } } as unknown as EditOperation
    expectSessionError(() => stageOperations(session, [badHash]), { code: 'invalid-operation', path: 'operations[0].payload.assetHash' })
    const unknownAction = { ...media, action: 'image-magic', payload: {} } as unknown as EditOperation
    expectSessionError(() => stageOperations(session, [unknownAction]), { code: 'invalid-operation', path: 'operations[0].action' })
    const mismatchedAction = { ...validStructured, kind: 'TOKEN', action: 'asset-swap' } as unknown as EditOperation
    expectSessionError(() => stageOperations(session, [mismatchedAction]), { code: 'invalid-operation', path: 'operations[0].action' })

    const tokenSession = chooseScope(analyzed(), { ...decision, includedRefs: ['token:accent'] })
    const tokenProjection = {
      id: 'token-projection', kind: 'TOKEN', targetRef: 'token:accent', before: '#111', after: '#222', action: 'local-projection',
      payload: { declarationRef: 'token:accent', value: '#222', localScope: { pageRef: 'page:home', mechanism: 'css-override' } },
    } as unknown as EditOperation
    expectSessionError(() => stageOperations(tokenSession, [tokenProjection]), { code: 'unsupported-operation', path: 'operations[0].action' })
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
    const unexpectedStructuredAction = { ...candidate(decision).operations[0], action: 'asset-swap', payload: { assetRef: 'assets/new.webp', assetHash: 'a'.repeat(64) } } as unknown as EditOperation
    expect(() => stageCandidate(edited, { ...candidate(decision), operations: [unexpectedStructuredAction, candidate(decision).operations[1]] })).toThrow(/exact operations/)
  })
  it('rejects evidence from another patch or runtime environment', () => {
    const s = staged()
    expect(() => registerVerification(s, { ...runFor(s.candidate!), patchHash: 'old-patch' })).toThrow(/does not match/)
    expect(() => registerVerification(s, { ...runFor(s.candidate!), runtimeFingerprint: 'different-env' })).toThrow(/does not match/)
  })
  it('rejects a declared viewport plan when a viewport has no browser check or screenshot evidence', () => {
    const run = runFor(candidate(scope()))
    const recordPath = run.execution!.recordPath
    const manifest = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { viewports: unknown[] }
    manifest.viewports = projectPreviewViewports.map(({ name, width, height }) => ({ name, width, height }))
    fs.writeFileSync(recordPath, JSON.stringify(manifest))

    expect(() => attestBrowserExecution(run, recordPath)).toThrow(/checks and screenshot evidence must cover exactly the declared viewport plan/)
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
  it('does not attest non-target PASS without candidate-bound baseline comparisons', () => {
    const run = runFor(candidate(scope()))
    const recordPath = run.execution!.recordPath
    const manifest = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<string, unknown>
    delete manifest.baselineComparisons
    fs.writeFileSync(recordPath, JSON.stringify(manifest))
    expect(() => attestBrowserExecution({ ...run, baselineComparisons: undefined, execution: undefined }, recordPath)).toThrow(/baseline comparison/i)
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
  it('checks page Scope against each route’s existing override baseline rather than one shared before-value', () => {
    const s = staged(), run = runFor(s.candidate!)
    const scopeObservations = run.scopeObservations!.map(observation => ({
      ...observation,
      operations: observation.operations.map(values => {
        const operation = s.operations.find(item => item.id === values.operationId)!
        const expectedBaselineText = observation.pageRef === 'page:home' ? `Home override: ${operation.before}` : operation.before
        return { ...values, expectedBaselineText, expectedCandidateText: operation.after, baselineValues: [expectedBaselineText], candidateValues: [operation.after] }
      }),
    }))
    const recordPath = run.execution!.recordPath
    const manifest = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<string, unknown>
    manifest.scopeObservations = scopeObservations
    fs.writeFileSync(recordPath, JSON.stringify(manifest))
    const attested = attestBrowserExecution({ ...run, scopeObservations, execution: undefined }, recordPath)
    expect(registerVerification(s, attested).status).toBe('verified')
  })
  it('invalidates the prior pass before a new browser attempt and persists a failed attempt without a false pass', () => {
    const s = staged(), run = runFor(s.candidate!)
    const verified = registerVerification(s, run)
    const rerun = beginVerification(verified)
    expect(rerun.status).toBe('candidate')
    expect(rerun.runs.at(-1)?.status).toBe('stale')
    expect(rerun.approval).toBeUndefined()
    expect(() => approve(rerun, approvalFor(s.candidate!, run))).toThrow(/Only a verified/)
    const failed = recordVerificationFailure(rerun, 'Docker runner exited before producing evidence', '2026-10-18T00:02:00Z')
    expect(failed.verificationFailure).toMatchObject({ candidateId: s.candidate!.id, patchHash: s.candidate!.patchHash, reason: 'Docker runner exited before producing evidence' })
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
  it('records rollback only for the exact applied candidate and restored baseline', () => {
    const s = staged(), run = runFor(s.candidate!)
    const accepted = approve(registerVerification(s, run), approvalFor(s.candidate!, run))
    const applied = recordAppliedRevision(accepted, { candidateId: s.candidate!.id, approval: accepted.approval!, appliedPatchHash: s.candidate!.patchHash, baseSourceDigest: revision.sourceDigest, targetSourceDigest: s.candidate!.candidateTreeDigest, appliedAt: '2026-10-18T00:03:00Z' })
    const rollback = { candidateId: s.candidate!.id, appliedPatchHash: s.candidate!.patchHash, restoredSourceDigest: revision.sourceDigest, rolledBackAt: '2026-10-18T00:04:00Z' }
    expect(recordRollback(applied, rollback)).toMatchObject({ status: 'rolled-back', rollback })
    expect(() => recordRollback(applied, { ...rollback, appliedPatchHash: 'different-patch' })).toThrow(/identify the applied patch/)
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
