import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaseId, EditableSlot, Evidence, PreviewEvidenceContext } from '../domain/contracts'
import type { MediaResource } from '../adapters/mediaLibrary'
import { createPageDocument } from '../preview/pageDocument'
import { previewViewports, type PreviewViewport } from '../preview/viewports'
import { withMeasurementBridge } from '../preview/measurementBridge'
import { usePreviewMeasurement } from './usePreviewMeasurement'
import { MeasurementPanel } from './MeasurementPanel'

export function PagePreview({ caseId, route, values, resources, viewport, onViewportChange, mode, onModeChange, hasCandidate, revision, onRepreview, context, onEvidence }: {
  caseId: CaseId
  route: string
  values: EditableSlot[]
  resources: Record<string, MediaResource>
  viewport: PreviewViewport
  onViewportChange: (viewport: PreviewViewport) => void
  mode: 'draft' | 'candidate'
  onModeChange: (mode: 'draft' | 'candidate') => void
  hasCandidate: boolean
  revision: number
  onRepreview: () => void
  context: PreviewEvidenceContext
  onEvidence: (evidence?: Evidence) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [availableWidth, setAvailableWidth] = useState(viewport.width as number)
  useEffect(() => {
    if (!host.current) return
    const measure = () => setAvailableWidth(host.current?.clientWidth || viewport.width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [viewport.width])
  const scale = Math.min(1, availableWidth / viewport.width)
  const document = useMemo(() => withMeasurementBridge(createPageDocument(caseId, route, values, resources)), [caseId, route, values, resources])
  const contextKey = JSON.stringify(context)
  const requestKey = useMemo(() => crypto.randomUUID(), [document, viewport.width, viewport.height, contextKey, revision])
  const measurement = usePreviewMeasurement({ frame, requestKey, caseId, route, viewport, values, context, onEvidence })
  return <section className="page-preview" data-testid="page-preview">
    <div className="canvas-toolbar"><span className="browser-dot red" /><span className="browser-dot yellow" /><span className="browser-dot green" /><span className="canvas-route">ripple.local{route}</span><span className="preview-scale">{Math.round(scale * 100)}%</span></div>
    <div className="device-row"><span className="device-label">预演视口</span>{previewViewports.map((item) => <button type="button" key={item.width} className={viewport.width === item.width ? 'device-chip highlighted' : 'device-chip'} aria-pressed={viewport.width === item.width} onClick={() => onViewportChange(item)} data-testid={`viewport-${item.width}`}><span className="device-icon" />{item.label}</button>)}</div>
    <div className="preview-mode-row"><button type="button" className="ghost-button" aria-pressed={mode === 'draft'} onClick={() => onModeChange('draft')} data-testid="preview-draft">当前草稿</button><button type="button" className="ghost-button" aria-pressed={mode === 'candidate'} disabled={!hasCandidate} onClick={() => onModeChange('candidate')} data-testid="preview-candidate">候选预览</button><button type="button" className="ghost-button" disabled={!hasCandidate} onClick={onRepreview} data-testid="repreview">重新预演</button></div>
    <div ref={host} className="viewport-host"><div className="viewport-size" style={{ width: viewport.width * scale, height: viewport.height * scale }}><iframe ref={frame} onLoad={measurement.request} key={requestKey} data-testid="page-frame" title={`${caseId} ${route} ${viewport.width} 页面预览`} sandbox="allow-scripts" srcDoc={document} width={viewport.width} height={viewport.height} style={{ transform: `scale(${scale})` }} /></div></div>
    <p className="preview-caption">页面按 {viewport.label} 布局，缩放仅适配工作台空间 · {mode === 'candidate' && hasCandidate ? '候选预览' : '当前草稿'}</p>
    {measurement.unavailable ? <p role="status" className="input-error">当前页面测量尚未就绪，可重新预演后再试。</p> : <MeasurementPanel evidence={measurement.evidence} />}
  </section>
}
