/** Project-first contract. Pure TypeScript, no React or predefined CaseId. */
export type Id = string
export type EditKind = 'TEXT' | 'MEDIA' | 'TOKEN' | 'CODE'
export type EvidenceResult = 'pass' | 'risk' | 'unknown' | 'not-run' | 'failed-to-run' | 'stale'
export type RelationCertainty = 'source-proven' | 'runtime-observed' | 'semantic-candidate' | 'unknown'

export interface ProjectRevision {
  projectId: Id
  sourceDigest: string
  ref?: string
  runtimeFingerprint: string
}
export interface SourceNode {
  id: Id
  kind: 'file' | 'symbol' | 'component' | 'route' | 'data' | 'media' | 'token' | 'dom-instance' | 'state'
  label: string
  location?: { path: string; start?: number; end?: number }
  page?: string
  selector?: string
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
export interface ScopeDecision {
  id: Id
  version: number
  includedRefs: Id[]
  excludedRefs: Id[]
  protectedRefs: Id[]
  decidedBy: Id
  decidedAt: string
}
export interface EditOperation {
  id: Id
  kind: EditKind
  targetRef: Id
  before: string
  after: string
}
export interface CandidatePatch {
  id: Id
  baseSourceDigest: string
  scopeDecisionId: Id
  scopeVersion: number
  patchHash: string
  candidateTreeDigest: string
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
  reason?: string
}
export interface VerificationRun {
  id: Id
  candidateId: Id
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  startedAt: string
  completedAt: string
  checks: VerificationCheck[]
  evidence: VerificationEvidence[]
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
export type SessionStatus = 'draft' | 'analyzed' | 'scoped' | 'candidate' | 'verified' | 'approved' | 'applied'
export interface EditSession {
  id: Id
  projectRevision: ProjectRevision
  rawIntent: string
  selectedElementRefs: Id[]
  status: SessionStatus
  sourceGraphId?: Id
  scope?: ScopeDecision
  candidate?: CandidatePatch
  runs: VerificationRun[]
  approval?: Approval
  applied?: AppliedRevision
}
