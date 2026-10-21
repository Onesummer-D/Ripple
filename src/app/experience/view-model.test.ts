import { describe, expect, it } from 'vitest'
import { approvalGate, scopeSummary, type PageXp } from './view-model'

const page = (id: string, scope: PageXp['scope'], certainty: PageXp['relationCertainty'] = 'source-proven'): PageXp => ({
  id, label: id, path: `/${id}`, relation: 'same-source', relationCertainty: certainty, scope,
})

describe('体验层 ViewModel 纯函数', () => {
  it('scopeSummary 统计包含/保护/排除/未决定与未证明包含数', () => {
    const summary = scopeSummary([
      page('page:home', 'include'),
      page('page:products', 'include', 'unknown'),
      page('page:story', 'protect'),
      page('page:contact', 'exclude'),
      page('page:seasonal', 'undecided'),
    ])
    expect(summary).toEqual({ included: 2, excluded: 1, protected: 1, undecided: 1, unprovenIncluded: 1 })
  })

  it('存在未决定页面时不得审批', () => {
    const gate = approvalGate([page('page:home', 'include'), page('page:story', 'undecided')])
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('未决定')
  })

  it('unknown/partial 页面被包含进范围时不得审批（不得提升为安全范围）', () => {
    const gate = approvalGate([page('page:home', 'include'), page('page:seasonal', 'include', 'unknown')])
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('无法完全证明')
  })

  it('全部 proven 且已决定时允许审批', () => {
    expect(approvalGate([page('page:home', 'include'), page('page:story', 'protect')]).allowed).toBe(true)
  })
})
