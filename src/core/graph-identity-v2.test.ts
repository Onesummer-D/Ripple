import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  EDGE_KINDS,
  GRAPH_DIGEST_DOMAIN,
  GRAPH_IDENTITY_VERSION,
  GRAPH_SCHEMA_VERSION,
  RELATION_IDENTITY_VERSION,
  SOURCE_MAPPING_VERSION,
  canonicalGraph,
  canonicalJson,
  computeGraphDigestV2,
  validateGraphDigestV2,
  type GraphDigestV2,
} from './graph-identity-v2'

const zeroDigest = '0'.repeat(64)

function g0(): GraphDigestV2 {
  return {
    graphIdentityVersion: GRAPH_IDENTITY_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    relationIdentityVersion: RELATION_IDENTITY_VERSION,
    sourceMappingVersion: SOURCE_MAPPING_VERSION,
    projectId: 'project-demo',
    sourceDigest: zeroDigest,
    nodes: [
      { id: 'node:b', kind: 'token', label: '--x' },
      { id: 'node:a', kind: 'token-use', label: 'var(--x)', location: { path: 'src/a.css', offset: 4, byteOffset: 4 } },
      { id: 'file:source-anchor', kind: 'file', label: 'src/a.css' },
    ],
    edges: [
      {
        id: 'rel:a', from: 'node:a', to: 'node:b', kind: 'reads', certainty: 'source-proven', evidenceRefs: ['e2', 'e1'],
        sourceUse: { path: 'src/a.css', charOffset: 4, byteOffset: 4, offsetUnit: 'code-unit' },
      },
      {
        id: 'anchor:source', from: 'file:source-anchor', to: 'node:a', kind: 'reads', certainty: 'source-proven', evidenceRefs: ['source-anchor'],
        sourceUse: { path: 'src/a.css', charOffset: 4, byteOffset: 4, offsetUnit: 'code-unit' }, producerIdentity: 'host-source-map/v1',
      },
    ],
    unresolved: [],
    sourceMappings: [{
      sourceRef: 'node:a', graphNodeId: 'node:a', sourceAnchorRelationId: 'anchor:source',
      sourceIdentity: `source:${zeroDigest}:src/a.css:4:4`,
      sourceUse: { path: 'src/a.css', charOffset: 4, byteOffset: 4, offsetUnit: 'code-unit' }, projectId: 'project-demo',
    }],
  }
}

describe('GraphDigestV2 pure canonical module', () => {
  it('reproduces D G0 canonical bytes and domain-separated digest', () => {
    const result = canonicalGraph(g0())
    expect(result.canonicalBytesSha256).toBe('8301d143ef0409e613f5e37d665011343787917c902478de65a18dab4b8ea87e')
    expect(result.digest).toBe('4b061992d5b8d61732d1c9da093dd643523c9a841dd8a86d9feeeaedb6f1627b')
    expect(result.sourceTrust).toBe('content-only')
    const expected = createHash('sha256').update(Buffer.concat([Buffer.from(GRAPH_DIGEST_DOMAIN, 'utf8'), result.canonicalBytes])).digest('hex')
    expect(expected).toBe(result.digest)
  })

  it('is stable under object, node, edge, mapping, and set-array permutations', () => {
    const original = g0()
    const permuted: GraphDigestV2 = {
      ...original,
      nodes: [original.nodes[2], original.nodes[0], original.nodes[1]].map(node => ({ ...node })),
      edges: [original.edges[1], original.edges[0]].map(edge => ({ ...edge, evidenceRefs: [...edge.evidenceRefs].reverse() })),
      sourceMappings: [...original.sourceMappings].reverse().map(mapping => ({ ...mapping, sourceUse: { ...mapping.sourceUse } })),
      unresolved: ['unresolved-b', 'unresolved-a'],
    }
    const withSets: GraphDigestV2 = {
      ...original,
      nodes: original.nodes.map(node => node.id === 'node:a' ? { ...node, pages: ['b', 'a'], mediaContext: ['screen', 'base'] } : node),
      unresolved: ['unresolved-a', 'unresolved-b'],
    }
    const first = canonicalGraph({ ...original, unresolved: ['unresolved-a', 'unresolved-b'] })
    expect(canonicalGraph(permuted).digest).toBe(first.digest)
    expect(canonicalGraph(withSets).digest).not.toBe(first.digest)
    expect(canonicalGraph(withSets).digest).toBe(canonicalGraph({
      ...withSets,
      nodes: withSets.nodes.map(node => node.id === 'node:a' ? { ...node, pages: ['a', 'b'], mediaContext: ['base', 'screen'] } : node),
      unresolved: ['unresolved-b', 'unresolved-a'],
    }).digest)
  })

  it.each([
    ['duplicate node id', (graph: GraphDigestV2) => ({ ...graph, nodes: [...graph.nodes, { ...graph.nodes[0] }] })],
    ['duplicate relation id', (graph: GraphDigestV2) => ({ ...graph, edges: [...graph.edges, { ...graph.edges[0] }] })],
    ['unknown endpoint', (graph: GraphDigestV2) => ({ ...graph, edges: [{ ...graph.edges[0], to: 'missing' }, graph.edges[1]] })],
    ['unknown graph field', (graph: GraphDigestV2) => ({ ...graph, unknown: true } as unknown as GraphDigestV2)],
    ['unknown node field', (graph: GraphDigestV2) => ({ ...graph, nodes: [{ ...graph.nodes[0], unknown: true }, ...graph.nodes.slice(1)] })],
    ['unknown edge field', (graph: GraphDigestV2) => ({ ...graph, edges: [{ ...graph.edges[0], unknown: true }, graph.edges[1]] })],
    ['conflicting duplicate payload', (graph: GraphDigestV2) => ({ ...graph, edges: [...graph.edges, { ...graph.edges[0], to: 'node:a' }] })],
  ])('rejects %s', (_name: string, mutate: (graph: GraphDigestV2) => unknown) => {
    expect(() => validateGraphDigestV2(mutate(g0()))).toThrow()
  })

  it.each([
    ['graph identity version', (graph: GraphDigestV2) => ({ ...graph, graphIdentityVersion: 'sourcegraph-identity/v1' })],
    ['graph schema version', (graph: GraphDigestV2) => ({ ...graph, graphSchemaVersion: 'acp6-sourcegraph/v2' })],
    ['relation identity version', (graph: GraphDigestV2) => ({ ...graph, relationIdentityVersion: 'relation-id/v2' })],
    ['source mapping version', (graph: GraphDigestV2) => ({ ...graph, sourceMappingVersion: 'sourcegraph-source-mapping/v2' })],
    ['missing source mappings', (graph: GraphDigestV2) => ({ ...graph, sourceMappings: undefined } as unknown as GraphDigestV2)],
    ['missing source identity', (graph: GraphDigestV2) => ({ ...graph, sourceMappings: [{ ...graph.sourceMappings[0], sourceIdentity: '' }] })],
    ['wrong mapping project', (graph: GraphDigestV2) => ({ ...graph, sourceMappings: [{ ...graph.sourceMappings[0], projectId: 'other' }] })],
    ['wrong mapping anchor', (graph: GraphDigestV2) => ({ ...graph, sourceMappings: [{ ...graph.sourceMappings[0], sourceAnchorRelationId: 'rel:a' }] })],
    ['wrong source identity digest', (graph: GraphDigestV2) => ({ ...graph, sourceMappings: [{ ...graph.sourceMappings[0], sourceIdentity: `source:${'1'.repeat(64)}:src/a.css:4:4` }] })],
  ])('rejects %s', (_name: string, mutate: (graph: GraphDigestV2) => unknown) => {
    expect(() => canonicalGraph(mutate(g0()))).toThrow()
  })

  it.each([
    ['empty path', { path: '' }],
    ['absolute path', { path: '/src/a.css' }],
    ['drive path', { path: 'C:/src/a.css' }],
    ['backslash path', { path: 'src\\a.css' }],
    ['traversal path', { path: '../src/a.css' }],
    ['dot path', { path: 'src/./a.css' }],
    ['duplicate separator', { path: 'src//a.css' }],
    ['placeholder path', { path: '<unknown-source>' }],
  ])('rejects invalid source path: %s', (_name: string, change: { path: string }) => {
    const graph = g0()
    graph.edges[0].sourceUse = { ...graph.edges[0].sourceUse!, ...change }
    expect(() => canonicalGraph(graph)).toThrow()
  })

  it.each([
    ['negative offset', -1],
    ['fractional offset', 1.5],
    ['unsafe offset', Number.MAX_SAFE_INTEGER + 1],
    ['infinite offset', Number.POSITIVE_INFINITY],
    ['NaN offset', Number.NaN],
  ])('rejects %s', (_name: string, offset: number) => {
    const graph = g0()
    graph.edges[0].sourceUse = { ...graph.edges[0].sourceUse!, charOffset: offset }
    expect(() => canonicalGraph(graph)).toThrow()
  })

  it('rejects duplicate evidence members and unsupported sourceUse units', () => {
    const duplicateEvidence = g0()
    duplicateEvidence.edges[0].evidenceRefs = ['e1', 'e1']
    expect(() => canonicalGraph(duplicateEvidence)).toThrow()
    const badUnit = g0()
    badUnit.edges[0].sourceUse = { ...badUnit.edges[0].sourceUse!, offsetUnit: 'bytes' as 'code-unit' }
    expect(() => canonicalGraph(badUnit)).toThrow()
  })

  it('rejects unsafe runtime values, cycles, accessors, and non-plain objects', () => {
    expect(() => canonicalJson(undefined)).toThrow()
    expect(() => canonicalJson(null)).toThrow()
    expect(() => canonicalJson(Number.NaN)).toThrow()
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow()
    expect(() => canonicalJson(new Date())).toThrow()
    const accessor = {} as Record<string, unknown>
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 })
    expect(() => canonicalJson(accessor)).toThrow()
  })

  it('changes digest for source bytes, UTF-8 byte offsets, and domain changes', () => {
    const chinese = g0()
    chinese.nodes[0].label = '--颜色'
    const changedOffset = g0()
    changedOffset.edges[0].sourceUse = { ...changedOffset.edges[0].sourceUse!, byteOffset: 5 }
    expect(computeGraphDigestV2(chinese)).not.toBe(computeGraphDigestV2(g0()))
    expect(computeGraphDigestV2(changedOffset)).not.toBe(computeGraphDigestV2(g0()))
    const result = canonicalGraph(g0())
    const alternateDomain = createHash('sha256').update(Buffer.concat([Buffer.from('other\0', 'utf8'), result.canonicalBytes])).digest('hex')
    expect(alternateDomain).not.toBe(result.digest)
  })

  it('keeps host trust outside the pure content result', () => {
    const result = canonicalGraph(g0())
    expect(result.sourceTrust).toBe('content-only')
    expect(result).not.toHaveProperty('trusted')
    expect(result).not.toHaveProperty('sourceProof')
    expect(result).not.toHaveProperty('runtimeProof')
  })

  it('uses the frozen canonical edge enum', () => {
    expect(EDGE_KINDS).toContain('css-cascade')
  })
})

