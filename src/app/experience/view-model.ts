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

/** D 点选采集到的运行时实例身份（仅显示/导航，不构成编辑授权）。 */
export interface RuntimeIdentityXp {
  /** 信封采集确定性；仅 stable-keyed/stable-react 可用于精准实例级操作。 */
  certainty: 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
  reasons: string[]
  runtimeInstanceId?: string
  sameSourceCount?: number
  sourceVersion?: string
  tagName?: string
  runtimeText?: string
}

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
  /** 真实模式：画布点选采集到的运行时身份（D 桥；缺省表示尚未点选采集）。 */
  runtimeIdentity?: RuntimeIdentityXp
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

/**
 * 真实项目源码预演会话（由 /__ripple/api/project/preview 建立）。
 * iframe 只允许加载这里给出的同源预演地址——它来自服务端身份核验响应，
 * 不得把任意第三方 URL 当作可信 Ripple 页面。
 */
export interface RealPreviewXp {
  url: string
  projectId: string
  previewId: string
  sourceDigest: string
}

/** 真实工程身份（分析响应 revision 的只读投影，用于界面标注与一致性核对）。 */
export interface ProjectIdentityXp {
  projectId: string
  sourceDigest: string
  gitCommit?: string
  graphId?: string
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
  /**
   * 前后对照的可比较性（明确三态，避免把"无需警告"误读为"已经一致"）：
   * - 'comparable'：两侧真实截图的身份、视口与必要交互状态均一致，可比较；
   * - 'partial'：有候选但 baseline/candidate 任一侧缺真实截图，对照不完整；
   * - 'none'：尚无候选，暂无可比较内容。
   */
  compare: { baseline: CompareSideXp; candidate: CompareSideXp; compareState: 'comparable' | 'partial' | 'none'; focusArea?: string }
  /** 真实模式：项目源码预演会话（iframe 唯一可信地址来源）。 */
  preview?: RealPreviewXp
  /** 真实模式：工程身份标注。 */
  projectIdentity?: ProjectIdentityXp
  /**
   * 真实模式当前无法提供的能力的准确阻断原因（如预演不可用、验证未运行）。
   * 用于"看到无法操作的按钮及其准确阻断原因"，不得用演示默认值填充。
   */
  blockedReasons?: string[]
  /**
   * 真实模式：画布点选能力是否可用（有可信项目预演会话才可用）。
   * 点选的激活状态是会话级 UI 状态，不放在模型里。
   */
  pickerAvailable?: boolean
  /** 真实模式：当前活跃候选（POST /candidate 的真实响应投影；无活跃候选时缺省）。 */
  activeCandidate?: {
    candidateId: string
    patchHash?: string
    /** 候选预演地址（POST /candidate/preview 响应；iframe 唯一可信来源）。 */
    previewUrl?: string
    previewLoading?: boolean
    /** 四视口验证运行中（POST /candidate/verify 在途；按钮禁用）。 */
    verificationRunning?: boolean
    /** 最近一次真实验证运行（POST /candidate/verify 响应投影；服务端权威，F 不自行生成）。 */
    verification?: CandidateVerificationXp
  }
}

/** 真实验证运行投影（第二批：POST /candidate/verify；全部字段来自服务端响应）。 */
export interface CandidateVerificationXp {
  state: 'not-run' | 'passed' | 'risks' | 'incomplete' | 'stale' | 'failed-to-run'
  stateLabel: string
  reason?: string
  runId?: string
  patchHash?: string
  scopeVersion?: number
  startedAt?: string
  completedAt?: string
  /** 执行记录哈希（审批必须绑定此运行，第三批接入）。 */
  recordHash?: string
  assertions: Array<{ id: string; result: string; detail: string }>
  /** 四视口证据截图（imageUrl 已为绝对地址，可直接作 img src）。 */
  shots: Array<{
    viewportWidth: number
    viewportHeight: number
    result: string
    runtimeState?: string
    imageUrl?: string
    reason?: string
  }>
  /** E 只读视觉差异证据（ripple-visual-evidence-view/v1 投影；无则缺省）。 */
  visualEvidences: Array<{
    checkId: string
    route: string
    result: string
    resultReason?: string
    /** 原始可读 view 投影（schema/stateLabel/summary/配对证明标签逐字渲染，不得改写升级）。 */
    view?: VisualEvidenceViewXp
  }>
}

/**
 * E 的 ripple-visual-evidence-view/v1 可读字段（F 只读消费；结构以 A/E 为准，
 * 缺失字段一律可选——不得臆造）。视觉证据仅为补充观察，永远不能是 pass。
 */
export interface VisualEvidenceViewXp {
  schema?: string
  stateLabel?: string
  summary?: string
  comparable?: boolean
  changedPixels?: number | null
  regionCount?: number
  identityStatus?: string
  limitations?: string[]
  crossVersion?: {
    scope?: { strictInstanceProofAvailable?: boolean }
    pairs?: Array<{ proofLabel?: string; reasons?: string[] }>
  }
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
 * 1. 已选中可编辑目标；2. 修改内容非空；3. 目标来源确定性为 source-proven
 *    （editable 只是"尝试编辑"的资格，partial/unknown 来源绝不能得到安全审批结论）；
 * 4. 无未决定页面；5. 未把 partial/unknown 页面包含进修改范围。
 */
export function approvalGate(input: { pages: PageXp[]; selectedElement?: CanvasElementXp; draftAfterText: string }): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!input.selectedElement) reasons.push('尚未选中要修改的位置')
  else if (!input.selectedElement.editable) reasons.push('选中位置来源未知，不能作为修改目标')
  else if (input.selectedElement.certainty !== 'source-proven') reasons.push('选中位置来源未完全证明，不能作为安全修改目标')
  if (!input.draftAfterText.trim()) reasons.push('修改内容为空')
  const summary = scopeSummary(input.pages)
  if (summary.undecided > 0) reasons.push(`还有 ${summary.undecided} 个受影响页面未决定范围`)
  if (summary.unprovenIncluded > 0) reasons.push(`${summary.unprovenIncluded} 个影响范围无法完全证明的页面被选为修改范围，不能安全审批`)
  return { allowed: reasons.length === 0, reasons }
}

/**
 * 选中目标后的页面关系投影 + 默认 Scope 生成（纯函数）。
 *
 * 规则（全部由当前目标的 CanvasElementXp 决定，与页面名称无关）：
 * - 未选中目标（element 为 undefined）：页面关系保持不变；
 * - 目标所属页面（elementPageRef，即真实修改目标所在的页面）：
 *   relation 'editing'，scope 固定 'include'；其来源确定性封顶为
 *   min(元素确定性, source-proven)——partial/unknown 元素所在页如实显示
 *   partial/unknown，不得无条件标记"来源已证实"。
 *   注意：elementPageRef 与"用户正在浏览的页面"（ViewModel.currentPageRef）
 *   是两个概念：浏览页只影响画布展示，绝不参与关系投影；目标所属页在真实
 *   Adapter 中必须由可信来源（元素归属页面数据）提供，体验层不自行推断。
 * - 在 impactPageRefs 中：
 *   - 目标来源 source-proven → 'same-source' / source-proven / 默认 include；
 *   - 目标来源 partial/unknown → 'unproven' / 目标同级的确定性 / 默认 undecided
 *     （不得把未完全证明的影响包装成安全同源）；
 * - 不在 impactPageRefs 中：默认 'unproven' / unknown（或目标的 partial）/ undecided。
 *   impactPageRefs 只是已知影响清单，缺页不证明"无影响"——不得自动升级为
 *   source-proven 的 unrelated；只有调用方显式给出 provenUnaffectedRefs
 *   （真实来源分析已证明不受影响的页面）才表达 'unrelated' / source-proven / exclude。
 *
 * 不修改传入数组，返回新数组；默认 Scope 只由当前目标推导，绝不继承上一目标。
 */
export function projectPageRelations(
  pages: PageXp[],
  element: CanvasElementXp | undefined,
  elementPageRef: string,
  provenUnaffectedRefs?: readonly string[],
): PageXp[] {
  if (!element) return pages
  const proven = element.certainty === 'source-proven'
  const unaffected = new Set(proven ? (provenUnaffectedRefs ?? []) : [])
  return pages.map(page => {
    if (page.id === elementPageRef) {
      // 编辑页的确定性不得高于元素自身的来源证据；scope 固定 include，
      // 审批安全仍由 approvalGate() 的元素确定性条件兜底
      return { ...page, relation: 'editing', relationCertainty: element.certainty, scope: 'include' }
    }
    if (element.impactPageRefs.includes(page.id)) {
      return proven
        ? { ...page, relation: 'same-source', relationCertainty: 'source-proven', scope: 'include' }
        : { ...page, relation: 'unproven', relationCertainty: element.certainty, scope: 'undecided' }
    }
    if (unaffected.has(page.id)) {
      return { ...page, relation: 'unrelated', relationCertainty: 'source-proven', scope: 'exclude' }
    }
    // 已知影响清单之外：不臆造"无影响"证明，保持未证明 + 默认 undecided
    return { ...page, relation: 'unproven', relationCertainty: proven ? 'unknown' : element.certainty, scope: 'undecided' }
  })
}

/**
 * 演示审批反馈是否已随修订失效（纯函数）。
 * 目标、草稿或范围决策任一变化，旧确认结论都必须作废——
 * 反馈只属于生成它的那一版（目标 + 草稿 + Scope），禁止跨修订复用。
 */
export function approvalFeedbackStale(previous: ExperienceViewModel, next: ExperienceViewModel): boolean {
  return previous.selectedElementId !== next.selectedElementId
    || previous.draftAfterText !== next.draftAfterText
    || previous.pages !== next.pages
}

/** 运行时身份是否达到精准实例级（stable-keyed / stable-react）。 */
export function isStableRuntimeIdentity(identity: RuntimeIdentityXp | undefined): boolean {
  return identity?.certainty === 'stable-keyed-instance' || identity?.certainty === 'stable-react-instance'
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
