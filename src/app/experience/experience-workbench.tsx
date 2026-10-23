import { useEffect, useRef, useState } from 'react'
import type { ExperienceAdapter } from './adapter'
import { approvalFeedbackStale } from './view-model'
import type { ExperienceViewModel, PageScopeChoiceXp } from './view-model'
import { createDemoAdapter } from './demo-adapter'
import { StaleResponseError } from './real-adapter'
import { createSelectionNonce, type PickerEnvelope } from './real-selection'
import { TopBar } from './components/top-bar'
import { PageRail } from './components/page-rail'
import { CanvasStage } from './components/canvas-stage'
import { ScopePanel } from './components/scope-panel'
import { EvidenceDrawer } from './components/evidence-drawer'
import { CompareStrip } from './components/compare-strip'
import { VersionFilmstrip } from './components/version-filmstrip'

/**
 * F 体验工作台（画布优先布局）：
 * 顶栏（工程/候选状态/历史入口）+ 左页面导航 + 中央真实画布 + 右侧范围决策
 * + 底部证据与前后对照。演示数据全程标记，不与真实生命周期混用。
 */
export function ExperienceWorkbench({ adapter }: { adapter?: ExperienceAdapter }) {
  const [activeAdapter] = useState<ExperienceAdapter>(() => adapter ?? createDemoAdapter())
  const [model, setModel] = useState<ExperienceViewModel>()
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'evidence' | 'history' | null>('evidence')
  const [activeVersionId, setActiveVersionId] = useState<string>()
  const [feedback, setFeedback] = useState('')
  const [openProjectPath, setOpenProjectPath] = useState('')
  const [openProjectError, setOpenProjectError] = useState('')
  const [openProjectBusy, setOpenProjectBusy] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const modelRef = useRef<ExperienceViewModel | undefined>(undefined)
  const scopeRef = useRef<HTMLDivElement>(null)
  /** 画布点选令牌：空串 = 未激活；每次进入轮换一次性 nonce。 */
  const [pickerNonce, setPickerNonce] = useState('')
  /**
   * 当前点选会话的同步可读令牌（state 的镜像）。异步响应判定必须读这里：
   * 闭包里的 pickerNonce 只是调用时刻的快照，退出再进入后旧快照比较是恒假，
   * 无法识别"旧 nonce 的迟到响应"。ref 在退出/重进时同步改写，迟到响应
   * 一律与当前会话比对，不符即丢弃。
   */
  const pickerSessionRef = useRef('')
  const [pickerError, setPickerError] = useState('')
  const [candidateError, setCandidateError] = useState('')

  // 点击涟漪：产品名 Ripple 的核心触感。任何点击在落点扩散一枚茶青圆环。
  // 涟漪节点必须挂在 .ripple-xp-scope 作用域内（--xp-brand 只在该作用域定义）；
  // 动效纯视觉、不拦截事件；animationend 清理 + 超时兜底，绝不留残留节点；
  // 减少动态偏好时完全关闭。
  useEffect(() => {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const host = scopeRef.current
    if (!host) return
    const onClick = (event: MouseEvent) => {
      const drop = document.createElement('span')
      drop.className = 'ripple-xp-ripple'
      drop.style.left = `${event.clientX}px`
      drop.style.top = `${event.clientY}px`
      host.appendChild(drop)
      const remove = () => { drop.remove() }
      drop.addEventListener('animationend', remove, { once: true })
      // 兜底：动画事件未触发的极端环境下 1s 后强制清理
      window.setTimeout(remove, 1000)
    }
    host.addEventListener('click', onClick)
    return () => host.removeEventListener('click', onClick)
  }, [model !== undefined])

  // 滚动浮现：分区进入视口时上浮入场（reveal → in-view），减少动态偏好时由 CSS 直接可见
  useEffect(() => {
    const root = document.querySelector('.ripple-xp-workbench')
    if (!root) return
    if (typeof IntersectionObserver === 'undefined') {
      // 老环境降级：不做浮现动画，内容直接可见
      root.querySelectorAll('.reveal:not(.in-view)').forEach(element => element.classList.add('in-view'))
      return
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view')
          observer.unobserve(entry.target)
        }
      }
    }, { rootMargin: '0px 0px -8% 0px' })
    root.querySelectorAll('.reveal:not(.in-view)').forEach(element => {
      // 首屏内的分区同步入场（不等 IO 回调，避免首帧空白）；
      // 视口外的交给 IO 做滚动浮现
      if (element.getBoundingClientRect().top < window.innerHeight) {
        element.classList.add('in-view')
        return
      }
      if (!(element as HTMLElement).dataset.xpObserved) {
        (element as HTMLElement).dataset.xpObserved = '1'
        observer.observe(element)
      }
    })
    return () => observer.disconnect()
  })

  useEffect(() => {
    let active = true
    activeAdapter.load()
      .then(loaded => { if (active) setModel(loaded) })
      .catch(cause => {
        // 过期响应：已有更新的请求接管，绝不提交任何 UI 状态更新
        if (cause instanceof StaleResponseError) return
        if (active) setError(cause instanceof Error ? cause.message : '工作台加载失败')
      })
    return () => { active = false }
  }, [activeAdapter, reloadToken])

  // 工作台卸载（含真实画布关闭）时释放适配器资源：停止项目预演、作废在途请求
  useEffect(() => () => { void activeAdapter.dispose?.() }, [activeAdapter])

  const retryLoad = () => {
    setError('')
    setModel(undefined)
    setReloadToken(token => token + 1)
  }

  const openProjectSeq = useRef(0)

  const openProject = () => {
    if (!activeAdapter.openProject || !openProjectPath.trim()) return
    const seq = ++openProjectSeq.current
    setOpenProjectBusy(true)
    setOpenProjectError('')
    activeAdapter.openProject(openProjectPath.trim())
      .then(loaded => { if (openProjectSeq.current === seq) setModel(loaded) })
      .catch(cause => {
        // 过期响应：更新的请求已接管，不得覆盖其错误/状态提示
        if (cause instanceof StaleResponseError) return
        if (openProjectSeq.current === seq) setOpenProjectError(cause instanceof Error ? cause.message : '打开工程失败')
      })
      .finally(() => { if (openProjectSeq.current === seq) setOpenProjectBusy(false) })
  }

  // 点选会话随预演会话失效（候选创建/工程切换会停止预演）：自动退出，不残留激活态。
  // 注意：此 hook 必须位于所有提前 return 之前（Rules of Hooks），用 ref 读取当前模型。
  useEffect(() => {
    if (!pickerNonce) return
    const current = modelRef.current
    if (!current || current.dataProvenance === 'demo' || !current.preview) {
      pickerSessionRef.current = ''
      setPickerNonce('')
    }
  }, [pickerNonce, model])

  if (error) return (
    <div className="ripple-xp-scope ripple-xp-fatal" role="alert" data-testid="load-error">
      <p>{error}</p>
      <button type="button" className="ripple-xp-quiet" data-testid="load-retry" onClick={retryLoad}>重试</button>
    </div>
  )
  if (!model) return <div className="ripple-xp-scope ripple-xp-loading" role="status">工作台加载中…</div>

  modelRef.current = model

  /**
   * 状态变更统一入口：模型一旦推进，旧版演示审批反馈立即作废。
   * 目标切换、草稿修改、范围决策变化（approvalFeedbackStale 判定）都会清掉
   * "范围决策已确认"横幅——旧确认绝不跨修订复用，approvalGate 重新生效。
   */
  const apply = (next: ExperienceViewModel) => {
    if (modelRef.current && approvalFeedbackStale(modelRef.current, next)) setFeedback('')
    setModel(next)
  }

  const isReal = model.dataProvenance !== 'demo'
  const pickerActive = isReal && !!pickerNonce && !!model.preview

  const togglePicker = () => {
    setPickerError('')
    // 以 state 判定当前是否在点选会话中：候选创建成功等路径只清了 state，
    // 若读 ref 会把下一次点击误判为"退出"，导致点选永远进不去（6c 回归根因）。
    // ref 仍须在同一事件循环内同步改写：迟到响应立即失效，不等 state 刷新。
    const next = pickerNonce ? '' : createSelectionNonce()
    pickerSessionRef.current = next
    setPickerNonce(next)
  }

  /** 合法信封到达（D 桥已校验会话）：走 source-selection 服务端授权路径。 */
  const handlePicked = (envelope: PickerEnvelope) => {
    if (!activeAdapter.applyPickedSource || !modelRef.current) return
    // 捕获当前会话令牌；响应回来时与【同步 ref】比对——退出再进入后旧 nonce
    // 的响应必然不匹配，不得覆盖新会话的选择；工程切换/预演刷新的过期响应
    // 由 adapter 的 generation 守卫以 StaleResponseError 拒绝。
    const session = pickerSessionRef.current
    if (!session) return
    activeAdapter.applyPickedSource(modelRef.current, { sourceRef: envelope.sourceRef, envelope })
      .then(next => {
        if (pickerSessionRef.current !== session) return
        setPickerError('')
        apply(next)
      })
      .catch(cause => {
        if (cause instanceof StaleResponseError) return
        if (pickerSessionRef.current !== session) return
        setPickerError(cause instanceof Error ? cause.message : '点选落位失败')
      })
  }

  /** 生成真实候选：审批门未过按钮已禁用，这里再兜底捕获服务端拒绝原因。 */
  const handleCreateCandidate = () => {
    if (!activeAdapter.createCandidate || !modelRef.current) return
    const selected = modelRef.current.elements.find(item => item.id === modelRef.current?.selectedElementId)
    const draft = modelRef.current.draftAfterText.trim()
    const rawIntent = selected && draft ? `把「${selected.currentText}」改为「${draft}」` : '真实文本修改'
    setCandidateError('')
    activeAdapter.createCandidate(modelRef.current, { rawIntent })
      .then(next => { apply(next); pickerSessionRef.current = ''; setPickerNonce('') })
      .catch(cause => {
        if (cause instanceof StaleResponseError) return
        setCandidateError(cause instanceof Error ? cause.message : '创建真实候选失败')
      })
  }

  const handleToggleCandidatePreview = () => {
    if (!modelRef.current) return
    const opening = !modelRef.current.activeCandidate?.previewUrl
    const action = opening ? activeAdapter.openCandidatePreview : activeAdapter.closeCandidatePreview
    if (!action) return
    setCandidateError('')
    action.call(activeAdapter, modelRef.current)
      .then(next => apply(next))
      .catch(cause => {
        if (cause instanceof StaleResponseError) return
        setCandidateError(cause instanceof Error ? cause.message : '候选预演操作失败')
      })
  }

  // 第二批：四视口验证（POST /candidate/verify）。结果完全来自服务端 VerificationRun，
  // 失败（含浏览器验证启动失败）如实透出，绝不用演示默认值兜底。
  const handleRunVerification = () => {
    if (!modelRef.current || !activeAdapter.runVerification) return
    setCandidateError('')
    activeAdapter.runVerification(modelRef.current)
      .then(next => apply(next))
      .catch(cause => {
        if (cause instanceof StaleResponseError) return
        setCandidateError(cause instanceof Error ? cause.message : '四视口验证运行失败')
      })
  }

  // 真实模式刷新：重建预演会话（候选创建后服务端会停止项目预演）并回读服务端状态
  const handleRefresh = () => {
    if (!modelRef.current || !activeAdapter.refresh) return
    setCandidateError('')
    activeAdapter.refresh(modelRef.current)
      .then(next => apply(next))
      .catch(cause => {
        if (cause instanceof StaleResponseError) return
        setCandidateError(cause instanceof Error ? cause.message : '刷新工程状态失败')
      })
  }

  return <div ref={scopeRef} className="ripple-xp-scope ripple-xp-workbench">
    <TopBar model={model} onOpenHistory={() => setPanel(panel === 'history' ? null : 'history')} onRefresh={activeAdapter.refresh ? handleRefresh : undefined} />
    {model.dataProvenance === 'real' && model.projectStatus === 'unavailable' && activeAdapter.openProject && (
      // 真实模式：尚未打开工程时提供"打开工程"入口；失败原因如实显示
      <form
        className="ripple-xp-open-project"
        data-testid="open-project-form"
        onSubmit={event => { event.preventDefault(); openProject() }}
      >
        <label>
          打开真实工程（本机 React/Vite 项目目录）
          <input
            data-testid="open-project-path"
            value={openProjectPath}
            placeholder="例如 D:\work\my-react-app"
            onChange={event => setOpenProjectPath(event.target.value)}
          />
        </label>
        <button type="submit" className="ripple-xp-primary" data-testid="open-project-submit" disabled={openProjectBusy || !openProjectPath.trim()}>
          {openProjectBusy ? '分析中…' : '分析并打开'}
        </button>
        {openProjectError && <p className="ripple-xp-warn" role="alert" data-testid="open-project-error">{openProjectError}</p>}
        {(model.blockedReasons ?? []).map(reason => <p key={reason} className="ripple-xp-warn" data-testid="blocked-reason">{reason}</p>)}
      </form>
    )}
    <div className="ripple-xp-body">
      <PageRail
        pages={model.pages}
        currentPageRef={model.currentPageRef}
        onSelectPage={pageRef => apply(activeAdapter.setPage(model, pageRef) ?? model)}
        // 真实模式第一阶段：预演 iframe 不支持页面切换，导航停用并明确标注（不误导用户）
        navigationDisabled={model.dataProvenance === 'real'}
      />
      <CanvasStage
        model={model}
        onSelectElement={id => apply(activeAdapter.selectElement(model, id) ?? model)}
        onViewportChange={id => apply(activeAdapter.setViewport(model, id) ?? model)}
        pickerActive={pickerActive}
        pickerNonce={pickerNonce}
        pickerError={pickerError}
        onTogglePicker={togglePicker}
        onPicked={handlePicked}
      />
      <ScopePanel
        model={model}
        onDraftText={text => apply(activeAdapter.setDraftText(model, text) ?? model)}
        onPageScope={(pageRef, scope: PageScopeChoiceXp) => apply(activeAdapter.setPageScope(model, pageRef, scope) ?? model)}
        onDemoApprove={() => {
          // 演示审批只产生可见反馈，绝不进入真实 Approval/Apply。
          setFeedback('演示范围决策已确认，未执行真实应用')
        }}
        onCreateCandidate={activeAdapter.createCandidate ? handleCreateCandidate : undefined}
        onToggleCandidatePreview={activeAdapter.openCandidatePreview ? handleToggleCandidatePreview : undefined}
        onRunVerification={activeAdapter.runVerification ? handleRunVerification : undefined}
        candidateError={candidateError}
      />
    </div>
    {feedback && (
      <div className="ripple-xp-feedback" role="status" aria-live="polite" data-testid="approve-feedback">
        <span>{feedback}</span>
        <button type="button" className="ripple-xp-quiet" data-testid="dismiss-feedback" onClick={() => setFeedback('')}>知道了</button>
      </div>
    )}
    {panel === 'evidence' && <EvidenceDrawer items={model.evidence} onClose={() => setPanel(null)} />}
    {panel === 'history' && (
      <VersionFilmstrip
        model={model}
        activeVersionId={activeVersionId}
        onSelect={version => {
          setActiveVersionId(version.id)
          // 真实历史不提供页面归属（pageRef 为空）时不切换页面，不臆造定位
          if (version.pageRef) apply(activeAdapter.setPage(model, version.pageRef) ?? model)
        }}
        onClose={() => setPanel(null)}
      />
    )}
    <CompareStrip model={model} />
  </div>
}
