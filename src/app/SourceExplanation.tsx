import type { CandidateEdit, CaseFixture, ScopeDecision, ScopeMode } from '../domain/contracts'
import { sourceExplanation } from '../preview/explanations'

export function SourceExplanation({ fixture, candidate, decision, onScope }: { fixture: CaseFixture; candidate: CandidateEdit; decision?: ScopeDecision; onScope: (mode: ScopeMode) => void }) {
  const explanation = sourceExplanation(fixture, candidate, decision)
  return <section className="explanation-panel" data-testid="source-explanation" aria-label="来源与范围解读">
    <header><h3>为什么这些位置会一起变化</h3><span>{fixture.evidence.some((item) => item.origin === 'fixture') ? 'Fixture 关系示例' : '关系图记录'}</span></header>
    <p>{explanation.finding}</p><p>{explanation.scope}</p>
    {explanation.state === 'unknown' ? <p role="status">来源证据待确认，当前图关系尚缺少可核查的结构记录。</p> : <p className="input-help">依据 {explanation.evidence.map((item) => item.id).join('、')} · 在右侧 Evidence 中打开对应记录核查。</p>}
    <p className="input-help">独立来源不会因使用相同组件而同步。范围只决定改动位置，页面风险还需结合下方的实际预演。</p>
    <div className="preview-mode-row"><button type="button" className="ghost-button" onClick={() => onScope('INSTANCE')} data-testid="explain-local">只改当前实例并重新预演</button><button type="button" className="ghost-button" onClick={() => onScope('SHARED')} data-testid="explain-shared">同步同源实例并重新预演</button></div>
  </section>
}
