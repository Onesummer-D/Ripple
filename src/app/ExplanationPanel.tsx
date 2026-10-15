import type { Evidence } from '../domain/contracts'
import { previewExplanations } from '../preview/explanations'
import { EvidencePanel } from './EvidencePanel'

export function ExplanationPanel({ evidence, onFocus }: { evidence?: Evidence; onFocus: (item: Evidence) => void }) {
  const cards = previewExplanations(evidence)
  return <section className="explanation-panel" data-testid="explanation-panel" aria-label="当前预览证据解读">
    <header><h3>这次预演说明了什么</h3><span>证据解读 · 本地规则</span></header>
    <div className="explanation-cards">{cards.map((card) => <article className={`explanation-card ${card.state}`} key={card.id} data-testid={`explanation-${card.id}`}>
      <span className="explanation-state">{card.state === 'risk' ? '发现重叠' : card.state === 'unknown' ? '待确认' : '已观测'}</span>
      <h4>{card.title}</h4><p>{card.finding}</p><p className="explanation-suggestion">{card.suggestion}</p>
      {card.evidenceIds.map((id) => <small key={id}>依据 {id}</small>)}
    </article>)}</div>
    {evidence && cards.some((card) => card.evidenceIds.includes(evidence.id)) && <EvidencePanel evidence={[evidence]} onFocus={onFocus} />}
  </section>
}
