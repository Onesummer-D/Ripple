import type { ScopeEffectRow } from './scope-effect-preview'
import './scope-effect-preview.css'

const outcomeLabel: Record<ScopeEffectRow['outcome'], string> = {
  change: '将修改',
  preserve: '保持当前值',
  conflict: 'Scope 冲突，候选将被拒绝',
  undecided: '等待选择',
  unknown: 'UNKNOWN · 无法计算',
}

interface ScopeEffectPreviewProps { rows: ScopeEffectRow[] }

export function ScopeEffectPreview({ rows }: ScopeEffectPreviewProps) {
  if (!rows.length) return null

  return <section className="scope-effect-preview" data-testid="scope-effect-preview" aria-label="候选范围预览">
    <div className="scope-effect-heading"><strong>本次修改在各页面的预期效果</strong><span>计划预览 · 不是浏览器 Evidence</span></div>
    <div className="scope-effect-list">
      {rows.map(row => <article className={`scope-effect-row scope-effect-${row.outcome}`} key={`${row.operationId}:${row.pageRef}`}>
        <div className="scope-effect-page"><strong>{row.pageLabel}</strong><code>{row.pageRef}</code></div>
        <div className="scope-effect-detail">
          <span>{row.operationLabel} · {row.kind}</span>
          {row.currentValue !== undefined && <p><del>{row.currentValue}</del>{row.plannedValue !== undefined && <><b>→</b><strong>{row.plannedValue}</strong></>}</p>}
          {row.reason && <small>{row.reason}</small>}
        </div>
        <strong className="scope-effect-status">{outcomeLabel[row.outcome]}</strong>
      </article>)}
    </div>
  </section>
}

