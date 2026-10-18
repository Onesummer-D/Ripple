import { describe, expect, it } from 'vitest'
import { evaluateOperationPageScope, expectedTextForPage, sourceProvenPageImpact } from './scope'
import type { SourceGraph } from './model'

const graph: SourceGraph = {
  id: 'graph-test',
  revision: { projectId: 'project-test', sourceDigest: 'digest', runtimeFingerprint: 'runtime' },
  nodes: [
    { id: 'page:home', kind: 'route', label: 'home', page: 'home' },
    { id: 'page:products', kind: 'route', label: 'products', page: 'products' },
    { id: 'component:ProductCard', kind: 'component', label: 'ProductCard', pages: ['home', 'products'] },
    { id: 'component:HomeHero', kind: 'component', label: 'HomeHero', pages: ['home'], location: { path: 'src/pages/HomeHero.tsx' } },
    { id: 'data:shared-price', kind: 'data', label: 'price', value: '$10' },
    { id: 'data:hero-title', kind: 'data', label: 'title', value: 'Home' },
  ],
  edges: [
    { id: 'home-card', from: 'page:home', to: 'component:ProductCard', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
    { id: 'products-card', from: 'page:products', to: 'component:ProductCard', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
    { id: 'card-price', from: 'component:ProductCard', to: 'data:shared-price', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
    { id: 'home-hero', from: 'page:home', to: 'component:HomeHero', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
    { id: 'hero-title', from: 'component:HomeHero', to: 'data:hero-title', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
    { id: 'semantic-guess', from: 'page:products', to: 'data:hero-title', kind: 'semantic-link', certainty: 'semantic-candidate', evidenceRefs: [] },
  ],
  unresolved: [],
}

describe('source-proven page impact', () => {
  it('finds all consumers of a shared source and only the local page for a local source', () => {
    expect(sourceProvenPageImpact(graph, 'data:shared-price')).toEqual({ pageRefs: ['page:home', 'page:products'], unresolved: [], certainty: 'source-proven' })
    expect(sourceProvenPageImpact(graph, 'data:hero-title')).toEqual({ pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' })
  })

  it('does not promote semantic suggestions to proven impact and fails closed on incomplete graph data', () => {
    expect(sourceProvenPageImpact(graph, 'data:hero-title').pageRefs).not.toContain('page:products')
    const independent = sourceProvenPageImpact({ ...graph, unresolved: ['src/routes/extra.tsx → @/components/Unknown'] }, 'data:hero-title')
    expect(independent.unresolved).toEqual([])
    expect(independent.certainty).toBe('source-proven')
    expect(sourceProvenPageImpact(graph, 'missing').unresolved[0]).toContain('不在当前源码图中')
  })

  it('keeps uncertainty when an unresolved import belongs to the affected consumer file', () => {
    const affected = sourceProvenPageImpact({ ...graph, unresolved: ['src/pages/HomeHero.tsx → ./missing-component'] }, 'data:hero-title')
    expect(affected.pageRefs).toEqual(['page:home'])
    expect(affected.unresolved).toHaveLength(1)
    expect(affected.certainty).toBe('partial')
  })
})

describe('shared page Scope evaluation', () => {
  it('uses the same conflict and preservation decisions for enforcement and preview', () => {
    const shared = { strategy: 'shared' as const, includedRefs: ['page:home'], excludedRefs: [], protectedRefs: [] }
    expect(evaluateOperationPageScope(shared, ['page:home'])).toEqual([{ pageRef: 'page:home', effect: 'change' }])
    expect(evaluateOperationPageScope(shared, ['page:products'])).toEqual([{ pageRef: 'page:products', effect: 'conflict', reason: 'Scope 尚未明确包含受影响页面：page:products' }])
    expect(evaluateOperationPageScope({ ...shared, protectedRefs: ['page:products'] }, ['page:products'])).toContainEqual(expect.objectContaining({ effect: 'conflict', reason: expect.stringContaining('排除或保护') }))

    const local = { ...shared, strategy: 'page-override' as const, localPageRef: 'page:home', protectedRefs: ['page:products'] }
    expect(evaluateOperationPageScope(local, ['page:home', 'page:products'])).toEqual([
      { pageRef: 'page:home', effect: 'change' },
      { pageRef: 'page:products', effect: 'preserve' },
    ])
    expect(evaluateOperationPageScope({ ...local, protectedRefs: [] }, ['page:products'])[0].effect).toBe('conflict')
  })

  it('computes current effective values from page override before applying a planned text change', () => {
    const source = { value: '$10', pageOverrides: { 'page:home': '$9' } }
    const operation = { id: 'edit', kind: 'TEXT' as const, targetRef: 'data:shared-price', before: '$10', after: '$8' }
    expect(expectedTextForPage(source, operation, {
      strategy: 'page-override', localPageRef: 'page:home', includedRefs: ['page:home'], excludedRefs: ['page:products'], protectedRefs: [],
    }, 'page:home')).toEqual({ baselineText: '$9', candidateText: '$8', shouldChange: true })
    expect(expectedTextForPage(source, operation, {
      strategy: 'page-override', localPageRef: 'page:home', includedRefs: ['page:home'], excludedRefs: ['page:products'], protectedRefs: [],
    }, 'page:products')).toEqual({ baselineText: '$10', candidateText: '$10', shouldChange: false })
  })
})

