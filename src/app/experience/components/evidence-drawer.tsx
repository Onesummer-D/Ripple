import { useState } from 'react'
import type { EvidenceItemXp } from '../view-model'

/**
 * 证据阅读面板（主工作区底部标签页之一）：第一眼看到"预期修改 / 风险 / 未检查 /
 * 来源不完整原因 / 下一步"，原始细节渐进展开；每条的依据类型明确分开，不虚构解释。
 */
export function EvidenceDrawer({ items }: { items: EvidenceItemXp[] }) {
  const [expanded, setExpanded] = useState<string>()
  return <section className="ripple-xp-evidence reveal" aria-label="验证证据" data-testid="evidence-drawer">
    <ul className="ripple-xp-evidence-list">
      {items.map(item => (
        <li key={item.id} className="ripple-xp-evidence-item" data-testid={`evidence-${item.id}`}>
          <button
            type="button"
            className="ripple-xp-evidence-head"
            aria-expanded={expanded === item.id}
            onClick={() => setExpanded(expanded === item.id ? undefined : item.id)}
          >
            <strong>{item.title}</strong>
            <span className={`ripple-xp-ev-summary ${expanded === item.id ? '' : 'is-clamped'}`}>{item.summary}</span>
          </button>
          {expanded === item.id && item.detail && <p className="ripple-xp-ev-detail">{item.detail}</p>}
        </li>
      ))}
    </ul>
  </section>
}
