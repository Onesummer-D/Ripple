import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserVerificationContract, EditKind, EditOperation, EvidenceResult, ScopeDecision } from '../core/model'
import { VerificationContractEditor } from './VerificationContractEditor'
import { ScopeEffectPreview } from './ScopeEffectPreview'
import { buildScopeEffectPreview, type PageScopeChoice } from './scope-effect-preview'
import { projectPreviewViewports } from '../core/project-viewports'
import { createVerificationContractDraft, incompleteVerificationDeclarations, toBrowserVerificationContract, type VerificationContractDraft } from './verification-contract-form'
import './project-workbench.css'

interface RouteSummary { id: string; label: string; page?: string }
interface ComponentSummary { id: string; label: string; pages: string[]; location?: { path: string; start?: number; end?: number } }
interface TargetSummary {
  id: string
  kind: 'data' | 'media' | 'token'
  label: string
  value?: string
  pageOverrides?: Record<string, string>
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
  previewResources: { referencedUrls: string[]; authorizedUrls: string[] }
}
interface CandidateView {
  id: string
  scopeDecisionId: string
  scopeVersion: number
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  operations: EditOperation[]
  modifiedPaths: string[]
  diff: string
}
interface WorkflowView {
  lifecycle: 'active' | 'discarded' | 'stale' | 'applied' | 'rolled-back'
  approval?: { candidateId: string; verificationRunId: string; by: string; at: string }
  applied?: { candidateId: string; appliedPatchHash: string; baseSourceDigest: string; targetSourceDigest: string; appliedAt: string; commit?: string }
  rollback?: { candidateId: string; appliedPatchHash: string; restoredSourceDigest: string; rolledBackAt: string }
  rollbackAvailable: boolean
}
interface HistoryItem {
  candidateId: string
  projectId: string
  lifecycle: WorkflowView['lifecycle']
  patchHash: string
  baseSourceDigest: string
  candidateTreeDigest: string
  updatedAt: string
  applied?: WorkflowView['applied']
  rollback?: WorkflowView['rollback']
  verification: VerificationView
}
interface VerificationView {
  state: 'not-run' | 'passed' | 'risks' | 'incomplete' | 'stale' | 'failed-to-run'
  reason?: string
  runId?: string
  patchHash?: string
  candidateTreeDigest?: string
  scopeDecisionId?: string
  scopeVersion?: number
  assertions?: Array<{ id: string; result: EvidenceResult; detail: string }>
  evidence?: Array<{ id: string; checkId: string; result: EvidenceResult; pageUrl: string; viewport: { width: number; height: number }; runtimeState: string; elementRefs: string[]; reason?: string; artifactUrl?: string }>
  recordUrl?: string
  recordHash?: string
}
interface SourceSelection {
  candidateId?: string
  projectId?: string
  previewId?: string
  patchHash?: string
  sourceDigest: string
  element: { id: string; label: string; location?: { path: string; start?: number; end?: number } }
  editableText: Array<{ id: string; label: string; value?: string; location?: { path: string; start?: number; end?: number }; impact: { pageRefs: string[]; unresolved: string[]; certainty: 'source-proven' | 'partial' | 'unknown' } }>
  runtimeInstanceId?: string
  identityCertainty: 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
  tagName: string
  text: string
}
interface ProjectSourcePreview { projectId: string; previewId: string; sourceDigest: string; url: string }
type PageScope = PageScopeChoice
const operationKind = (kind: TargetSummary['kind']): EditKind => kind === 'data' ? 'TEXT' : kind === 'media' ? 'MEDIA' : 'TOKEN'
const candidateStorageKey = 'ripple.workbench.activeCandidate'
const previewSizes = projectPreviewViewports
const verificationLabel = (state: VerificationView['state']) => state === 'not-run' ? 'NOT RUN' : state === 'failed-to-run' ? 'FAILED TO RUN' : state.toUpperCase()

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/__ripple/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`)
  return payload
}

async function loadHistory(): Promise<HistoryItem[]> {
  const response = await fetch('/__ripple/api/history', { cache: 'no-store' })
  const payload = await response.json() as { history?: HistoryItem[]; error?: string }
  if (!response.ok) throw new Error(payload.error ?? `读取历史失败（${response.status}）`)
  return payload.history ?? []
}

interface CandidatePreviewPaneProps {
  url: string
  previewTestId: 'project-preview' | 'candidate-preview'
  viewportTestIdPrefix: 'project-preview' | 'preview'
  selectionTestId: string
  previewTitle: string
  selectionNonce: string
  frameRef: { current: HTMLIFrameElement | null }
  onFrameLoad: (event: { currentTarget: HTMLIFrameElement }) => void
  onToggleSelection: () => void
}

function CandidatePreviewPane({ url, previewTestId, viewportTestIdPrefix, selectionTestId, previewTitle, selectionNonce, frameRef, onFrameLoad, onToggleSelection }: CandidatePreviewPaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(1440)
  const viewport = previewSizes.find(size => size.width === viewportWidth)!
  const scale = hostWidth ? Math.min(1, hostWidth / viewport.width) : 1

  useEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setHostWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <>
    <div className="preview-toolbar"><div><strong>{previewTitle}</strong><small>Linux 容器只读挂载源码与依赖，再复制到临时文件系统运行固定 Ripple Vite 配置；不会执行目标工程的 npm 脚本。浏览器外链与表单导航受限。它不是 VM 级沙箱，请只预演可信项目。</small></div><div className="preview-actions"><div className="preview-size-controls" role="group" aria-label="页面预演视口">{previewSizes.map(size => <button type="button" key={size.width} data-testid={`${viewportTestIdPrefix}-viewport-${size.width}`} aria-pressed={viewportWidth === size.width} onClick={() => setViewportWidth(size.width)}>{size.label}</button>)}</div><button type="button" data-testid={selectionTestId} className="quiet-button" aria-pressed={!!selectionNonce} onClick={onToggleSelection}>{selectionNonce ? '取消点选' : '点选页面元素'}</button></div></div>
    <div className="preview-viewport-shell" ref={host} data-testid="preview-viewport-shell" style={{ height: `${Math.ceil(viewport.height * scale)}px` }}>
      <div className="preview-viewport-surface" style={{ width: `${viewport.width}px`, height: `${viewport.height}px`, left: `${Math.max(0, (hostWidth - viewport.width * scale) / 2)}px`, transform: `scale(${scale})` }}>
        <iframe ref={frameRef} onLoad={onFrameLoad} data-testid={previewTestId} title={`${previewTitle} · ${viewport.label}`} src={url} width={viewport.width} height={viewport.height} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="eager" />
      </div>
    </div>
  </>
}

function SourceSelectionDetails({ selection, kind, onUseText }: { selection: SourceSelection; kind: 'project' | 'candidate'; onUseText?: (targetId: string) => void }) {
  return <div className="source-selection" data-testid="selected-source">
    <div><span className="eyebrow">{kind === 'project' ? 'PROJECT SOURCE MAPPING' : 'CANDIDATE SOURCE MAPPING'}</span><strong>{selection.element.label} · &lt;{selection.tagName}&gt;</strong><code data-testid="selected-jsx-source">{selection.element.location?.path}#{selection.element.location?.start}</code></div>
    <p>{selection.patchHash ? <>绑定候选 Patch <code>{selection.patchHash.slice(0, 16)}</code> 与源码摘要</> : <>绑定当前项目源码摘要</>} <code>{selection.sourceDigest.slice(0, 16)}</code>。这是本次预演的定位信息，不是验证证据。</p>
    <p>运行时实例：<code>{selection.runtimeInstanceId ?? '未提供'}</code> · 身份确定性：<strong>{selection.identityCertainty}</strong>{selection.identityCertainty === 'position-dependent' || selection.identityCertainty === 'unknown' || selection.identityCertainty === 'unmapped' ? ' · 不允许按唯一实例精准修改' : ' · 仅用于定位，不构成编辑授权'}</p>
    <p>页面文本：{selection.text || '（无文本）'}</p>
    {selection.editableText.length > 0 ? <ul>{selection.editableText.map(item => <li key={item.id}><code>{item.location?.path}#{item.location?.start}</code> {item.label} · {item.impact.certainty}{item.impact.pageRefs.length ? ` · ${item.impact.pageRefs.map(ref => ref.replace('page:', '/')).join('、')}` : ''}{kind === 'project' && onUseText && item.value !== undefined && <button type="button" className="quiet-button" data-testid={`use-source-text-${item.id}`} aria-label={`编辑这段文字：${item.value}`} onClick={() => onUseText(item.id)}>编辑这段文字</button>}</li>)}</ul> : <small>此 JSX 元素没有直接映射到可编辑文本节点。</small>}
  </div>
}

export default function ProjectWorkbench() {
  const [projectPath, setProjectPath] = useState('')
  const [intent, setIntent] = useState('')
  const [analysis, setAnalysis] = useState<Analysis>()
  const [resourceDraft, setResourceDraft] = useState('')
  const [targetId, setTargetId] = useState('')
  const [focusAfterInputRequest, setFocusAfterInputRequest] = useState(0)
  const [after, setAfter] = useState('')
  const [operations, setOperations] = useState<EditOperation[]>([])
  const [pageScope, setPageScope] = useState<Record<string, PageScope>>({})
  const [scopeStrategy, setScopeStrategy] = useState<'shared' | 'page-override'>('shared')
  const [localPageRef, setLocalPageRef] = useState('')
  const [verificationContractDraft, setVerificationContractDraft] = useState<VerificationContractDraft>({ pages: [], interactions: [] })
  const [candidate, setCandidate] = useState<CandidateView>()
  const [verification, setVerification] = useState<VerificationView>({ state: 'not-run', reason: '浏览器验证尚未运行。' })
  const [workflow, setWorkflow] = useState<WorkflowView>()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [verificationBusy, setVerificationBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [previewBusy, setPreviewBusy] = useState(false)
  const [sourcePreview, setSourcePreview] = useState<ProjectSourcePreview>()
  const [sourcePreviewBusy, setSourcePreviewBusy] = useState(false)
  const [selectionNonce, setSelectionNonce] = useState('')
  const [selection, setSelection] = useState<SourceSelection>()
  const previewFrame = useRef<HTMLIFrameElement>(null)
  const sourcePreviewFrame = useRef<HTMLIFrameElement>(null)
  const [selectionKind, setSelectionKind] = useState<'project' | 'candidate'>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!focusAfterInputRequest) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    document.getElementById('edit-panel')?.scrollIntoView({ block: 'start', behavior })
    const input = document.getElementById('after-input') as HTMLInputElement | null
    input?.focus()
    input?.select()
  }, [focusAfterInputRequest])

  useEffect(() => {
    let active = true
    void loadHistory().then(items => { if (active) setHistory(items) }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '无法读取候选历史')
    })
    return () => { active = false }
  }, [])

  async function refreshHistory() {
    setHistory(await loadHistory())
  }

  useEffect(() => {
    const candidateId = window.sessionStorage.getItem(candidateStorageKey)
    if (!candidateId) return
    let active = true
    setBusy(true)
    post<{ analysis: Analysis; rawIntent: string; verificationContract?: BrowserVerificationContract; scope?: ScopeDecision; candidate: CandidateView; verification: VerificationView; workflow: WorkflowView }>('candidate/restore', { candidateId })
      .then(restored => {
        if (!active) return
        setProjectPath(restored.analysis.projectRoot)
        setAnalysis(restored.analysis)
        setResourceDraft(restored.analysis.previewResources.authorizedUrls.join('\n'))
        setIntent(restored.rawIntent)
        setVerificationContractDraft(createVerificationContractDraft(restored.analysis.routes, restored.verificationContract))
        setCandidate(restored.candidate)
        setVerification(restored.verification)
        setWorkflow(restored.workflow)
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
  const scopeSuggestions = useMemo(() => {
    if (!analysis || !operations.length) return undefined
    const targets = operations.map(operation => analysis.targets.find(item => item.id === operation.targetRef))
    if (targets.some(item => !item || item.impact.certainty !== 'source-proven' || item.impact.unresolved.length || !item.impact.pageRefs.length || item.impact.pageRefs.some(pageRef => !analysis.routes.some(route => route.id === pageRef)))) return undefined
    const operationPages = targets.map(item => new Set(item!.impact.pageRefs))
    const sharedPageRefs = [...new Set(operationPages.flatMap(pages => [...pages]))].filter(pageRef => analysis.routes.some(route => route.id === pageRef))
    const localPageRefs = operations.every((operation, index) => operation.kind === 'TEXT' && targets[index]?.kind === 'data')
      ? sharedPageRefs.filter(pageRef => operationPages.every(pages => pages.has(pageRef)))
      : []
    return { sharedPageRefs, localPageRefs }
  }, [analysis, operations])
  const scopesComplete = !!analysis && analysis.routes.every(route => !!pageScope[route.id])
  const includedRoutes = analysis?.routes.filter(route => pageScope[route.id] === 'include') ?? []
  const scopesValid = scopeStrategy === 'shared' || (includedRoutes.length === 1 && includedRoutes[0].id === localPageRef)
  const scopePageDecision = useMemo(() => ({
    strategy: scopeStrategy,
    ...(scopeStrategy === 'page-override' ? { localPageRef } : {}),
    includedRefs: [...new Set([
      ...operations.map(operation => operation.targetRef),
      ...(analysis?.routes.filter(route => pageScope[route.id] === 'include').map(route => route.id) ?? []),
    ])],
    excludedRefs: analysis?.routes.filter(route => pageScope[route.id] === 'exclude').map(route => route.id) ?? [],
    protectedRefs: analysis?.routes.filter(route => pageScope[route.id] === 'protect').map(route => route.id) ?? [],
  }), [analysis, operations, pageScope, scopeStrategy, localPageRef])
  const scopeEffectRows = useMemo(() => buildScopeEffectPreview({
    routes: analysis?.routes ?? [],
    targets: analysis?.targets ?? [],
    operations,
    choices: pageScope,
    scope: scopePageDecision,
  }), [analysis, operations, pageScope, scopePageDecision])
  useEffect(() => {
    const active = candidate && previewUrl
      ? { kind: 'candidate' as const, previewId: candidate.id, frame: previewFrame.current }
      : sourcePreview
        ? { kind: 'project' as const, previewId: sourcePreview.previewId, frame: sourcePreviewFrame.current }
        : undefined
    if (!active?.frame?.contentWindow) return
    active.frame.contentWindow.postMessage({ type: 'ripple:selection-mode', previewId: active.previewId, token: selectionNonce, enabled: !!selectionNonce }, '*')
  }, [candidate?.id, previewUrl, sourcePreview?.previewId, selectionNonce])

  useEffect(() => {
    const kind = candidate && previewUrl ? 'candidate' : sourcePreview ? 'project' : undefined
    const previewId = kind === 'candidate' ? candidate?.id : sourcePreview?.previewId
    const frameRef = kind === 'candidate' ? previewFrame : sourcePreviewFrame
    if (!kind || !previewId || !selectionNonce) return
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      const data = event.data as Record<string, unknown> | null
      const certainties = ['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped']
      if (!frame?.contentWindow || event.source !== frame.contentWindow || !data || data.type !== 'ripple:element-selected' ||
        data.previewId !== previewId || data.token !== selectionNonce || typeof data.sourceRef !== 'string' ||
        typeof data.identityCertainty !== 'string' || !certainties.includes(data.identityCertainty) ||
        typeof data.tagName !== 'string' || typeof data.text !== 'string') return
      const request = kind === 'candidate'
        ? post<Omit<SourceSelection, 'runtimeInstanceId' | 'identityCertainty' | 'tagName' | 'text'>>('candidate/source-selection', { candidateId: previewId, sourceRef: data.sourceRef })
        : post<Omit<SourceSelection, 'runtimeInstanceId' | 'identityCertainty' | 'tagName' | 'text'>>('project/source-selection', {
          projectId: sourcePreview?.projectId, previewId, sourceDigest: sourcePreview?.sourceDigest, sourceRef: data.sourceRef,
        })
      void request.then(mapped => {
        if (selectionNonce !== data.token || (kind === 'candidate' ? candidate?.id !== previewId : sourcePreview?.previewId !== previewId)) return
        setSelection({
          ...mapped,
          runtimeInstanceId: typeof data.runtimeInstanceId === 'string' ? data.runtimeInstanceId : undefined,
          identityCertainty: data.identityCertainty as SourceSelection['identityCertainty'],
          tagName: data.tagName as string,
          text: data.text as string,
        })
        setSelectionKind(kind)
      }).catch(cause => setError(cause instanceof Error ? `元素没有可确认的 JSX 来源：${cause.message}` : '元素没有可确认的 JSX 来源'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [candidate?.id, previewUrl, sourcePreview?.projectId, sourcePreview?.previewId, sourcePreview?.sourceDigest, selectionNonce])

  function toggleElementSelection(previewId: string, frame: { current: HTMLIFrameElement | null }) {
    if (selectionNonce) {
      frame.current?.contentWindow?.postMessage({ type: 'ripple:selection-mode', previewId, token: selectionNonce, enabled: false }, '*')
      setSelectionNonce('')
    } else {
      setSelection(undefined)
      setSelectionKind(undefined)
      setSelectionNonce(crypto.randomUUID())
    }
  }

  function syncElementSelection(event: { currentTarget: HTMLIFrameElement }, previewId: string) {
    event.currentTarget.contentWindow?.postMessage({
      type: 'ripple:selection-mode', previewId, token: selectionNonce, enabled: !!selectionNonce,
    }, '*')
  }

  async function analyze() {
    setBusy(true); setError('')
    try {
      const next = await post<Analysis>('analyze', { projectRoot: projectPath, previousCandidateId: candidate?.id })
      setProjectPath(next.projectRoot)
      setAnalysis(next)
      setResourceDraft(next.previewResources.authorizedUrls.join('\n'))
      setCandidate(undefined)
      setWorkflow(undefined)
      setVerification({ state: 'not-run', reason: '浏览器验证尚未运行。' })
      setPreviewUrl(undefined)
      setSourcePreview(undefined)
      setSelectionKind(undefined)
      setSelectionNonce('')
      setSelection(undefined)
      window.sessionStorage.removeItem(candidateStorageKey)
      setOperations([])
      const firstEditable = next.targets.find(item => item.value !== undefined && item.impact.pageRefs.length > 0 && item.impact.unresolved.length === 0)
      if (firstEditable) { setTargetId(firstEditable.id); setAfter(firstEditable.value ?? '') }
      setPageScope(Object.fromEntries(next.routes.map(route => [route.id, ''])))
      setLocalPageRef(next.routes[0]?.id ?? '')
      setScopeStrategy('shared')
      setVerificationContractDraft(createVerificationContractDraft(next.routes))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法分析项目') }
    finally { setBusy(false) }
  }

  async function toggleProjectSourcePreview() {
    if (!analysis) return
    setSourcePreviewBusy(true); setError('')
    try {
      if (sourcePreview) {
        await post('project/preview/stop', { projectId: sourcePreview.projectId, previewId: sourcePreview.previewId })
        setSourcePreview(undefined)
        setSelectionNonce('')
        setSelection(undefined)
        setSelectionKind(undefined)
      } else {
        const preview = await post<ProjectSourcePreview>('project/preview', { projectId: analysis.revision.projectId })
        if (preview.sourceDigest !== analysis.revision.sourceDigest) throw new Error('项目源码已变化，请重新分析后再选择目标')
        setSourcePreview(preview)
        setSelection(undefined)
        setSelectionKind(undefined)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法启动真实项目预览') }
    finally { setSourcePreviewBusy(false) }
  }

  function useSelectedSourceText(targetRef: string) {
    const selectedTarget = analysis?.targets.find(item => item.id === targetRef)
    if (!selectedTarget || selectedTarget.value === undefined) {
      setError('点选来源没有可执行的文字目标；可以查看源码位置，但不能将其当作可编辑文本')
      return
    }
    setTargetId(targetRef)
    setAfter(scopeStrategy === 'page-override' ? selectedTarget.pageOverrides?.[localPageRef] ?? selectedTarget.value : selectedTarget.value)
    setError('')
    setFocusAfterInputRequest(request => request + 1)
  }

  function addResourceToDraft(resourceUrl: string) {
    setResourceDraft(current => [...new Set([...current.split(/\r?\n/).map(value => value.trim()).filter(Boolean), resourceUrl])].join('\n'))
  }

  async function savePreviewResources() {
    if (!analysis) return
    setBusy(true); setError('')
    try {
      if (sourcePreview) {
        await post('project/preview/stop', { projectId: sourcePreview.projectId, previewId: sourcePreview.previewId })
        setSourcePreview(undefined)
        setSelectionNonce('')
        setSelection(undefined)
        setSelectionKind(undefined)
      }
      const urls = resourceDraft.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
      const result = await post<{ previewResources: Analysis['previewResources'] }>('preview/resources', { projectId: analysis.revision.projectId, urls })
      setAnalysis(current => current ? { ...current, previewResources: result.previewResources } : current)
      setResourceDraft(result.previewResources.authorizedUrls.join('\n'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存预演资源授权') }
    finally { setBusy(false) }
  }

  async function invalidateCandidate(): Promise<boolean> {
    if (!candidate) return true
    setBusy(true); setError('')
    try {
      await post('discard', { candidateId: candidate.id })
      setCandidate(current => current?.id === candidate.id ? undefined : current)
      setWorkflow(undefined)
      setVerification({ state: 'not-run', reason: '候选已清理。' })
      setPreviewUrl(undefined)
      setSelectionNonce('')
      setSelection(undefined)
      setSelectionKind(undefined)
      if (window.sessionStorage.getItem(candidateStorageKey) === candidate.id) window.sessionStorage.removeItem(candidateStorageKey)
      await refreshHistory()
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
    const fields = { id: `operation-${crypto.randomUUID()}`, targetRef: target.id, before: target.value, after }
    const operation: EditOperation = target.kind === 'data'
      ? { ...fields, kind: 'TEXT' }
      : target.kind === 'media'
        ? { ...fields, kind: 'MEDIA' }
        : { ...fields, kind: 'TOKEN' }
    setOperations(current => [...current, operation])
    setError('')
  }

  async function chooseScopePreset(strategy: 'shared' | 'page-override') {
    if (!analysis || !scopeSuggestions) return
    const localPage = scopeSuggestions.localPageRefs.includes(localPageRef)
      ? localPageRef
      : scopeSuggestions.localPageRefs[0]
    const includedPages = strategy === 'shared' ? scopeSuggestions.sharedPageRefs : localPage ? [localPage] : []
    if (!includedPages.length) {
      setError(strategy === 'page-override' ? '本次操作没有共同的已证明消费页面，无法建议单页覆盖。' : '没有可证明的页面消费者，无法建议共享范围。')
      return
    }
    if (!await invalidateCandidate()) return
    setScopeStrategy(strategy)
    if (strategy === 'page-override') setLocalPageRef(localPage!)
    const included = new Set(includedPages)
    setPageScope(Object.fromEntries(analysis.routes.map(route => [route.id, included.has(route.id) ? 'include' : 'exclude'])))
    setError('')
  }

  async function removePageOverride() {
    if (!target || !localPageRef || target.pageOverrides?.[localPageRef] === undefined) return
    if (operations.some(operation => operation.targetRef === target.id)) { setError('同一候选中每个源码目标只能编辑一次'); return }
    if (!await invalidateCandidate()) return
    const fallback = target.value ?? ''
    const operation: EditOperation = { id: `operation-${crypto.randomUUID()}`, kind: 'TEXT', targetRef: target.id, before: fallback, after: fallback, overrideAction: 'remove' }
    setOperations(current => [...current, operation])
    setError('')
  }

  async function createCandidate() {
    if (!analysis || !operations.length || !intent.trim() || !scopesComplete) return
    setBusy(true); setError('')
    const scope: ScopeDecision = {
      ...scopePageDecision,
      id: `scope-${crypto.randomUUID()}`, version: 1,
      decidedBy: 'local-user', decidedAt: new Date().toISOString(),
    }
    try {
      const verificationContract = toBrowserVerificationContract(verificationContractDraft)
      const result = await post<{ candidate: CandidateView; verification: VerificationView; workflow: WorkflowView }>('candidate', { projectId: analysis.revision.projectId, rawIntent: intent, operations, scope, verificationContract, previousCandidateId: candidate?.id })
      setCandidate(result.candidate)
      setSourcePreview(undefined)
      setVerification(result.verification)
      setWorkflow(result.workflow)
      setPreviewUrl(undefined)
      setSelectionNonce('')
      setSelection(undefined)
      setSelectionKind(undefined)
      window.sessionStorage.setItem(candidateStorageKey, result.candidate.id)
      await refreshHistory()
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
        setSelectionNonce('')
        setSelection(undefined)
      } else {
        const preview = await post<{ url: string; verification: VerificationView }>('candidate/preview', { candidateId: candidate.id })
        setPreviewUrl(preview.url)
        setVerification(preview.verification)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法启动候选浏览器预演') }
    finally { setPreviewBusy(false) }
  }

  async function verifyCandidate() {
    if (!candidate) return
    setVerificationBusy(true); setError('')
    try {
      const result = await post<{ candidateId: string; previewUrl: string; verification: VerificationView; workflow: WorkflowView }>('candidate/verify', { candidateId: candidate.id })
      if (candidate?.id !== result.candidateId) return
      setVerification(result.verification)
      setWorkflow(result.workflow)
      setPreviewUrl(result.previewUrl)
      window.sessionStorage.setItem(candidateStorageKey, candidate.id)
      await refreshHistory()
    } catch (cause) {
      setVerification({ state: 'failed-to-run', reason: cause instanceof Error ? cause.message : '隔离浏览器验证未能启动。' })
      setError(cause instanceof Error ? cause.message : '隔离浏览器验证未能启动')
    } finally { setVerificationBusy(false) }
  }

  async function restoreHistoryItem(candidateId: string) {
    setBusy(true); setError('')
    try {
      const restored = await post<{ analysis: Analysis; rawIntent: string; verificationContract?: BrowserVerificationContract; scope?: ScopeDecision; candidate: CandidateView; verification: VerificationView; workflow: WorkflowView }>('candidate/restore', { candidateId })
      setProjectPath(restored.analysis.projectRoot)
      setAnalysis(restored.analysis)
      setResourceDraft(restored.analysis.previewResources.authorizedUrls.join('\n'))
      setIntent(restored.rawIntent)
      setVerificationContractDraft(createVerificationContractDraft(restored.analysis.routes, restored.verificationContract))
      setCandidate(restored.candidate)
      setVerification(restored.verification)
      setWorkflow(restored.workflow)
      setOperations(restored.candidate.operations)
      setTargetId(restored.candidate.operations[0]?.targetRef ?? '')
      setAfter(restored.candidate.operations[0]?.after ?? '')
      setScopeStrategy(restored.scope?.strategy ?? 'shared')
      setLocalPageRef(restored.scope?.localPageRef ?? restored.analysis.routes[0]?.id ?? '')
      setPageScope(Object.fromEntries(restored.analysis.routes.map(route => {
        const scope = restored.scope
        return [route.id, scope?.protectedRefs.includes(route.id) ? 'protect' : scope?.excludedRefs.includes(route.id) ? 'exclude' : scope?.includedRefs.includes(route.id) ? 'include' : '']
      })))
      window.sessionStorage.setItem(candidateStorageKey, candidateId)
      setPreviewUrl(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法恢复候选历史') }
    finally { setBusy(false) }
  }

  async function approveCandidate() {
    if (!candidate || !verification.runId || verification.state !== 'passed') return
    setBusy(true); setError('')
    try {
      const result = await post<{ workflow: WorkflowView }>('candidate/approve', { candidateId: candidate.id, runId: verification.runId })
      setWorkflow(result.workflow)
      await refreshHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法审批候选') }
    finally { setBusy(false) }
  }

  async function applyCandidate() {
    if (!candidate || !workflow?.approval) return
    setBusy(true); setError('')
    try {
      const result = await post<{ workflow: WorkflowView; analysis: Analysis }>('candidate/apply', { candidateId: candidate.id })
      setWorkflow(result.workflow)
      setAnalysis(result.analysis)
      setPreviewUrl(undefined)
      setSelectionNonce('')
      await refreshHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法应用已审批补丁') }
    finally { setBusy(false) }
  }

  async function rollbackCandidate() {
    if (!candidate || !workflow?.rollbackAvailable) return
    setBusy(true); setError('')
    try {
      const result = await post<{ workflow: WorkflowView; analysis: Analysis }>('candidate/rollback', { candidateId: candidate.id })
      setWorkflow(result.workflow)
      setAnalysis(result.analysis)
      setPreviewUrl(undefined)
      setSelectionNonce('')
      await refreshHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法安全回滚补丁') }
    finally { setBusy(false) }
  }

  return <main className="workbench-shell">
    <header className="workbench-header">
      <a className="brand-mark" href="#top" aria-label="Ripple 项目工作台"><span className="brand-symbol">R</span><span>ripple<span className="brand-subtitle">PROJECT WORKBENCH</span></span></a>
      <div className="header-state"><i />本机项目模式 · 候选源码在容器预演，浏览器资源受限</div>
    </header>
    <section className="workbench-intro" id="top">
      <div><span className="eyebrow">SOURCE-AWARE EDITING</span><h1>从真实源码开始，<em>每一步都有边界。</em></h1><p>读取 React / Vite 工程，检查真实页面消费者，显式确认修改范围，再生成隔离候选补丁。</p></div>
      <div className="intro-stamp"><span>01</span><small>PROJECT<br />FIRST</small></div>
    </section>

    <section className="project-open panel">
      <div className="section-title"><span className="step-badge">01</span><div><h2>打开本机工程</h2><p>只读分析干净的 Git 工作树；候选文件与补丁保存在工程目录之外。</p></div></div>
      <div className="project-open-form"><label htmlFor="project-path">Git 项目目录</label><div className="project-path-row"><input id="project-path" data-testid="project-path" value={projectPath} onChange={event => setProjectPath(event.target.value)} placeholder="例如 D:\\projects\\ripple-qingye-bolt\\project" spellCheck={false} /><button data-testid="analyze-project" type="button" onClick={() => void analyze()} disabled={busy || sourcePreviewBusy || previewBusy || verificationBusy || !projectPath.trim()}>{busy && !analysis ? '正在读取…' : '分析工程'}<span>↗</span></button></div></div>
      {error && <p className="api-error" role="alert">{error}</p>}
    </section>

    {analysis && <>
      <section className="overview-grid">
        <article className="metric-card"><span>工程 HEAD</span><strong>{analysis.revision.gitCommit?.slice(0, 10) ?? '未知'}</strong><small>{analysis.projectRoot}</small></article>
        <article className="metric-card"><span>实际页面状态</span><strong>{analysis.routes.length}</strong><small>{analysis.routes.map(route => route.page ?? route.label).join(' · ') || '未解析到页面'}</small></article>
        <article className="metric-card"><span>源码编辑目标</span><strong>{analysis.targets.length}</strong><small>TEXT · MEDIA · TOKEN 统一进入 EditSession</small></article>
        <article className={analysis.unresolved.length ? 'metric-card metric-warning' : 'metric-card'}><span>分析确定性</span><strong>{analysis.unresolved.length ? `${analysis.unresolved.length} 项待确认` : '依赖完整'}</strong><small>{analysis.unresolved.length ? '模糊关系不会被当作已证明影响' : '来源与页面消费关系已读取'}</small></article>
      </section>

      <section className="panel project-source-preview" data-testid="project-source-preview">
        <div className="section-title compact"><span className="step-badge">↗</span><div><h2>先看真实页面，再选源码目标</h2><p>只读预演当前分析版本；页面点选后由 Ripple 服务端重新核实 JSX 来源。</p></div><button type="button" data-testid="toggle-project-preview" className="quiet-button" onClick={() => void toggleProjectSourcePreview()} disabled={busy || sourcePreviewBusy || previewBusy || verificationBusy || !!candidate}>{sourcePreviewBusy ? '准备只读预演…' : sourcePreview ? '关闭项目预演' : '启动真实页面预演'}</button></div>
        {sourcePreview && <CandidatePreviewPane url={sourcePreview.url} previewTestId="project-preview" viewportTestIdPrefix="project-preview" selectionTestId="toggle-project-element-selection" previewTitle="真实项目 · 只读预演" selectionNonce={selectionNonce} frameRef={sourcePreviewFrame} onFrameLoad={event => syncElementSelection(event, sourcePreview.previewId)} onToggleSelection={() => toggleElementSelection(sourcePreview.previewId, sourcePreviewFrame)} />}
        {selection && selectionKind === 'project' && <SourceSelectionDetails selection={selection} kind="project" onUseText={useSelectedSourceText} />}
        {!sourcePreview && <p className="empty-note">启动后可在四种项目视口中切换并点选页面元素。预演不会写入原项目，也不会运行其 npm scripts；资源仅加载你已明确授权的 URL。</p>}
      </section>

      <div className="workbench-columns">
        <section className="panel source-panel">
          <div className="section-title compact"><span className="step-badge">02</span><div><h2>工程关系</h2><p>来自当前项目 AST 与本地页面状态</p></div></div>
          <div className="route-list"><h3>页面状态</h3>{analysis.routes.map(route => <div className="route-row" key={route.id}><span className="route-dot" /> <strong>{route.label}</strong><code>{route.id}</code></div>)}</div>
          <div className="component-list"><h3>组件消费</h3>{analysis.components.filter(component => component.pages.length > 1).slice(0, 12).map(component => <div className="component-row" key={component.id}><span><strong>{component.label}</strong><small>{component.location?.path}</small></span><em>{component.pages.map(page => `/${page}`).join('  ')}</em></div>)}{!analysis.components.some(component => component.pages.length > 1) && <p className="empty-note">尚未证明有跨页面共享组件。</p>}</div>
          <div className="certainty-note"><span>●</span><p>仅 source-proven 消费关系参与范围校验；语义候选和未解析路径不会被标成确定。</p></div>
        </section>

        <section className="panel edit-panel" id="edit-panel" data-testid="edit-panel">
          <div className="section-title compact"><span className="step-badge">03</span><div><h2>意图与操作</h2><p>一条 EditSession 支持多项 TEXT / MEDIA / TOKEN 修改</p></div></div>
          <label className="field-label" htmlFor="intent">用自己的话描述这次修改</label><textarea id="intent" data-testid="intent-input" className="intent-field" aria-describedby="intent-help" value={intent} disabled={!!candidate} onChange={event => setIntent(event.target.value)} placeholder="例如：只改首页标题，品牌故事里的旧活动名称要保留。" /><small className="intent-help" id="intent-help">你的原话会随 EditSession 保存。确定的新文案请在下方“修改为”中输入；当前 TEXT 执行器不会自行改写意图或生成其他文案。</small>
          <div className="target-fields"><label><span className="field-label">要修改的内容</span><select data-testid="target-select" value={targetId} disabled={!!candidate} onChange={event => { const nextId = event.target.value; const nextTarget = analysis.targets.find(item => item.id === nextId); setTargetId(nextId); setAfter(scopeStrategy === 'page-override' ? nextTarget?.pageOverrides?.[localPageRef] ?? nextTarget?.value ?? '' : nextTarget?.value ?? '') }}><option value="">选择页面上的内容</option>{analysis.targets.map(item => <option key={item.id} value={item.id}>{operationKind(item.kind)} · {item.value ?? item.label}</option>)}</select></label><label><span className="field-label">修改为</span><input id="after-input" data-testid="after-input" aria-label="修改为" value={after} disabled={!!candidate} onChange={event => setAfter(event.target.value)} placeholder="输入想显示的新文字" /></label></div>
          {target && <div className="target-proof"><span className="proof-check">✓</span><div><strong className="target-current-value" title={target.value}>{target.value ?? target.label}</strong><small>{target.location?.path}#{target.location?.start} · {target.impact.pageRefs.length ? `已证明显示于 ${target.impact.pageRefs.map(ref => ref.replace('page:', '/')).join('、')}` : '没有可证明的页面消费者'}{target.impact.unresolved.length ? ` · 待确认 ${target.impact.unresolved.length} 项` : ''}</small></div><code>{target.impact.unresolved.length ? 'UNRESOLVED' : 'SOURCE-PROVEN'}</code></div>}
          <div className="operation-actions"><button type="button" data-testid="add-operation" className="add-operation" onClick={() => void addOperation()} disabled={busy || verificationBusy || !target || !after || target.value === after || !!target?.impact.unresolved.length}>＋ 加入本次修改</button>{scopeStrategy === 'page-override' && target?.pageOverrides?.[localPageRef] !== undefined && <button type="button" data-testid="remove-page-override" className="quiet-button" onClick={() => void removePageOverride()} disabled={busy || verificationBusy || !!candidate || !!target?.impact.unresolved.length}>移除此页覆盖，继承共享值</button>}</div>
          {operations.length > 0 && <div className="operation-list"><h3>本次 EditSession <span>{operations.length} 项</span></h3>{operations.map(operation => <article className="operation-row" key={operation.id}><span className="op-kind">{operation.kind}</span><div><code>{analysis.targets.find(item => item.id === operation.targetRef)?.location?.path}</code>{operation.overrideAction === 'remove' ? <p><del>当前页面覆盖</del><b>→</b><strong>继承共享值</strong></p> : <p><del>{operation.before}</del><b>→</b><strong>{operation.after}</strong></p>}</div><button type="button" aria-label="移除此操作" disabled={busy || previewBusy || verificationBusy} onClick={() => void invalidateCandidate().then(ok => { if (ok) setOperations(current => current.filter(item => item.id !== operation.id)) })}>×</button></article>)}</div>}
        </section>
      </div>

      <section className="panel resource-policy-panel" data-testid="preview-resource-policy">
        <div className="section-title compact"><span className="step-badge">↗</span><div><h2>预演外部静态资源授权</h2><p>源码 URL 仅作为建议；每项授权都由你明确保存，且只允许对应 HTTPS 路径。</p></div></div>
        <div className="resource-policy-columns"><div><strong>源码引用（未授权）</strong>{analysis.previewResources.referencedUrls.length ? <ul>{analysis.previewResources.referencedUrls.map(url => <li key={url}><code>{url}</code><button type="button" className="quiet-button" data-testid="add-preview-resource" onClick={() => addResourceToDraft(url)} disabled={busy || sourcePreviewBusy || !!candidate}>加入授权草稿</button></li>)}</ul> : <small>没有发现 HTTPS 静态资源引用。</small>}</div><label><strong>明确授权的 URL</strong><textarea data-testid="preview-resource-draft" value={resourceDraft} onChange={event => setResourceDraft(event.target.value)} disabled={busy || sourcePreviewBusy || !!candidate} placeholder="每行一条 HTTPS 图片、字体或样式表 URL" spellCheck={false} /><small>每条必须是具体文件路径（不接受根目录/目录授权）；CSP 路径匹配不包含 query。源码或注释里的 URL 不会自动授权。</small><button type="button" data-testid="save-preview-resources" className="quiet-button" onClick={() => void savePreviewResources()} disabled={busy || sourcePreviewBusy || !!candidate}>保存资源授权</button></label></div>
      </section>

      <section className="panel scope-panel">
        <div className="section-title compact"><span className="step-badge">04</span><div><h2>明确 Scope</h2><p>每个实际页面都要明确选择包含、排除或保护；共享来源的传播会在执行器内复核。</p></div></div>
        <fieldset className="scope-suggestions" disabled={busy || previewBusy || verificationBusy || !operations.length || !scopeSuggestions} data-testid="scope-suggestions">
          <legend>从已证明的消费者快速填写建议</legend>
          <button type="button" data-testid="scope-preset-shared" onClick={() => void chooseScopePreset('shared')}>共享修改 · 包含所有已证明消费者</button>
          <button type="button" data-testid="scope-preset-page" disabled={!scopeSuggestions?.localPageRefs.length} onClick={() => void chooseScopePreset('page-override')}>单页覆盖 · 只包含一个共同消费者</button>
          <small>{!scopeSuggestions ? '当前操作缺少完整、已证明的页面消费关系；不会自动猜测范围。' : scopeSuggestions.localPageRefs.length ? '建议会明确填写每个页面的包含/排除值；你仍可逐页修改。下方只是计划预览，不是浏览器 Evidence。' : operations.some(operation => operation.kind !== 'TEXT') ? '当前执行器仅支持 JSX 文本单页覆盖；其他操作仍可使用共享范围建议。' : '本次操作没有共同的已证明消费者，不能建议单页覆盖。'}</small>
        </fieldset>
        <fieldset className="scope-strategy" disabled={busy || previewBusy || verificationBusy || !operations.length}>
          <legend>共享源码冲突时的处理方式</legend>
          <label><input type="radio" name="scope-strategy" value="shared" checked={scopeStrategy === 'shared'} onChange={() => void invalidateCandidate().then(ok => { if (ok) { setScopeStrategy('shared'); setAfter(target?.value ?? '') } })} /> 修改共享来源，并纳入全部受影响页面</label>
          <label><input type="radio" name="scope-strategy" value="page-override" checked={scopeStrategy === 'page-override'} onChange={() => void invalidateCandidate().then(ok => { if (ok) { setScopeStrategy('page-override'); setAfter(target?.pageOverrides?.[localPageRef] ?? target?.value ?? '') } })} /> 仅在一个页面创建可维护覆盖，不改共享值</label>
          {scopeStrategy === 'page-override' && <label className="local-page-choice">覆盖页面<select aria-label="选择局部覆盖页面" value={localPageRef} onChange={event => void invalidateCandidate().then(ok => { if (ok) { const pageRef = event.target.value; setLocalPageRef(pageRef); setAfter(target?.pageOverrides?.[pageRef] ?? target?.value ?? '') } })}>{analysis.routes.map(route => <option key={route.id} value={route.id}>{route.label}</option>)}</select><small>当前执行器支持 JSX 文本；MEDIA、TOKEN 和运行时单实例覆盖仍未接入。</small></label>}
        </fieldset>
        {analysis.routes.length === 0 ? <p className="empty-note">尚未解析出路由，当前不能生成页面范围候选。</p> : <div className="scope-grid">{analysis.routes.map(route => <label className={`scope-route ${pageScope[route.id] ? `scope-${pageScope[route.id]}` : ''}`} key={route.id}><span className="scope-route-head"><strong>{route.label}</strong><code>{route.id}</code></span><select data-testid={`scope-${route.id}`} aria-label={`${route.label} 页面范围`} value={pageScope[route.id] ?? ''} disabled={busy || previewBusy || verificationBusy} onChange={event => { const value = event.target.value as PageScope; void invalidateCandidate().then(ok => { if (ok) setPageScope(current => ({ ...current, [route.id]: value })) }) }}><option value="">请选择范围</option><option value="include">包含在候选中</option><option value="exclude">明确排除</option><option value="protect">保护，不得修改</option></select>{impactedPages.includes(route.id) && <small>目标源码的已证明消费者</small>}</label>)}</div>}
        <ScopeEffectPreview rows={scopeEffectRows} />
        <VerificationContractEditor routes={analysis.routes} value={verificationContractDraft} disabled={busy || previewBusy || verificationBusy || !!candidate} onChange={setVerificationContractDraft} />
        {incompleteVerificationDeclarations(verificationContractDraft) > 0 && <p className="verification-contract-note" role="status">有 {incompleteVerificationDeclarations(verificationContractDraft)} 项验收信息尚未填写完整；不完整项不会送入执行器，相关断言将保持 UNKNOWN。</p>}
        <div className="scope-footer"><span>{operations.length} 项操作 · {impactedPages.length} 个已证明页面消费者{scopeStrategy === 'page-override' ? ' · 一项页面覆盖' : ''}</span><button type="button" data-testid="create-real-candidate" onClick={() => void createCandidate()} disabled={busy || sourcePreviewBusy || previewBusy || verificationBusy || !analysis || !intent.trim() || !operations.length || !scopesComplete || !scopesValid}>{busy ? '正在创建隔离候选…' : '创建真实隔离候选'}<span>↗</span></button></div>
      </section>

      {candidate && <section className="panel candidate-panel">
        <div className="candidate-head"><div><span className="eyebrow">ISOLATED CANDIDATE</span><h2>候选补丁已生成</h2><p>真实 Git worktree 中产生的源码差异；预演只运行隔离副本，不写入原工程。</p></div>{workflow?.lifecycle === 'active' && <button type="button" data-testid="discard-candidate" className="quiet-button" onClick={() => void discardCandidate()} disabled={busy || previewBusy || verificationBusy}>清理候选</button>}</div>
        <div className="hash-grid"><div><span>候选 ID</span><code data-testid="candidate-id">{candidate.id}</code></div><div><span>Patch SHA-256</span><code>{candidate.patchHash}</code></div><div><span>候选树摘要</span><code>{candidate.candidateTreeDigest}</code></div></div>
        <div className="candidate-files"><span>修改文件</span>{candidate.modifiedPaths.map(file => <code key={file}>{file}</code>)}</div>
        <pre className="diff-view" data-testid="candidate-diff" aria-label="真实候选补丁差异">{candidate.diff}</pre>
        <div className="preview-toolbar"><div><strong>隔离浏览器预演</strong><small>候选运行于 Docker internal network；iframe 的外部资源默认受限，外链与表单导航会拦截。它不是用于对抗刻意恶意脚本的浏览器沙箱，请只预演可信项目。</small></div><div className="preview-actions"><button type="button" data-testid="verify-candidate" className="quiet-button" onClick={() => void verifyCandidate()} disabled={busy || workflow?.lifecycle !== 'active' || previewBusy || verificationBusy}>{verificationBusy ? '浏览器验证中…' : `运行 ${projectPreviewViewports.length} 个视口验证`}</button><button type="button" data-testid="toggle-candidate-preview" className="quiet-button" onClick={() => void togglePreview()} disabled={busy || workflow?.lifecycle !== 'active' || previewBusy || verificationBusy}>{previewBusy ? '启动中…' : previewUrl ? '关闭预演' : '启动真实预演'}</button></div></div>
        {previewUrl && candidate && <CandidatePreviewPane url={previewUrl} previewTestId="candidate-preview" viewportTestIdPrefix="preview" selectionTestId="toggle-element-selection" previewTitle="隔离候选 · 真实预演" selectionNonce={selectionNonce} frameRef={previewFrame} onFrameLoad={event => syncElementSelection(event, candidate.id)} onToggleSelection={() => toggleElementSelection(candidate.id, previewFrame)} />}
        {selection && selectionKind === 'candidate' && <SourceSelectionDetails selection={selection} kind="candidate" />}
        <div className={`verification-state verification-${verification.state}`} data-testid="verification-state"><span>{verificationLabel(verification.state)}</span><p>{verification.reason ?? (verification.state === 'passed' ? '本次必需检查和断言均通过。候选审批严格绑定此验证运行与补丁哈希。' : verification.state === 'risks' ? '浏览器观察到明确风险；此候选不可批准。' : verification.state === 'incomplete' ? '浏览器执行已留存，但有断言未知或未运行；此候选不可批准。' : verification.state === 'stale' ? '证据对应的候选或源码已过期。' : '预演不等于验证；请运行受限浏览器检查。')}</p><button type="button" data-testid="run-verification" onClick={() => void verifyCandidate()} disabled={busy || workflow?.lifecycle !== 'active' || previewBusy || verificationBusy}>{verificationBusy ? '执行中…' : verification.state === 'not-run' || verification.state === 'failed-to-run' ? '运行验证' : '重新验证'}</button></div>
        {verification.assertions && <div className="verification-assertions" data-testid="verification-assertions">{verification.assertions.map(assertion => <div key={assertion.id}><span>{assertion.result.toUpperCase()}</span><strong>{assertion.id}</strong><p>{assertion.detail}</p></div>)}</div>}
        {verification.evidence?.length ? <div className="verification-evidence" data-testid="verification-evidence">{verification.evidence.map(evidence => <article key={evidence.id}><div><strong>{evidence.viewport.width} × {evidence.viewport.height}</strong><span>{evidence.result.toUpperCase()} · {evidence.runtimeState}</span></div>{evidence.artifactUrl ? <img src={evidence.artifactUrl} alt={`候选浏览器截图 ${evidence.viewport.width}×${evidence.viewport.height}`} /> : <p>{evidence.reason ?? '本次没有生成可验证截图。'}</p>}</article>)}</div> : null}
        {verification.recordUrl && <p className="verification-record">受信任执行记录 <a href={verification.recordUrl} target="_blank" rel="noreferrer">JSON · SHA-256 {verification.recordHash?.slice(0, 16)}</a></p>}
        <div className="workflow-actions" data-testid="candidate-workflow"><div><span>生命周期</span><strong>{workflow?.lifecycle ?? 'unknown'}</strong>{workflow?.approval && <small>已批准 · run {workflow.approval.verificationRunId.slice(0, 18)}</small>}{workflow?.applied && <small>已应用 · {workflow.applied.appliedAt}</small>}{workflow?.rollback && <small>已回滚 · {workflow.rollback.rolledBackAt}</small>}</div><div className="workflow-buttons"><button type="button" data-testid="approve-candidate" onClick={() => void approveCandidate()} disabled={busy || workflow?.lifecycle !== 'active' || verification.state !== 'passed' || !verification.runId || !!workflow?.approval}>批准此补丁</button><button type="button" data-testid="apply-candidate" onClick={() => void applyCandidate()} disabled={busy || workflow?.lifecycle !== 'active' || !workflow.approval}>应用同一补丁</button><button type="button" data-testid="rollback-candidate" onClick={() => void rollbackCandidate()} disabled={busy || workflow?.lifecycle !== 'applied' || !workflow.rollbackAvailable}>安全回滚</button></div>{workflow?.lifecycle === 'applied' && !workflow.rollbackAvailable && <small className="workflow-warning">应用后工程已有变化，系统拒绝覆盖并回滚。</small>}</div>
      </section>}
    </>}
    {history.length > 0 && <section className="panel history-panel" data-testid="candidate-history"><div className="section-title compact"><span className="step-badge">↺</span><div><h2>候选与版本历史</h2><p>从本机持久记录恢复原补丁与验证证据；这里不会重新生成修改。</p></div></div><div className="history-list">{history.map(item => <article key={item.candidateId}><div><strong>{item.lifecycle}</strong><code>{item.candidateId}</code><small>Patch {item.patchHash.slice(0, 16)} · 验证 {verificationLabel(item.verification.state)}</small>{item.applied && <small>应用于 {item.applied.appliedAt}</small>}{item.rollback && <small>回滚于 {item.rollback.rolledBackAt}</small>}</div><button type="button" className="quiet-button" onClick={() => void restoreHistoryItem(item.candidateId)} disabled={busy || item.lifecycle === 'discarded' || item.lifecycle === 'stale'}>{item.lifecycle === 'discarded' || item.lifecycle === 'stale' ? '仅审计留存' : '恢复记录'}</button></article>)}</div></section>}
    <footer className="workbench-footer"><span>RIPPLE / PROJECT-FIRST CORE</span><span>candidate workspace is isolated · original checkout stays untouched</span></footer>
  </main>
}

