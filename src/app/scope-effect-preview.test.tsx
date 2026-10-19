import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScopeEffectPreview } from './ScopeEffectPreview'
import { buildScopeEffectPreview, type ScopePreviewTarget } from './scope-effect-preview'
import type { EditOperation } from '../core/model'

const routes = [
  { id: 'page:home', label: '首页' },
  { id: 'page:products', label: '商品页' },
  { id: 'page:about', label: '关于页' },
]
const sharedText: ScopePreviewTarget = {
  id: 'data:heading', kind: 'data', label: '共享标题', value: '原始标题',
  impact: { pageRefs: ['page:home', 'page:products'], unresolved: [], certainty: 'source-proven' },
}
const textEdit: EditOperation = { id: 'op-1', kind: 'TEXT', targetRef: 'data:heading', before: '原始标题', after: '新标题' }

describe('workbench Scope effect preview', () => {
  it('shows proven included/excluded consumers while keeping pages without a negative proof unknown', () => {
    const rows = buildScopeEffectPreview({
      routes, targets: [sharedText], operations: [textEdit],
      choices: { 'page:home': 'include', 'page:products': 'protect', 'page:about': 'include' },
      scope: { strategy: 'shared', includedRefs: ['page:home', 'page:about'], excludedRefs: [], protectedRefs: ['page:products'] },
    })
    expect(rows.map(row => [row.pageRef, row.outcome])).toEqual([
      ['page:home', 'change'], ['page:products', 'conflict'], ['page:about', 'unknown'],
    ])
    expect(rows[0].currentValue).toBe('原始标题')
    expect(rows[0].plannedValue).toBe('新标题')
    render(<ScopeEffectPreview rows={rows} />)
    expect(screen.getByText('计划预览 · 不是浏览器 Evidence')).toBeTruthy()
    expect(screen.getByText('Scope 冲突，候选将被拒绝')).toBeTruthy()
  })

  it('previews a local override against the current page value and preserves other proven consumers', () => {
    const target = { ...sharedText, pageOverrides: { 'page:home': '首页旧覆盖' } }
    const rows = buildScopeEffectPreview({
      routes, targets: [target], operations: [textEdit],
      choices: { 'page:home': 'include', 'page:products': 'protect', 'page:about': 'exclude' },
      scope: { strategy: 'page-override', localPageRef: 'page:home', includedRefs: ['page:home'], excludedRefs: ['page:about'], protectedRefs: ['page:products'] },
    })
    expect(rows.map(row => [row.outcome, row.currentValue, row.plannedValue])).toEqual([
      ['change', '首页旧覆盖', '新标题'], ['preserve', '原始标题', '原始标题'], ['unknown', undefined, undefined],
    ])
  })

  it('does not invent a value for uncertain source impact or unsupported resource kinds', () => {
    const unknownTarget = { ...sharedText, impact: { ...sharedText.impact, certainty: 'partial' as const } }
    const media: ScopePreviewTarget = { ...sharedText, id: 'media:hero', kind: 'media' }
    const mediaEdit: EditOperation = { ...textEdit, id: 'op-media', kind: 'MEDIA', targetRef: 'media:hero' }
    const rows = buildScopeEffectPreview({
      routes, targets: [unknownTarget, media], operations: [textEdit, mediaEdit], choices: {},
      scope: { strategy: 'shared', includedRefs: [], excludedRefs: [], protectedRefs: [] },
    })
    expect(rows).toHaveLength(6)
    expect(rows.every(row => row.outcome === 'unknown')).toBe(true)
    expect(rows.some(row => row.plannedValue !== undefined)).toBe(false)
  })

  it('leaves affected pages undecided and pages without consumer proof unknown', () => {
    const rows = buildScopeEffectPreview({
      routes, targets: [sharedText], operations: [textEdit], choices: {},
      scope: { strategy: 'shared', includedRefs: [], excludedRefs: [], protectedRefs: [] },
    })
    expect(rows.filter(row => row.pageRef !== 'page:about').map(row => row.outcome)).toEqual(['undecided', 'undecided'])
    expect(rows.find(row => row.pageRef === 'page:about')?.outcome).toBe('unknown')
  })
})

