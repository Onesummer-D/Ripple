import type { Relation, SourceGraph } from './model'

const consumerRelations = new Set<Relation['kind']>([
  'reads',
  'uses-token',
  'asset-consumer',
  'imports',
  'renders',
  'css-cascade',
])

export interface PageImpact {
  pageRefs: string[]
  unresolved: string[]
  certainty: 'source-proven' | 'partial' | 'unknown'
}

/** Follows only source-proven consumer edges; candidate writes fail closed on incomplete proof. */
export function sourceProvenPageImpact(graph: SourceGraph, sourceRef: string): PageImpact {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const target = nodes.get(sourceRef)
  if (!target) return { pageRefs: [], unresolved: [`目标不在当前源码图中：${sourceRef}`], certainty: 'unknown' }

  const incoming = new Map<string, Relation[]>()
  for (const edge of graph.edges) {
    if (!consumerRelations.has(edge.kind)) continue
    if (!incoming.has(edge.to)) incoming.set(edge.to, [])
    incoming.get(edge.to)!.push(edge)
  }

  const pageRefs = new Set<string>()
  const unresolved: string[] = []
  const visited = new Set<string>()
  const queue = [sourceRef]
  while (queue.length) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    const node = nodes.get(current)
    if (!node) {
      unresolved.push(`关系图引用了不存在的源码节点：${current}`)
      continue
    }
    if (node.kind === 'route') pageRefs.add(node.id)
    if (node.kind === 'component') {
      for (const page of node.pages ?? []) {
        const pageRef = `page:${page}`
        if (nodes.get(pageRef)?.kind === 'route') pageRefs.add(pageRef)
        else unresolved.push(`组件 ${node.label} 声明了未解析页面：${pageRef}`)
      }
    }
    for (const edge of incoming.get(current) ?? []) {
      if (edge.certainty !== 'source-proven') {
        unresolved.push(`目标存在非确定的消费者关系：${edge.id}`)
        continue
      }
      queue.push(edge.from)
    }
  }

  // An unresolved import matters only when its importing file is in this target's
  // proven consumer subgraph. Unrelated project dependencies do not poison every edit.
  const reachableFiles = new Set([...visited].filter(ref => ref.startsWith('file:')))
  for (const ref of visited) {
    const node = nodes.get(ref)
    if (node?.location?.path) reachableFiles.add(`file:${node.location.path}`)
  }
  for (const dependency of graph.unresolved) {
    const delimiter = dependency.indexOf(' → ')
    if (delimiter < 0) continue
    const importer = `file:${dependency.slice(0, delimiter)}`
    if (reachableFiles.has(importer)) unresolved.push(`受影响子图含有未解析依赖：${dependency}`)
  }

  if (!pageRefs.size) unresolved.push(`目标没有可证明的页面消费者：${sourceRef}`)
  const uniqueUnresolved = [...new Set(unresolved)]
  return {
    pageRefs: [...pageRefs].sort(),
    unresolved: uniqueUnresolved,
    certainty: uniqueUnresolved.length ? pageRefs.size ? 'partial' : 'unknown' : 'source-proven',
  }
}
