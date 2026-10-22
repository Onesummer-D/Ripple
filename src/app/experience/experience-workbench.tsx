import { useEffect, useRef, useState } from 'react'
import type { ExperienceAdapter } from './adapter'
import { approvalFeedbackStale } from './view-model'
import type { ExperienceViewModel, PageScopeChoiceXp } from './view-model'
import { createDemoAdapter } from './demo-adapter'
import { StaleResponseError } from './real-adapter'
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

  // 点击涟漪：产品名 Ripple 的核心触感。任何点击在落点扩散一枚茶青圆环；
  // 动效纯视觉、挂载在 body，不干扰事件流；减少动态偏好时完全关闭。
  useEffect(() => {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const onClick = (event: MouseEvent) => {
      const drop = document.createElement('span')
      drop.className = 'ripple-xp-ripple'
      drop.style.left = `${event.clientX}px`
      drop.style.top = `${event.clientY}px`
      document.body.appendChild(drop)
      drop.addEventListener('animationend', () => drop.remove(), { once: true })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

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

  return <div className="ripple-xp-scope ripple-xp-workbench">
    <TopBar model={model} onOpenHistory={() => setPanel(panel === 'history' ? null : 'history')} />
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
      />
      <ScopePanel
        model={model}
        onDraftText={text => apply(activeAdapter.setDraftText(model, text) ?? model)}
        onPageScope={(pageRef, scope: PageScopeChoiceXp) => apply(activeAdapter.setPageScope(model, pageRef, scope) ?? model)}
        onDemoApprove={() => {
          // 演示审批只产生可见反馈，绝不进入真实 Approval/Apply。
          setFeedback('演示范围决策已确认，未执行真实应用')
        }}
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
