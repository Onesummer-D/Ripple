import { useEffect, useRef, useState } from 'react'
import type { ExperienceAdapter } from './adapter'
import { approvalFeedbackStale } from './view-model'
import type { ExperienceViewModel, PageScopeChoiceXp } from './view-model'
import { createDemoAdapter } from './demo-adapter'
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

  useEffect(() => {
    let active = true
    activeAdapter.load()
      .then(loaded => { if (active) setModel(loaded) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '工作台加载失败') })
    return () => { active = false }
  }, [activeAdapter, reloadToken])

  // 工作台卸载（含真实画布关闭）时释放适配器资源：停止项目预演、作废在途请求
  useEffect(() => () => { void activeAdapter.dispose?.() }, [activeAdapter])

  const retryLoad = () => {
    setError('')
    setModel(undefined)
    setReloadToken(token => token + 1)
  }

  const openProject = () => {
    if (!activeAdapter.openProject || !openProjectPath.trim()) return
    setOpenProjectBusy(true)
    setOpenProjectError('')
    activeAdapter.openProject(openProjectPath.trim())
      .then(loaded => setModel(loaded))
      .catch(cause => setOpenProjectError(cause instanceof Error ? cause.message : '打开工程失败'))
      .finally(() => setOpenProjectBusy(false))
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
      <PageRail pages={model.pages} currentPageRef={model.currentPageRef} onSelectPage={pageRef => apply(activeAdapter.setPage(model, pageRef) ?? model)} />
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
