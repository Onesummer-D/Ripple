// Read-only view model over VisualDifferenceEvidence for the F workbench.
//
// This module is the ONLY sanctioned consumption surface for visual evidence:
// it maps an already-computed evidence object to plain, JSON-safe view data.
// It never re-analyses, never decides PASS, and never mutates the evidence.
// F (or any other consumer) must not reach into visual-evidence internals;
// formal verification state must not be derived from these views.
import type { VisualDifferenceEvidence, VisualEvidenceResult } from './visual-evidence'
import type { RegionClassification } from './visual-evidence'

export const VISUAL_EVIDENCE_VIEW_SCHEMA = 'ripple-visual-evidence-view/v1'

/** Mirror of F's EvidenceStateXp minus 'pass': visual evidence can never be pass. */
export type VisualEvidenceViewState = Exclude<VisualEvidenceResult, 'pass'>

/** Stable per-state labels so the workbench renders identical wording everywhere. */
export const VISUAL_EVIDENCE_STATE_LABEL: Record<VisualEvidenceViewState, string> = {
  risk: '视觉风险',
  unknown: '视觉未知',
  'not-run': '未运行',
  stale: '证据过期',
  'failed-to-run': '无法运行',
}

export interface VisualEvidenceViewFinding {
  code: string
  severity: 'info' | 'review' | 'risk'
  detail: string
  regionIds: string[]
}

export interface VisualEvidenceViewRegion {
  id: string
  /** Region box in CSS px (screenshot-relative). */
  cssBox: { x: number; y: number; width: number; height: number }
  classification: RegionClassification
  attribution: 'mapped' | 'unmapped' | 'unknown'
  changedPixels: number
  insideTargetPixels: number | null
  /** sourceRefs of the elements attributed to this region (bounded by the evidence). */
  sourceRefs: string[]
}

export interface VisualEvidenceView {
  schema: typeof VISUAL_EVIDENCE_VIEW_SCHEMA
  /** Evidence id; stable for one evidence object. */
  id: string
  checkId: string | null
  state: VisualEvidenceViewState
  stateLabel: string
  /** One-sentence, human summary of what the evidence may claim. */
  summary: string
  resultReason: string
  identityStatus: VisualDifferenceEvidence['identity']['status']
  comparable: boolean
  coverage: VisualDifferenceEvidence['coverage']
  changedPixels: number | null
  regionCount: number
  regions: VisualEvidenceViewRegion[]
  findings: VisualEvidenceViewFinding[]
  /** Comparability limitation codes (fonts, stability, provenance, ...). */
  limitations: string[]
  comparabilityReasons: string[]
  /** Read-only artifact references; consumers render but must not modify. */
  artifacts: {
    evidenceJson: { sha256: string } | null
    diffImage: { sha256: string; pixelSha256: string } | null
    /** Caller-supplied display URLs (e.g. served artifact paths). Never trusted as identity. */
    urls: { baseline?: string; candidate?: string; diff?: string; evidence?: string }
  }
}

/** Caller-supplied, display-only URLs for the workbench. */
export interface VisualEvidenceViewRefs {
  baselineImageUrl?: string
  candidateImageUrl?: string
  diffImageUrl?: string
  evidenceUrl?: string
}

const summarize = (evidence: VisualDifferenceEvidence): string => {
  const observation = evidence.observation
  const where = observation ? (observation.changedPixels > 0 ? `检测到 ${observation.changedPixels} 个变化像素（${observation.regionCount} 个区域）` : '未检测到视觉变化') : '未进行像素比较'
  const riskCount = evidence.findings.filter(finding => finding.severity === 'risk').length
  const risk = riskCount > 0 ? `；触发 ${riskCount} 条布局风险规则` : ''
  return `${where}${risk}。视觉证据仅为补充观察，不构成通过判定。`
}

/** Maps evidence to its read-only view. Pure: same evidence in, same view out. */
export function toVisualEvidenceView(evidence: VisualDifferenceEvidence, refs: VisualEvidenceViewRefs = {}): VisualEvidenceView {
  const observation = evidence.observation
  return {
    schema: VISUAL_EVIDENCE_VIEW_SCHEMA,
    id: evidence.id,
    checkId: evidence.checkId,
    state: evidence.result,
    stateLabel: VISUAL_EVIDENCE_STATE_LABEL[evidence.result],
    summary: summarize(evidence),
    resultReason: evidence.resultReason,
    identityStatus: evidence.identity.status,
    comparable: evidence.comparability.comparable,
    coverage: evidence.coverage,
    changedPixels: observation?.changedPixels ?? null,
    regionCount: observation?.regions.length ?? 0,
    regions: (observation?.regions ?? []).map(region => ({
      id: region.id,
      cssBox: region.cssBox,
      classification: region.classification,
      attribution: region.attribution,
      changedPixels: region.changedPixels,
      insideTargetPixels: region.insideTargetPixels,
      sourceRefs: [...new Set(region.elements.map(element => element.sourceRef).filter((ref): ref is string => ref !== null))],
    })),
    findings: evidence.findings.map(finding => ({ code: finding.code, severity: finding.severity, detail: finding.detail, regionIds: finding.regionIds ?? [] })),
    limitations: evidence.comparability.limitations.map(limitation => limitation.code),
    comparabilityReasons: evidence.comparability.reasons.map(reason => reason.code),
    artifacts: {
      evidenceJson: null,
      diffImage: observation?.diffImage ? { sha256: observation.diffImage.sha256, pixelSha256: observation.diffImage.pixelSha256 } : null,
      urls: {
        baseline: refs.baselineImageUrl,
        candidate: refs.candidateImageUrl,
        diff: refs.diffImageUrl,
        evidence: refs.evidenceUrl,
      },
    },
  }
}

/** Shape-compatible with F's EvidenceItemXp; F can consume without importing core internals. */
export function toEvidenceItemView(view: VisualEvidenceView): {
  id: string
  title: string
  state: VisualEvidenceViewState
  summary: string
  sourceKind: 'runtime-observation'
  detail: string
} {
  return {
    id: view.id,
    title: view.checkId ? `视觉证据 ${view.checkId}` : '视觉证据',
    state: view.state,
    summary: view.summary,
    sourceKind: 'runtime-observation',
    detail: JSON.stringify({ schema: view.schema, identity: view.identityStatus, comparable: view.comparable, findings: view.findings, limitations: view.limitations, artifacts: view.artifacts }),
  }
}
