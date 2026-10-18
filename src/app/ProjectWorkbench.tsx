import { useEffect, useMemo, useState } from 'react'
import type { EditKind, EditOperation, ScopeDecision } from '../core/model'
import './project-workbench.css'

interface RouteSummary { id: string; label: string; page?: string }
interface ComponentSummary { id: string; label: string; pages: string[]; location?: { path: string; start?: number; end?: number } }
interface TargetSummary {
  id: string
  kind: 'data' | 'media' | 'token'
  label: string
  value?: string
  location?: { path: string; start?: number; end?: number }
  impact: { pageRefs: string[]; unresolved: string[]; certainty: 'source-proven' | 'partial' | 'unknown' }
}
interface Analysis {
  projectRoot: string
  revision: { projectId: string; sourceDigest: string; gitCommit?: string; runtimeFingerprint: string }
  graphId: string
  unresolved: string[]
  routes: RouteSummary[]
  components: ComponentSummary[]
  targets: TargetSummary[]
  relationCounts: Record<string, number>
}
interface CandidateView {
  id: string
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  operations: EditOperation[]
  modifiedPaths: string[]
  diff: string
}
type PageScope = 'include' | 'exclude' | 'protect' | ''
const operationKind = (kind: TargetSummary['kind']): EditKind => kind === 'data' ? 'TEXT' : kind === 'media' ? 'MEDIA' : 'TOKEN'
const candidateStorageKey = 'ripple.workbench.activeCandidate'

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/__ripple/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`)
  return payload
}

export default function ProjectWorkbench() {
  const [projectPath, setProjectPath] = useState('')
  const [intent, setIntent] = useState('')
  const [analysis, setAnalysis] = useState<Analysis>()
  const [targetId, setTargetId] = useState('')
  const [after, setAfter] = useState('')
  const [operations, setOperations] = useState<EditOperation[]>([])
  const [pageScope, setPageScope] = useState<Record<string, PageScope>>({})
  const [scopeStrategy, setScopeStrategy] = useState<'shared' | 'page-override'>('shared')
  const [localPageRef, setLocalPageRef] = useState('')
  const [candidate, setCandidate] = useState<CandidateView>()
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [previewBusy, setPreviewBusy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const candidateId = window.sessionStorage.getItem(candidateStorageKey)
    if (!candidateId) return
    let active = true
    setBusy(true)
    post<{ analysis: Analysis; rawIntent: string; scope?: ScopeDecision; candidate: CandidateView }>('candidate/restore', { candidateId })
      .then(restored => {
        if (!active) return
        setProjectPath(restored.analysis.projectRoot)
        setAnalysis(restored.analysis)
        setIntent(restored.rawIntent)
        setCandidate(restored.candidate)
        setOperations(restored.candidate.operations)
        setTargetId(restored.candidate.operations[0]?.targetRef ?? '')
        setAfter(restored.candidate.operations[0]?.after ?? '')
        setScopeStrategy(restored.scope?.strategy ?? 'shared')
        setLocalPageRef(restored.scope?.localPageRef ?? restored.analysis.routes[0]?.id ?? '')
        setPageScope(Object.fromEntries(restored.analysis.routes.map(route => {
          const scope = restored.scope
          const value: PageScope = scope?.protectedRefs.includes(route.id) ? 'protect' : scope?.excludedRefs.includes(route.id) ? 'exclude' : scope?.includedRefs.includes(route.id) ? 'include' : ''
          return [route.id, value]
        })))
      })
      .catch(cause => {
        if (!active) return
        window.sessionStorage.removeItem(candidateStorageKey)
        setError(cause instanceof Error ? `上次候选无法恢复：${cause.message}` : '上次候选已失效，请重新分析项目')
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])

  const target = analysis?.targets.find(item => item.id === targetId)
  const impactedPages = useMemo(() => [...new Set(operations.flatMap(operation => analysis?.targets.find(item => item.id === operation.targetRef)?.impact.pageRefs ?? []))].sort(), [analysis, operations])
  const scopesComplete = !!analysis && analysis.routes.every(route => !!pageScope[route.id])
  const includedRoutes = analysis?.routes.filter(route => pageScope[route.id] === 'include') ?? []
  const scopesValid = scopeStrategy === 'shared' || (includedRoutes.length === 1 && includedRoutes[0].id === localPageRef)

  async function analyze() {
    setBusy(true); setError('')
    try {
      const next = await post<Analysis>('analyze', { projectRoot: projectPath, previousCandidateId: candidate?.id })
      setProjectPath(next.projectRoot)
      setAnalysis(next)
      setCandidate(undefined)
      setPreviewUrl(undefined)
      window.sessionStorage.removeItem(candidateStorageKey)
      setOperations([])
      const firstEditable = next.targets.find(item => item.value !== undefined && item.impact.pageRefs.length > 0 && item.impact.unresolved.length === 0)
      if (firstEditable) { setTargetId(firstEditable.id); setAfter(firstEditable.value ?? '') }
      setPageScope(Object.fromEntries(next.routes.map(route => [route.id, ''])))
      setLocalPageRef(next.routes[0]?.id ?? '')
      setScopeStrategy('shared')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法分析项目') }
    finally { setBusy(false) }
  }

  async function invalidateCandidate(): Promise<boolean> {
    if (!candidate) return true
    setBusy(true); setError('')
    try {
      await post('discard', { candidateId: candidate.id })
      setCandidate(current => current?.id === candidate.id ? undefined : current)
      setPreviewUrl(undefined)
      if (window.sessionStorage.getItem(candidateStorageKey) === candidate.id) window.sessionStorage.removeItem(candidateStorageKey)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法清理过期候选')
      return false
    } finally { setBusy(false) }
  }

  async function addOperation() {
    if (!target || target.value === undefined || target.value === after) return
    if (operations.some(operation => operation.targetRef === target.id)) { setError('同一候选中每个源码目标只能编辑一次'); return }
    if (!await invalidateCandidate()) return
    const operation: EditOperation = { id: `operation-${crypto.randomUUID()}`, kind: operationKind(target.kind), targetRef: target.id, before: target.value, after }
    setOperations(current => [...current, operation])
    setError('')
  }

  async function createCandidate() {
    if (!analysis || !operations.length || !intent.trim() || !scopesComplete) return
    setBusy(true); setError('')
    const scope: ScopeDecision = {
      id: `scope-${crypto.randomUUID()}`, version: 1,
      strategy: scopeStrategy,
      ...(scopeStrategy === 'page-override' ? { localPageRef } : {}),
      includedRefs: [...operations.map(operation => operation.targetRef), ...analysis.routes.filter(route => pageScope[route.id] === 'include').map(route => route.id)],
      excludedRefs: analysis.routes.filter(route => pageScope[route.id] === 'exclude').map(route => route.id),
      protectedRefs: analysis.routes.filter(route => pageScope[route.id] === 'protect').map(route => route.id),
      decidedBy: 'local-user', decidedAt: new Date().toISOString(),
    }
    try {
      const result = await post<{ candidate: CandidateView }>('candidate', { projectId: analysis.revision.projectId, rawIntent: intent, operations, scope, previousCandidateId: candidate?.id })
      setCandidate(result.candidate)
      setPreviewUrl(undefined)
      window.sessionStorage.setItem(candidateStorageKey, result.candidate.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建隔离候选') }
    finally { setBusy(false) }
  }

  async function discardCandidate() { await invalidateCandidate() }

  async function togglePreview() {
    if (!candidate) return
    setPreviewBusy(true); setError('')
    try {
      if (previewUrl) {
        await post('candidate/preview/stop', { candidateId: candidate.id })
        setPreviewUrl(undefined)
      } else {
        const preview = await post<{ url: string }>('candidate/preview', { candidateId: candidate.id })
        setPreviewUrl(preview.url)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法启动候选浏览器预演') }
    finally { setPreviewBusy(false) }
  }

  return <main className="workbench-shell">
    <header className="workbench-header">
      <a className="brand-mark" href="#top" aria-label="Ripple 项目工作台"><span className="brand-symbol">R</span><span>ripple<span className="brand-subtitle">PROJECT WORKBENCH</span></span></a>
      <div className="header-state"><i />本机项目模式 · 不执行目标工程脚本</div>
    </header>
    <section className="workbench-intro" id="top">
      <div><span className="eyebrow">SOURCE-AWARE EDITING</span><h1>从真实源码开始，<em>每一步都有边界。</em></h1><p>读取 React / Vite 工程，检查真实页面消费者，显式确认修改范围，再生成隔离候选补丁。</p></div>
      <div className="intro-stamp"><span>01</span><small>PROJECT<br />FIRST</small></div>
    </section>

    <section className="project-open panel">
      <div className="section-title"><span className="step-badge">01</span><div><h2>打开本机工程</h2><p>只读分析干净的 Git 工作树；候选文件与补丁保存在工程目录之外。</p></div></div>
      <div className="project-open-form"><label htmlFor="project-path">Git 项目目录</label><div className="project-path-row"><input id="project-path" data-testid="project-path" value={projectPath} onChange={event => setProjectPath(event.target.value)} placeholder="例如 D:\\projects\\ripple-qingye-bolt\\project" spellCheck={false} /><button data-testid="analyze-project" type="button" onClick={() => void analyze()} disabled={busy || previewBusy || !projectPath.trim()}>{busy && !analysis ? '正在读取…' : '分析工程'}<span>↗</span></button></div></div>
      {error && <p className="api-error" role="alert">{error}</p>}
    </section>

    {analysis && <>
      <section className="overview-grid">
        <article className="metric-card"><span>工程 HEAD</span><strong>{analysis.revision.gitCommit?.slice(0, 10) ?? '未知'}</strong><small>{analysis.projectRoot}</small></article>
        <article className="metric-card"><span>实际页面状态</span><strong>{analysis.routes.length}</strong><small>{analysis.routes.map(route => route.page ?? route.label).join(' · ') || '未解析到页面'}</small></article>
        <article className="metric-card"><span>源码编辑目标</span><strong>{analysis.targets.length}</strong><small>TEXT · MEDIA · TOKEN 统一进入 EditSession</small></article>
        <article className={analysis.unresolved.length ? 'metric-card metric-warning' : 'metric-card'}><span>分析确定性</span><strong>{analysis.unresolved.length ? `${analysis.unresolved.length} 项待确认` : '依赖完整'}</strong><small>{analysis.unresolved.length ? '模糊关系不会被当作已证明影响' : '来源与页面消费关系已读取'}</small></article>
      </section>

      <div className="workbench-columns">
        <section className="panel source-panel">
          <div className="section-title compact"><span className="step-badge">02</span><div><h2>工程关系</h2><p>来自当前项目 AST 与本地页面状态</p></div></div>
          <div className="route-list"><h3>页面状态</h3>{analysis.routes.map(route => <div className="route-row" key={route.id}><span className="route-dot" /> <strong>{route.label}</strong><code>{route.id}</code></div>)}</div>
          <div className="component-list"><h3>组件消费</h3>{analysis.components.filter(component => component.pages.length > 1).slice(0, 12).map(component => <div className="component-row" key={component.id}><span><strong>{component.label}</strong><small>{component.location?.path}</small></span><em>{component.pages.map(page => `/${page}`).join('  ')}</em></div>)}{!analysis.components.some(component => component.pages.length > 1) && <p className="empty-note">尚未证明有跨页面共享组件。</p>}</div>
          <div className="certainty-note"><span>●</span><p>仅 source-proven 消费关系参与范围校验；语义候选和未解析路径不会被标成确定。</p></div>
        </section>

        <section className="panel edit-panel">
          <div className="section-title compact"><span className="step-badge">03</span><div><h2>意图与操作</h2><p>一条 EditSession 支持多项 TEXT / MEDIA / TOKEN 修改</p></div></div>
          <label className="field-label" htmlFor="intent">保留用户原始意图</label><textarea id="intent" data-testid="intent-input" className="intent-field" value={intent} disabled={!!candidate} onChange={event => setIntent(event.target.value)} placeholder="例如：只优化首页主标题和按钮文案，保留青野网站的视觉设计。" />
          <div className="target-fields"><label><span className="field-label">真实源码目标</span><select data-testid="target-select" value={targetId} disabled={!!candidate} onChange={event => { const nextId = event.target.value; const nextTarget = analysis.targets.find(item => item.id === nextId); setTargetId(nextId); setAfter(nextTarget?.value ?? '') }}><option value="">选择分析到的目标</option>{analysis.targets.map(item => <option key={item.id} value={item.id}>{operationKind(item.kind)} · {item.label} · {item.location?.path}#{item.location?.start}</option>)}</select></label><label><span className="field-label">候选值</span><input data-testid="after-input" value={after} disabled={!!candidate} onChange={event => setAfter(event.target.value)} placeholder="输入新的源码值" /></label></div>
          {target && <div className="target-proof"><span className="proof-check">✓</span><div><strong>{target.location?.path}#{target.location?.start}</strong><small>{target.impact.pageRefs.length ? `可证明消费：${target.impact.pageRefs.map(ref => ref.replace('page:', '/')).join('、')}` : '没有可证明的页面消费者'}{target.impact.unresolved.length ? ` · 待确认 ${target.impact.unresolved.length} 项` : ''}</small></div><code>{target.impact.unresolved.length ? 'UNRESOLVED' : 'SOURCE-PROVEN'}</code></div>}
          <button type="button" data-testid="add-operation" className="add-operation" onClick={() => void addOperation()} disabled={busy || !target || !after || target.value === after || !!target?.impact.unresolved.length}>＋ 加入本次修改</button>
          {operations.length > 0 && <div className="operation-list"><h3>本次 EditSession <span>{operations.length} 项</span></h3>{operations.map(operation => <article className="operation-row" key={operation.id}><span className="op-kind">{operation.kind}</span><div><code>{analysis.targets.find(item => item.id === operation.targetRef)?.location?.path}</code><p><del>{operation.before}</del><b>→</b><strong>{operation.after}</strong></p></div><button type="button" aria-label="移除此操作" disabled={busy || previewBusy} onClick={() => void invalidateCandidate().then(ok => { if (ok) setOperations(current => current.filter(item => item.id !== operation.id)) })}>×</button></article>)}</div>}
        </section>
      </div>

      <section className="panel scope-panel">
        <div className="section-title compact"><span className="step-badge">04</span><div><h2>明确 Scope</h2><p>每个实际页面都要明确选择包含、排除或保护；共享来源的传播会在执行器内复核。</p></div></div>
        <fieldset className="scope-strategy" disabled={busy || previewBusy || !operations.length}>
          <legend>共享源码冲突时的处理方式</legend>
          <label><input type="radio" name="scope-strategy" value="shared" checked={scopeStrategy === 'shared'} onChange={() => void invalidateCandidate().then(ok => { if (ok) setScopeStrategy('shared') })} /> 修改共享来源，并纳入全部受影响页面</label>
          <label><input type="radio" name="scope-strategy" value="page-override" checked={scopeStrategy === 'page-override'} onChange={() => void invalidateCandidate().then(ok => { if (ok) setScopeStrategy('page-override') })} /> 仅在一个页面创建可维护覆盖，不改共享值</label>
          {scopeStrategy === 'page-override' && <label className="local-page-choice">覆盖页面<select aria-label="选择局部覆盖页面" value={localPageRef} onChange={event => void invalidateCandidate().then(ok => { if (ok) setLocalPageRef(event.target.value) })}>{analysis.routes.map(route => <option key={route.id} value={route.id}>{route.label}</option>)}</select><small>当前执行器支持 JSX 文本；MEDIA、TOKEN 和运行时单实例覆盖仍未接入。</small></label>}
        </fieldset>
        {analysis.routes.length === 0 ? <p className="empty-note">尚未解析出路由，当前不能生成页面范围候选。</p> : <div className="scope-grid">{analysis.routes.map(route => <label className={`scope-route ${pageScope[route.id] ? `scope-${pageScope[route.id]}` : ''}`} key={route.id}><span className="scope-route-head"><strong>{route.label}</strong><code>{route.id}</code></span><select data-testid={`scope-${route.id}`} aria-label={`${route.label} 页面范围`} value={pageScope[route.id] ?? ''} disabled={busy || previewBusy} onChange={event => { const value = event.target.value as PageScope; void invalidateCandidate().then(ok => { if (ok) setPageScope(current => ({ ...current, [route.id]: value })) }) }}><option value="">请选择范围</option><option value="include">包含在候选中</option><option value="exclude">明确排除</option><option value="protect">保护，不得修改</option></select>{impactedPages.includes(route.id) && <small>目标源码的已证明消费者</small>}</label>)}</div>}
        <div className="scope-footer"><span>{operations.length} 项操作 · {impactedPages.length} 个已证明页面消费者{scopeStrategy === 'page-override' ? ' · 一项页面覆盖' : ''}</span><button type="button" data-testid="create-real-candidate" onClick={() => void createCandidate()} disabled={busy || previewBusy || !analysis || !intent.trim() || !operations.length || !scopesComplete || !scopesValid}>{busy ? '正在创建隔离候选…' : '创建真实隔离候选'}<span>↗</span></button></div>
      </section>

      {candidate && <section className="panel candidate-panel"><div className="candidate-head"><div><span className="eyebrow">ISOLATED CANDIDATE</span><h2>候选补丁已生成</h2><p>真实 Git worktree 中产生的源码差异；预演只运行隔离副本，不写入原工程。</p></div><button type="button" data-testid="discard-candidate" className="quiet-button" onClick={() => void discardCandidate()} disabled={busy || previewBusy}>清理候选</button></div><div className="hash-grid"><div><span>候选 ID</span><code data-testid="candidate-id">{candidate.id}</code></div><div><span>Patch SHA-256</span><code>{candidate.patchHash}</code></div><div><span>候选树摘要</span><code>{candidate.candidateTreeDigest}</code></div></div><div className="candidate-files"><span>修改文件</span>{candidate.modifiedPaths.map(file => <code key={file}>{file}</code>)}</div><pre className="diff-view" data-testid="candidate-diff" aria-label="真实候选补丁差异">{candidate.diff}</pre><div className="preview-toolbar"><div><strong>隔离浏览器预演</strong><small>运行候选前端代码；Docker 容器无网络出口，浏览器以沙箱 iframe 打开。</small></div><button type="button" data-testid="toggle-candidate-preview" className="quiet-button" onClick={() => void togglePreview()} disabled={previewBusy}>{previewBusy ? '启动中…' : previewUrl ? '关闭预演' : '启动真实预演'}</button></div>{previewUrl && <iframe data-testid="candidate-preview" title="隔离候选浏览器预演" src={previewUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="eager" />}
        <div className="verification-state" data-testid="verification-state"><span>NOT RUN</span><p>预演不等于验证。截图证据、定向回归、审批、应用和回滚仍未执行。</p></div></section>}
    </>}
    <footer className="workbench-footer"><span>RIPPLE / PROJECT-FIRST CORE</span><span>candidate workspace is isolated · original checkout stays untouched</span></footer>
  </main>
}
