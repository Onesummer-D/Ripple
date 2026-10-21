/**
 * F 体验层 ViewModel 契约（纯类型 + 纯派生函数，不依赖 React）。
 *
 * 体验组件只消费这些类型；真实数据由 ExperienceAdapter 的实现提供
 * （现在是 demo-adapter.ts，未来由 local-project-api / model.ts 映射）。
 * 这里不复制核心领域状态机，只是把"用户需要看懂什么"投影成 UI 状态。
 */

export type DataProvenance = 'demo' | 'simulated' | 'real'
export type SourceCertainty = 'source-proven' | 'partial' | 'unknown'
export type PageScopeChoiceXp = 'include' | 'exclude' | 'protect' | 'undecided'

/** 画布元素（可悬停/选中）。location 是演示用摘要，真实实现换成 sourceRef。 */
export interface CanvasElementXp {
  id: string
  label: string
  /** 画布内稳定选择器（演示 DOM）；真实实现为 sourceRef + runtime instance。 */
  demoSelector: string
  currentText: string
  /** 该元素在源码中的可编辑文本来源。 */
  sourceRef?: string
  sourcePath?: string
  certainty: SourceCertainty
  /** 已知消费此来源的页面。 */
  impactPageRefs: string[]
  unresolvedReasons: string[]
  /** 能否进入编辑（unknown 元素只能查看，不能承诺修改范围）。 */
  editable: boolean
}

export interface PageXp {
  id: string
  label: string
  path: string
  /** 与当前修改目标的关系。 */
  relation: 'editing' | 'same-source' | 'unrelated' | 'unproven'
  /** 关系证据强度；unrelated 页面也可能是 source-proven 的"无影响"。 */
  relationCertainty: SourceCertainty
  scope: PageScopeChoiceXp
}

export interface ViewportXp {
  id: string
  label: string
  width: number
  height: number
  /** 390 视口在正式验证中的状态。 */
  verificationStatus: 'available' | 'in-verification' | 'unavailable'
}

export type EvidenceSourceKind = 'source-graph' | 'runtime-observation' | 'user-choice' | 'ai-suggestion'
export type EvidenceStateXp = 'pass' | 'risk' | 'unknown' | 'not-run' | 'stale' | 'failed-to-run'

export interface EvidenceItemXp {
  id: string
  title: string
  state: EvidenceStateXp
  /** 第一眼解释（一句话，人话）。 */
  summary: string
  /** 依据类型，必须区分，不得混写。 */
  sourceKind: EvidenceSourceKind
  detail?: string
}

export type CandidateLifecycleXp = 'candidate' | 'applied' | 'rolled-back' | 'stale' | 'discarded'

export interface VersionItemXp {
  id: string
  title: string
  lifecycle: CandidateLifecycleXp
  updatedAt: string
  summary: string
  pageRef: string
  evidenceAvailable: boolean
}

export interface CompareSideXp {
  state: 'ready' | 'loading' | 'failed' | 'unavailable' | 'stale'
  imageUrl?: string
  note?: string
}

export interface ExperienceViewModel {
  projectName: string
  projectStatus: 'ready' | 'analyzing' | 'failed' | 'unavailable'
  candidateStatus: 'none' | 'draft' | 'candidate' | 'verified' | 'approved' | 'applied' | 'rolled-back' | 'stale'
  dataProvenance: DataProvenance
  pages: PageXp[]
  elements: CanvasElementXp[]
  currentPageRef: string
  selectedElementId?: string
  draftAfterText: string
  viewports: ViewportXp[]
  activeViewportId: string
  /** 当前选中的画布视口状态（预览加载/失败/不可用/证据过期）。 */
  canvasState: 'ready' | 'loading' | 'failed' | 'unavailable' | 'stale-evidence'
  evidence: EvidenceItemXp[]
  versions: VersionItemXp[]
  compare: { baseline: CompareSideXp; candidate: CompareSideXp; matchedViewport: boolean; focusArea?: string }
}

/** 把 scope 选择汇总成一句即时摘要（纯函数，可测）。 */
export function scopeSummary(pages: PageXp[]): { included: number; excluded: number; protected: number; undecided: number; unprovenIncluded: number } {
  const summary = { included: 0, excluded: 0, protected: 0, undecided: 0, unprovenIncluded: 0 }
  for (const page of pages) {
    if (page.scope === 'include') {
      summary.included += 1
      if (page.relationCertainty !== 'source-proven') summary.unprovenIncluded += 1
    } else if (page.scope === 'exclude') summary.excluded += 1
    else if (page.scope === 'protect') summary.protected += 1
    else summary.undecided += 1
  }
  return summary
}

/**
 * 审批门（体验层强制，不依赖后端）。全部条件满足才允许（演示）审批：
 * 1. 已选中可编辑目标；2. 修改内容非空；3. 目标来源满足编辑条件（editable）；
 * 4. 无未决定页面；5. 未把 partial/unknown 页面包含进修改范围。
 */
export function approvalGate(input: { pages: PageXp[]; selectedElement?: CanvasElementXp; draftAfterText: string }): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!input.selectedElement) reasons.push('尚未选中要修改的位置')
  else if (!input.selectedElement.editable) reasons.push('选中位置来源未知，不能作为修改目标')
  if (!input.draftAfterText.trim()) reasons.push('修改内容为空')
  const summary = scopeSummary(input.pages)
  if (summary.undecided > 0) reasons.push(`还有 ${summary.undecided} 个受影响页面未决定范围`)
  if (summary.unprovenIncluded > 0) reasons.push(`${summary.unprovenIncluded} 个影响范围无法完全证明的页面被选为修改范围，不能安全审批`)
  return { allowed: reasons.length === 0, reasons }
}

/** 状态文案（统一术语出口，避免散写）。 */
export const CERTAINTY_LABEL: Record<SourceCertainty, string> = {
  'source-proven': '来源已证实',
  partial: '部分证明',
  unknown: '未知',
}
export const EVIDENCE_STATE_LABEL: Record<EvidenceStateXp, string> = {
  pass: '通过', risk: '风险', unknown: '未知', 'not-run': '未运行', stale: '已过期', 'failed-to-run': '运行失败',
}
export const LIFECYCLE_LABEL: Record<CandidateLifecycleXp, string> = {
  candidate: '候选', applied: '已应用', 'rolled-back': '已回滚', stale: '已失效', discarded: '已丢弃',
}
