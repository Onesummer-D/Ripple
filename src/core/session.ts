import { REQUIRED_VERIFICATION_ASSERTION_IDS, type AppliedRevision, type Approval, type BrowserVerificationContract, type CandidatePatch, type EditOperation, type EditSession, type ProjectRevision, type RollbackRevision, type ScopeDecision, type VerificationRun } from './model'
import { assertTrustedBrowserExecution } from './verification'
import { carryTrustedBrowserExecution } from './verification-receipt'
import { verificationContractHash } from './verification-contract'

export class SessionInvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'SessionInvariantError' }
}
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SessionInvariantError(message)
}
const unique = (xs: string[]) => new Set(xs).size === xs.length
const currentRun = (session: EditSession): VerificationRun | undefined => session.runs.find((run) => run.id === session.approval?.verificationRunId)
const routePath = (value: string): string | undefined => {
  try { return new URL(value, 'http://ripple.local').pathname.replace(/\/+$/, '') || '/' }
  catch { return undefined }
}

export function openSession(id: string, revision: ProjectRevision, rawIntent: string, selectedElementRefs: string[] = [], verificationContract?: BrowserVerificationContract): EditSession {
  requireCondition(!!id && !!revision.projectId && !!revision.sourceDigest && !!revision.runtimeFingerprint, 'Project revision must be identified')
  requireCondition(!!rawIntent.trim(), 'Original user intent is required')
  return { id, projectRevision: revision, rawIntent, selectedElementRefs: [...selectedElementRefs], operations: [], ...(verificationContract ? { verificationContract } : {}), status: 'draft', runs: [] }
}

export function recordSourceGraph(session: EditSession, graphId: string, sourceDigest: string): EditSession {
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!graphId && sourceDigest === session.projectRevision.sourceDigest, 'Source graph must match baseline revision')
  return { ...session, sourceGraphId: graphId, scope: undefined, operations: [], candidate: undefined, approval: undefined, runs: session.runs.map(r => ({ ...r, status: 'stale' })), status: 'analyzed' }
}

export function chooseScope(session: EditSession, scope: ScopeDecision): EditSession {
  requireCondition(!!session.sourceGraphId, 'Analysis must precede scope decision')
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!scope.id && !!scope.decidedBy && scope.version >= 1 && Number.isInteger(scope.version), 'Scope identity and decision metadata required')
  requireCondition(scope.includedRefs.length > 0, 'Empty inclusion set is not an editable scope')
  requireCondition(unique(scope.includedRefs) && unique(scope.excludedRefs) && unique(scope.protectedRefs), 'Duplicate scope references')
  const included = new Set(scope.includedRefs)
  requireCondition(![...scope.excludedRefs, ...scope.protectedRefs].some(ref => included.has(ref)), 'Included scope conflicts with excluded/protected references')
  requireCondition(!session.scope || (session.scope.id !== scope.id && scope.version > session.scope.version), 'Changing scope requires a new identity and increasing version')
  return { ...session, scope: { ...scope, includedRefs: [...scope.includedRefs], excludedRefs: [...scope.excludedRefs], protectedRefs: [...scope.protectedRefs] }, candidate: undefined, approval: undefined, runs: session.runs.map(r => ({ ...r, status: 'stale' })), status: 'scoped' }
}

export function stageOperations(session: EditSession, operations: EditOperation[]): EditSession {
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!session.scope, 'Explicit scope required before editing operations')
  requireCondition(unique(operations.map(operation => operation.id)) && unique(operations.map(operation => operation.targetRef)), 'Operation identities and targets must be unique')
  const included = new Set(session.scope.includedRefs)
  const excluded = new Set([...session.scope.excludedRefs, ...session.scope.protectedRefs])
  requireCondition(operations.every(operation => !!operation.id &&
    (operation.overrideAction === 'remove'
      ? session.scope?.strategy === 'page-override' && operation.targetRef.startsWith('override:') && operation.before === operation.after
      : operation.before !== operation.after) && included.has(operation.targetRef) && !excluded.has(operation.targetRef)), 'Operation changes an unchanged, forbidden or unscoped target')
  return { ...session, operations: operations.map(operation => ({ ...operation })), candidate: undefined, approval: undefined, runs: session.runs.map(run => ({ ...run, status: 'stale' })), status: 'scoped' }
}

export function stageCandidate(session: EditSession, patch: CandidatePatch): EditSession {
  const scope = session.scope
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!scope, 'Explicit scope required')
  requireCondition(patch.baseSourceDigest === session.projectRevision.sourceDigest, 'Candidate baseline does not match project')
  requireCondition(patch.scopeDecisionId === scope.id && patch.scopeVersion === scope.version, 'Candidate scope is stale')
  requireCondition(!!patch.id && !!patch.patchHash && !!patch.candidateTreeDigest && !!patch.diffArtifact && patch.operations.length > 0, 'Real patch and output tree digest required')
  const sameOperation = (left: EditOperation, right: EditOperation) => left.id === right.id && left.kind === right.kind && left.targetRef === right.targetRef && left.before === right.before && left.after === right.after && left.overrideAction === right.overrideAction
  requireCondition(session.operations.length === patch.operations.length && session.operations.every((operation, index) => sameOperation(operation, patch.operations[index])), 'Candidate must contain the exact operations in this EditSession')
  const included = new Set(scope.includedRefs)
  requireCondition(patch.operations.every(op => included.has(op.targetRef) && !!op.id &&
    (op.overrideAction === 'remove'
      ? scope.strategy === 'page-override' && op.targetRef.startsWith('override:') && op.before === op.after
      : op.before !== op.after)), 'Patch changes forbidden or unchanged targets')
  return { ...session, candidate: { ...patch, operations: [...patch.operations] }, approval: undefined, runs: session.runs.map(r => ({ ...r, status: 'stale' })), status: 'candidate' }
}

export function beginVerification(session: EditSession): EditSession {
  requireCondition(['candidate', 'verified', 'approved'].includes(session.status) && !!session.candidate, 'Candidate must exist before verification')
  const runs = session.runs.map(run => {
    if (run.status === 'stale') return run
    assertTrustedBrowserExecution(run)
    return carryTrustedBrowserExecution(run, { ...run, status: 'stale' })
  })
  return { ...session, runs, approval: undefined, verificationFailure: undefined, status: 'candidate' }
}

export function recordVerificationFailure(session: EditSession, reason: string, attemptedAt = new Date().toISOString()): EditSession {
  const candidate = session.candidate
  requireCondition(session.status === 'candidate' && !!candidate && !!reason.trim(), 'A failed verification attempt must belong to an active candidate')
  return { ...session, verificationFailure: { candidateId: candidate.id, patchHash: candidate.patchHash, attemptedAt, reason: reason.slice(0, 4000) }, approval: undefined, status: 'candidate' }
}

export function registerVerification(session: EditSession, run: VerificationRun): EditSession {
  const patch = session.candidate
  requireCondition(session.status === 'candidate' || session.status === 'verified', 'Candidate must exist before verification')
  requireCondition(!!patch && !!session.scope, 'Candidate and scope required')
  requireCondition(run.candidateId === patch.id && run.scopeDecisionId === patch.scopeDecisionId && run.scopeVersion === patch.scopeVersion && run.baseSourceDigest === patch.baseSourceDigest && run.patchHash === patch.patchHash && run.candidateTreeDigest === patch.candidateTreeDigest && run.runtimeFingerprint === session.projectRevision.runtimeFingerprint && run.verificationContractHash === verificationContractHash(session.verificationContract), 'Verification does not match candidate scope/code/environment/contract')
  assertTrustedBrowserExecution(run)
  assertVerificationContractResults(session, run)
  requireCondition(!session.runs.some(r => r.id === run.id), 'Verification run identity already exists')
  const startedAt = Date.parse(run.startedAt), completedAt = Date.parse(run.completedAt)
  requireCondition(Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt, 'Verification run time window is invalid')
  requireCondition(run.checks.some(c => c.mandatory) && unique(run.checks.map(c => c.id)) && unique(run.evidence.map(e => e.id)) && unique(run.evidence.map(e => e.checkId)), 'Mandatory checks and unique check/evidence identities required')
  const checks = new Map(run.checks.map(c => [c.id, c]))
  requireCondition(run.evidence.every(e => {
    const check = checks.get(e.checkId)
    const capturedAt = Date.parse(e.capturedAt)
    let pageUrl: URL | undefined
    try { pageUrl = new URL(e.pageUrl) } catch { /* malformed or relative evidence URLs are not verifiable */ }
    return !!check && !!pageUrl && ['http:', 'https:'].includes(pageUrl.protocol) && routePath(e.pageUrl) === routePath(check.route) &&
      Number.isFinite(capturedAt) && capturedAt >= startedAt && capturedAt <= completedAt &&
      unique(e.elementRefs) && e.viewport.width === check.viewport.width && e.viewport.height === check.viewport.height && e.runtimeState === check.state &&
      (e.result !== 'pass' || (!!e.artifactPath && !!e.artifactHash && /^[a-f0-9]{64}$/i.test(e.artifactHash)))
  }), 'Evidence must match candidate page, viewport, state and run time; passes need a hashed artifact')
  const verified = new Set(run.evidence.filter(e => e.result === 'pass').map(e => e.checkId))
  const mandatoryEvidencePassed = run.checks.filter(c => c.mandatory).every(c => verified.has(c.id))
  const assertions = new Map(run.assertions.map(assertion => [assertion.id, assertion.result]))
  const assertionsPassed = REQUIRED_VERIFICATION_ASSERTION_IDS.every(id => assertions.get(id) === 'pass')
  const hasRisks = run.evidence.some(e => e.result === 'risk' || e.result === 'failed-to-run') || run.assertions.some(assertion => assertion.result === 'risk' || assertion.result === 'failed-to-run')
  const status: VerificationRun['status'] = hasRisks ? 'risks' : mandatoryEvidencePassed && assertionsPassed ? 'passed' : 'incomplete'
  const registeredRun = carryTrustedBrowserExecution(run, { ...run, status })
  return { ...session, runs: [...session.runs, registeredRun], approval: undefined, verificationFailure: undefined, status: status === 'passed' ? 'verified' : 'candidate' }
}

export function assertVerificationContractResults(session: EditSession, run: VerificationRun): void {
  const assertion = (id: string) => run.assertions.find(item => item.id === id)?.result
  const scopeResult = assertion('scope-propagation')
  if (scopeResult === 'pass') {
    const contract = session.verificationContract
    const scope = session.scope
    const observations = run.scopeObservations ?? []
    const pages = contract?.pages ?? []
    const routeRefs = scope ? [...scope.includedRefs, ...scope.excludedRefs, ...scope.protectedRefs].filter(ref => ref.startsWith('page:')) : []
    const viewports = [...new Map(run.checks.map(check => [`${check.viewport.width}x${check.viewport.height}`, check.viewport])).values()]
    const expectedCount = pages.length * viewports.length
    requireCondition(!!contract && !!scope && pages.length > 0 &&
      routeRefs.length > 0 && routeRefs.every(ref => pages.some(page => page.pageRef === ref)) && pages.every(page => routeRefs.includes(page.pageRef)) &&
      observations.length === expectedCount && expectedCount > 0, 'Scope PASS needs browser observations for every contracted and scoped page at each checked viewport')
    const seen = new Set<string>()
    for (const observation of observations) {
      const page = pages.find(item => item.pageRef === observation.pageRef)
      const key = `${observation.pageRef}:${observation.viewport.width}x${observation.viewport.height}`
      requireCondition(!!page && page.path === observation.route && viewports.some(viewport => viewport.width === observation.viewport.width && viewport.height === observation.viewport.height) && !seen.has(key), 'Scope observations must uniquely bind declared pages and checked viewports')
      seen.add(key)
      requireCondition(observation.markerText === page.markerText && observation.baselineMarkerVisible && observation.candidateMarkerVisible, 'Scope PASS requires the declared page marker in both original and candidate projects')
      requireCondition(observation.operations.length === session.operations.length && session.operations.every(operation => {
        const values = observation.operations.find(item => item.operationId === operation.id)
        const shouldChange = scope.strategy === 'page-override' ? scope.localPageRef === observation.pageRef : scope.includedRefs.includes(observation.pageRef)
        const expectedCandidate = shouldChange ? operation.after : operation.before
        return !!values && values.baselineValues.length > 0 && values.candidateValues.length > 0 &&
          values.baselineValues.every(value => value.includes(operation.before)) && values.candidateValues.every(value => value.includes(expectedCandidate))
      }), 'Scope PASS target values must match the original baseline and selected page decision')
    }
  }
  const interactionResult = assertion('interaction')
  if (interactionResult === 'pass') {
    const contract = session.verificationContract
    const observations = run.interactionObservations ?? []
    const viewports = [...new Map(run.checks.map(check => [`${check.viewport.width}x${check.viewport.height}`, check.viewport])).values()]
    const expectedCount = (contract?.interactions.length ?? 0) * viewports.length
    requireCondition(!!contract && contract.interactions.length > 0 && observations.length === expectedCount && expectedCount > 0, 'Interaction PASS needs an executed observation for each declared interaction at every checked viewport')
    for (let interactionIndex = 0; interactionIndex < contract.interactions.length; interactionIndex += 1) {
      const interaction = contract.interactions[interactionIndex]
      for (const viewport of viewports) {
        const match = observations.filter(item => item.interactionIndex === interactionIndex && item.pageRef === interaction.pageRef &&
          item.viewport.width === viewport.width && item.viewport.height === viewport.height)
        requireCondition(match.length === 1 && match[0].route === contract.pages.find(page => page.pageRef === interaction.pageRef)?.path &&
          match[0].role === interaction.role && match[0].name === interaction.name && match[0].expectedText === interaction.expectedText &&
          match[0].baselinePassed && match[0].candidatePassed, 'Interaction PASS requires the declared accessible control and expected state in original and candidate browsers')
      }
    }
  }
}

export function approve(session: EditSession, approval: Approval): EditSession {
  requireCondition(session.status === 'verified' && !!session.candidate, 'Only a verified candidate can be approved')
  const run = session.runs.at(-1)
  requireCondition(!!approval.by && !!approval.at && approval.candidateId === session.candidate.id && !!run && run.id === approval.verificationRunId && run.candidateId === session.candidate.id && run.status === 'passed' && !session.verificationFailure, 'Approval must bind to the latest passed verification run of the current candidate')
  assertTrustedBrowserExecution(run)
  assertVerificationContractResults(session, run)
  return { ...session, approval: { ...approval }, status: 'approved' }
}

export function recordAppliedRevision(session: EditSession, applied: AppliedRevision): EditSession {
  const patch = session.candidate
  requireCondition(session.status === 'approved' && !!patch && !!session.approval, 'Candidate must be approved before applying')
  requireCondition(applied.candidateId === patch.id && applied.appliedPatchHash === patch.patchHash && applied.baseSourceDigest === patch.baseSourceDigest && applied.targetSourceDigest === patch.candidateTreeDigest, 'Applied code must be exactly the verified candidate tree')
  requireCondition(applied.approval.verificationRunId === session.approval.verificationRunId && applied.approval.candidateId === patch.id, 'Application does not match approval')
  const run = currentRun(session)
  requireCondition(run?.status === 'passed', 'Verification evidence is no longer current')
  assertTrustedBrowserExecution(run)
  assertVerificationContractResults(session, run)
  return { ...session, applied: { ...applied }, status: 'applied' }
}

export function recordRollback(session: EditSession, rollback: RollbackRevision): EditSession {
  const patch = session.candidate
  const applied = session.applied
  const run = currentRun(session)
  requireCondition(session.status === 'applied' && !!patch && !!applied && !!run, 'Only an applied candidate can be rolled back')
  requireCondition(rollback.candidateId === patch.id && rollback.appliedPatchHash === patch.patchHash &&
    rollback.restoredSourceDigest === applied.baseSourceDigest && !!rollback.rolledBackAt, 'Rollback must identify the applied patch and restored baseline')
  requireCondition(run.status === 'passed', 'Rollback record needs the original passed verification')
  assertTrustedBrowserExecution(run)
  assertVerificationContractResults(session, run)
  return { ...session, rollback: { ...rollback }, status: 'rolled-back' }
}
