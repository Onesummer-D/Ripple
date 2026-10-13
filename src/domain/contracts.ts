export const editKinds = ['TEXT', 'MEDIA', 'TOKEN'] as const
export type EditKind = (typeof editKinds)[number]

export const graphNodeKinds = ['route', 'component', 'instance', 'slot', 'source'] as const
export type GraphNodeKind = (typeof graphNodeKinds)[number]

export const graphEdgeTypes = ['renders', 'instantiates', 'contains', 'reads'] as const
export type GraphEdgeType = (typeof graphEdgeTypes)[number]

export const scopeModes = ['INSTANCE', 'SHARED'] as const
export type ScopeMode = (typeof scopeModes)[number]

export const evidenceTypes = ['STRUCTURE', 'RUNTIME', 'LAYOUT', 'SCREENSHOT'] as const
export type EvidenceType = (typeof evidenceTypes)[number]

export const evidenceVerificationStates = ['verified', 'unknown', 'loading'] as const
export type EvidenceVerificationState = (typeof evidenceVerificationStates)[number]
export const evidenceOrigins = ['fixture', 'real'] as const
export type EvidenceOrigin = (typeof evidenceOrigins)[number]

export type CaseId = 'qingye' | 'qiguang' | 'third-party'

export interface RippleGraphNode {
  id: string
  caseId: CaseId
  kind: GraphNodeKind
  label: string
  route?: string
  sourceId?: string
}

export interface RippleGraphEdge {
  id: string
  caseId: CaseId
  type: GraphEdgeType
  from: string
  to: string
}

export interface RippleGraph {
  id: string
  caseId: CaseId
  nodes: RippleGraphNode[]
  edges: RippleGraphEdge[]
}

export interface CandidateEdit {
  id: string
  caseId: CaseId
  instanceId: string
  slotId: string
  sourceId: string
  oldValue: string
  newValue: string
  editKind: EditKind
  mediaResource?: MediaAssetMetadata
}

export interface MediaAssetMetadata {
  id: string
  name: string
  mimeType: string
  bytes: number
  width: number
  height: number
}

export interface ScopeDecision {
  id: string
  caseId: CaseId
  mode: ScopeMode
  affectedInstanceIds: string[]
  candidateEditId: string
}

export interface Evidence {
  id: string
  caseId: CaseId
  type: EvidenceType
  route: string
  viewport: string
  summary: string
  sourcePath: string
  screenshotPath?: string
  verification?: EvidenceVerificationState
  origin?: EvidenceOrigin
  producer?: 'A-preview'
  context?: PreviewEvidenceContext
  measurement?: PreviewMeasurement
}

export interface PreviewEvidenceContext {
  previewMode: 'draft' | 'candidate'
  previewKey?: string
  candidateEditId?: string
  candidateValue?: string
  scopeDecisionId?: string
  scopeMode?: ScopeMode
  snapshotId?: string
}

export interface ElementRect { x: number; y: number; width: number; height: number }

export interface SlotObservation {
  slotId: string
  instanceId: string
  sourceId: string
  rect: ElementRect
  media?: { naturalWidth: number; naturalHeight: number; objectFit: string; objectPosition: string }
  style?: { color: string; backgroundColor: string; borderColor: string }
}

export interface PreviewMeasurement {
  measuredAt: string
  width: number
  height: number
  slots: SlotObservation[]
  cta?: ElementRect
}

export interface RepositoryProvenance {
  repositoryUrl: string
  commit?: string
  tag?: string
  license?: string
  noticePath?: string
  tokenSource?: string
  consumerPaths: string[]
}

export interface Snapshot {
  id: string
  caseId: CaseId
  createdAt: string
  decision: ScopeDecision
  verificationEvidenceIds: string[]
  state: Record<string, string>
  previousSnapshotId?: string
  previewEvidence?: Evidence[]
}

export interface EditableSlot {
  id: string
  instanceId: string
  sourceId: string
  label: string
  value: string
  editKind: EditKind
  route: string
  shared: boolean
}

export interface CaseFixture {
  id: CaseId
  name: string
  subtitle: string
  description: string
  editKind: EditKind
  accent: string
  sourceLabel: string
  slots: EditableSlot[]
  graph: RippleGraph
  evidence: Evidence[]
  fixtureIds: string[]
  provenance?: RepositoryProvenance
}
