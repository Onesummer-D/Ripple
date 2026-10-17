import { describe, expect, it } from 'vitest'
import { sourceProvenPageImpact } from './scope'
import type { SourceGraph } from './model'

const graph: SourceGraph = {
  id: 'graph-test',
  revision: { projectId: 'project-test', sourceDigest: 'digest', runtimeFingerprint: 'runtime' },
  nodes: [
    { id: 'page:home', kind: 'route', label: 'home', page: 'home' },
    { id: 'page:products', kind: 'route', label: 'products', page: 'products' },
    { id: 'component:ProductCard', kind: 'component', label: 'ProductCard', pages: ['home', 'products'] },
    { id: 'component:HomeHero', kind: 'component', label: 'HomeHero', pages: ['home'] },
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
    expect(sourceProvenPageImpact(graph, 'data:shared-price')).toEqual({ pageRefs: ['page:home', 'page:products'], unresolved: [] })
    expect(sourceProvenPageImpact(graph, 'data:hero-title')).toEqual({ pageRefs: ['page:home'], unresolved: [] })
  })

  it('does not promote semantic suggestions to proven impact and fails closed on incomplete graph data', () => {
    expect(sourceProvenPageImpact(graph, 'data:hero-title').pageRefs).not.toContain('page:products')
    expect(sourceProvenPageImpact({ ...graph, unresolved: ['src/routes/extra.tsx → @/components/Unknown'] }, 'data:hero-title').unresolved).toHaveLength(1)
    expect(sourceProvenPageImpact(graph, 'missing').unresolved[0]).toContain('不在当前源码图中')
  })
})
