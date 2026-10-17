import type { AppliedRevision, Approval, CandidatePatch, EditSession, ProjectRevision, ScopeDecision, VerificationRun } from './model'

export class SessionInvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'SessionInvariantError' }
}
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SessionInvariantError(message)
}
const unique = (xs: string[]) => new Set(xs).size === xs.length
const currentRun = (session: EditSession): VerificationRun | undefined => session.runs.find((run) => run.id === session.approval?.verificationRunId)

export function openSession(id: string, revision: ProjectRevision, rawIntent: string, selectedElementRefs: string[] = []): EditSession {
  requireCondition(!!id && !!revision.projectId && !!revision.sourceDigest && !!revision.runtimeFingerprint, 'Project revision must be identified')
  requireCondition(!!rawIntent.trim(), 'Original user intent is required')
  return { id, projectRevision: revision, rawIntent, selectedElementRefs: [...selectedElementRefs], status: 'draft', runs: [] }
}

export function recordSourceGraph(session: EditSession, graphId: string, sourceDigest: string): EditSession {
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!graphId && sourceDigest === session.projectRevision.sourceDigest, 'Source graph must match baseline revision')
  return { ...session, sourceGraphId: graphId, scope: undefined, candidate: undefined, approval: undefined, runs: session.runs.map(r => ({ ...r, status: 'stale' })), status: 'analyzed' }
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

export function stageCandidate(session: EditSession, patch: CandidatePatch): EditSession {
  const scope = session.scope
  requireCondition(session.status !== 'applied', 'Applied session is immutable')
  requireCondition(!!scope, 'Explicit scope required')
  requireCondition(patch.baseSourceDigest === session.projectRevision.sourceDigest, 'Candidate baseline does not match project')
  requireCondition(patch.scopeDecisionId === scope.id && patch.scopeVersion === scope.version, 'Candidate scope is stale')
  requireCondition(!!patch.id && !!patch.patchHash && !!patch.candidateTreeDigest && !!patch.diffArtifact && patch.operations.length > 0, 'Real patch and output tree digest required')
  const included = new Set(scope.includedRefs)
  requireCondition(patch.operations.every(op => included.has(op.targetRef) && !!op.id && op.before !== op.after), 'Patch changes forbidden or unchanged targets')
  return { ...session, candidate: { ...patch, operations: [...patch.operations] }, approval: undefined, runs: session.runs.map(r => ({ ...r, status: 'stale' })), status: 'candidate' }
}

export function registerVerification(session: EditSession, run: VerificationRun): EditSession {
  const patch = session.candidate
  requireCondition(session.status === 'candidate' || session.status === 'verified', 'Candidate must exist before verification')
  requireCondition(!!patch && !!session.scope, 'Candidate and scope required')
  requireCondition(run.candidateId === patch.id && run.baseSourceDigest === patch.baseSourceDigest && run.patchHash === patch.patchHash && run.candidateTreeDigest === patch.candidateTreeDigest && run.runtimeFingerprint === session.projectRevision.runtimeFingerprint, 'Verification does not match candidate code/environment')
  requireCondition(!session.runs.some(r => r.id === run.id), 'Verification run identity already exists')
  requireCondition(run.checks.some(c => c.mandatory) && unique(run.checks.map(c => c.id)) && unique(run.evidence.map(e => e.id)) && unique(run.evidence.map(e => e.checkId)), 'Mandatory checks and unique check/evidence identities required')
  const checks = new Map(run.checks.map(c => [c.id, c]))
  requireCondition(run.evidence.every(e => { const c = checks.get(e.checkId); return !!c && e.pageUrl.length > 0 && e.capturedAt.length > 0 && e.viewport.width === c.viewport.width && e.viewport.height === c.viewport.height && e.runtimeState === c.state && (e.result !== 'pass' || !!e.artifactPath) }), 'Evidence must correspond to a real check, viewport and state; passes need artifacts')
  const verified = new Set(run.evidence.filter(e => e.result === 'pass').map(e => e.checkId))
  const complete = run.checks.filter(c => c.mandatory).every(c => verified.has(c.id))
  const hasRisks = run.evidence.some(e => e.result === 'risk' || e.result === 'failed-to-run')
  const status: VerificationRun['status'] = hasRisks ? 'risks' : complete ? 'passed' : 'incomplete'
  return { ...session, runs: [...session.runs, { ...run, status }], approval: undefined, status: status === 'passed' ? 'verified' : 'candidate' }
}

export function approve(session: EditSession, approval: Approval): EditSession {
  requireCondition(session.status === 'verified' && !!session.candidate, 'Only a verified candidate can be approved')
  const run = session.runs.find(r => r.id === approval.verificationRunId)
  requireCondition(!!approval.by && !!approval.at && approval.candidateId === session.candidate.id && !!run && run.candidateId === session.candidate.id && run.status === 'passed', 'Approval must bind to a passed verification run of the current candidate')
  return { ...session, approval: { ...approval }, status: 'approved' }
}

export function recordAppliedRevision(session: EditSession, applied: AppliedRevision): EditSession {
  const patch = session.candidate
  requireCondition(session.status === 'approved' && !!patch && !!session.approval, 'Candidate must be approved before applying')
  requireCondition(applied.candidateId === patch.id && applied.appliedPatchHash === patch.patchHash && applied.baseSourceDigest === patch.baseSourceDigest && applied.targetSourceDigest === patch.candidateTreeDigest, 'Applied code must be exactly the verified candidate tree')
  requireCondition(applied.approval.verificationRunId === session.approval.verificationRunId && applied.approval.candidateId === patch.id, 'Application does not match approval')
  requireCondition(currentRun(session)?.status === 'passed', 'Verification evidence is no longer current')
  return { ...session, applied: { ...applied }, status: 'applied' }
}
