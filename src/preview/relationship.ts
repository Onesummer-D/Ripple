import type { CaseFixture, ScopeDecision } from '../domain/contracts'

export function relationshipProjection(fixture: CaseFixture, sourceId: string, decision?: ScopeDecision) {
  const sources = fixture.graph.nodes.filter((node) => node.kind === 'source').map((node, index) => ({ ...node, x: 85, y: 75 + index * 160, selected: node.id === sourceId }))
  const affected = new Set(decision?.affectedInstanceIds ?? [])
  const instances = fixture.graph.nodes.filter((node) => node.kind === 'instance').map((node, index) => {
    const consumedSources = fixture.graph.edges.filter((edge) => edge.type === 'reads' && edge.from === node.id).map((edge) => edge.to)
    const knownSources = consumedSources.length ? consumedSources : node.sourceId ? [node.sourceId] : []
    return { ...node, x: 405, y: 55 + index * 82, affected: affected.has(node.id), independent: knownSources.length > 0 && !knownSources.includes(sourceId), unknown: knownSources.length === 0 }
  })
  const edges = fixture.graph.edges.filter((edge) => edge.type === 'reads').flatMap((edge) => {
    const instance = instances.find((node) => node.id === edge.from)
    const source = sources.find((node) => node.id === edge.to)
    return instance && source ? [{ ...edge, source, instance, affected: instance.affected && source.selected }] : []
  })
  return { sources, instances, edges, height: Math.max(230, instances.length * 82 + 40, sources.length * 160 + 40), affectedCount: instances.filter((node) => node.affected).length }
}
