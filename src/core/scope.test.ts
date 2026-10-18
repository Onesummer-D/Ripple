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

  it('distinguishes module imports from concrete TEXT reads and TOKEN uses', () => {
    const nodes: SourceGraph['nodes'] = [
      { id: 'page:home', kind: 'route', label: 'home', page: 'home' },
      { id: 'page:shop', kind: 'route', label: 'shop', page: 'shop' },
      { id: 'component:Home', kind: 'component', label: 'Home', pages: ['home'] },
      { id: 'component:Shop', kind: 'component', label: 'Shop', pages: ['shop'] },
      { id: 'file:src/copy.ts', kind: 'file', label: 'copy.ts' },
      { id: 'file:src/theme.ts', kind: 'file', label: 'theme.ts' },
      { id: 'data:home-title', kind: 'data', label: 'Home title', value: 'Home' },
      { id: 'token:accent', kind: 'token', label: 'accent', value: '#246' },
    ]
    const edges: SourceGraph['edges'] = [
      { id: 'home-render', from: 'page:home', to: 'component:Home', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'shop-render', from: 'page:shop', to: 'component:Shop', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-copy-import', from: 'component:Home', to: 'file:src/copy.ts', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'shop-copy-import', from: 'component:Shop', to: 'file:src/copy.ts', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'copy-definition', from: 'file:src/copy.ts', to: 'data:home-title', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-actual-read', from: 'component:Home', to: 'data:home-title', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-theme-import', from: 'component:Home', to: 'file:src/theme.ts', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'shop-theme-import', from: 'component:Shop', to: 'file:src/theme.ts', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'token-definition', from: 'file:src/theme.ts', to: 'token:accent', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-actual-token-use', from: 'component:Home', to: 'token:accent', kind: 'uses-token', certainty: 'source-proven', evidenceRefs: [] },
    ]
    const sourceGraph: SourceGraph = { ...graph, nodes, edges }

    expect(sourceProvenPageImpact(sourceGraph, 'data:home-title')).toMatchObject({
      pageRefs: ['page:home'], certainty: 'source-proven', unresolved: [],
    })
    expect(sourceProvenPageImpact(sourceGraph, 'token:accent')).toMatchObject({
      pageRefs: ['page:home'], certainty: 'source-proven', unresolved: [],
    })
  })

  it('requires concrete TEXT reads and TOKEN uses beyond imports of definition files', () => {
    const nodes: SourceGraph['nodes'] = [
      { id: 'page:home', kind: 'route', label: 'home', page: 'home' },
      { id: 'page:about', kind: 'route', label: 'about', page: 'about' },
      { id: 'component:Home', kind: 'component', label: 'Home' },
      { id: 'component:About', kind: 'component', label: 'About' },
      { id: 'file:src/pages/Home.tsx', kind: 'file', label: 'Home.tsx' },
      { id: 'file:src/pages/About.tsx', kind: 'file', label: 'About.tsx' },
      { id: 'file:src/copy.ts', kind: 'file', label: 'copy.ts' },
      { id: 'file:src/tokens.css', kind: 'file', label: 'tokens.css' },
      { id: 'data:home-title', kind: 'data', label: 'title', value: 'Home' },
      { id: 'token:accent', kind: 'token', label: '--accent', value: '#246' },
    ]
    const importOnlyEdges: SourceGraph['edges'] = [
      { id: 'home-render', from: 'page:home', to: 'component:Home', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'about-render', from: 'page:about', to: 'component:About', kind: 'renders', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-file', from: 'component:Home', to: 'file:src/pages/Home.tsx', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'about-file', from: 'component:About', to: 'file:src/pages/About.tsx', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-copy-import', from: 'file:src/pages/Home.tsx', to: 'file:src/copy.ts', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'about-copy-import', from: 'file:src/pages/About.tsx', to: 'file:src/copy.ts', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'home-token-import', from: 'file:src/pages/Home.tsx', to: 'file:src/tokens.css', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'about-token-import', from: 'file:src/pages/About.tsx', to: 'file:src/tokens.css', kind: 'imports', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'copy-definition', from: 'file:src/copy.ts', to: 'data:home-title', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'token-definition', from: 'file:src/tokens.css', to: 'token:accent', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
    ]
    const importOnly: SourceGraph = { ...graph, nodes, edges: importOnlyEdges }

    expect(sourceProvenPageImpact(importOnly, 'data:home-title')).toMatchObject({
      pageRefs: [], certainty: 'unknown',
    })
    expect(sourceProvenPageImpact(importOnly, 'token:accent')).toMatchObject({
      pageRefs: [], certainty: 'unknown',
    })

    const consumed: SourceGraph = {
      ...importOnly,
      edges: [
        ...importOnlyEdges,
        { id: 'home-title-read', from: 'component:Home', to: 'data:home-title', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
        { id: 'home-token-use', from: 'component:Home', to: 'token:accent', kind: 'uses-token', certainty: 'source-proven', evidenceRefs: [] },
      ],
    }
    expect(sourceProvenPageImpact(consumed, 'data:home-title')).toMatchObject({
      pageRefs: ['page:home'], certainty: 'source-proven', unresolved: [],
    })
    expect(sourceProvenPageImpact(consumed, 'token:accent')).toMatchObject({
      pageRefs: ['page:home'], certainty: 'source-proven', unresolved: [],
    })
  })

  it('does not treat imported media definitions as consumption and follows concrete TEXT reads and imported CSS token use', () => {
    const pages = ['home', 'shop', 'about', 'contact']
    const nodes: SourceGraph['nodes'] = [
      ...pages.flatMap(page => [
        { id: `page:${page}`, kind: 'route' as const, label: page, page },
        { id: `component:${page}`, kind: 'component' as const, label: page },
        { id: `file:${page}`, kind: 'file' as const, label: `${page}.tsx` },
      ]),
      { id: 'file:src/data/products.ts', kind: 'file', label: 'products.ts' },
      { id: 'file:src/styles/tokens.css', kind: 'file', label: 'tokens.css' },
      { id: 'media:unconsumed', kind: 'media', label: 'image', value: '/unused.jpg' },
      { id: 'media:consumed', kind: 'media', label: 'image', value: '/used.jpg' },
      { id: 'data:shared-label', kind: 'data', label: 'Shared label', value: 'Shop' },
      { id: 'token:accent', kind: 'token', label: '--accent', value: '#246' },
    ]
    const edges: SourceGraph['edges'] = [
      { id: 'definition:unconsumed', from: 'file:src/data/products.ts', to: 'media:unconsumed', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'definition:consumed', from: 'file:src/data/products.ts', to: 'media:consumed', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'definition:text', from: 'file:src/data/products.ts', to: 'data:shared-label', kind: 'reads', certainty: 'source-proven', evidenceRefs: [] },
      { id: 'token-use', from: 'file:src/styles/tokens.css', to: 'token:accent', kind: 'uses-token', certainty: 'source-proven', evidenceRefs: [] },
      ...pages.flatMap(page => [
        { id: `route-render:${page}`, from: `page:${page}`, to: `component:${page}`, kind: 'renders' as const, certainty: 'source-proven' as const, evidenceRefs: [] },
        { id: `component-file:${page}`, from: `component:${page}`, to: `file:${page}`, kind: 'imports' as const, certainty: 'source-proven' as const, evidenceRefs: [] },
        { id: `data-import:${page}`, from: `file:${page}`, to: 'file:src/data/products.ts', kind: 'imports' as const, certainty: 'source-proven' as const, evidenceRefs: [] },
        { id: `token-import:${page}`, from: `file:${page}`, to: 'file:src/styles/tokens.css', kind: 'imports' as const, certainty: 'source-proven' as const, evidenceRefs: [] },
        { id: `actual-text-read:${page}`, from: `component:${page}`, to: 'data:shared-label', kind: 'reads' as const, certainty: 'source-proven' as const, evidenceRefs: [] },
      ]),
      { id: 'actual-image-use', from: 'component:home', to: 'media:consumed', kind: 'asset-consumer', certainty: 'source-proven', evidenceRefs: [] },
    ]
    const sourceGraph: SourceGraph = { ...graph, nodes, edges }

    expect(sourceProvenPageImpact(sourceGraph, 'media:unconsumed')).toMatchObject({
      pageRefs: [],
      certainty: 'unknown',
    })
    expect(sourceProvenPageImpact(sourceGraph, 'media:consumed')).toMatchObject({
      pageRefs: ['page:home'],
      certainty: 'source-proven',
    })
    expect(sourceProvenPageImpact(sourceGraph, 'data:shared-label')).toMatchObject({
      pageRefs: ['page:about', 'page:contact', 'page:home', 'page:shop'],
      certainty: 'source-proven',
    })
    expect(sourceProvenPageImpact(sourceGraph, 'token:accent')).toMatchObject({
      pageRefs: ['page:about', 'page:contact', 'page:home', 'page:shop'],
      certainty: 'source-proven',
    })
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

