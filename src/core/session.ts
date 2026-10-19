import { isDeepStrictEqual } from 'node:util'
import { REQUIRED_VERIFICATION_ASSERTION_IDS, type AppliedRevision, type Approval, type BrowserVerificationContract, type CandidatePatch, type EditOperation, type EditSession, type ProjectRevision, type RollbackRevision, type ScopeDecision, type VerificationRun } from './model'
import { assertTrustedBrowserExecution } from './verification'
import { carryTrustedBrowserExecution } from './verification-receipt'
import { verificationContractHash } from './verification-contract'
import { expectedTextForScope } from './scope'
import { assertCandidateOperationRegistry, findCandidateOperationExecutor, type CandidateOperationRegistry } from './candidate-operation-executors'

export class SessionInvariantError extends Error {
  constructor(message: string, readonly code: 'invariant-violation' | 'invalid-operation' | 'unsupported-operation' = 'invariant-violation', readonly path?: string) {
    super(message)
    this.name = 'SessionInvariantError'
  }
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

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value)
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function invalidOperation(path: string, detail: string): never {
  throw new SessionInvariantError(detail, 'invalid-operation', path)
}

function validateStructuredPayload(kind: unknown, action: unknown, payload: unknown, index: number): void {
  const basePath = `operations[${index}].payload`
  if (!record(payload)) invalidOperation(basePath, 'Structured edit operation requires an object payload')

  if (kind === 'MEDIA' && action === 'asset-swap') {
    if (!nonEmptyString(payload.assetRef)) invalidOperation(`${basePath}.assetRef`, 'assetRef must be a non-empty candidate-relative path')
    if (!hash(payload.assetHash)) invalidOperation(`${basePath}.assetHash`, 'assetHash must be a SHA-256 digest')
    if (payload.focalPoint !== undefined && (!record(payload.focalPoint) || !finiteNumber(payload.focalPoint.x) || !finiteNumber(payload.focalPoint.y) || payload.focalPoint.x < 0 || payload.focalPoint.x > 1 || payload.focalPoint.y < 0 || payload.focalPoint.y > 1)) {
      invalidOperation(`${basePath}.focalPoint`, 'focalPoint coordinates must be between 0 and 1')
    }
    if (payload.variants !== undefined) {
      if (!Array.isArray(payload.variants)) invalidOperation(`${basePath}.variants`, 'variants must be an array')
      const mechanisms = new Set(['srcset', 'picture', 'css', 'container-rule'])
      for (let variantIndex = 0; variantIndex < payload.variants.length; variantIndex += 1) {
        const variant = payload.variants[variantIndex]
        const variantPath = `${basePath}.variants[${variantIndex}]`
        if (!record(variant)) invalidOperation(variantPath, 'Each responsive variant must be an object')
        if (!mechanisms.has(String(variant.mechanism))) invalidOperation(`${variantPath}.mechanism`, 'Unsupported responsive variant mechanism')
        if (!nonEmptyString(variant.condition)) invalidOperation(`${variantPath}.condition`, 'A responsive variant must identify its actual condition')
        if (!nonEmptyString(variant.assetRef)) invalidOperation(`${variantPath}.assetRef`, 'assetRef must be a non-empty candidate-relative path')
        if (!hash(variant.assetHash)) invalidOperation(`${variantPath}.assetHash`, 'assetHash must be a SHA-256 digest')
      }
    }
    if (payload.containerHint !== undefined && (!record(payload.containerHint) || !nonEmptyString(payload.containerHint.selector) || !finiteNumber(payload.containerHint.aspect) || payload.containerHint.aspect <= 0)) {
      invalidOperation(`${basePath}.containerHint`, 'containerHint requires a selector and positive aspect ratio')
    }
    return
  }

  if (kind === 'TOKEN' && action === 'local-projection') {
    if (!nonEmptyString(payload.declarationRef)) invalidOperation(`${basePath}.declarationRef`, 'declarationRef is required')
    if (typeof payload.value !== 'string' || !payload.value.trim()) invalidOperation(`${basePath}.value`, 'Token projection value is required')
    if (!record(payload.localScope)) invalidOperation(`${basePath}.localScope`, 'Token projection requires a local scope')
    if (!nonEmptyString(payload.localScope.pageRef)) invalidOperation(`${basePath}.localScope.pageRef`, 'Token projection pageRef is required')
    if (payload.localScope.mechanism !== 'css-override' && payload.localScope.mechanism !== 'style-prop') invalidOperation(`${basePath}.localScope.mechanism`, 'Unsupported token projection mechanism')
    return
  }

  invalidOperation(`operations[${index}].action`, 'The action does not match its edit kind')
}

function validateOperation(operation: unknown, index: number, executors: CandidateOperationRegistry): asserts operation is EditOperation {
  const path = `operations[${index}]`
  if (!record(operation)) invalidOperation(path, 'Edit operation must be an object')
  if (!nonEmptyString(operation.id)) invalidOperation(`${path}.id`, 'Operation id is required')
  if (!nonEmptyString(operation.targetRef)) invalidOperation(`${path}.targetRef`, 'Operation targetRef is required')
  if (typeof operation.before !== 'string') invalidOperation(`${path}.before`, 'Operation before value must be a string')
  if (typeof operation.after !== 'string') invalidOperation(`${path}.after`, 'Operation after value must be a string')
  if (!['TEXT', 'MEDIA', 'TOKEN', 'CODE'].includes(String(operation.kind))) invalidOperation(`${path}.kind`, 'Unknown edit kind')
  if (operation.overrideAction !== undefined && operation.overrideAction !== 'remove') invalidOperation(`${path}.overrideAction`, 'Unknown override action')

  const hasAction = owns(operation, 'action')
  const hasPayload = owns(operation, 'payload')
  if (!hasAction && !hasPayload) return
  if (operation.kind !== 'MEDIA' && operation.kind !== 'TOKEN') invalidOperation(`${path}.${hasAction ? 'action' : 'payload'}`, 'TEXT and CODE operations cannot carry structured action or payload fields')
  if (!hasAction) invalidOperation(`${path}.action`, 'A structured payload requires an explicit action')

  const knownAction = (operation.kind === 'MEDIA' && operation.action === 'asset-swap') ||
    (operation.kind === 'TOKEN' && operation.action === 'local-projection')
  if (!knownAction) invalidOperation(`${path}.action`, 'Unknown or mismatched structured edit action')
  if (!hasPayload) invalidOperation(`${path}.payload`, 'Structured edit action requires a payload')
  validateStructuredPayload(operation.kind, operation.action, operation.payload, index)
  const executor = findCandidateOperationExecutor(operation, executors)
  if (!executor) throw new SessionInvariantError('Structured edit action has no registered candidate executor', 'unsupported-operation', `${path}.action`)
  if (!executor.validate(operation)) invalidOperation(`${path}.payload`, 'Registered candidate executor rejected the structured operation')
}

export function stageOperations(session: EditSession, operations: EditOperation[], executors: CandidateOperationRegistry = []): EditSession {
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!session.scope, 'Explicit scope required before editing operations')
  assertCandidateOperationRegistry(executors)
  operations.forEach((operation, index) => validateOperation(operation, index, executors))
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
  const sameOperation = (left: EditOperation, right: EditOperation) => isDeepStrictEqual(left, right)
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
        const expectedBaseline = values?.expectedBaselineText
        const expectation = expectedBaseline ? expectedTextForScope(scope, observation.pageRef, expectedBaseline, operation.after) : undefined
        return !!values && !!expectedBaseline && values.baselineValues.length > 0 && values.candidateValues.length > 0 &&
          !!expectation && values.expectedCandidateText === expectation.candidateText &&
          values.baselineValues.every(value => value.includes(expectation.baselineText)) && values.candidateValues.every(value => value.includes(expectation.candidateText))
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
