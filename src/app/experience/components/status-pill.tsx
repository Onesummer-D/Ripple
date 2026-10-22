import type { ReactNode } from 'react'
import { CERTAINTY_LABEL, EVIDENCE_STATE_LABEL, LIFECYCLE_LABEL, type EvidenceStateXp, type SourceCertainty, type CandidateLifecycleXp } from '../view-model'

export function CertaintyPill({ certainty }: { certainty: SourceCertainty }) {
  return <span className={`ripple-xp-pill ripple-xp-pill-${certainty}`} data-testid={`certainty-${certainty}`}>
    {CERTAINTY_LABEL[certainty]}
  </span>
}

export function EvidenceStatePill({ state }: { state: EvidenceStateXp }) {
  return <span className={`ripple-xp-pill ripple-xp-ev-${state}`} data-testid={`ev-state-${state}`}>
    {EVIDENCE_STATE_LABEL[state]}
  </span>
}

export function LifecyclePill({ lifecycle }: { lifecycle: CandidateLifecycleXp }) {
  return <span className={`ripple-xp-pill ripple-xp-lc-${lifecycle}`} data-testid={`lifecycle-${lifecycle}`}>
    {LIFECYCLE_LABEL[lifecycle]}
  </span>
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="ripple-xp-section-title"><h3>{children}</h3>{aside}</div>
}
