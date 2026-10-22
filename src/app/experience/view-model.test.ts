import { describe, expect, it } from 'vitest'
import {
  approvalFeedbackStale,
  approvalGate,
  projectPageRelations,
  scopeSummary,
  type CanvasElementXp,
  type ExperienceViewModel,
  type PageXp,
} from './view-model'

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

describe('页面关系投影 projectPageRelations（任务一）', () => {
  const pages: PageXp[] = [
    { id: 'page:home', label: '首页', path: '/', relation: 'editing', relationCertainty: 'source-proven', scope: 'include' },
    { id: 'page:products', label: '商品专题', path: '/products', relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' },
    { id: 'page:seasonal', label: '活动页', path: '/seasonal', relation: 'unproven', relationCertainty: 'partial', scope: 'undecided' },
    { id: 'page:contact', label: '联系我们', path: '/contact', relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' },
  ]
  const heroTitle: CanvasElementXp = {
    ...editableElement, id: 'el:hero-title', currentText: '秋日茶器市集',
    certainty: 'source-proven', impactPageRefs: ['page:home', 'page:products'],
  }
  const heroSubtitle: CanvasElementXp = {
    ...editableElement, id: 'el:hero-subtitle', currentText: '以茶会友，以器传心',
    certainty: 'source-proven', impactPageRefs: ['page:home'],
  }
  const partialBanner: CanvasElementXp = {
    ...editableElement, id: 'el:seasonal-banner', certainty: 'partial', impactPageRefs: ['page:seasonal'],
  }
  const unknownCard: CanvasElementXp = {
    ...editableElement, id: 'el:promo-card', certainty: 'unknown', impactPageRefs: [],
  }

  it('未选中目标时页面关系保持不变', () => {
    expect(projectPageRelations(pages, undefined, 'page:home')).toBe(pages)
  })

  it('source-proven 目标：影响页投影为同源 include，当前页为 editing', () => {
    const projected = projectPageRelations(pages, heroTitle, 'page:home')
    const byId = Object.fromEntries(projected.map(item => [item.id, item]))
    expect(byId['page:home']).toMatchObject({ relation: 'editing', relationCertainty: 'source-proven', scope: 'include' })
    expect(byId['page:products']).toMatchObject({ relation: 'same-source', relationCertainty: 'source-proven', scope: 'include' })
    // 清单外页面不臆造"无影响"：保持 unproven，不升级为 source-proven unrelated
    expect(byId['page:seasonal']).toMatchObject({ relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' })
    expect(byId['page:contact']).toMatchObject({ relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' })
  })

  it('切换为仅影响首页的目标：商品专题不再虚假显示同源，且不继承旧 include', () => {
    const withOldScope = pages.map(item => item.id === 'page:products' ? { ...item, scope: 'include' as const } : item)
    const projected = projectPageRelations(withOldScope, heroSubtitle, 'page:home')
    const products = projected.find(item => item.id === 'page:products')
    expect(products).toMatchObject({ relation: 'unproven', scope: 'undecided' })
    expect(products?.relationCertainty).not.toBe('source-proven')
  })

  it('显式提供 provenUnaffectedRefs 时才表达已证明无关页', () => {
    const projected = projectPageRelations(pages, heroTitle, 'page:home', ['page:contact'])
    expect(projected.find(item => item.id === 'page:contact'))
      .toMatchObject({ relation: 'unrelated', relationCertainty: 'source-proven', scope: 'exclude' })
    // 未在清单中的页面仍然不得自动升级
    expect(projected.find(item => item.id === 'page:seasonal')).toMatchObject({ relation: 'unproven' })
  })

  it('partial 目标：已知影响页也不得提升为安全同源，非影响页保持 partial 未证明', () => {
    const projected = projectPageRelations(pages, partialBanner, 'page:home')
    expect(projected.find(item => item.id === 'page:seasonal'))
      .toMatchObject({ relation: 'unproven', relationCertainty: 'partial', scope: 'undecided' })
    for (const id of ['page:products', 'page:contact']) {
      expect(projected.find(item => item.id === id)?.relationCertainty).not.toBe('source-proven')
    }
  })

  it('unknown 目标：任何页面都不会得到 source-proven 关系', () => {
    const projected = projectPageRelations(pages, unknownCard, 'page:home')
    for (const item of projected.filter(page => page.id !== 'page:home')) {
      expect(item.relation).toBe('unproven')
      expect(item.relationCertainty).not.toBe('source-proven')
      expect(item.scope).toBe('undecided')
    }
  })

  it('负例：partial 元素的目标所属页如实显示部分证明，不得标为来源已证实', () => {
    const projected = projectPageRelations(pages, partialBanner, 'page:home')
    expect(projected.find(item => item.id === 'page:home'))
      .toMatchObject({ relation: 'editing', relationCertainty: 'partial', scope: 'include' })
  })

  it('负例：unknown 元素的目标所属页如实显示未知，不得标为来源已证实', () => {
    const projected = projectPageRelations(pages, unknownCard, 'page:home')
    expect(projected.find(item => item.id === 'page:home'))
      .toMatchObject({ relation: 'editing', relationCertainty: 'unknown', scope: 'include' })
  })

  it('目标所属页由元素数据决定，与用户浏览位置无关', () => {
    // 目标在商品专题页（elementPageRef），即使用户正在首页浏览：
    // 商品专题才是 editing，首页只按影响清单投影为同源
    const projected = projectPageRelations(pages, heroTitle, 'page:products')
    expect(projected.find(item => item.id === 'page:products'))
      .toMatchObject({ relation: 'editing', relationCertainty: 'source-proven', scope: 'include' })
    expect(projected.find(item => item.id === 'page:home'))
      .toMatchObject({ relation: 'same-source', relationCertainty: 'source-proven' })
  })

  it('不修改传入数组（不可变更新）', () => {
    const snapshot = JSON.parse(JSON.stringify(pages))
    projectPageRelations(pages, heroTitle, 'page:home')
    expect(pages).toEqual(snapshot)
  })
})

describe('演示审批反馈失效 approvalFeedbackStale（任务三）', () => {
  const baseModel: ExperienceViewModel = {
    projectName: '青野文创商店', projectStatus: 'ready', candidateStatus: 'draft', dataProvenance: 'demo',
    pages: [page('page:home', 'include')], elements: [editableElement], currentPageRef: 'page:home',
    selectedElementId: 'el:x', draftAfterText: '新标题',
    viewports: [], activeViewportId: 'desktop', canvasState: 'ready',
    evidence: [], versions: [], compare: { baseline: { state: 'ready' }, candidate: { state: 'ready' }, matchedViewport: true },
  }

  it('目标切换 → 旧反馈失效', () => {
    expect(approvalFeedbackStale(baseModel, { ...baseModel, selectedElementId: 'el:y' })).toBe(true)
  })

  it('草稿修改（含清空）→ 旧反馈失效', () => {
    expect(approvalFeedbackStale(baseModel, { ...baseModel, draftAfterText: '又一个新标题' })).toBe(true)
    expect(approvalFeedbackStale(baseModel, { ...baseModel, draftAfterText: '' })).toBe(true)
  })

  it('范围决策变化 → 旧反馈失效', () => {
    const nextPages = baseModel.pages.map(item => ({ ...item, scope: 'exclude' as const }))
    expect(approvalFeedbackStale(baseModel, { ...baseModel, pages: nextPages })).toBe(true)
  })

  it('模型未发生目标/草稿/范围修订时反馈保持有效', () => {
    expect(approvalFeedbackStale(baseModel, { ...baseModel })).toBe(false)
    expect(approvalFeedbackStale(baseModel, { ...baseModel, evidence: [], canvasState: 'loading' })).toBe(false)
  })
})
