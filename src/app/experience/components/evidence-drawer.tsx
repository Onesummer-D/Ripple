import { useState } from 'react'
import type { DataProvenance, EvidenceItemXp } from '../view-model'
import { EvidenceStatePill, SectionTitle } from './status-pill'

const SOURCE_KIND_LABEL: Record<EvidenceItemXp['sourceKind'], string> = {
  'source-graph': '源码证实', 'runtime-observation': '运行时观测', 'user-choice': '用户选择', 'ai-suggestion': 'AI 建议',
}
const DEMO_SOURCE_KIND_LABEL: Record<EvidenceItemXp['sourceKind'], string> = {
  'source-graph': 'Demo 来源示意（非 SourceGraph 证明）',
  'runtime-observation': 'Demo 运行时观测（未执行真实验证）',
  'user-choice': 'Demo 用户选择',
  'ai-suggestion': 'Demo 建议',
}

/**
 * 底部证据阅读面板：第一眼看到"预期修改 / 风险 / 未检查 / 来源不完整原因 / 下一步"，
 * 原始细节渐进展开；每条的依据类型明确分开，不虚构解释。
 */
export function EvidenceDrawer({ items, provenance, onClose }: { items: EvidenceItemXp[]; provenance: DataProvenance; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string>()
  const isDemo = provenance === 'demo'
  return <section className="ripple-xp-evidence reveal" aria-label="验证证据" data-testid="evidence-drawer">
    <SectionTitle aside={<button type="button" className="ripple-xp-quiet" onClick={onClose} data-testid="close-evidence">收起</button>}>
      证据与解释
    </SectionTitle>
    <ul className="ripple-xp-evidence-list">
      {items.map(item => (
        <li key={item.id} className="ripple-xp-evidence-item" data-testid={`evidence-${item.id}`}>
          {isDemo && <span className="ripple-xp-evidence-provenance" data-testid={`evidence-provenance-${item.id}`}>DEMO</span>}
          <button
            type="button"
            className="ripple-xp-evidence-head"
            aria-expanded={expanded === item.id}
            onClick={() => setExpanded(expanded === item.id ? undefined : item.id)}
          >
            <EvidenceStatePill state={item.state} />
            <strong>{item.title}</strong>
            <span className="ripple-xp-ev-summary">{item.summary}</span>
          </button>
          <span className={`ripple-xp-src-kind ripple-xp-src-${item.sourceKind}`}>{isDemo ? DEMO_SOURCE_KIND_LABEL[item.sourceKind] : SOURCE_KIND_LABEL[item.sourceKind]}</span>
          {expanded === item.id && item.detail && <p className="ripple-xp-ev-detail">{item.detail}</p>}
        </li>
      ))}
    </ul>
  </section>
}
