/** Project-first contract. Pure TypeScript, no React or predefined CaseId. */
export type Id = string
export type EditKind = 'TEXT' | 'MEDIA' | 'TOKEN' | 'CODE'
export type EvidenceResult = 'pass' | 'risk' | 'unknown' | 'not-run' | 'failed-to-run' | 'stale'
export type RelationCertainty = 'source-proven' | 'runtime-observed' | 'semantic-candidate' | 'unknown'
export const REQUIRED_VERIFICATION_ASSERTION_IDS = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors'] as const

export interface ProjectRevision {
  projectId: Id
  sourceDigest: string
  gitCommit?: string
  ref?: string
  runtimeFingerprint: string
}
export interface SourceNode {
  id: Id
  kind: 'file' | 'symbol' | 'component' | 'route' | 'data' | 'media' | 'token' | 'jsx-element' | 'state'
  label: string
  location?: { path: string; start?: number; end?: number }
  page?: string
  pages?: string[]
  selector?: string
  value?: string
  pageOverrides?: Record<Id, string>
}
export interface Relation {
  id: Id
  from: Id
  to: Id
  kind: 'imports' | 'reads' | 'renders' | 'uses-token' | 'asset-consumer' | 'css-cascade' | 'same-copy' | 'semantic-link'
  certainty: RelationCertainty
  evidenceRefs: Id[]
}
export interface SourceGraph {
  id: Id
  revision: ProjectRevision
  nodes: SourceNode[]
  edges: Relation[]
  unresolved: string[]
}
export interface RuntimeElementObservation {
  sourceRef: Id
  runtimeInstanceId: Id
  certainty: 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
}
export interface RuntimeSourceMap {
  graphId: Id
  sourceDigest: string
  runtimeFingerprint: string
  observations: RuntimeElementObservation[]
}
export interface ScopeDecision {
  id: Id
  version: number
  strategy?: 'shared' | 'page-override'
  localPageRef?: Id
  includedRefs: Id[]
  excludedRefs: Id[]
  protectedRefs: Id[]
  decidedBy: Id
  decidedAt: string
}
export type BrowserControlRole = 'button' | 'link'
export interface BrowserVerificationContract {
  pages: Array<{
    pageRef: Id
    path: string
    markerText: string
    navigateBy?: { role: BrowserControlRole; name: string }
  }>
  interactions: Array<{
    pageRef: Id
    role: BrowserControlRole
    name: string
    expectedText: string
  }>
}
export interface ScopePropagationObservation {
  pageRef: Id
  route: string
  viewport: { width: number; height: number }
  markerText: string
  baselineMarkerVisible: boolean
  candidateMarkerVisible: boolean
  operations: Array<{
    operationId: Id
    expectedBaselineText: string
    baselineValues: string[]
    candidateValues: string[]
  }>
}
export interface InteractionObservation {
  interactionIndex: number
  pageRef: Id
  route: string
  viewport: { width: number; height: number }
  role: BrowserControlRole
  name: string
  expectedText: string
  baselinePassed: boolean
  candidatePassed: boolean
}
export interface EditOperation {
  id: Id
  kind: EditKind
  targetRef: Id
  before: string
  after: string
  overrideAction?: 'remove'
}
export interface CandidatePatch {
  id: Id
  baseSourceDigest: string
  scopeDecisionId: Id
  scopeVersion: number
  patchHash: string
  candidateTreeDigest: string
  candidateRoot?: string
  artifactPath?: string
  operations: EditOperation[]
  diffArtifact: string
}
export interface VerificationCheck {
  id: Id
  route: string
  viewport: { width: number; height: number }
  state: string
  description: string
  mandatory: boolean
}
export interface VerificationAssertion {
  id: string
  result: EvidenceResult
  detail: string
}
export interface BaselineComparison {
  route: string
  viewport: { width: number; height: number }
  baselineDigest?: string
  candidateDigest?: string
  maskedOperationIds: string[]
  matched: boolean
  artifactPath?: string
  artifactHash?: string
  reason?: string
}
export interface VerificationEvidence {
  id: Id
  checkId: Id
  result: EvidenceResult
  capturedAt: string
  pageUrl: string
  viewport: { width: number; height: number }
  runtimeState: string
  elementRefs: Id[]
  artifactPath?: string
  artifactHash?: string
  reason?: string
}
export interface VerificationRun {
  id: Id
  candidateId: Id
  scopeDecisionId: Id
  scopeVersion: number
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  verificationContractHash?: string
  startedAt: string
  completedAt: string
  checks: VerificationCheck[]
  assertions: VerificationAssertion[]
  evidence: VerificationEvidence[]
  baselineComparisons?: BaselineComparison[]
  scopeObservations?: ScopePropagationObservation[]
  interactionObservations?: InteractionObservation[]
  execution?: { executor: 'playwright'; recordPath: string; recordHash: string }
  status: 'passed' | 'risks' | 'incomplete' | 'stale'
}
export interface Approval {
  candidateId: Id
  verificationRunId: Id
  by: Id
  at: string
}
export interface AppliedRevision {
  candidateId: Id
  approval: Approval
  appliedPatchHash: string
  baseSourceDigest: string
  targetSourceDigest: string
  appliedAt: string
  commit?: string
}
export interface RollbackRevision {
  candidateId: Id
  appliedPatchHash: string
  restoredSourceDigest: string
  rolledBackAt: string
}
export interface VerificationFailure {
  candidateId: Id
  patchHash: string
  attemptedAt: string
  reason: string
}
export type SessionStatus = 'draft' | 'analyzed' | 'scoped' | 'candidate' | 'verified' | 'approved' | 'applied' | 'rolled-back'
export interface EditSession {
  id: Id
  projectRevision: ProjectRevision
  rawIntent: string
  selectedElementRefs: Id[]
  operations: EditOperation[]
  status: SessionStatus
  sourceGraphId?: Id
  verificationContract?: BrowserVerificationContract
  scope?: ScopeDecision
  candidate?: CandidatePatch
  runs: VerificationRun[]
  approval?: Approval
  applied?: AppliedRevision
  rollback?: RollbackRevision
  verificationFailure?: VerificationFailure
}
