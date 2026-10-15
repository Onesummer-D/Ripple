import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowRight, Check, ChevronLeft, CircleHelp, Layers3, RotateCcw, Sparkles, Waves } from 'lucide-react'
import { caseOrder } from '../cases/fixtures'
import { appAdapter } from '../adapters/appAdapter'
import { applyDraft, cancelDraft, chooseScope, createRuntime, resetRuntime, restorePrevious, restoreSnapshot, selectSlot, setCandidate, type CaseRuntime } from '../domain/state'
import type { CaseFixture, CaseId, Evidence, ScopeMode } from '../domain/contracts'
import { affectedInstanceIdsFor, candidatePreviewValues, impactProjection, projectValues, routePreviewProjection } from './selectors'
import { CandidateEditor, validCandidateValue } from './CandidateEditor'
import { ContentPreview } from './ContentPreview'
import { useMediaLibrary } from './useMediaLibrary'
import type { MediaResource } from '../adapters/mediaLibrary'
import { PagePreview } from './PagePreview'
import { EvidencePanel } from './EvidencePanel'
import { previewViewports, viewportForEvidence, type PreviewViewport } from '../preview/viewports'
import { RelationshipMap } from './RelationshipMap'
import { SourceExplanation } from './SourceExplanation'

type View = 'space' | 'case'

const labels: Record<CaseId, string> = {
  qingye: '文字 Source',
  qiguang: '图片 Source',
  'third-party': '色彩 Token',
}

const fixtures = Object.fromEntries(caseOrder.map((id) => [id, appAdapter.getCase(id)])) as Record<CaseId, CaseFixture>
const adapterDiagnostics = appAdapter.getDiagnostics()

function App() {
  const mediaLibrary = useMediaLibrary()
  const [view, setView] = useState<View>('space')
  const [activeCase, setActiveCase] = useState<CaseId>('qingye')
  const [runtimes, setRuntimes] = useState<Record<CaseId, CaseRuntime>>(() =>
    Object.fromEntries(caseOrder.map((id) => [id, createRuntime(fixtures[id])])) as Record<CaseId, CaseRuntime>,
  )
  const current = fixtures[activeCase]
  const runtime = runtimes[activeCase]
  const currentSource = appAdapter.getSource(activeCase)

  const openCase = (id: CaseId) => {
    setActiveCase(id)
    setView('case')
  }

  const resetCase = () => {
    setRuntimes((previous) => ({ ...previous, [activeCase]: resetRuntime(current) }))
  }

  const updateRuntime = (next: CaseRuntime) => {
    setRuntimes((previous) => ({ ...previous, [activeCase]: next }))
  }

  const currentValues = useMemo(() => projectValues(current, runtime.draftValues), [current, runtime.draftValues])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <div className="brand-orbit"><Waves size={18} /></div>
          <div><strong>Ripple</strong><span>涟漪工作台</span></div>
        </div>
        <nav className="side-nav" aria-label="主导航">
          <button type="button" className={view === 'space' ? 'nav-item active' : 'nav-item'} aria-current={view === 'space' ? 'page' : undefined} onClick={() => setView('space')} data-testid="nav-space">
            <Layers3 size={16} />作品空间
          </button>
          <button type="button" className={view === 'case' ? 'nav-item active' : 'nav-item'} aria-current={view === 'case' ? 'page' : undefined} onClick={() => setView('case')} data-testid="nav-case">
            <Sparkles size={16} />编辑演示
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="status-dot"><span />本地演示环境</div>
          <div className="sidebar-note">改动上线前<br /><b>先看见波及</b></div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><span className="eyebrow">RIPPLE / IMPACT-AWARE EDITING</span><h1>{view === 'space' ? '作品空间' : current.name}</h1></div>
          <div className="topbar-actions">
            {view === 'case' && <button type="button" className="ghost-button" onClick={() => setView('space')}><ChevronLeft size={16} />返回空间</button>}
            {view === 'case' && <button type="button" className="ghost-button" onClick={resetCase} data-testid="reset-case"><RotateCcw size={15} />重置案例</button>}
          </div>
        </header>
        {adapterDiagnostics.length > 0 && <div className="diagnostic-banner" role="status" aria-live="polite" data-testid="adapter-diagnostics"><CircleHelp size={15} /><div><strong>数据包需要复核</strong><span>{adapterDiagnostics.length} 条 adapter 诊断 · {adapterDiagnostics[0]?.path}</span></div></div>}
        {view === 'space' ? <SpaceView onOpen={openCase} /> : <CaseView key={activeCase} fixture={current} values={currentValues} runtime={runtime} source={currentSource} resources={mediaLibrary.resources} importImage={mediaLibrary.importImage} libraryError={mediaLibrary.error} onRuntimeChange={updateRuntime} onReset={resetCase} />}
      </main>
    </div>
  )
}

function SpaceView({ onOpen }: { onOpen: (id: CaseId) => void }) {
  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="kicker">影响感知式编辑 · FOUNDATION 01</span>
          <h2>每一次修改，<br /><em>先看见它会碰到哪里。</em></h2>
          <p>Ripple 把数字作品里的隐藏关联、真实预演和范围决策，变成一条可理解、可回退的编辑路径。</p>
          <div className="hero-meta"><span><span className="pulse" />3 个演示案例</span><span>375 / 768 / 1440</span><span>Fixture 驱动</span></div>
        </div>
        <div className="hero-ripple" aria-hidden="true"><div className="ripple-ring ring-one" /><div className="ripple-ring ring-two" /><div className="ripple-ring ring-three" /><div className="ripple-core"><Waves size={32} /></div></div>
      </section>
      <div className="section-heading"><div><span className="eyebrow">CASE LIBRARY</span><h2>选择一个作品，开始看见涟漪</h2></div><span className="muted">Phase 01 · 可重置 Fixture</span></div>
      <section className="case-grid">
        {caseOrder.map((id, index) => {
          const fixture = fixtures[id]
          return (
            <button type="button" className="case-card" key={id} aria-label={`打开案例：${fixture.name}`} onClick={() => onOpen(id)} data-testid={'case-card-' + id}>
              <div className="case-card-top"><span className="case-index">0{index + 1}</span><span className="case-kind" style={{ color: fixture.accent }}>{labels[id]}</span></div>
              <div className="case-visual" style={{ '--accent': fixture.accent } as CSSProperties}><div className="visual-grid" /><div className="visual-wave" /><span className="visual-label">{id === 'qingye' ? '青野秋日' : id === 'qiguang' ? '栖光 FEST' : 'OPEN SOURCE'}</span></div>
              <div className="case-copy"><h3>{fixture.name}</h3><p>{fixture.subtitle}</p><span className="case-enter">进入案例 <ArrowRight size={15} /></span></div>
            </button>
          )
        })}
      </section>
      <section className="principle-strip"><CircleHelp size={18} /><div><strong>同组件，不等于同来源。</strong><span>About 与 Archive 的独立 source 会在关系图中被明确排除。</span></div><span className="strip-tag">NEGATIVE CASE READY</span></section>
    </div>
  )
}

function CaseView({
  fixture,
  values,
  runtime,
  source,
  resources,
  importImage,
  libraryError,
  onRuntimeChange,
  onReset,
}: {
  fixture: CaseFixture
  values: CaseFixture['slots']
  runtime: CaseRuntime
  source: 'fixture' | 'real'
  resources: Record<string, MediaResource>
  importImage: (file: File) => Promise<MediaResource>
  libraryError?: string
  onRuntimeChange: (next: CaseRuntime) => void
  onReset: () => void
}) {
  const [candidateDraft, setCandidateDraft] = useState('')
  const [restoreNotice, setRestoreNotice] = useState<string>()
  const [previewRoute, setPreviewRoute] = useState(fixture.slots[0]?.route ?? '/')
  const [viewport, setViewport] = useState<PreviewViewport>(previewViewports[0])
  const [previewMode, setPreviewMode] = useState<'draft' | 'candidate'>('candidate')
  const [previewRevision, setPreviewRevision] = useState(0)
  const [liveEvidence, setLiveEvidence] = useState<Evidence>()
  const previewPanel = useRef<HTMLElement>(null)
  const sharedCount = fixture.slots.filter((item) => item.shared).length
  const selectedSlot = fixture.slots.find((item) => item.id === runtime.selectedSlotId)
  const selectedValue = values.find((item) => item.id === runtime.selectedSlotId)?.value ?? selectedSlot?.value ?? ''
  const { nodes: affectedNodes, edges: affectedEdges } = impactProjection(fixture, runtime.decision)
  const previewValues = useMemo(() => candidatePreviewValues(values, runtime.status === 'applied' ? undefined : runtime.candidate, runtime.decision), [values, runtime.status, runtime.candidate, runtime.decision])
  const routePreviews = routePreviewProjection(previewValues, runtime.decision)
  const displayedValues = previewMode === 'candidate' ? previewValues : values
  const effectivePreviewMode = runtime.candidate && runtime.status !== 'applied' ? previewMode : 'draft'
  const previewKey = useMemo(() => crypto.randomUUID(), [fixture.id, previewRoute, displayedValues, resources, viewport.width, viewport.height, effectivePreviewMode, previewRevision, runtime.candidate, runtime.decision, runtime.currentSnapshotId])
  const currentProof = liveEvidence?.context?.previewKey === previewKey ? liveEvidence : undefined
  const comparisonSlot = selectedSlot ?? fixture.slots[0]
  const beforeSlot = values.find((slot) => slot.id === comparisonSlot.id) ?? comparisonSlot
  const afterSlot = previewValues.find((slot) => slot.id === comparisonSlot.id) ?? comparisonSlot
  const focusEvidence = (item: Evidence) => {
    if (fixture.slots.some((slot) => slot.route === item.route)) setPreviewRoute(item.route)
    const targetViewport = viewportForEvidence(item.viewport)
    if (targetViewport) setViewport(targetViewport)
    requestAnimationFrame(() => previewPanel.current?.scrollIntoView?.({ block: 'start' }))
  }
  const changeCandidateDraft = (value: string) => {
    setCandidateDraft(value)
    if (runtime.selectedSlotId) onRuntimeChange(selectSlot(runtime, runtime.selectedSlotId))
  }

  useEffect(() => {
    if (runtime.snapshots.length === 0 && !runtime.selectedSlotId && !runtime.candidate) {
      setCandidateDraft('')
      setRestoreNotice(undefined)
    }
  }, [runtime.snapshots.length, runtime.selectedSlotId, runtime.candidate])

  const handleSelectSlot = (slotId: string) => {
    const next = selectSlot(runtime, slotId)
    onRuntimeChange(next)
    const slot = fixture.slots.find((item) => item.id === slotId)
    if (slot) setPreviewRoute(slot.route)
    setCandidateDraft(values.find((item) => item.id === slotId)?.value ?? slot?.value ?? '')
  }

  const handleCreateCandidate = () => {
    if (!selectedSlot || !validCandidateValue(selectedSlot.editKind, candidateDraft)) return
    const resource = candidateDraft.startsWith('media://') ? resources[candidateDraft.slice(8)] : undefined
    setPreviewMode('candidate')
    onRuntimeChange(setCandidate(runtime, {
      id: fixture.id + '-candidate-' + selectedSlot.id,
      caseId: fixture.id,
      instanceId: selectedSlot.instanceId,
      slotId: selectedSlot.id,
      sourceId: selectedSlot.sourceId,
      oldValue: selectedValue,
      newValue: candidateDraft.trim(),
      editKind: selectedSlot.editKind,
      ...(resource ? { mediaResource: { id: resource.id, name: resource.name, mimeType: resource.mimeType, bytes: resource.bytes, width: resource.width, height: resource.height } } : {}),
    }))
  }

  const handleChooseScope = (mode: ScopeMode) => {
    if (!runtime.candidate) return
    const affectedInstanceIds = affectedInstanceIdsFor(fixture, runtime.candidate, mode)
    onRuntimeChange(chooseScope(runtime, {
      id: fixture.id + '-scope-' + mode.toLowerCase(),
      caseId: fixture.id,
      mode,
      affectedInstanceIds,
      candidateEditId: runtime.candidate.id,
    }, mode))
  }

  const handleApply = () => onRuntimeChange(applyDraft(runtime, fixture, new Date().toISOString(), currentProof ? [currentProof] : []))
  const handleRestore = () => {
    setCandidateDraft('')
    setRestoreNotice('已恢复上一个快照')
    onRuntimeChange(restorePrevious(runtime, fixture))
  }
  const handleCancel = () => {
    setCandidateDraft('')
    onRuntimeChange(cancelDraft(runtime))
  }
  const handleRestoreSnapshot = (snapshotId: string) => {
    setCandidateDraft('')
    setRestoreNotice(`已恢复 ${snapshotId}`)
    onRuntimeChange(restoreSnapshot(runtime, fixture, snapshotId))
  }
  const handleReplay = () => {
    setCandidateDraft('')
    setRestoreNotice('已重置，可重新播放完整编辑流程')
    onRuntimeChange(resetRuntime(fixture))
  }

  return (
    <div className="workspace">
      <div className="workspace-banner" style={{ '--accent': fixture.accent } as CSSProperties}>
        <div><span className="eyebrow">CASE / {fixture.id.toUpperCase()}</span><h2>{fixture.subtitle}</h2><p>{fixture.description}</p></div>
        <div className="banner-status"><span className={source === 'real' ? 'status-pill real' : 'status-pill'}><span className="pulse" />{source === 'real' ? 'Real package loaded' : 'Fixture loaded'}</span><span>{fixture.fixtureIds.join(' · ')}</span></div>
      </div>
      <div className="workspace-grid">
        <section className="canvas-panel" ref={previewPanel}>
          <div className="panel-header"><div><span className="eyebrow">WORKSPACE CANVAS</span><h3>作品草稿画布 · {fixture.name}</h3></div><span className="viewport-chip">{viewport.label}</span></div>
          <div className="page-route-tabs" aria-label="预览页面">{routePreviews.map((item) => <button type="button" className="ghost-button" key={item.route} aria-pressed={previewRoute === item.route} onClick={() => setPreviewRoute(item.route)} data-testid={`preview-route-${item.route === '/' ? 'home' : item.route.slice(1)}`}>{item.route}</button>)}</div>
          <RelationshipMap fixture={fixture} sourceId={runtime.candidate?.sourceId ?? selectedSlot?.sourceId ?? fixture.slots[0]?.sourceId ?? ''} decision={runtime.decision} onFocusRoute={setPreviewRoute} />
          {runtime.candidate && runtime.status !== 'applied' && <SourceExplanation fixture={fixture} candidate={runtime.candidate} decision={runtime.decision} onScope={(mode) => { handleChooseScope(mode); setPreviewMode('candidate'); setPreviewRevision((revision) => revision + 1) }} />}
          <PagePreview caseId={fixture.id} route={previewRoute} values={displayedValues} resources={resources} viewport={viewport} onViewportChange={setViewport} mode={previewMode} onModeChange={setPreviewMode} hasCandidate={Boolean(runtime.candidate && runtime.status !== 'applied')} revision={previewRevision} onRepreview={() => { setPreviewMode('candidate'); setPreviewRevision((revision) => revision + 1) }} context={{ previewMode: effectivePreviewMode, previewKey, candidateEditId: runtime.candidate?.id, candidateValue: runtime.candidate?.newValue, scopeDecisionId: runtime.decision?.id, scopeMode: runtime.decision?.mode, snapshotId: runtime.currentSnapshotId }} onEvidence={setLiveEvidence} />
          {runtime.candidate && runtime.status !== 'applied' && <section className="comparison-grid" data-testid="candidate-comparison"><div><h4>当前草稿</h4><ContentPreview slot={beforeSlot} resources={resources} /></div><div><h4>候选预览</h4><ContentPreview slot={afterSlot} resources={resources} /></div></section>}
          {fixture.editKind === 'MEDIA' && <section className="media-layout-grid" data-testid="media-layout-grid">{previewValues.map((slot) => <article key={slot.id}><h4>{slot.label} · {slot.route}</h4><ContentPreview slot={slot} resources={resources} /></article>)}</section>}
          {fixture.editKind === 'TOKEN' && <section className="media-layout-grid" data-testid="token-consumers">{previewValues.map((slot) => <article key={slot.id}><h4>{slot.route}</h4><ContentPreview slot={slot} resources={resources} /></article>)}</section>}
          <div className="route-preview-heading"><div><span className="eyebrow">ROUTE CONSUMERS</span><strong>页面消费预览</strong></div><span>{routePreviews.length} ROUTES</span></div>
          <div className="route-preview-grid" data-testid="route-preview-grid">{routePreviews.map((preview) => <button type="button" key={preview.route} className={preview.affected ? 'route-preview-card affected' : 'route-preview-card'} aria-pressed={preview.slotIds.includes(runtime.selectedSlotId ?? '')} aria-label={`选择 ${preview.route} 页面`} onClick={() => handleSelectSlot(preview.slotIds[0])} data-testid={'route-preview-' + preview.route.replace(/[^a-z0-9]+/gi, '-')}><div className="route-preview-top"><code>{preview.route}</code><span className={preview.affected ? 'route-state affected' : 'route-state'}>{preview.affected ? '波及' : '保持'}</span></div><div className="route-preview-screen"><span className="route-preview-line" /><strong>{preview.value}</strong><small>{preview.instanceIds.length} 个实例 · {preview.shared ? '共享 Source' : '独立 Source'}</small></div><div className="route-preview-footer"><span>{preview.slotIds.length} 个 Slot</span><ArrowRight size={12} /></div></button>)}</div>
        </section>
        <aside className="inspector-panel">
          <div className="panel-header"><div><span className="eyebrow">SOURCE / SLOT</span><h3>{fixture.sourceLabel}</h3></div><span className="version-badge">{runtime.currentSnapshotId ? runtime.currentSnapshotId.split('-').at(-1) : 'v0'}</span></div>
          <div className="inspector-summary"><div className="summary-icon" style={{ color: fixture.accent }}><Waves size={18} /></div><div><strong>{sharedCount} 个关联实例</strong><span>{fixture.slots.length} 个可编辑位置 · {fixture.fixtureIds.length} 个 Fixture</span></div></div>
          <div className="slot-list">{values.map((item) => <button type="button" className={runtime.selectedSlotId === item.id ? 'slot-row selected' : 'slot-row'} aria-pressed={runtime.selectedSlotId === item.id} key={item.id} onClick={() => handleSelectSlot(item.id)} data-testid={'slot-' + item.id}><div className="slot-marker" style={{ background: item.shared ? fixture.accent : '#596273' }} /><div className="slot-info"><strong>{item.label}</strong><span>{item.route} · {item.shared ? '共享 Source' : '独立 Source'}</span></div><span className="slot-value">{item.value}</span></button>)}</div>
          <div className="editor-panel">
            <div className="flow-status"><span className="step-number">02</span><div><strong>{selectedSlot ? '编辑候选' : '先选中一个 Slot'}</strong><span>{selectedSlot ? `${selectedSlot.label} · ${selectedSlot.sourceId}` : '候选输入会保留原值，便于比较与回退。'}</span></div><span className="status-chip">{runtime.status}</span></div>
            <label className="field-label" htmlFor={fixture.editKind === 'MEDIA' ? 'media-upload' : 'candidate-input'}>候选值</label>
            <div className="candidate-form"><CandidateEditor key={`${selectedSlot?.id ?? 'none'}-${runtime.snapshots.length}-${runtime.currentSnapshotId ?? 'initial'}`} kind={fixture.editKind} value={candidateDraft} onChange={changeCandidateDraft} disabled={!selectedSlot} importImage={importImage} resources={resources} /><button type="button" className="primary-button" onClick={handleCreateCandidate} disabled={!selectedSlot || !validCandidateValue(fixture.editKind, candidateDraft)} data-testid="create-candidate"><Sparkles size={14} />生成候选</button></div>
            {libraryError && fixture.editKind === 'MEDIA' && <span role="alert" className="input-error">{libraryError}</span>}
            {runtime.candidate && <div className="candidate-summary"><span className="summary-label">CANDIDATE</span><strong>{runtime.candidate.oldValue} <ArrowRight size={13} /> {runtime.candidate.newValue}</strong><span>{runtime.candidate.editKind} · {runtime.candidate.sourceId}</span></div>}
            {runtime.candidate && <div className="scope-area"><div className="scope-heading"><div><span className="field-label">影响范围</span><span className="helper-text">同一个 Source 可以选择只改当前实例，或同步所有消费位置。</span></div><span className="step-number">03</span></div><div className="scope-grid"><button type="button" className={runtime.decision?.mode === 'INSTANCE' ? 'scope-card active' : 'scope-card'} aria-pressed={runtime.decision?.mode === 'INSTANCE'} onClick={() => handleChooseScope('INSTANCE')} data-testid="scope-instance"><strong>当前实例</strong><span>{runtime.candidate.instanceId}</span><em>1 个位置</em></button><button type="button" className={runtime.decision?.mode === 'SHARED' ? 'scope-card active' : 'scope-card'} aria-pressed={runtime.decision?.mode === 'SHARED'} onClick={() => handleChooseScope('SHARED')} data-testid="scope-shared"><strong>共享 Source</strong><span>{runtime.candidate.sourceId}</span><em>{fixture.slots.filter((item) => item.sourceId === runtime.candidate?.sourceId).length} 个位置</em></button></div></div>}
            {runtime.decision && <div className="preview-result"><div><span className="field-label">PREVIEW RESULT</span><strong>{runtime.decision.mode === 'SHARED' ? '共享涟漪已展开' : '局部涟漪已收束'}</strong><span>{runtime.decision.affectedInstanceIds.length} 个实例将应用候选，证据链已挂载。</span></div><Check size={16} /></div>}
            {runtime.decision && <div className="impact-panel" data-testid="impact-panel"><div className="impact-heading"><div><span className="field-label">IMPACT MAP</span><strong>可解释的波及节点</strong></div><span className="step-number">{affectedNodes.length} NODES</span></div><div className="impact-list">{affectedNodes.map((node) => <div className="impact-node" key={node.id}><span className="node-dot" style={{ background: fixture.accent }} /><div><strong>{node.label}</strong><span>{node.id} · {node.route} · {node.sourceId}</span></div><Check size={13} /></div>)}</div><div className="edge-list"><span className="field-label">GRAPH EDGES</span>{affectedEdges.map((edge) => <div className="edge-row" key={edge.id}><span>{edge.type}</span><code>{edge.from} → {edge.to}</code></div>)}</div></div>}
            <EvidencePanel evidence={fixture.evidence} onFocus={focusEvidence} />
            <div className="action-row"><button type="button" className="primary-button" onClick={handleApply} disabled={!runtime.decision || runtime.status === 'applied'} data-testid="apply-draft"><Check size={14} />应用草稿</button><button type="button" className="ghost-button" onClick={handleCancel} disabled={!runtime.candidate} data-testid="cancel-draft"><RotateCcw size={14} />取消候选</button><button type="button" className="ghost-button" onClick={handleRestore} data-testid="restore-previous"><RotateCcw size={14} />恢复上一个快照</button></div>
          </div>
          {runtime.snapshots.length > 0 && <div className="history-panel" data-testid="history-panel"><div className="history-heading"><div><span className="eyebrow">SNAPSHOT FILMSTRIP</span><h3>草稿版本</h3></div><div className="history-actions"><span className="version-badge">{runtime.currentSnapshotId ? runtime.currentSnapshotId.split('-').at(-1) : '初始'} / {runtime.snapshots.length}</span><button type="button" className="ghost-button replay-button" onClick={handleReplay} data-testid="replay-flow"><RotateCcw size={12} />重播流程</button></div></div>{restoreNotice && <div className="restore-notice" role="status"><Check size={13} />{restoreNotice}</div>}<div className="history-list">{runtime.snapshots.slice().reverse().map((snapshot) => <button type="button" className={runtime.currentSnapshotId === snapshot.id ? 'history-item current' : 'history-item'} aria-current={runtime.currentSnapshotId === snapshot.id ? 'step' : undefined} key={snapshot.id} onClick={() => handleRestoreSnapshot(snapshot.id)} data-testid={'restore-' + snapshot.id}><span className="history-version">{snapshot.id.split('-').at(-1)}</span><span><strong>{snapshot.decision.mode === 'SHARED' ? '共享 Source' : '当前实例'}{runtime.currentSnapshotId === snapshot.id ? ' · 当前' : ''}</strong><small>{snapshot.decision.affectedInstanceIds.length} 个实例 · {snapshot.verificationEvidenceIds.length} 条证据</small></span><ArrowRight size={13} /></button>)}</div></div>}
          {fixture.provenance && <div className="provenance-panel" data-testid="provenance-panel"><div><span className="eyebrow">REPOSITORY PROVENANCE</span><h3>第三方来源记录</h3></div><div className="provenance-grid"><span>Repository</span><strong>{fixture.provenance.repositoryUrl}</strong><span>Revision</span><strong>{fixture.provenance.commit ?? fixture.provenance.tag ?? 'unknown'}</strong><span>License</span><strong>{fixture.provenance.license ?? 'unknown'}</strong><span>NOTICE</span><strong>{fixture.provenance.noticePath ?? 'unknown'}</strong><span>Token source</span><strong>{fixture.provenance.tokenSource ?? 'unknown'}</strong><span>Consumers</span><strong>{fixture.provenance.consumerPaths.join(' · ') || 'unknown'}</strong></div></div>}
          {runtime.currentSnapshotId && (runtime.snapshots.find((item) => item.id === runtime.currentSnapshotId)?.previewEvidence?.length ?? 0) > 0 && <section className="snapshot-evidence" data-testid="snapshot-evidence"><h3>此版本保存的预览证据</h3><EvidencePanel evidence={runtime.snapshots.find((item) => item.id === runtime.currentSnapshotId)?.previewEvidence ?? []} onFocus={focusEvidence} /></section>}
          <div className="next-step"><div className="step-number">04</div><div><strong>下一步：接入真实预演证据</strong><span>当前使用 Fixture 关系图，后续由 B 的 adapter 替换为真实结构与浏览器结果。</span></div><Check size={16} /></div>
          <button type="button" className="reset-link" onClick={onReset} data-testid="reset-case-inline"><RotateCcw size={14} />重置此案例到 Fixture 初始状态</button>
        </aside>
      </div>
      <div className="handoff-note"><Sparkles size={15} /><span>A Foundation 已就绪：B 可通过 adapter 替换 Fixture，C 可使用稳定状态稿，D 可从 reset 入口开始验收。</span></div>
    </div>
  )
}

export default App
