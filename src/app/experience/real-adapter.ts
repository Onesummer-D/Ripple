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
import { projectPageRelations } from './view-model'
import type {
  CanvasElementXp,
  EvidenceItemXp,
  EvidenceStateXp,
  ExperienceViewModel,
  PageScopeChoiceXp,
  PageXp,
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
  assertions?: Array<{ id: string; result: string; detail: string }>
  evidence?: Array<{
    id: string
    result: string
    viewport: { width: number; height: number }
    artifactUrl?: string
    reason?: string
  }>
  browserErrorDetails?: { total: number; byCategory: Record<string, number>; samples: string[]; truncated: boolean }
}
type StoredLifecycle = 'active' | 'discarded' | 'stale' | 'applied' | 'rolled-back'
interface HistoryItem {
  candidateId: string
  projectId: string
  lifecycle: StoredLifecycle
  patchHash: string
  updatedAt: string
  approval?: { verificationRunId: string; at: string }
  verification: VerificationView
}
interface PreviewSession { projectId: string; previewId: string; sourceDigest: string; url: string }

export interface RealAdapterOptions {
  /** 本机 React/Vite 工程目录；未提供时 load() 返回"未选择工程"的不可用模型。 */
  projectRoot?: string
  /** API 前缀（测试注入用；默认同源 /__ripple/api）。 */
  apiBase?: string
  fetchImpl?: typeof fetch
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
}

/* ---------- 内部工具 ---------- */

class StaleResponseError extends Error {}

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
  let projectRoot = options.projectRoot
  /** generation 守卫：每次 load/openProject/refresh/dispose 自增，过期响应一律丢弃。 */
  let generation = 0
  let analysis: AnalysisResponse | undefined
  let history: HistoryItem[] = []
  let previewSession: PreviewSession | undefined
  let previewFailedReason = ''
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

  function resetForProject(): void {
    analysis = undefined
    history = []
    previewSession = undefined
    previewFailedReason = ''
    ui.selectedElementId = undefined
    ui.draftAfterText = ''
    ui.currentPageRef = ''
    ui.activeViewportId = 'desktop'
    ui.scopes = {}
  }

  /** 加载真实工程状态：analyze → history → 尽力启动源码预演。 */
  async function loadProjectState(gen: number): Promise<void> {
    if (!projectRoot?.trim()) return
    const analyzed = await post<AnalysisResponse>('analyze', { projectRoot })
    stale(gen)
    analysis = analyzed
    const projectId = analyzed.revision.projectId
    const historyPayload = await get<{ history?: HistoryItem[] }>('history').catch(() => ({ history: [] as HistoryItem[] }))
    stale(gen)
    history = (historyPayload.history ?? []).filter(item => item.projectId === projectId)
    previewSession = undefined
    previewFailedReason = ''
    try {
      previewSession = await post<PreviewSession>('project/preview', { projectId })
    } catch (error) {
      previewFailedReason = error instanceof Error ? error.message : '项目预演启动失败'
    }
    stale(gen)
  }

  function elements(): CanvasElementXp[] {
    return (analysis?.targets ?? []).map(target => ({
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
    }))
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

  function candidateStatus(): ExperienceViewModel['candidateStatus'] {
    const latest = latestCandidate()
    if (!latest) return 'none'
    if (latest.approval) return 'approved'
    switch (latest.lifecycle) {
      case 'applied': return 'applied'
      case 'rolled-back': return 'rolled-back'
      case 'stale': return 'stale'
      case 'discarded': return 'none'
      default:
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
      state: unresolved.length ? 'risk' : 'pass',
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
          ? `把「${selected.currentText}」改为「${ui.draftAfterText || '（尚未输入）'}」（本地意向，真实候选生成尚未接入）。`
          : `「${selected.label}」来源未完全证明，只能查看，不能承诺修改范围。`,
        detail: identity
          ? `运行时身份（D 点选预留）：${identity.identityCertainty} · ${identity.reasons.join('、') || '无降级原因'}。sourceRef 唯一不等于 React 实例唯一。`
          : '运行时实例身份尚未通过点选采集（D 接口预留，接入前不臆造实例确定性）。',
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
      matchedViewport: !!shot,
      focusArea: elements().find(item => item.id === ui.selectedElementId)?.label,
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
      canvasState: previewSession ? 'ready' : 'unavailable',
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
    }
  }

  async function guarded(action: () => Promise<ExperienceViewModel>): Promise<ExperienceViewModel> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof StaleResponseError) return buildModel(analysis ? 'ready' : projectRoot?.trim() ? 'unavailable' : 'unavailable')
      throw error
    }
  }

  return {
    provenance: 'real',

    async load() {
      const gen = ++generation
      return guarded(async () => {
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
      return guarded(async () => {
        // 工程切换：旧候选、旧证据、旧预演会话全部失效（resetForProject 内清空）
        resetForProject()
        projectRoot = root
        await loadProjectState(gen)
        stale(gen)
        return buildModel('ready', previewFailedReason ? [`真实预览不可用：${previewFailedReason}`] : [])
      })
    },

    async refresh() {
      const gen = ++generation
      return guarded(async () => {
        if (!analysis) return buildModel(projectRoot?.trim() ? 'unavailable' : 'unavailable', ['尚未选择工程'])
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
        await post('project/preview/stop', { projectId: session.projectId, previewId: session.previewId }).catch(() => undefined)
      }
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
      ui.selectedElementId = elementId
      // 草稿属于目标：切换目标即清空，旧草稿绝不跨目标复用
      ui.draftAfterText = ''
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
  } as ExperienceAdapter & {
    attachSourceRelations(relations: RealSourceRelations): void
    attachRuntimeIdentity(observation: RealRuntimeIdentityObservation): void
  }
}
