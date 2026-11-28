import { useEffect, useId, useRef, useState } from 'react'

interface AnalysisSummary {
  projectId: string
  sourceDigest: string
  graphDigest: string
  mappingCount: number
  unresolvedCount: number
  hostReceiptStatus: 'verified'
  producerEvidenceStatus: 'available-producer-evidence'
}
interface HistoryRecord {
  schemaVersion: 'ripple/read-only-analysis-history/v1'
  recordId: string
  capturedAt: string
  projectId: string
  repository: string
  gitHead: string
  rootTree: string
  sourceDigest: string
  graphDigest: string
  mappingCount: number
  unresolvedCount: number
  hostReceiptStatus: 'verified'
  producerEvidenceStatus: 'available-producer-evidence'
}
const errors: Record<string,string> = {
  'project-unregistered': '当前项目尚未在服务端登记。',
  'host-config-unavailable': '宿主配置不可用。',
  'host-receipt-unavailable': '宿主回执不可用。',
  'host-receipt-rejected': '宿主回执验签未通过。',
  'project-drift': '工作树与已登记源码不一致。请重新打开工程后再试。',
  'producer-evidence-unavailable': '无法复验 Analyzer 构建和产出的来源证据。',
  'analysis-failed': '服务端分析失败。',
  'history-storage-unavailable': '历史存储暂时不可用。',
  'history-storage-limit': '历史存储已达到容量限制。',
  'history-record-corrupt': '历史记录损坏，无法读取。',
}
type State =
  | { status: 'idle' | 'pending' }
  | { status: 'failed'; message: string; code?: string }
  | { status: 'ready'; summary: AnalysisSummary }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function readSummary(body: unknown, projectId: string, sourceDigest: string): AnalysisSummary | undefined {
  if (!isRecord(body) || body.projectId !== projectId || body.sourceDigest !== sourceDigest ||
      !isDigest(body.sourceDigest) || !isDigest(body.graphDigest) || !isCount(body.mappingCount) ||
      !isCount(body.unresolvedCount) || body.hostReceiptStatus !== 'verified' ||
      body.producerEvidenceStatus !== 'available-producer-evidence') return
  return { projectId, sourceDigest, graphDigest: body.graphDigest, mappingCount: body.mappingCount,
    unresolvedCount: body.unresolvedCount, hostReceiptStatus: body.hostReceiptStatus,
    producerEvidenceStatus: body.producerEvidenceStatus }
}
function readHistory(body: unknown, projectId: string): HistoryRecord[] {
  if (!isRecord(body) || body.schemaVersion !== 'ripple/read-only-analysis-history/v1' ||
      body.projectId !== projectId || !Array.isArray(body.records)) return []
  return body.records.filter((item): item is HistoryRecord => isRecord(item) &&
    item.schemaVersion === 'ripple/read-only-analysis-history/v1' && typeof item.recordId === 'string' &&
    item.projectId === projectId && typeof item.repository === 'string' && typeof item.gitHead === 'string' &&
    typeof item.rootTree === 'string' && isDigest(item.sourceDigest) && isDigest(item.graphDigest) &&
    isCount(item.mappingCount) && isCount(item.unresolvedCount) &&
    item.hostReceiptStatus === 'verified' && item.producerEvidenceStatus === 'available-producer-evidence')
}
function readableDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
function CopyHash({ label, value }: { label: string; value: string }) {
  return <button type="button" className="quiet-button read-only-analysis-copy" aria-label={`复制${label}`} onClick={event => {
    event.preventDefault()
    void navigator.clipboard?.writeText(value)
  }}>复制</button>
}
export function ReadOnlyAnalysisPanel({ projectId, sourceDigest, opening }: {
  projectId: string; sourceDigest: string; opening: boolean
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'saved'>('idle')
  const [selected, setSelected] = useState<string[]>([])
  const active = useRef<AbortController | null>(null)
  const historyRequest = useRef<AbortController | null>(null)
  const historyGeneration = useRef(0)
  const title = useId()
  async function loadHistory(signal?: AbortSignal, expectedGeneration = historyGeneration.current) {
    try {
      const response = await fetch('/__ripple/api/project/read-only-history?projectId=' + encodeURIComponent(projectId) + '&limit=100', { signal })
      const body: unknown = await response.json().catch(() => undefined)
      if (signal?.aborted || expectedGeneration !== historyGeneration.current) return
      if (!response.ok) {
        const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
        throw new Error(errors[code] || '历史读取失败（HTTP ' + response.status + '）。')
      }
      setHistory(readHistory(body, projectId))
      setHistoryError('')
    } catch (error) {
      if (signal?.aborted) return
      setHistoryError(error instanceof Error ? error.message : '历史读取失败。')
    }
  }
  useEffect(() => {
    historyGeneration.current += 1
    historyRequest.current?.abort()
    const request = new AbortController()
    historyRequest.current = request
    setState({ status: 'idle' })
    setSelected([])
    setHistory([])
    setHistoryError('')
    setCaptureStatus('idle')
    void loadHistory(request.signal, historyGeneration.current)
    return () => {
      active.current?.abort()
      request.abort()
      if (historyRequest.current === request) historyRequest.current = null
    }
  }, [projectId, sourceDigest])
  async function run() {
    if (active.current || opening) return
    const request = new AbortController()
    active.current = request
    setState({ status: 'pending' })
    try {
      const response = await fetch('/__ripple/api/project/read-only-analysis', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }), signal: request.signal,
      })
      const body: unknown = await response.json().catch(() => undefined)
      if (request.signal.aborted) return
      if (!response.ok) {
        const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
        setState({ status: 'failed', code, message: errors[code] || '读取分析结果失败（HTTP ' + response.status + '）。' })
        return
      }
      const summary = readSummary(body, projectId, sourceDigest)
      setState(summary ? { status: 'ready', summary } : { status: 'failed', message: '返回结果与当前工程版本不一致，或摘要字段无效。请重新打开工程后再试。' })
    } catch (error) {
      if (!request.signal.aborted) setState({ status: 'failed', message: error instanceof Error ? error.message : '无法连接只读分析服务。' })
    } finally {
      if (active.current === request) active.current = null
    }
  }
  async function captureHistory() {
    if (!summary) return
    setHistoryBusy(true); setHistoryError(''); setCaptureStatus('idle')
    try {
      const response = await fetch('/__ripple/api/project/read-only-history/capture', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }),
      })
      const body: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
        throw new Error(errors[code] || '历史保存失败（HTTP ' + response.status + '）。')
      }
      setCaptureStatus('saved')
      await loadHistory()
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '历史保存失败。')
    } finally { setHistoryBusy(false) }
  }
  const summary = state.status === 'ready' ? state.summary : undefined
  const compared = selected.length === 2 ? selected.map(id => history.find(item => item.recordId === id)).filter((item): item is HistoryRecord => Boolean(item)) : []
  const delta = compared.length === 2 ? {
    head: compared[0].gitHead === compared[1].gitHead ? '相同' : '已变化',
    tree: compared[0].rootTree === compared[1].rootTree ? '相同' : '已变化',
    source: compared[0].sourceDigest === compared[1].sourceDigest ? '相同' : '已变化',
    graph: compared[0].graphDigest === compared[1].graphDigest ? '相同' : '已变化',
    mapping: compared[1].mappingCount - compared[0].mappingCount,
    unresolved: compared[1].unresolvedCount - compared[0].unresolvedCount,
    host: compared[0].hostReceiptStatus === compared[1].hostReceiptStatus ? compared[0].hostReceiptStatus : '已变化',
    producer: compared[0].producerEvidenceStatus === compared[1].producerEvidenceStatus ? compared[0].producerEvidenceStatus : '已变化',
  } : undefined
  function toggleHistory(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : current.length === 2 ? [current[1], id] : [...current, id])
  }
  return <section className="panel read-only-analysis" aria-labelledby={title} data-testid="read-only-analysis-panel">
    <div className="read-only-analysis-header section-title">
      <div><h2 id={title}>项目来源与摘要</h2><p>核对当前打开工程的源码与分析证据。</p></div>
      <div className="read-only-analysis-actions">
        <button type="button" className="quiet-button" disabled={opening || state.status === 'pending'} onClick={() => void run()}>
          {state.status === 'pending' ? '正在运行…' : '运行只读分析'}
        </button>
        <button type="button" className="quiet-button" disabled={opening || historyBusy || !summary} onClick={() => void captureHistory()}>
          {historyBusy ? '正在保存…' : '保存分析记录'}
        </button>
      </div>
    </div>
    <div role="status">
      {state.status === 'pending' && <p className="empty-note">正在核对当前工程并复验分析结果…</p>}
      {summary && <span className="read-only-analysis-announcement">只读分析完成。</span>}
    </div>
    {state.status === 'failed' && <p className="api-error read-only-analysis-error" role="alert">{state.message}{state.code && <> <code>{state.code}</code></>}</p>}
    {historyError && <div className="read-only-analysis-error-row"><p className="api-error read-only-analysis-error" role="alert" data-testid="read-only-history-error">{historyError}</p><button type="button" className="quiet-button" onClick={() => void loadHistory()} disabled={historyBusy}>重试</button></div>}
    {captureStatus === 'saved' && <p className="read-only-analysis-saved" role="status" data-testid="read-only-history-saved">分析记录已保存。</p>}
    {summary && <div className="read-only-analysis-results">
      <section className="read-only-analysis-group"><h3>内容摘要 <code>content-only</code></h3><dl className="read-only-analysis-content">
        <div className="read-only-analysis-full"><dt>项目 ID</dt><dd><code>{summary.projectId}</code></dd></div>
        <div className="read-only-analysis-full"><dt>SourceDigest</dt><dd><code>{summary.sourceDigest}</code></dd></div>
        <div className="read-only-analysis-full"><dt>GraphDigest</dt><dd><code>{summary.graphDigest}</code></dd></div>
        <div><dt>Mapping 数量</dt><dd>{summary.mappingCount}</dd></div><div><dt>unresolved 数量</dt><dd>{summary.unresolvedCount}</dd></div>
      </dl></section>
      <section className="read-only-analysis-group"><h3>来源证明</h3><dl>
        <div><dt>Host Receipt</dt><dd>验签通过 <code>{summary.hostReceiptStatus}</code></dd></div>
        <div><dt>Producer Evidence</dt><dd>复验通过 <code>{summary.producerEvidenceStatus}</code></dd></div>
      </dl><p className="empty-note">结果仅用于查阅，不参与编辑、审批或应用。</p></section>
    </div>}
    <section className="read-only-analysis-history" data-testid="read-only-analysis-history">
      <div className="read-only-analysis-history-heading"><div><h3>分析历史</h3><p>历史记录描述保存时版本。</p></div><button type="button" className="quiet-button" onClick={() => void loadHistory()} disabled={historyBusy}>刷新历史</button></div>
      {history.length === 0 && <p className="empty-note">暂无保存记录。</p>}
      {history.length > 0 && <div className="read-only-analysis-history-list">{history.map((record, index) => <label key={record.recordId} className="read-only-analysis-history-item">
        <input type="checkbox" aria-label={`选择历史版本 ${index === 0 ? 'A' : 'B'} ${record.gitHead.slice(0, 10)}`} checked={selected.includes(record.recordId)} onChange={() => toggleHistory(record.recordId)} />
        <span><strong>{selected[0] === record.recordId ? '版本 A · ' : selected[1] === record.recordId ? '版本 B · ' : ''}{readableDate(record.capturedAt)}</strong><small>{record.repository} · HEAD {record.gitHead.slice(0, 10)} · Mapping {record.mappingCount} · unresolved {record.unresolvedCount}</small><small>Host Receipt：{record.hostReceiptStatus} · Producer Evidence：{record.producerEvidenceStatus}</small><code>{record.recordId}</code><details><summary>展开版本身份</summary><small>Git HEAD：{record.gitHead} <CopyHash label="Git HEAD" value={record.gitHead} /></small><small>Root Tree：{record.rootTree} <CopyHash label="Root Tree" value={record.rootTree} /></small><small>SourceDigest：{record.sourceDigest} <CopyHash label="SourceDigest" value={record.sourceDigest} /></small><small>GraphDigest：{record.graphDigest} <CopyHash label="GraphDigest" value={record.graphDigest} /></small><small>recordId：{record.recordId} <CopyHash label="recordId" value={record.recordId} /></small></details></span>
      </label>)}</div>}
      {delta && <div className="read-only-analysis-comparison" data-testid="read-only-analysis-comparison"><strong>版本比较（只读）</strong><span>版本 A：{readableDate(compared[0].capturedAt)} · 版本 B：{readableDate(compared[1].capturedAt)}</span><span>Git HEAD：{delta.head} · Root Tree：{delta.tree}</span><span>SourceDigest：{delta.source} · GraphDigest：{delta.graph}</span><span>Mapping 变化：{delta.mapping > 0 ? '+' : ''}{delta.mapping} · unresolved 变化：{delta.unresolved > 0 ? '+' : ''}{delta.unresolved}</span><span>Host Receipt：{delta.host} · Producer Evidence：{delta.producer}</span><small>差异仅表示历史身份或分析结果不同，不推断页面影响、来源证明、Verification PASS 或任何编辑授权。</small></div>}
    </section>
  </section>
}
