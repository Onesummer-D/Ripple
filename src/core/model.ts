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
/** Why a collected runtime identity cannot be treated as one proven instance. */
export type RuntimeIdentityReason =
  | 'invalid-certainty'
  | 'unmapped-owner'
  | 'instance-unavailable'
  | 'duplicate-runtime-instance'
  | 'route-namespace-stale'
  | 'source-version-unavailable'
  | 'source-version-ambiguous'
  | 'source-version-mismatch'
  | 'source-not-in-graph'
  | 'page-context-mismatch'
  | 'page-context-unverified'
  | 'react-keys-unavailable'
  | 'identity-not-stable'
/** Browser location an element was observed at (client routing may use any of the parts). */
export interface RuntimePageContext {
  pathname: string
  search: string
  hash: string
}
export interface RuntimeElementObservation {
  sourceRef: Id
  runtimeInstanceId: Id
  certainty: 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
  /** Optional, additive: where the element was observed. */
  pageContext?: RuntimePageContext
  /** Optional, additive: sha256 of the served source file that rendered `sourceRef`. */
  sourceVersion?: string
  /** Optional, additive: collection-time downgrade reasons. */
  reasons?: RuntimeIdentityReason[]
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
    menuControl?: { role: BrowserControlRole; name: string }
  }>
  interactions: Array<{
    pageRef: Id
    role: BrowserControlRole
    name: string
    expectedText: string
  }>
}
export type RouteIdentityStatus = 'verified' | 'missing' | 'ambiguous' | 'wrong-route'
export interface ScopePropagationObservation {
  pageRef: Id
  route: string
  viewport: { width: number; height: number }
  markerText: string
  baselineMarkerVisible: boolean
  candidateMarkerVisible: boolean
  baselineMarkerMatchCount: number
  candidateMarkerMatchCount: number
  baselineRouteIdentity: RouteIdentityStatus
  candidateRouteIdentity: RouteIdentityStatus
  operations: Array<{
    operationId: Id
    expectedBaselineText: string
    expectedCandidateText: string
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
  baselineRouteIdentity: RouteIdentityStatus
  candidateRouteIdentity: RouteIdentityStatus
  baselinePassed: boolean
  candidatePassed: boolean
}
export interface EditOperationBase {
  id: Id
  targetRef: Id
  before: string
  after: string
  overrideAction?: 'remove'
}
export type ResponsiveVariantMechanism = 'srcset' | 'picture' | 'css' | 'container-rule'
export interface MediaAssetSwapPayload {
  assetRef: string
  assetHash: string
  focalPoint?: { x: number; y: number }
  variants?: Array<{
    mechanism: ResponsiveVariantMechanism
    condition: string
    assetRef: string
    assetHash: string
  }>
  containerHint?: { selector: string; aspect: number }
}
export interface TokenLocalProjectionPayload {
  declarationRef: Id
  value: string
  localScope: { pageRef: Id; mechanism: 'css-override' | 'style-prop' }
}
type PayloadlessEditOperation<K extends EditKind> = EditOperationBase & { kind: K; action?: never; payload?: never }
export type EditOperation =
  | PayloadlessEditOperation<'TEXT'>
  | PayloadlessEditOperation<'CODE'>
  | PayloadlessEditOperation<'MEDIA'>
  | PayloadlessEditOperation<'TOKEN'>
  | (EditOperationBase & { kind: 'MEDIA'; action: 'asset-swap'; payload: MediaAssetSwapPayload })
  | (EditOperationBase & { kind: 'TOKEN'; action: 'local-projection'; payload: TokenLocalProjectionPayload })
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
export interface VisualRunEvidence {
  checkId: Id
  route: string
  viewport: { width: number; height: number }
  state: string
  /** Never 'pass': a visual result is supplementary and cannot approve. */
  result: 'risk' | 'unknown' | 'not-run' | 'stale' | 'failed-to-run'
  resultReason: string
  /** ripple-visual-difference/v1 evidence (every list bounded by construction). */
  evidence: unknown
  /** ripple-visual-evidence-view/v1 read-only projection for the F workbench. */
  view: unknown
  artifacts: {
    baseline: { path: string; sha256: string } | null
    candidate: { path: string; sha256: string } | null
    diff: { path: string; sha256: string; pixelSha256: string } | null
    evidenceJson: { path: string; sha256: string } | null
  }
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
  browserErrorDetails?: BrowserErrorDetails
  /**
   * Supplementary visual-difference evidence (capture + analysis attached by
   * the host after the attested browser run). Read-only, advisory, never part
   * of assertions, status or the approval gate; results can never be 'pass'.
   */
  visualEvidences?: VisualRunEvidence[]
  execution?: { executor: 'playwright'; recordPath: string; recordHash: string }
  status: 'passed' | 'risks' | 'incomplete' | 'stale'
}
export interface Approval {
  candidateId: Id
  verificationRunId: Id
  by: Id
  at: string
}
/** Categorized browser-error evidence carried with a verification run. */
export interface BrowserErrorDetails {
  total: number
  byCategory: Record<string, number>
  samples: string[]
  truncated: boolean
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
