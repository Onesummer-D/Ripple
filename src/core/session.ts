import type { AppliedRevision, Approval, CandidatePatch, EditOperation, EditSession, ProjectRevision, ScopeDecision, VerificationRun } from './model'
import { assertTrustedBrowserExecution } from './verification'
import { carryTrustedBrowserExecution } from './verification-receipt'

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

export function openSession(id: string, revision: ProjectRevision, rawIntent: string, selectedElementRefs: string[] = []): EditSession {
  requireCondition(!!id && !!revision.projectId && !!revision.sourceDigest && !!revision.runtimeFingerprint, 'Project revision must be identified')
  requireCondition(!!rawIntent.trim(), 'Original user intent is required')
  return { id, projectRevision: revision, rawIntent, selectedElementRefs: [...selectedElementRefs], operations: [], status: 'draft', runs: [] }
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

export function registerVerification(session: EditSession, run: VerificationRun): EditSession {
  const patch = session.candidate
  requireCondition(session.status === 'candidate' || session.status === 'verified', 'Candidate must exist before verification')
  requireCondition(!!patch && !!session.scope, 'Candidate and scope required')
  requireCondition(run.candidateId === patch.id && run.scopeDecisionId === patch.scopeDecisionId && run.scopeVersion === patch.scopeVersion && run.baseSourceDigest === patch.baseSourceDigest && run.patchHash === patch.patchHash && run.candidateTreeDigest === patch.candidateTreeDigest && run.runtimeFingerprint === session.projectRevision.runtimeFingerprint, 'Verification does not match candidate scope/code/environment')
  assertTrustedBrowserExecution(run)
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
  const complete = run.checks.filter(c => c.mandatory).every(c => verified.has(c.id))
  const hasRisks = run.evidence.some(e => e.result === 'risk' || e.result === 'failed-to-run')
  const status: VerificationRun['status'] = hasRisks ? 'risks' : complete ? 'passed' : 'incomplete'
  const registeredRun = carryTrustedBrowserExecution(run, { ...run, status })
  return { ...session, runs: [...session.runs, registeredRun], approval: undefined, status: status === 'passed' ? 'verified' : 'candidate' }
}

export function approve(session: EditSession, approval: Approval): EditSession {
  requireCondition(session.status === 'verified' && !!session.candidate, 'Only a verified candidate can be approved')
  const run = session.runs.find(r => r.id === approval.verificationRunId)
  requireCondition(!!approval.by && !!approval.at && approval.candidateId === session.candidate.id && !!run && run.candidateId === session.candidate.id && run.status === 'passed', 'Approval must bind to a passed verification run of the current candidate')
  assertTrustedBrowserExecution(run)
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
  return { ...session, applied: { ...applied }, status: 'applied' }
}
