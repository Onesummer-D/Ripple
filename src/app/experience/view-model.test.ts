import { describe, expect, it } from 'vitest'
import { approvalGate, scopeSummary, type CanvasElementXp, type PageXp } from './view-model'

const page = (id: string, scope: PageXp['scope'], certainty: PageXp['relationCertainty'] = 'source-proven'): PageXp => ({
  id, label: id, path: `/${id}`, relation: 'same-source', relationCertainty: certainty, scope,
})
const editableElement: CanvasElementXp = {
  id: 'el:x', label: '标题', demoSelector: '[data-xp-demo="x"]', currentText: '旧',
  certainty: 'source-proven', impactPageRefs: ['page:home'], unresolvedReasons: [], editable: true,
}
const lockedElement: CanvasElementXp = { ...editableElement, id: 'el:y', editable: false, certainty: 'unknown' }
const okInput = { pages: [page('page:home', 'include'), page('page:products', 'protect')], selectedElement: editableElement, draftAfterText: '新标题' }

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

  it('全部条件满足时允许审批', () => {
    expect(approvalGate(okInput).allowed).toBe(true)
  })

  it('负例：未选中目标不得审批', () => {
    const gate = approvalGate({ ...okInput, selectedElement: undefined })
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('尚未选中')
  })

  it('负例：选中目标来源未知（不可编辑）不得审批', () => {
    const gate = approvalGate({ ...okInput, selectedElement: lockedElement })
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('来源未知')
  })

  it('负例：partial 来源即使 editable 也得不到安全审批结论', () => {
    const partialEditable: CanvasElementXp = { ...editableElement, certainty: 'partial' }
    const gate = approvalGate({ ...okInput, selectedElement: partialEditable })
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('未完全证明')
  })

  it('负例：修改内容为空或纯空白不得审批', () => {
    for (const draftAfterText of ['', '   ']) {
      const gate = approvalGate({ ...okInput, draftAfterText })
      expect(gate.allowed).toBe(false)
      expect(gate.reasons.join()).toContain('修改内容为空')
    }
  })

  it('负例：存在未决定页面不得审批', () => {
    const gate = approvalGate({ ...okInput, pages: [page('page:home', 'include'), page('page:story', 'undecided')] })
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('未决定')
  })

  it('负例：partial/unknown 页面被包含进范围不得审批（不得提升为安全范围）', () => {
    const gate = approvalGate({ ...okInput, pages: [page('page:home', 'include'), page('page:seasonal', 'include', 'unknown')] })
    expect(gate.allowed).toBe(false)
    expect(gate.reasons.join()).toContain('无法完全证明')
  })

  it('负例：多条件同时不满足时逐条列出', () => {
    const gate = approvalGate({ pages: [page('page:home', 'undecided')], selectedElement: undefined, draftAfterText: '' })
    expect(gate.reasons.length).toBeGreaterThanOrEqual(3)
  })
})
