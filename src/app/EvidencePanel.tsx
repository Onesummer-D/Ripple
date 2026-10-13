import { useEffect, useRef, useState } from 'react'
import type { Evidence } from '../domain/contracts'
import { evidencePresentation } from './selectors'
import { evidenceAssetHref } from '../preview/evidenceAssets'

function EvidenceDetails({ item, onFocus }: { item: Evidence; onFocus: (item: Evidence) => void }) {
  const presentation = evidencePresentation(item)
  const waiting = presentation.unknown || item.verification === 'loading'
  const sourceHref = waiting ? undefined : evidenceAssetHref(item.sourcePath)
  const screenshotHref = waiting ? undefined : evidenceAssetHref(item.screenshotPath)
  const inline = !waiting && item.measurement ? JSON.stringify(item, null, 2) : undefined
  const [source, setSource] = useState<{ content?: string; state: 'loading' | 'available' | 'unavailable' }>({ state: inline ? 'available' : sourceHref ? 'loading' : 'unavailable', content: inline })
  const [screenshotFailed, setScreenshotFailed] = useState(false)
  useEffect(() => {
    if (!sourceHref) return
    const controller = new AbortController()
    fetch(sourceHref, { signal: controller.signal }).then(async (response) => {
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || (!type.includes('json') && !type.includes('text/plain'))) throw new Error('Source unavailable')
      const content = await response.text()
      if (!controller.signal.aborted) setSource({ content, state: 'available' })
    }).catch(() => { if (!controller.signal.aborted) setSource({ state: 'unavailable' }) })
    return () => controller.abort()
  }, [sourceHref])
  return <div className="evidence-details" data-testid="evidence-details">
    <span className="evidence-state">{presentation.label}</span><h3>{item.summary}</h3>
    <dl><dt>Evidence ID</dt><dd>{item.id}</dd><dt>案例 / 路由</dt><dd>{item.caseId} / {item.route}</dd><dt>视口</dt><dd>{item.viewport}</dd><dt>来源</dt><dd>{item.producer === 'A-preview' ? 'A 自有页面浏览器实测' : item.origin === 'fixture' ? 'Fixture 示例' : item.origin === 'real' ? '真实数据包' : '来源未标注'}</dd><dt>文件路径</dt><dd>{item.sourcePath}</dd></dl>
    <button type="button" className="primary-button" onClick={() => onFocus(item)} data-testid="focus-evidence-route">聚焦证据页面</button>
    {waiting && <p className="evidence-unavailable" role="status">{item.verification === 'loading' ? '该证据仍在加载，检测结果尚未就绪。' : '证据尚未验证，暂未提供可用检测文件。'}</p>}
    {source.state === 'loading' && <p role="status">正在读取证据文件…</p>}
    {source.state === 'available' ? <>{sourceHref && <a href={sourceHref} target="_blank" rel="noreferrer" className="evidence-link">打开证据文件</a>}{inline && <a className="evidence-link" download={`${item.id}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(inline)}`}>下载此版本测量 JSON</a>}<pre className="evidence-source">{source.content}</pre></> : !waiting && source.state === 'unavailable' && <p className="evidence-unavailable" role="status">证据文件尚未放入可访问的资源目录。</p>}
    {screenshotHref && !screenshotFailed && <a href={screenshotHref} target="_blank" rel="noreferrer" className="evidence-screenshot-link"><img className="evidence-screenshot" src={screenshotHref} alt={`${item.id} 预演截图`} onError={() => setScreenshotFailed(true)} /></a>}
    {screenshotFailed && <p className="evidence-unavailable" role="status">截图文件不可用。</p>}
    {!screenshotHref && <p className="input-help">此条记录没有可用预演截图。</p>}
  </div>
}

export function EvidencePanel({ evidence, onFocus }: { evidence: Evidence[]; onFocus: (item: Evidence) => void }) {
  const [selected, setSelected] = useState<Evidence>()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal() }, [selected])
  return <div className="evidence-list" data-testid="evidence-panel"><span className="field-label">EVIDENCE</span>
    {evidence.map((item) => { const presentation = evidencePresentation(item); return <button type="button" className="evidence-row evidence-open" key={item.id} onClick={() => setSelected(item)} data-testid={`evidence-${item.id}`}><span className={presentation.unknown ? 'evidence-state unknown' : item.origin === 'fixture' ? 'evidence-state fixture' : 'evidence-state'}>{presentation.label}</span><span><span>{item.summary}</span><small>{item.id} · {item.route} · {item.viewport}</small></span><span aria-hidden="true">↗</span></button> })}
    {evidence.length === 0 && <p className="input-help">暂未提供 Evidence。</p>}
    <dialog ref={dialog} className="crop-dialog evidence-dialog" aria-label="Evidence 详情" onClose={() => setSelected(undefined)}><header><h3>Evidence 详情</h3><button type="button" className="ghost-button" onClick={() => dialog.current?.close()}>关闭</button></header>{selected && <EvidenceDetails key={selected.id} item={selected} onFocus={(item) => { onFocus(item); dialog.current?.close() }} />}</dialog>
  </div>
}
