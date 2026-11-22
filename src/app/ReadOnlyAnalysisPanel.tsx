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

const errors = {
  'project-unregistered': '当前项目尚未在服务端登记。',
  'host-config-unavailable': '宿主配置不可用。',
  'host-receipt-unavailable': '宿主回执不可用。',
  'host-receipt-rejected': '宿主回执验签未通过。',
  'project-drift': '工作树与已登记源码不一致。请重新打开工程后再试。',
  'producer-evidence-unavailable': '无法复验 Analyzer 构建和产出的来源证据。',
  'analysis-failed': '服务端分析失败。',
  'invalid-request': '服务端拒绝了分析请求。',
  'method-not-allowed': '服务端不支持此分析请求。',
}

type State =
  | { status: 'idle' | 'pending' }
  | { status: 'failed'; message: string; code?: string }
  | { status: 'ready'; summary: AnalysisSummary }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function readSummary(body: unknown, projectId: string, sourceDigest: string): AnalysisSummary | undefined {
  if (!isRecord(body) || body.projectId !== projectId || body.sourceDigest !== sourceDigest ||
      !isDigest(body.sourceDigest) || !isDigest(body.graphDigest) ||
      !isCount(body.mappingCount) || !isCount(body.unresolvedCount) ||
      body.hostReceiptStatus !== 'verified' || body.producerEvidenceStatus !== 'available-producer-evidence') return
  return {
    projectId, sourceDigest, graphDigest: body.graphDigest, mappingCount: body.mappingCount,
    unresolvedCount: body.unresolvedCount, hostReceiptStatus: body.hostReceiptStatus,
    producerEvidenceStatus: body.producerEvidenceStatus,
  }
}

export function ReadOnlyAnalysisPanel({ projectId, sourceDigest, opening }: {
  projectId: string; sourceDigest: string; opening: boolean
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const active = useRef<AbortController | null>(null)
  const title = useId()
  useEffect(() => () => { active.current?.abort() }, [])

  async function run() {
    if (active.current || opening) return
    const request = new AbortController()
    active.current = request
    setState({ status: 'pending' })
    try {
      const response = await fetch('/__ripple/api/project/read-only-analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
        signal: request.signal,
      })
      const body: unknown = await response.json().catch(() => undefined)
      if (request.signal.aborted) return
      if (!response.ok) {
        const code = isRecord(body) ? body.code : undefined
        if (typeof code === 'string' && Object.hasOwn(errors, code)) {
          setState({ status: 'failed', code, message: errors[code as keyof typeof errors] })
        } else {
          setState({ status: 'failed', message: `读取分析结果失败（HTTP ${response.status}）。` })
        }
        return
      }
      const summary = readSummary(body, projectId, sourceDigest)
      setState(summary ? { status: 'ready', summary } : {
        status: 'failed', message: '返回结果与当前工程版本不一致，或摘要字段无效。请重新打开工程后再试。',
      })
    } catch {
      if (!request.signal.aborted) setState({ status: 'failed', message: '无法连接只读分析服务。' })
    } finally {
      if (active.current === request) active.current = null
    }
  }

  const summary = state.status === 'ready' ? state.summary : undefined
  return <section className="panel read-only-analysis" aria-labelledby={title} data-testid="read-only-analysis-panel">
    <div className="read-only-analysis-header section-title">
      <div><h2 id={title}>项目来源与摘要</h2><p>核对当前打开工程的源码与分析证据。</p></div>
      <button type="button" className="quiet-button" disabled={opening || state.status === 'pending'} onClick={() => void run()}>
        {state.status === 'pending' ? '正在运行…' : '运行只读分析'}
      </button>
    </div>
    <div role="status">
      {state.status === 'pending' && <p className="empty-note">正在核对当前工程并复验分析结果…</p>}
      {summary && <span className="read-only-analysis-announcement">只读分析完成。</span>}
    </div>
    {state.status === 'failed' && <p className="api-error read-only-analysis-error" role="alert">
      {state.message}{state.code && <> <code>{state.code}</code></>}
    </p>}
    {summary && <div className="read-only-analysis-results">
      <section className="read-only-analysis-group">
        <h3>内容摘要 <code>content-only</code></h3>
        <dl className="read-only-analysis-content">
          <div className="read-only-analysis-full"><dt>项目 ID</dt><dd><code>{summary.projectId}</code></dd></div>
          <div className="read-only-analysis-full"><dt>SourceDigest</dt><dd><code>{summary.sourceDigest}</code></dd></div>
          <div className="read-only-analysis-full"><dt>GraphDigest</dt><dd><code>{summary.graphDigest}</code></dd></div>
          <div><dt>Mapping 数量</dt><dd>{summary.mappingCount}</dd></div>
          <div><dt>unresolved 数量</dt><dd>{summary.unresolvedCount}</dd></div>
        </dl>
      </section>
      <section className="read-only-analysis-group">
        <h3>来源证明</h3>
        <dl>
          <div><dt>Host Receipt</dt><dd>验签通过 <code>{summary.hostReceiptStatus}</code></dd></div>
          <div><dt>Producer Evidence</dt><dd>复验通过 <code>{summary.producerEvidenceStatus}</code></dd></div>
        </dl>
        <p className="empty-note">结果仅用于查阅，不参与编辑、审批或应用。</p>
      </section>
    </div>}
  </section>
}
