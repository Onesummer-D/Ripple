/**
 * 真实适配器（Real Adapter，第一阶段）。
 *
 * 把 A 已存在的服务端 API（/__ripple/api/*，见 src/core/local-project-api.ts）
 * 的真实响应映射到 ExperienceViewModel，数据全程标记 dataProvenance: 'real'。
 *
 * 数据来源（全部只读，绝不伪造）：
 * - POST /__ripple/api/analyze        → 工程身份（revision）、页面列表（routes）、
 *   编辑目标（targets，含 B 的 sourceProvenPageImpact 来源确定性）；
 * - GET  /__ripple/api/history        → 已保存候选、补丁身份（patchHash）与生命周期、
 *   VerificationRun 的真实结果（not-run/failed-to-run/stale 原样透出）；
 * - POST /__ripple/api/project/preview → 项目源码预演会话（iframe 唯一可信地址）。
 *
 * 明确不做（第一阶段范围外）：
 * - 不创建真实候选（draftAfterText/Scope 只是本地意向，绝不 POST /candidate）；
 * - 不开放真实 Approval/Apply/Rollback（UI 已有"真实审批尚未接入"提示）；
 * - 不臆造 provenUnaffectedRefs，不用浏览页推断目标所属页；
 * - 预览不可用时如实显示 unavailable 与阻断原因，绝不渲染演示 DOM。
 *
 * 异步契约见 adapter.ts 文件头：generation 守卫丢弃过期响应；openProject 使旧
 * 工程全部数据失效；dispose 停止预演会话并取消在途请求。
 */
import type { ExperienceAdapter } from './adapter'
import type { EditOperation, ScopeDecision, VerificationRun } from '../../core/model'
import { pairRuntimeIdentityRun, type RuntimeIdentityRunPairingView } from '../../core/runtime-identity-pairing'
import {
  assessDisplayIdentity,
  isBoundProjectSelection,
  type ProjectSourceSelectionResponse,
} from './real-selection'
import { projectPageRelations, scopeSummary } from './view-model'
import type {
  CanvasElementXp,
  EvidenceItemXp,
  EvidenceStateXp,
  ExperienceViewModel,
  PageScopeChoiceXp,
  PageXp,
  RuntimeIdentityXp,
  VerificationContractPageXp,
  VerificationContractXp,
  VersionItemXp,
  ViewportXp,
} from './view-model'

/* ---------- 服务端响应类型（/ __ripple/api 的只读投影，字段以 A 的服务端为准） ---------- */

interface RouteSummary { id: string; label: string; page?: string }
interface TargetImpact { pageRefs: string[]; unresolved: string[]; certainty: 'source-proven' | 'partial' | 'unknown' }
interface TargetSummary {
  id: string
  kind: string
  label: string
  value?: string
  location?: { path: string; start?: number; end?: number }
  impact: TargetImpact
}
interface AnalysisResponse {
  projectRoot: string
  revision: { projectId: string; sourceDigest: string; gitCommit?: string; runtimeFingerprint: string }
  graphId: string
  unresolved: string[]
  routes: RouteSummary[]
  targets: TargetSummary[]
  relationCounts: Record<string, number>
}
type VerificationState = 'not-run' | 'passed' | 'risks' | 'incomplete' | 'stale' | 'failed-to-run'
interface VerificationView {
  state: VerificationState
  reason?: string
  runId?: string
  patchHash?: string
  scopeDecisionId?: string
  scopeVersion?: number
  startedAt?: string
  completedAt?: string
  assertions?: Array<{ id: string; result: string; detail: string }>
  /** Formal checks define the expected runpoints independently of visual evidence. */
  checks?: VerificationRun['checks']
  /** Host-produced v1.2 single-side receipts; this adapter passes them through without pairing or upgrading proof. */
  runtimeIdentities?: VerificationRun['runtimeIdentities']
  evidence?: Array<{
    id: string
    checkId?: string
    result: string
    pageUrl?: string
    viewport: { width: number; height: number }
    runtimeState?: string
    elementRefs?: string[]
    reason?: string
    artifactUrl?: string
  }>
  recordUrl?: string
  recordHash?: string
  browserErrorDetails?: { total: number; byCategory: Record<string, number>; samples: string[]; truncated: boolean }
  /** E 只读视觉差异证据投影（ripple-visual-evidence-view/v1；字段以 A 为准）。 */
  visualEvidences?: Array<{
    checkId: string
    route: string
    result: string
    resultReason?: string
    view?: unknown
  }>
}
type StoredLifecycle = 'active' | 'discarded' | 'stale' | 'applied' | 'rolled-back'
/** 第三批：服务端 workflow 投影（approve/apply/rollback/verify 响应；A local-project-api workflowView）。 */
interface WorkflowView {
  lifecycle: string
  approval?: { verificationRunId: string; by?: string; at?: string }
  applied?: { appliedAt?: string }
  rollback?: { rolledBackAt?: string }
  rollbackAvailable?: boolean
}
interface HistoryItem {
  candidateId: string
  projectId: string
  lifecycle: StoredLifecycle
  patchHash: string
  updatedAt: string
  approval?: { verificationRunId: string; at: string }
  applied?: { appliedAt?: string }
  rollback?: { rolledBackAt?: string }
  verification: VerificationView
}
interface PreviewSession { projectId: string; previewId: string; sourceDigest: string; url: string }
interface CandidateRestoreResponse {
  analysis: AnalysisResponse
  candidate: { id: string; patchHash?: string }
  verification: VerificationView
  workflow: WorkflowView
}

export interface RealAdapterOptions {
  /** 本机 React/Vite 工程目录；未提供时 load() 返回"未选择工程"的不可用模型。 */
  projectRoot?: string
  /** API 前缀（测试注入用；默认同源 /__ripple/api）。 */
  apiBase?: string
  fetchImpl?: typeof fetch
  /** 瞬时锁冲突退避间隔（测试注入用；默认 700ms）。 */
  busyRetryDelayMs?: number
  /** Preserve an active formally verified candidate when reloading a project. */
  restorePersistedCandidate?: boolean
}

/* ---------- C+D 数据合同预留（第四部分：来源关系与运行时实例身份） ---------- */

/**
 * C（source-graph 消费关系增强）合入后的页面关系数据挂点。
 * 当前一律不提供：未证明的页面保持 unknown，不臆造 provenUnaffectedRefs。
 */
export interface RealSourceRelations {
  /** 来源分析已证明不受当前修改影响的页面（必须由可信来源给出）。 */
  provenUnaffectedRefs?: readonly string[]
  /** 页面级关系增强（C 的合同字段，预留）。 */
  pageRelations?: Readonly<Record<string, {
    relation: 'same-source' | 'unrelated' | 'unproven'
    certainty: 'source-proven' | 'partial' | 'unknown'
  }>>
}

/**
 * D（DOM→Source 运行时身份）点选观测的注入挂点。
 * 注意：sourceRef 唯一 ≠ React 实例唯一；identityCertainty 不达
 * stable-keyed-instance / stable-react-instance 时不得用于精准实例修改。
 */
export interface RealRuntimeIdentityObservation {
  sourceRef: string
  identityCertainty: 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
  reasons: string[]
  sourceVersion?: string
  pageContext?: { pathname: string; search: string; hash: string }
  /** 评估达 stable-* 时的运行时实例 id（显示用，不构成授权）。 */
  runtimeInstanceId?: string
  sameSourceCount?: number
  tagName?: string
  runtimeText?: string
}

/* ---------- 内部工具 ---------- */

/**
 * 过期响应错误：generation 不匹配时抛出。
 * 语义：调用方（工作台）收到此错误时不得提交任何 UI 状态更新——
 * 新请求的结果（或后续请求）才是唯一可信状态。
 */
export class StaleResponseError extends Error {}

const VIEWPORTS: Array<Omit<ViewportXp, 'verificationStatus'>> = [
  { id: 'desktop', label: '桌面 1440', width: 1440, height: 900 },
  { id: 'tablet', label: '平板 768', width: 768, height: 1024 },
  { id: 'mobile-375', label: '手机 375', width: 375, height: 812 },
  { id: 'mobile-390', label: '手机 390', width: 390, height: 844 },
]

function pathBasename(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

/** 预演地址的路径部分（身份评估的页面上下文比对用；非法地址返回空串）。 */
function safePathname(url: string): string {
  try { return new URL(url, 'http://ripple.local/').pathname } catch { return '' }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const VERIFICATION_STATE_LABEL: Record<VerificationState, string> = {
  'not-run': '尚未运行', passed: '通过', risks: '存在风险', incomplete: '不完整', stale: '已过期', 'failed-to-run': '运行失败',
}

/** 目标所属页：仅当来源分析唯一证明一个消费页时才给出；多页或未证明时不推断。 */
function provenSinglePageRef(target: TargetSummary): string {
  return target.impact.certainty === 'source-proven' && target.impact.pageRefs.length === 1 ? target.impact.pageRefs[0] : ''
}

/* ---------- 真实适配器 ---------- */

export function createRealAdapter(options: RealAdapterOptions = {}): ExperienceAdapter {
  const apiBase = options.apiBase ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const busyRetryDelayMs = options.busyRetryDelayMs ?? 700
  const restorePersistedCandidate = options.restorePersistedCandidate ?? false
  let projectRoot = options.projectRoot
  /** generation 守卫：每次 load/openProject/refresh/dispose 自增，过期响应一律丢弃。 */
  let generation = 0
  let analysis: AnalysisResponse | undefined
  let history: HistoryItem[] = []
  let previewSession: PreviewSession | undefined
  let previewFailedReason = ''
  /** 第二阶段：当前活跃真实候选（POST /candidate 响应投影；服务端为权威）。 */
  let activeCandidate: { candidateId: string; patchHash?: string } | undefined
  /** 候选预演会话地址（POST /candidate/preview 响应；iframe 唯一可信来源）。 */
  let candidatePreviewUrl: string | undefined
  let candidatePreviewLoading = false
  /** 第二批：四视口验证运行状态（POST /candidate/verify 在途）。 */
  let verificationRunning = false
  /** 第二批：最近一次真实验证运行投影（服务端权威；F 不自行生成）。 */
  let activeVerification: VerificationView | undefined
  /** E③ read-only projection cache, bound to the active candidate and verification run. */
  let activeRuntimeIdentityPairing: RuntimeIdentityRunPairingView | undefined
  /** 第三批：当前跟踪候选的服务端工作流投影（生命周期/审批/应用/回滚全部来自真实响应）。 */
  let activeWorkflow: WorkflowView | undefined
  /** 第三批：生命周期操作在途（审批/应用/回滚请求进行中；模型携带以禁用按钮防重复提交）。 */
  let lifecycleBusy: 'approving' | 'applying' | 'rolling-back' | undefined
  /** 联合验收批次：验证合同草案（页面标记初始建议来自分析；交互只能用户显式声明）。 */
  let draftContract: VerificationContractXp | undefined
  /** 本地交互状态（草稿/范围意向只属于体验层，绝不写服务端）。 */
  const ui: {
    selectedElementId?: string
    draftAfterText: string
    currentPageRef: string
    activeViewportId: string
    scopes: Record<string, PageScopeChoiceXp>
  } = { draftAfterText: '', currentPageRef: '', activeViewportId: 'desktop', scopes: {} }
  /** C+D 预留挂点数据。 */
  let sourceRelations: RealSourceRelations | undefined
  const runtimeIdentities = new Map<string, RealRuntimeIdentityObservation>()

  async function prepareRuntimeIdentityPairing(
    verification: VerificationView | undefined,
    capturedGeneration: number,
    capturedCandidateId: string | undefined,
  ): Promise<void> {
    if (!verification) {
      if (capturedGeneration === generation && capturedCandidateId === activeCandidate?.candidateId) activeRuntimeIdentityPairing = undefined
      return
    }
    const verificationRunId = verification.runId
    const pairing = await pairRuntimeIdentityRun({
      id: verificationRunId as string,
      checks: verification.checks ?? [],
      runtimeIdentities: verification.runtimeIdentities ?? [],
    })
    // Hash verification is asynchronous. Revalidate every owner identity before
    // publishing so an old run cannot replace the current project's/candidate's view.
    if (capturedGeneration !== generation || capturedCandidateId !== activeCandidate?.candidateId ||
        verificationRunId !== activeVerification?.runId || verification !== activeVerification) return
    activeRuntimeIdentityPairing = pairing
  }

  function stale(gen: number): void {
    if (gen !== generation) throw new StaleResponseError()
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchImpl(`${apiBase}/__ripple/api/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`)
    return payload
  }

  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(`${apiBase}/__ripple/api/${path}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`)
    return payload
  }

  /**
   * A 核心的项目预览锁是瞬时互斥。跨页 reload 时旧页面 dispose 的 preview/stop
   * 与新页面 load 的 analyze / preview/start 可能在服务端锁上短暂相撞，撞出的
   * 「正在执行」错误是瞬时的（stop 完成即释放），不代表工程状态异常。
   * 对此类错误做有限退避重试：期间遵守 generation 过期语义，持续失败仍如实抛出
   * （fail-closed，绝不把持续锁冲突伪装成成功，也不放宽任何 A 核心门控）。
   */
  async function postWithBusyRetry<T>(gen: number, path: string, body: unknown, attempts = 5, delayMs = busyRetryDelayMs): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      stale(gen)
      try {
        return await post<T>(path, body)
      } catch (error) {
        if (error instanceof StaleResponseError) throw error
        const message = error instanceof Error ? error.message : ''
        if (attempt >= attempts - 1 || !message.includes('正在执行')) throw error
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  function resetForProject(): void {
    analysis = undefined
    history = []
    previewSession = undefined
    previewFailedReason = ''
    activeCandidate = undefined
    candidatePreviewUrl = undefined
    candidatePreviewLoading = false
    verificationRunning = false
    activeVerification = undefined
    activeRuntimeIdentityPairing = undefined
    activeWorkflow = undefined
    lifecycleBusy = undefined
    draftContract = undefined
    ui.selectedElementId = undefined
    ui.draftAfterText = ''
    ui.currentPageRef = ''
    ui.activeViewportId = 'desktop'
    ui.scopes = {}
    // C/D 挂点数据属于具体工程：切换工程时一并清除，避免跨工程残留
    sourceRelations = undefined
    runtimeIdentities.clear()
    activeRuntimeIdentityPairing = undefined
  }

  /**
   * 清理失败但服务端仍可能持有的预演会话：保留完整会话身份（projectId+previewId），
   * 在下次切换/刷新/关闭时由 retryPendingCleanup() 可验证地重试停止，绝不丢弃引用。
   */
  const pendingCleanup: PreviewSession[] = []
  /**
   * 每个待清理会话各自的失败诊断（按 previewId 记录）。
   * 关键语义：某会话清理成功只删除它自己的诊断——绝不误清空其他仍失败会话的风险提示；
   * 全部成功（Map 为空）时 Evidence 风险项才消失。
   */
  const cleanupFailures = new Map<string, string>()

  /**
   * 停止一个预演会话：与 A 服务端合同兼容的尽力清理。
   * 成功：从待清理列表移除并删除该会话的诊断；失败：保留会话身份并入列待重试，
   * 同时按身份记录诊断。不阻断主流程，也绝不静默伪装成清理成功。
   */
  async function stopPreview(session: PreviewSession): Promise<void> {
    try {
      await post('project/preview/stop', { projectId: session.projectId, previewId: session.previewId })
      const index = pendingCleanup.findIndex(item => item.previewId === session.previewId)
      if (index >= 0) pendingCleanup.splice(index, 1)
      cleanupFailures.delete(session.previewId)
    } catch (error) {
      if (!pendingCleanup.some(item => item.previewId === session.previewId)) pendingCleanup.push(session)
      cleanupFailures.set(session.previewId, `预演会话 ${session.previewId} 停止失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /** 尽力重试全部待清理会话：按身份逐个停止，成功者移除，失败者保留身份与诊断等待下一轮。 */
  async function retryPendingCleanup(): Promise<void> {
    for (const session of [...pendingCleanup]) await stopPreview(session)
  }

  /**
   * 从分析结果提出验证合同初始建议：
   * - 页面 = 工程全部路由（A 运行器要求合同页面与路由集合一致才能 PASS）；
   * - 每页标记 = 该页 source-proven 文本目标：优先选不被其他路由共享的值，其次较短者
   *  （运行时在页面内唯一命中的概率最高）；任一页面提不出可信标记则不提交合同
   *  （scope-propagation / interaction 断言如实保持 unknown，fail-closed）；
   * - 交互绝不自动臆造，只能由用户在界面显式声明。
   */
  function proposeContract(): VerificationContractXp | undefined {
    if (!analysis || analysis.routes.length === 0) return undefined
    const pages: VerificationContractPageXp[] = []
    for (const route of analysis.routes) {
      // A 核心 safePath 合同：合同页面路径必须是同源绝对路径（'/' 开头）。
      // 路由路径不满足时整个合同不提交——运行器要求合同页面与全部路由一致，
      // 部分页面无法声明路径的项目如实保持无合同（相关断言 unknown，fail-closed）。
      const path = route.page ?? route.label
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return undefined
      const values = analysis.targets
        .filter(target => target.kind === 'data'
          && typeof target.value === 'string'
          && target.value.trim().length > 0 && target.value.trim().length <= 300
          && target.impact.certainty === 'source-proven'
          && target.impact.pageRefs.includes(route.id))
        .map(target => target.value!.trim())
      if (values.length === 0) return undefined
      const sharedWithOtherRoutes = (value: string) => analysis!.targets.some(target =>
        typeof target.value === 'string' && target.value.trim() === value
        && target.impact.pageRefs.some(ref => ref !== route.id))
      const markerText = [...new Set(values)]
        .sort((a, b) => Number(sharedWithOtherRoutes(a)) - Number(sharedWithOtherRoutes(b)) || a.length - b.length)[0]
      pages.push({ pageRef: route.id, path, markerText })
    }
    return { pages, interactions: [] }
  }

  /**
   * 从历史记录重建 workflow 投影。A 的 history 携带 approval/applied/rollback
   * 全部痕迹（回滚后 applied 记录仍保留），终态推导必须三者齐备；
   * rollbackAvailable 仅服务端实时 workflow 响应给出——applied 终态保留
   * 上一次已知的服务端结论，其余生命周期一律视为不可回滚。
   */
  function workflowFromHistory(item: HistoryItem, previous: WorkflowView | undefined): WorkflowView {
    return {
      lifecycle: item.lifecycle,
      approval: item.approval,
      applied: item.applied,
      rollback: item.rollback,
      rollbackAvailable: item.lifecycle === 'applied' ? previous?.rollbackAvailable : false,
    }
  }

  /**
   * 历史回读 + 候选 reconcile（A 语义：重新分析使活跃候选退役 fail-closed；
   * applied/rolled-back 终态保留跟踪供终态展示与回滚入口；绝不展示幽灵候选）。
   * 历史记录是持久化权威且携带 approval/applied/rollback 全部痕迹——
   * workflow 投影必须由历史整体重建，漏掉 applied/rollback 会让终态推导
   * 退化为 approval 优先（回滚后误显示"已审批"）。
   */
  async function refreshHistoryAndReconcile(gen: number, projectId: string): Promise<void> {
    const historyPayload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
    stale(gen)
    history = (historyPayload.history ?? []).filter(item => item.projectId === projectId)
    if (activeCandidate) {
      const tracked = history.find(item => item.candidateId === activeCandidate!.candidateId)
      if (!tracked || tracked.lifecycle === 'stale' || tracked.lifecycle === 'discarded') {
        activeCandidate = undefined
        activeWorkflow = undefined
        activeVerification = undefined
        activeRuntimeIdentityPairing = undefined
        candidatePreviewUrl = undefined
        candidatePreviewLoading = false
      } else {
        // 历史回读是持久化权威：验证投影随历史刷新（切换候选后旧验证不残留）；
        // workflow 投影同样以历史为准重建（含 applied/rollback 痕迹）
        activeVerification = tracked.verification
        activeWorkflow = workflowFromHistory(tracked, activeWorkflow)
        if (tracked.lifecycle !== 'active') {
          candidatePreviewUrl = undefined
          candidatePreviewLoading = false
        }
      }
    }
    // 无本地跟踪时跟踪历史最新候选（含审批后/应用后的终态），保证刷新/重开页面后
    // 审批、应用、回滚状态可继续操作；stale/discarded 一律不复活。
    if (!activeCandidate && history.length > 0) {
      const latest = history[0]
      if (latest.lifecycle === 'active' || latest.lifecycle === 'applied' || latest.lifecycle === 'rolled-back') {
        activeCandidate = { candidateId: latest.candidateId, patchHash: latest.patchHash }
        activeVerification = latest.verification
        activeWorkflow = workflowFromHistory(latest, undefined)
      }
    }
    await prepareRuntimeIdentityPairing(activeVerification, gen, activeCandidate?.candidateId)
  }

  /** 尽力启动项目源码预演：失败如实记录原因（如应用后工作树未提交，A 核心 fail-closed 拒绝）。 */
  async function startPreviewBestEffort(gen: number, projectId: string): Promise<void> {
    previewSession = undefined
    previewFailedReason = ''
    try {
      // 重试仅覆盖 reload 时与旧页 dispose 相撞的瞬时锁冲突；持续失败仍走下方降级
      const session = await postWithBusyRetry<PreviewSession>(gen, 'project/preview', { projectId })
      if (gen !== generation) {
        // 请求期间已切换/失效：立即回收刚创建的会话，再按过期处理
        await stopPreview(session)
        stale(gen)
      }
      previewSession = session
    } catch (error) {
      if (error instanceof StaleResponseError) throw error
      previewFailedReason = error instanceof Error ? error.message : '项目预演启动失败'
    }
    stale(gen)
  }

  /**
   * A page reload must be able to read an active candidate's persisted run.
   * The ordinary analyze endpoint intentionally retires active candidates as a
   * new source revision boundary. When history already contains a candidate,
   * restore it first so a read-only reload does not destroy the candidate it is
   * trying to display. A candidate from another project is ignored and the
   * normal analyze path remains authoritative for that project.
   */
  async function restoreActiveCandidateForProject(gen: number, requestedRoot: string): Promise<AnalysisResponse | undefined> {
    if (!restorePersistedCandidate) return undefined
    const payload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
    // Only a formally verified history entry can carry the E③ runtime
    // identity projection that must survive a reload. Unverified draft
    // candidates continue through the existing analyze path.
    const candidatesToTry = (payload.history ?? []).filter(item => item.lifecycle === 'active' &&
      Array.isArray(item.verification?.runtimeIdentities) && item.verification.runtimeIdentities.length > 0)
    for (const item of candidatesToTry) {
      stale(gen)
      try {
        const restored = await post<CandidateRestoreResponse>('candidate/restore', { candidateId: item.candidateId })
        stale(gen)
        const normalizeRoot = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '')
        if (normalizeRoot(restored.analysis.projectRoot) !== normalizeRoot(requestedRoot)) continue
        activeCandidate = { candidateId: restored.candidate.id, patchHash: restored.candidate.patchHash }
        activeVerification = restored.verification
        activeWorkflow = restored.workflow
        return restored.analysis
      } catch {
        // A stale or malformed candidate is not a reason to block opening the
        // project. The normal analyze path will report the current project
        // state and the history endpoint will retain the audit record.
      }
    }
    return undefined
  }

  /** 加载真实工程状态：analyze → history → 尽力启动源码预演。 */
  async function loadProjectState(gen: number): Promise<void> {
    if (!projectRoot?.trim()) return
    const restored = restorePersistedCandidate
      ? await restoreActiveCandidateForProject(gen, projectRoot)
      : undefined
    if (restored) {
      analysis = restored
      if (!draftContract) draftContract = proposeContract()
      await refreshHistoryAndReconcile(gen, restored.revision.projectId)
      await startPreviewBestEffort(gen, restored.revision.projectId)
      return
    }
    // reload 时旧页 dispose 的 preview/stop 可能仍持有服务端预览锁，
    // analyze 内部按项目收锁，撞锁是瞬时错误——有限重试后仍失败才如实抛出
    const analyzed = await postWithBusyRetry<AnalysisResponse>(gen, 'analyze', { projectRoot })
    stale(gen)
    analysis = analyzed
    // 刷新（同一工程）保留用户已编辑的合同草案；只有工程切换/首次加载才提出初始建议
    if (!draftContract) draftContract = proposeContract()
    await refreshHistoryAndReconcile(gen, analyzed.revision.projectId)
    await startPreviewBestEffort(gen, analyzed.revision.projectId)
  }

  /**
   * 应用/回滚成功后的状态刷新：直接采用服务端响应内嵌的重新分析结果
   * （A 在 apply/rollback 成功后已重分析并随响应返回），不再请求 analyze——
   * 应用后工作树带未提交的应用字节，A 核心的 analyze 以 requireClean 拒绝（fail-closed），
   * 重复 analyze 会让已成功写盘的应用被误报为失败。历史与预演照常回读。
   */
  async function refreshAfterLifecycleWrite(gen: number, nextAnalysis: AnalysisResponse | undefined): Promise<void> {
    // A 正式合同保证 apply/rollback 响应携带重新分析结果；防御缺省时不替换分析
    if (nextAnalysis?.revision?.projectId) analysis = nextAnalysis
    if (!draftContract) draftContract = proposeContract()
    await refreshHistoryAndReconcile(gen, analysis?.revision.projectId ?? '')
    await startPreviewBestEffort(gen, analysis?.revision.projectId ?? '')
  }


  function elements(): CanvasElementXp[] {
    return (analysis?.targets ?? []).map(target => {
      const identity = runtimeIdentities.get(target.id)
      return {
        id: target.id,
        label: target.label,
        // 真实模式画布不渲染演示 DOM，demoSelector 仅占位（不会被消费）。
        demoSelector: `real:${target.id}`,
        currentText: target.value ?? '',
        sourceRef: target.id,
        sourcePath: target.location?.path,
        certainty: target.impact.certainty,
        impactPageRefs: target.impact.pageRefs,
        unresolvedReasons: target.impact.unresolved,
        // 只有来源完全证明的元素才允许进入本地编辑意向；unknown/partial 只能查看。
        editable: target.impact.certainty === 'source-proven' && target.impact.unresolved.length === 0,
        runtimeIdentity: identity ? toRuntimeIdentityXp(identity) : undefined,
      }
    })
  }

  /** D 点选观测 → 界面投影（仅显示；稳定实例身份不改变 editable 判定）。 */
  function toRuntimeIdentityXp(identity: RealRuntimeIdentityObservation): RuntimeIdentityXp {
    return {
      certainty: identity.identityCertainty,
      reasons: identity.reasons,
      runtimeInstanceId: identity.runtimeInstanceId,
      sameSourceCount: identity.sameSourceCount,
      sourceVersion: identity.sourceVersion,
      tagName: identity.tagName,
      runtimeText: identity.runtimeText,
    }
  }

  function pages(): PageXp[] {
    const base: PageXp[] = (analysis?.routes ?? []).map(route => ({
      id: route.id,
      label: route.label,
      path: route.page ?? `/${route.id.replace(/^page:/, '')}`,
      relation: 'unproven',
      relationCertainty: 'unknown',
      scope: 'undecided',
    }))
    const selected = elements().find(item => item.id === ui.selectedElementId)
    if (!selected) {
      // 未选中目标：保留用户已做的本地范围意向（仍是本地状态，不代表服务端事实）
      return base.map(page => ({ ...page, scope: ui.scopes[page.id] ?? page.scope }))
    }
    const target = (analysis?.targets ?? []).find(item => item.id === selected.id)
    const projected = projectPageRelations(base, selected, target ? provenSinglePageRef(target) : '', sourceRelations?.provenUnaffectedRefs)
    return projected.map(page => ({ ...page, scope: ui.scopes[page.id] ?? page.scope }))
  }

  function latestCandidate(): HistoryItem | undefined {
    return history[0]
  }

  /**
   * 候选状态映射（以 A local-project-api 的历史合同为准）：
   * lifecycle 终态（applied/rolled-back/stale/discarded）优先——历史记录上保留的
   * 旧审批不得把终态覆盖显示为"已审批"；仅 active 生命周期才用 approval/验证结果推导。
   */
  function candidateStatus(): ExperienceViewModel['candidateStatus'] {
    const latest = latestCandidate()
    // 本 session 刚创建、历史尚未回读时，如实反映"已有活跃候选"（服务端已持久化）
    if (!latest) return activeCandidate ? 'candidate' : 'none'
    // fail-safe 与 workflowFromHistory 一致：出现 rollback 痕迹时终态以回滚为准
    //（痕迹冲突时更接近工程原始状态），哪怕 lifecycle 字段声明为 applied
    if (latest.rollback) return 'rolled-back'
    switch (latest.lifecycle) {
      case 'applied': return 'applied'
      case 'rolled-back': return 'rolled-back'
      case 'stale': return 'stale'
      case 'discarded': return 'none'
      default:
        if (latest.approval) return 'approved'
        return latest.verification.state === 'passed' || latest.verification.state === 'risks' ? 'verified' : 'candidate'
    }
  }

  function evidenceItems(): EvidenceItemXp[] {
    const items: EvidenceItemXp[] = []
    const unresolved = analysis?.unresolved ?? []
    const relationText = analysis
      ? Object.entries(analysis.relationCounts).map(([kind, count]) => `${kind}×${count}`).join('，') || '无消费关系'
      : '无'
    items.push({
      id: 'ev:source-graph',
      title: '来源分析（真实）',
      // 尚未分析工程时不得标记 pass：没有来源证据就是未知
      state: !analysis ? 'unknown' : unresolved.length ? 'risk' : 'pass',
      sourceKind: 'source-graph',
      summary: analysis
        ? unresolved.length
          ? `来源图有 ${unresolved.length} 项未解析依赖；消费关系：${relationText}。`
          : `来源图完整；消费关系：${relationText}。`
        : '尚未分析工程，来源未知。',
      detail: unresolved.length ? unresolved.join('；') : undefined,
    })

    const latest = latestCandidate()
    if (!latest) {
      items.push({
        id: 'ev:verification',
        title: '浏览器验证（真实）',
        state: 'not-run',
        sourceKind: 'runtime-observation',
        summary: '当前工程没有已保存候选，浏览器验证尚未运行。',
      })
    } else {
      const verification = latest.verification
      const stateMap: Record<VerificationState, EvidenceStateXp> = {
        'not-run': 'not-run', passed: 'pass', risks: 'risk', incomplete: 'unknown', stale: 'stale', 'failed-to-run': 'failed-to-run',
      }
      const assertions = verification.assertions ?? []
      const failed = assertions.filter(item => item.result !== 'pass')
      const summary = verification.state === 'not-run' || verification.state === 'failed-to-run' || verification.state === 'stale'
        ? verification.reason ?? VERIFICATION_STATE_LABEL[verification.state]
        : failed.length
          ? `${failed.length}/${assertions.length} 项断言未通过：${failed[0].detail}`
          : `${assertions.length} 项断言全部通过。`
      items.push({
        id: 'ev:verification',
        title: '浏览器验证（真实）',
        state: stateMap[verification.state],
        sourceKind: 'runtime-observation',
        summary,
        detail: `候选 ${latest.candidateId} · 运行 ${verification.runId ?? '（无）'} · 补丁 ${verification.patchHash?.slice(0, 16) ?? '（无）'} · Scope v${verification.scopeVersion ?? '（无）'} · 状态 ${VERIFICATION_STATE_LABEL[verification.state]}`,
      })
      if (verification.browserErrorDetails && verification.browserErrorDetails.total > 0) {
        const details = verification.browserErrorDetails
        const categories = Object.entries(details.byCategory).map(([category, count]) => `${category}×${count}`).join('，')
        items.push({
          id: 'ev:browser-errors',
          title: '浏览器错误（真实）',
          state: 'risk',
          sourceKind: 'runtime-observation',
          summary: `浏览器错误 ${details.total} 条：${categories}${details.truncated ? `（仅保留前 ${details.samples.length} 条样例）` : ''}`,
          detail: details.samples.join('\n'),
        })
      }
    }

    const selected = elements().find(item => item.id === ui.selectedElementId)
    if (selected) {
      const identity = runtimeIdentities.get(selected.id)
      items.push({
        id: 'ev:intent',
        title: '修改意向（本地草稿）',
        state: selected.editable ? 'pass' : 'unknown',
        sourceKind: 'user-choice',
        summary: selected.editable
          ? activeCandidate
            ? `把「${selected.currentText}」改为「${ui.draftAfterText || '（尚未输入）'}」；已生成真实候选 ${activeCandidate.candidateId.slice(0, 18)}…（服务端持久化${activeVerification?.runId ? `，验证${VERIFICATION_STATE_LABEL[activeVerification.state]}` : ''}；审批在后续批次接入）。`
            : `把「${selected.currentText}」改为「${ui.draftAfterText || '（尚未输入）'}」（本地意向，尚未生成真实候选）。`
          : `「${selected.label}」来源未完全证明，只能查看，不能承诺修改范围。`,
        detail: identity
          ? `运行时身份（画布点选，D 桥）：${identity.identityCertainty} · ${identity.reasons.join('、') || '无降级原因'}。sourceRef 唯一不等于 React 实例唯一；该身份只用于显示与导航，不构成编辑授权。`
          : '运行时实例身份尚未通过画布点选采集；编辑资格只由来源证明（source-proven）决定。',
      })
    }

    if (cleanupFailures.size > 0) {
      // 清理失败如实呈现为风险：逐会话列出仍失败的诊断（其他会话成功不误清），
      // 绝不静默伪装成清理成功
      items.push({
        id: 'ev:cleanup',
        title: '预演会话清理（尽力清理）',
        state: 'risk',
        sourceKind: 'runtime-observation',
        summary: `${[...cleanupFailures.values()].join('；')}（已保留会话身份，将在下次切换/刷新/关闭时重试清理；当前待清理 ${pendingCleanup.length} 个会话）`,
      })
    }
    return items
  }

  function versions(): VersionItemXp[] {
    return history.map(item => ({
      id: item.candidateId,
      title: `候选 ${item.patchHash.slice(0, 8)}`,
      lifecycle: item.lifecycle === 'active' ? 'candidate' : item.lifecycle,
      updatedAt: formatTime(item.updatedAt),
      summary: `验证${VERIFICATION_STATE_LABEL[item.verification.state]}${item.approval ? ' · 已审批' : ''}`,
      // 历史 API 不提供候选所属页面，不臆造页面归属。
      pageRef: '',
      evidenceAvailable: item.verification.state === 'passed'
        || item.verification.state === 'risks'
        || (item.verification.evidence?.some(entry => entry.artifactUrl) ?? false),
    }))
  }

  function viewports(): ViewportXp[] {
    const covered = new Set((latestCandidate()?.verification.evidence ?? []).map(entry => entry.viewport.width))
    const hasRun = !!latestCandidate()?.verification.runId
    return VIEWPORTS.map(viewport => ({
      ...viewport,
      verificationStatus: covered.has(viewport.width) ? 'available' : hasRun || viewport.id === 'mobile-390' ? 'in-verification' : 'available',
    }))
  }

  function compare(): ExperienceViewModel['compare'] {
    const viewportWidth = VIEWPORTS.find(item => item.id === ui.activeViewportId)?.width ?? 1440
    const latest = latestCandidate()
    const shot = latest?.verification.evidence?.find(entry => entry.artifactUrl && entry.viewport.width === viewportWidth)
    return {
      baseline: {
        state: 'unavailable',
        note: '基线截图尚未通过当前 API 提供（不提供演示替代图）。',
      },
      candidate: shot
        ? { state: 'ready', imageUrl: `${apiBase}${shot.artifactUrl}`, note: `候选真实截图 · ${shot.viewport.width}×${shot.viewport.height}（浏览器验证产物）` }
        : {
            state: 'unavailable',
            note: latest ? `该视口暂无真实截图（验证${VERIFICATION_STATE_LABEL[latest.verification.state]}）。` : '验证尚未运行，没有真实截图。',
          },
      /**
       * 对照可比较性：基线截图 API 尚未提供，真实模式有候选时如实保持 'partial'。
       * 未来实现 'comparable' 时必须校验双方截图的候选身份（candidateId/patchHash）、
       * 视口与必要验证上下文一致——不得仅判断两张图片 URL 是否存在。
       */
      compareState: !latest ? 'none' : 'partial',
      focusArea: elements().find(item => item.id === ui.selectedElementId)?.label,
    }
  }

  /** 第二批：把服务端 VerificationRun 投影转成候选面板可渲染的验证快照（截图地址绝对化）。 */
  function candidateVerificationView(verification: VerificationView | undefined): import('./view-model').CandidateVerificationXp | undefined {
    if (!verification) return undefined
    return {
      state: verification.state,
      stateLabel: VERIFICATION_STATE_LABEL[verification.state],
      reason: verification.reason,
      runId: verification.runId,
      patchHash: verification.patchHash,
      scopeVersion: verification.scopeVersion,
      startedAt: verification.startedAt,
      completedAt: verification.completedAt,
      recordHash: verification.recordHash,
      assertions: verification.assertions ?? [],
      runtimeIdentities: verification.runtimeIdentities,
      runtimeIdentityPairing: activeRuntimeIdentityPairing?.verificationRunId === (verification.runId ?? null)
        ? activeRuntimeIdentityPairing
        : undefined,
      shots: (verification.evidence ?? []).map(entry => ({
        viewportWidth: entry.viewport.width,
        viewportHeight: entry.viewport.height,
        result: entry.result,
        runtimeState: entry.runtimeState,
        imageUrl: entry.artifactUrl ? `${apiBase}${entry.artifactUrl}` : undefined,
        reason: entry.reason,
      })),
      visualEvidences: (verification.visualEvidences ?? []).map(entry => ({
        checkId: entry.checkId,
        route: entry.route,
        result: entry.result,
        resultReason: entry.resultReason,
        // E 的只读 view 投影：视觉证据只描述自身，不承载正式身份配对结论。
        view: toVisualEvidenceViewXp(entry.view),
      })),
    }
  }

  /** E 的 View 只读复制视觉证据自身的已知字段。 */
  function toVisualEvidenceViewXp(view: unknown): import('./view-model').VisualEvidenceViewXp | undefined {
    if (!view || typeof view !== 'object') return undefined
    const raw = view as Record<string, unknown>
    const cross = raw.crossVersion && typeof raw.crossVersion === 'object'
      ? raw.crossVersion as Record<string, unknown>
      : undefined
    const crossScope = cross?.scope && typeof cross.scope === 'object'
      ? cross.scope as Record<string, unknown>
      : undefined
    const pairs = Array.isArray(cross?.pairs)
      ? (cross!.pairs as Array<Record<string, unknown>>).map(pair => ({
          proofLabel: typeof pair.proofLabel === 'string' ? pair.proofLabel : undefined,
          reasons: Array.isArray(pair.reasons) ? pair.reasons.filter((item): item is string => typeof item === 'string') : undefined,
        }))
      : undefined
    return {
      schema: typeof raw.schema === 'string' ? raw.schema : undefined,
      stateLabel: typeof raw.stateLabel === 'string' ? raw.stateLabel : undefined,
      summary: typeof raw.summary === 'string' ? raw.summary : undefined,
      comparable: typeof raw.comparable === 'boolean' ? raw.comparable : undefined,
      changedPixels: typeof raw.changedPixels === 'number' ? raw.changedPixels : null,
      regionCount: typeof raw.regionCount === 'number' ? raw.regionCount : undefined,
      identityStatus: typeof raw.identityStatus === 'string' ? raw.identityStatus : undefined,
      limitations: Array.isArray(raw.limitations)
        ? raw.limitations.filter((item): item is string => typeof item === 'string')
        : undefined,
      crossVersion: cross ? { scope: { strictInstanceProofAvailable: typeof crossScope?.strictInstanceProofAvailable === 'boolean' ? crossScope.strictInstanceProofAvailable : undefined }, pairs } : undefined,
    }
  }

  function buildModel(projectStatus: ExperienceViewModel['projectStatus'], blockedReasons: string[] = []): ExperienceViewModel {
    const targets = elements()
    const selected = targets.find(item => item.id === ui.selectedElementId)
    if (ui.selectedElementId && !selected) {
      // 工程刷新后目标已不存在：旧草稿与旧选择不得残留
      ui.selectedElementId = undefined
      ui.draftAfterText = ''
    }
    return {
      projectName: analysis ? pathBasename(analysis.projectRoot) : projectRoot?.trim() ? pathBasename(projectRoot) : '（未选择工程）',
      projectStatus,
      candidateStatus: candidateStatus(),
      dataProvenance: 'real',
      currentPageRef: ui.currentPageRef || analysis?.routes[0]?.id || '',
      draftAfterText: ui.draftAfterText,
      activeViewportId: ui.activeViewportId,
      canvasState: candidatePreviewUrl || previewSession ? 'ready' : 'unavailable',
      pickerAvailable: !!previewSession,
      activeCandidate: activeCandidate
        ? {
            ...activeCandidate,
            previewUrl: candidatePreviewUrl,
            previewLoading: candidatePreviewLoading,
            verificationRunning,
            verification: candidateVerificationView(activeVerification),
            // 第三批：生命周期投影全部来自服务端 workflow/历史，绝不本地生成。
            // A 的 workflow.lifecycle 是候选生命周期（active/applied/rolled-back），
            // 审批态在 workflow.approval。注意 session 在回滚后仍保留 applied 记录
            // （applied/rollback 都是历史痕迹），当前终态必须先看 rollback 再看 applied；
            // 历史痕迹整体缺失（旧版/部分响应）时以 lifecycle 终态字段兜底——
            // 持久化权威声明的终态绝不允许被残留审批记录降级显示。
            lifecycle: activeWorkflow?.rollback
              ? 'rolled-back'
              : activeWorkflow?.applied
                ? 'applied'
                : activeWorkflow?.lifecycle === 'rolled-back' || activeWorkflow?.lifecycle === 'applied'
                  ? activeWorkflow.lifecycle
                  : activeWorkflow?.approval
                    ? 'approved'
                    : activeWorkflow?.lifecycle ?? 'active',
            approval: activeWorkflow?.approval,
            appliedAt: activeWorkflow?.applied?.appliedAt,
            rollbackAvailable: activeWorkflow?.rollbackAvailable,
            lifecycleBusy,
          }
        : undefined,
      pages: pages(),
      elements: targets,
      selectedElementId: selected?.id,
      viewports: viewports(),
      evidence: evidenceItems(),
      versions: versions(),
      compare: compare(),
      preview: previewSession ? {
        url: previewSession.url,
        projectId: previewSession.projectId,
        previewId: previewSession.previewId,
        sourceDigest: previewSession.sourceDigest,
      } : undefined,
      projectIdentity: analysis ? {
        projectId: analysis.revision.projectId,
        sourceDigest: analysis.revision.sourceDigest,
        gitCommit: analysis.revision.gitCommit,
        graphId: analysis.graphId,
      } : undefined,
      blockedReasons,
      verificationContract: draftContract,
    }
  }

  /**
   * 异步动作直接外抛：StaleResponseError 表示"已有更新的请求接管"，调用方
   * （工作台）必须忽略它、不得提交任何 UI 状态更新——绝不返回一个
   * unavailable 模型去覆盖新请求的 ready 状态来掩盖竞态。
   */
  function run(action: () => Promise<ExperienceViewModel>): Promise<ExperienceViewModel> {
    return action()
  }

  return {
    provenance: 'real',

    async load() {
      const gen = ++generation
      return run(async () => {
        resetForProject()
        if (!projectRoot?.trim()) {
          return buildModel('unavailable', ['尚未选择工程：请输入本机 React/Vite 项目目录。'])
        }
        await loadProjectState(gen)
        stale(gen)
        return buildModel('ready', previewFailedReason ? [`真实预览不可用：${previewFailedReason}`] : [])
      })
    },

    async openProject(root: string) {
      const gen = ++generation
      return run(async () => {
        // 工程切换：旧候选、旧证据、旧预演会话全部失效；旧会话先尽力停止，避免服务端泄漏。
        // projectRoot 必须在任何 await 之前同步落定——停止请求挂起期间若有更新的
        // openProject 先完成，本续体随后不得把 projectRoot 改写回旧工程。
        const oldSession = previewSession
        resetForProject()
        projectRoot = root
        // 先重试历史失败会话，再停止当前会话——本轮刚失败的会话留待下一轮重试
        await retryPendingCleanup()
        if (oldSession) await stopPreview(oldSession)
        // 停止期间被更新的请求接管：立即按过期处理，不得继续 analyze
        stale(gen)
        await loadProjectState(gen)
        stale(gen)
        return buildModel('ready', previewFailedReason ? [`真实预览不可用：${previewFailedReason}`] : [])
      })
    },

    async refresh() {
      const gen = ++generation
      return run(async () => {
        if (!analysis) return buildModel('unavailable', ['尚未选择工程：请输入本机 React/Vite 项目目录。'])
        // 重拉前停止旧预演会话（refresh 会重建 preview 会话）
        const oldSession = previewSession
        previewSession = undefined
        // 候选预演地址同属本轮预演会话：刷新后不再假定其可用，由用户重新打开（A 会复用在跑会话）
        candidatePreviewUrl = undefined
        // 先重试历史失败会话，再停止当前会话——本轮刚失败的会话留待下一轮重试
        await retryPendingCleanup()
        if (oldSession) await stopPreview(oldSession)
        stale(gen)
        await loadProjectState(gen)
        stale(gen)
        return buildModel('ready', previewFailedReason ? [`真实预览不可用：${previewFailedReason}`] : [])
      })
    },

    async dispose() {
      generation += 1
      const session = previewSession
      previewSession = undefined
      if (session) {
        await stopPreview(session)
      }
      // 候选预演会话同属预演资源：关闭时一并尽力停止
      const candidateSession = activeCandidate
      candidatePreviewUrl = undefined
      if (candidateSession) {
        await post('candidate/preview/stop', { candidateId: candidateSession.candidateId }).catch(() => {
          // 尽力清理：与项目预演同策略，不阻断关闭
        })
      }
      // 关闭是最后一次清理机会：连同历史失败会话一并按身份重试
      await retryPendingCleanup()
    },

    /** C 来源关系数据挂点：真实数据到达前一律不传，缺页保持未证明。 */
    attachSourceRelations(relations: RealSourceRelations) {
      sourceRelations = relations
    },

    /** D 运行时身份点选挂点：identityCertainty 不达 stable-* 不得用于精准实例修改。 */
    attachRuntimeIdentity(observation: RealRuntimeIdentityObservation) {
      runtimeIdentities.set(observation.sourceRef, observation)
    },

    selectElement(current, elementId) {
      if (current.selectedElementId === elementId) return current
      // 不存在的目标 id 一律拒绝：无效选择不得进入模型（否则 buildModel 内部
      // 清除后又被 spread 覆盖，产生悬空 selectedElementId）
      if (!elements().some(item => item.id === elementId)) return current
      ui.selectedElementId = elementId
      // 草稿与范围意向都属于目标：切换目标即清空。旧 Scope 决定绝不用于
      // 来源关系不同的新目标——默认 Scope 完全由新目标的真实来源证明生成。
      ui.draftAfterText = ''
      ui.scopes = {}
      // 候选状态反映真实生命周期，不被本地选中动作改写
      return { ...buildModel(current.projectStatus, current.blockedReasons), selectedElementId: elementId, candidateStatus: current.candidateStatus }
    },

    setDraftText(current, text) {
      ui.draftAfterText = text
      return { ...buildModel(current.projectStatus, current.blockedReasons), candidateStatus: current.candidateStatus }
    },

    setPageScope(current, pageRef, scope) {
      ui.scopes[pageRef] = scope
      return { ...buildModel(current.projectStatus, current.blockedReasons), candidateStatus: current.candidateStatus }
    },

    setContractMarker(current, pageRef, markerText) {
      if (!draftContract) return current
      draftContract = {
        ...draftContract,
        pages: draftContract.pages.map(page => page.pageRef === pageRef ? { ...page, markerText } : page),
      }
      return { ...buildModel(current.projectStatus, current.blockedReasons), candidateStatus: current.candidateStatus }
    },

    setContractInteractions(current, interactions) {
      if (!draftContract) return current
      draftContract = { ...draftContract, interactions }
      return { ...buildModel(current.projectStatus, current.blockedReasons), candidateStatus: current.candidateStatus }
    },

    setViewport(current, viewportId) {
      const viewport = viewports().find(item => item.id === viewportId)
      ui.activeViewportId = viewportId
      const model = buildModel(current.projectStatus, current.blockedReasons)
      return { ...model, canvasState: viewport?.verificationStatus === 'unavailable' ? 'unavailable' : model.canvasState }
    },

    setPage(current, pageRef) {
      ui.currentPageRef = pageRef
      // 浏览页只影响画布展示，绝不参与页面关系投影
      return { ...buildModel(current.projectStatus, current.blockedReasons), candidateStatus: current.candidateStatus }
    },

    /**
     * 画布点选落位：信封已由工作台用 A 核心 isCurrentPickerEnvelope 校验；
     * 这里负责服务端授权路径——POST /project/source-selection，响应绑定当前
     * 预演会话才采信；显示身份用 assessPickerDisplayIdentity 评估（不构成授权）。
     */
    async applyPickedSource(current, picked, isCurrent) {
      return run(async () => {
        const gen = generation
        if (!analysis || !previewSession) throw new Error('画布点选需要先建立项目预演会话')
        const session = previewSession
        const response = await post<ProjectSourceSelectionResponse>('project/source-selection', {
          projectId: session.projectId,
          previewId: session.previewId,
          sourceDigest: session.sourceDigest,
          sourceRef: picked.sourceRef,
        })
        if (gen !== generation) throw new StaleResponseError()
        if (!isBoundProjectSelection(response, {
          projectId: session.projectId,
          previewId: session.previewId,
          sourceDigest: session.sourceDigest,
          sourceRef: picked.sourceRef,
        })) {
          throw new Error('点选响应与当前预演会话不一致，已丢弃（预览可能已被替换）')
        }
        // Workbench 会忽略已退出/替换的点选会话响应；在此之前必须先阻止
        // 迟到响应改写 adapter 私有状态，避免清空新草稿/Scope 却不更新展示模型。
        if (isCurrent && !isCurrent()) throw new StaleResponseError()
        const framePathname = safePathname(session.url)
        const verdict = assessDisplayIdentity(picked.envelope, {
          sourceRef: response.element.id,
          sourceVersion: response.sourceVersion ?? picked.envelope.sourceVersion,
          expectedPathname: framePathname,
        })
        // 显示身份登记（按 sourceRef 与可选中目标双键，均只用于显示）
        const observation: RealRuntimeIdentityObservation = {
          sourceRef: response.element.id,
          identityCertainty: verdict.certainty,
          reasons: verdict.reasons,
          sourceVersion: typeof picked.envelope.sourceVersion === 'string' ? picked.envelope.sourceVersion : undefined,
          pageContext: picked.envelope.pageContext,
          runtimeInstanceId: verdict.runtimeInstanceId,
          sameSourceCount: Number.isSafeInteger(picked.envelope.sameSourceCount) && Number(picked.envelope.sameSourceCount) > 0 ? Number(picked.envelope.sameSourceCount) : undefined,
          tagName: picked.envelope.tagName,
          runtimeText: picked.envelope.text,
        }
        runtimeIdentities.set(response.element.id, observation)
        // 选中点选元素的可编辑文本目标：必须存在于已分析目标中，否则拒绝——
        // 不因为用户在画布上点到了就臆造一个可编辑目标
        const editableNode = response.editableText.find(node => (analysis?.targets ?? []).some(target => target.id === node.id))
        if (!editableNode) {
          throw new Error('点选元素的文本来源不在已分析目标中，无法作为修改目标（可在源码工作台定位）')
        }
        runtimeIdentities.set(editableNode.id, observation)
        ui.selectedElementId = editableNode.id
        // 草稿与范围意向都属于目标：点选切换目标即清空
        ui.draftAfterText = ''
        ui.scopes = {}
        return { ...buildModel(current.projectStatus, current.blockedReasons), selectedElementId: editableNode.id }
      })
    },

    /**
     * 创建真实候选：operations 由当前选中目标 + 草稿派生（TEXT 单操作）；
     * Scope 决策由用户在本轮的页面范围选择显式构建。审批门（approvalGate）
     * 由调用方（ScopePanel/工作台）先行把关，这里再次校验绝不静默放行。
     * 服务端持久化成功后回读历史，版本胶片与候选状态以服务端为权威。
     */
    async createCandidate(current, input) {
      return run(async () => {
        const gen = generation
        const selected = elements().find(item => item.id === ui.selectedElementId)
        if (!analysis) throw new Error('尚未分析工程，不能创建候选')
        if (!selected) throw new Error('尚未选中要修改的真实目标')
        if (!selected.editable) throw new Error('选中目标来源未完全证明，不能创建真实候选')
        if (!ui.draftAfterText.trim()) throw new Error('修改内容为空')
        const pagesNow = pages()
        const summary = scopeSummary(pagesNow)
        if (summary.undecided > 0) throw new Error(`还有 ${summary.undecided} 个受影响页面未决定范围`)
        if (summary.unprovenIncluded > 0) throw new Error('修改范围包含来源未完全证明的页面，不能创建候选')
        if (summary.included === 0) throw new Error('没有任何页面被包含进修改范围')
        // A 核心 assertScope 合同（src/core/candidate.ts）：
        // 1. strategy 'shared' 不得携带 localPageRef（否则"共享来源 Scope 不能携带局部页面引用"）；
        // 2. includedRefs 必须包含 operation.targetRef（否则"Scope 不允许修改目标"）。
        // includedRefs = 当前编辑目标 + 用户本轮明确包含的页面引用（去重，绝不自动升级未证明页面）。
        const scope: ScopeDecision = {
          id: `scope-${crypto.randomUUID()}`,
          version: 1,
          strategy: 'shared',
          includedRefs: [...new Set([
            selected.id,
            ...pagesNow.filter(page => page.scope === 'include').map(page => page.id),
          ])],
          excludedRefs: pagesNow.filter(page => page.scope === 'exclude').map(page => page.id),
          protectedRefs: pagesNow.filter(page => page.scope === 'protect').map(page => page.id),
          decidedBy: 'local-user',
          decidedAt: new Date().toISOString(),
        }
        const operations: EditOperation[] = [{
          id: `operation-${crypto.randomUUID()}`,
          kind: 'TEXT',
          targetRef: selected.id,
          before: selected.currentText,
          after: ui.draftAfterText,
        }]
        let response: {
          sessionId: string
          candidate: { id: string; patchHash?: string }
          verification: VerificationView
          workflow: WorkflowView
        }
        try {
          response = await post('candidate', {
            projectId: analysis.revision.projectId,
            rawIntent: input.rawIntent,
            operations,
            scope,
            // 验证合同：创建候选时绑定（服务端按合同哈希校验执行记录）。
            // 页面标记来自分析建议（用户可改）；交互为用户显式声明。无合同不发送——
            // 服务端对缺页/缺交互如实给出 unknown 断言（fail-closed）。
            ...(draftContract && draftContract.pages.length > 0
              ? { verificationContract: { pages: draftContract.pages, interactions: draftContract.interactions } }
              : {}),
          })
        } catch (error) {
          // A 的 POST /candidate 在创建候选【之前】停止项目预演（local-project-api.ts）：
          // 候选被拒绝时服务端预演也已失效。本地绝不留存看似可用的旧会话状态，
          // 一律失效化并给出如实原因，由刷新/重新打开工程重建预演。
          const stoppedSession = previewSession
          previewSession = undefined
          if (stoppedSession) cleanupFailures.delete(stoppedSession.previewId)
          previewFailedReason = previewFailedReason || '候选处理已停止项目预演会话，请刷新工程重新建立预演。'
          throw error
        }
        if (gen !== generation) throw new StaleResponseError()
        activeCandidate = { candidateId: response.candidate.id, patchHash: response.candidate.patchHash }
        activeWorkflow = response.workflow
        // 新候选不得残留上一个候选的验证：验证严格绑定候选身份（candidateId/patchHash）
        activeVerification = undefined
        activeRuntimeIdentityPairing = undefined
        // 服务端在候选创建时停止项目预演会话：本地状态如实跟进，不保留失效会话
        const stoppedSession = previewSession
        previewSession = undefined
        if (stoppedSession) cleanupFailures.delete(stoppedSession.previewId)
        // 回读历史：版本胶片与候选状态以服务端持久化结果为权威
        const historyPayload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
        if (gen === generation) {
          history = (historyPayload.history ?? []).filter(item => item.projectId === analysis?.revision.projectId)
        }
        return buildModel(current.projectStatus, [
          ...current.blockedReasons ?? [],
          '候选创建后项目预演已由服务端停止；候选预演入口在下方提供。',
        ])
      })
    },

    async openCandidatePreview(current) {
      return run(async () => {
        const gen = generation
        if (!activeCandidate) throw new Error('当前没有活跃候选，无法打开候选预演')
        candidatePreviewLoading = true
        try {
          const response = await post<{ candidateId: string; url: string; verification: VerificationView }>('candidate/preview', { candidateId: activeCandidate.candidateId })
          if (gen !== generation) throw new StaleResponseError()
          if (response.candidateId !== activeCandidate.candidateId) throw new Error('候选预演响应与当前候选不一致，已丢弃')
          candidatePreviewUrl = response.url
          // 必须在 buildModel 前复位：finally 晚于模型构建执行，否则发出的模型
          // 携带过期的 previewLoading=true，预演开关按钮会永久禁用（CI 真实链路抓到）
          candidatePreviewLoading = false
          return buildModel(current.projectStatus, current.blockedReasons)
        } finally {
          candidatePreviewLoading = false
        }
      })
    },

    async closeCandidatePreview(current) {
      return run(async () => {
        const gen = generation
        if (!activeCandidate || !candidatePreviewUrl) return current
        await post('candidate/preview/stop', { candidateId: activeCandidate.candidateId }).catch(() => {
          // 尽力清理：失败不阻断界面，会话由服务端超时回收
        })
        if (gen !== generation) throw new StaleResponseError()
        candidatePreviewUrl = undefined
        return buildModel(current.projectStatus, current.blockedReasons)
      })
    },

    /**
     * 第二批：运行真实四视口验证（POST /candidate/verify）。
     * 只消费服务端 VerificationRun 投影（断言/证据截图/记录哈希/E 视觉证据），
     * 绝不自行生成 pass；响应候选身份不一致或代际过期一律丢弃；
     * 完成后回读历史，版本胶片/证据/视口覆盖以服务端持久化结果为权威。
     */
    async runVerification(current) {
      return run(async () => {
        const gen = generation
        if (!activeCandidate) throw new Error('当前没有活跃候选，无法运行验证')
        verificationRunning = true
        try {
          const response = await post<{ candidateId: string; previewUrl: string; verification: VerificationView; workflow?: WorkflowView }>(
            'candidate/verify', { candidateId: activeCandidate.candidateId },
          )
          if (gen !== generation) throw new StaleResponseError()
          if (response.candidateId !== activeCandidate.candidateId) throw new Error('验证响应与当前候选不一致，已丢弃')
          activeVerification = response.verification
          const verificationCandidateId = activeCandidate.candidateId
          await prepareRuntimeIdentityPairing(activeVerification, gen, verificationCandidateId)
          if (gen !== generation || activeCandidate?.candidateId !== verificationCandidateId ||
              activeVerification?.runId !== response.verification.runId) throw new StaleResponseError()
          if (response.workflow) activeWorkflow = response.workflow
          const historyPayload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
          if (gen === generation) {
            history = (historyPayload.history ?? []).filter(item => item.projectId === analysis?.revision.projectId)
          }
          // 必须在 buildModel 前复位（da94ab7 教训）：finally 晚于模型构建执行
          verificationRunning = false
          return buildModel(current.projectStatus, current.blockedReasons)
        } catch (error) {
          // 失败也必须如实刷新：服务端可能已把候选退役为 stale（如源码被改动），
          // 尽力回读历史，让 stale 生命周期在下一次模型重建时如实反映
          const historyPayload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
          if (gen === generation) {
            history = (historyPayload.history ?? []).filter(item => item.projectId === analysis?.revision.projectId)
          }
          throw error
        } finally {
          verificationRunning = false
        }
      })
    },

    /**
     * 第三批：审批（POST /candidate/approve）。
     * 审批严格绑定【最新 passed 验证的 runId】——recordHash 是执行记录哈希，不能代替
     * runId（A 核心以 runId 定位运行并校验可信浏览器执行）。门控：仅当 activeVerification
     * 为 passed 才发请求；服务端仍是最终权威（非活动候选/验证不 passed/runId 不匹配一律
     * 拒绝，错误如实透出）。
     */
    async approveCandidate(current) {
      return run(async () => {
        const gen = generation
        if (!activeCandidate) throw new Error('当前没有候选，无法审批')
        const latestRun = activeVerification
        if (!latestRun || latestRun.state !== 'passed' || !latestRun.runId) {
          throw new Error(`只有最新验证为「通过」的候选可以审批（当前：${latestRun ? VERIFICATION_STATE_LABEL[latestRun.state] : '尚未运行'}）`)
        }
        lifecycleBusy = 'approving'
        try {
          const response = await post<{ candidateId: string; workflow: WorkflowView }>('candidate/approve', {
            candidateId: activeCandidate.candidateId,
            runId: latestRun.runId,
          })
          if (gen !== generation) throw new StaleResponseError()
          if (response.candidateId !== activeCandidate.candidateId) throw new Error('审批响应与当前候选不一致，已丢弃')
          activeWorkflow = response.workflow
          const historyPayload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
          if (gen === generation) {
            history = (historyPayload.history ?? []).filter(item => item.projectId === analysis?.revision.projectId)
          }
          // 返回模型前清除在途标记：否则 UI 永久卡在"审批提交中"（busy 仅用于在途禁用）
          lifecycleBusy = undefined
          return buildModel(current.projectStatus, current.blockedReasons)
        } finally {
          lifecycleBusy = undefined
        }
      })
    },

    /**
     * 第三批：应用（POST /candidate/apply）。服务端校验：仅已审批且当前活动候选可应用
     * （源码变化/候选过期/脏工作树一律拒绝，错误如实透出，绝不本地生成 applied）。
     * 成功后服务端已把候选源码写入工程并重新分析：全量回读重建目标/页面/历史与预演，
     * 画布与版本历史必须反映应用后的真实工程。
     */
    async applyCandidate(_current) {
      return run(async () => {
        const gen = generation
        if (!activeCandidate) throw new Error('当前没有候选，无法应用')
        lifecycleBusy = 'applying'
        try {
          const response = await post<{ candidateId: string; workflow: WorkflowView; analysis: AnalysisResponse }>('candidate/apply', { candidateId: activeCandidate.candidateId })
          if (gen !== generation) throw new StaleResponseError()
          if (response.candidateId !== activeCandidate.candidateId) throw new Error('应用响应与当前候选不一致，已丢弃')
          activeWorkflow = response.workflow
          candidatePreviewUrl = undefined
          candidatePreviewLoading = false
          // 应用后工作树带未提交的应用字节：采用服务端随响应返回的重新分析结果，
          // 绝不再请求 analyze（A 核心 requireClean 会拒绝，导致已成功写盘被误报失败）。
          await refreshAfterLifecycleWrite(gen, response.analysis)
          stale(gen)
          lifecycleBusy = undefined
          return buildModel('ready', previewFailedReason ? [`真实预览不可用：${previewFailedReason}`] : [])
        } finally {
          lifecycleBusy = undefined
        }
      })
    },

    /**
     * 第三批：回滚（POST /candidate/rollback）。仅服务端确认仍可回滚的已应用候选可回滚；
     * 成功后源码恢复，同样全量回读刷新真实工程状态与版本记录。
     */
    async rollbackCandidate(_current) {
      return run(async () => {
        const gen = generation
        if (!activeCandidate) throw new Error('当前没有候选，无法回滚')
        lifecycleBusy = 'rolling-back'
        try {
          const response = await post<{ candidateId: string; workflow: WorkflowView; analysis: AnalysisResponse }>('candidate/rollback', { candidateId: activeCandidate.candidateId })
          if (gen !== generation) throw new StaleResponseError()
          if (response.candidateId !== activeCandidate.candidateId) throw new Error('回滚响应与当前候选不一致，已丢弃')
          activeWorkflow = response.workflow
          candidatePreviewUrl = undefined
          candidatePreviewLoading = false
          await refreshAfterLifecycleWrite(gen, response.analysis)
          stale(gen)
          lifecycleBusy = undefined
          return buildModel('ready', previewFailedReason ? [`真实预览不可用：${previewFailedReason}`] : [])
        } finally {
          lifecycleBusy = undefined
        }
      })
    },
  } as ExperienceAdapter & {
    attachSourceRelations(relations: RealSourceRelations): void
    attachRuntimeIdentity(observation: RealRuntimeIdentityObservation): void
  }
}
