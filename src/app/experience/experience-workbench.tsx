import { useEffect, useState } from 'react'
import type { ExperienceAdapter } from './adapter'
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

  useEffect(() => {
    let active = true
    activeAdapter.load()
      .then(loaded => { if (active) setModel(loaded) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '工作台加载失败') })
    return () => { active = false }
  }, [activeAdapter])

  if (error) return <div className="ripple-xp-scope ripple-xp-fatal" role="alert">{error}</div>
  if (!model) return <div className="ripple-xp-scope ripple-xp-loading" role="status">工作台加载中…</div>

  const apply = (next: ExperienceViewModel) => setModel(next)

  return <div className="ripple-xp-scope ripple-xp-workbench">
    <TopBar model={model} onOpenHistory={() => setPanel(panel === 'history' ? null : 'history')} />
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
          apply(activeAdapter.setPage(model, version.pageRef) ?? model)
        }}
        onClose={() => setPanel(null)}
      />
    )}
    <CompareStrip model={model} />
  </div>
}
