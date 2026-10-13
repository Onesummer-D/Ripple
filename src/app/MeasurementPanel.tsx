import type { Evidence } from '../domain/contracts'
import { centerCoverCrop, intersectionArea } from '../preview/measurement'

export function MeasurementPanel({ evidence }: { evidence?: Evidence }) {
  const report = evidence?.measurement
  if (!evidence || !report) return <section className="measurement-panel pending" data-testid="measurement-panel"><p role="status">正在读取当前页面的浏览器布局…</p></section>
  const overlap = report.cta && report.slots.some((slot) => intersectionArea(slot.rect, report.cta!) > 0)
  return <section className={overlap ? 'measurement-panel risk' : 'measurement-panel'} data-testid="measurement-panel" data-evidence-id={evidence.id} data-measurement-width={report.width} data-measurement-route={evidence.route}>
    <header><span className="eyebrow">LIVE PREVIEW / OBSERVED</span><span className="measurement-state">A 预览实测</span></header>
    <h3 data-testid="measurement-summary">{report.cta ? overlap ? '标题与购买按钮重叠' : '当前标题与购买按钮未重叠' : '当前页面观测已就绪'}</h3>
    <p>{evidence.route} · {evidence.viewport} · {evidence.context?.previewMode === 'candidate' ? '候选预览' : '当前草稿'}</p>
    {report.cta && <p>依据当前标题矩形与 CTA 矩形的实际交集计算，{overlap ? '建议调整文案或修改范围后重新预演。' : '此检查仅针对这两个元素。'}</p>}
    {report.slots.map((slot) => {
      const crop = slot.media?.objectFit === 'cover' && slot.media.objectPosition === '50% 50%' ? centerCoverCrop(slot.media.naturalWidth, slot.media.naturalHeight, slot.rect.width, slot.rect.height) : undefined
      return <div className="measurement-observation" key={slot.slotId}><strong>{slot.slotId}</strong><span>容器 {Math.round(slot.rect.width)} × {Math.round(slot.rect.height)} px</span>{slot.media && <span>自然尺寸 {slot.media.naturalWidth} × {slot.media.naturalHeight} · {slot.media.objectFit} / {slot.media.objectPosition}</span>}{crop && <span>可见原图区域 {Math.round(crop.width)} × {Math.round(crop.height)} px · 构图由你判断</span>}{slot.style && <span>实际颜色 {slot.style.color} · 背景 {slot.style.backgroundColor}</span>}</div>
    })}
    <details><summary>查看测量证据 · {evidence.id}</summary><pre>{JSON.stringify(evidence, null, 2)}</pre><a className="evidence-link" download={`${evidence.id}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(evidence, null, 2))}`}>下载测量 JSON</a></details>
  </section>
}
