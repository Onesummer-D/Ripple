import type { EditOperation, Relation, ScopeDecision, SourceGraph, SourceNode } from './model'

const consumerRelations = new Set<Relation['kind']>([
  'reads',
  'uses-token',
  'asset-consumer',
  'renders',
  'css-cascade',
])

const mediaConsumerRelations = new Set<Relation['kind']>([
  'asset-consumer',
  'renders',
])

const fileDependencyRelations = new Set<Relation['kind']>(['imports'])

export interface PageImpact {
  pageRefs: string[]
  unresolved: string[]
  certainty: 'source-proven' | 'partial' | 'unknown'
}

export type ScopePageDecision = Pick<ScopeDecision, 'strategy' | 'localPageRef' | 'includedRefs' | 'excludedRefs' | 'protectedRefs'>

export type OperationPageEffect =
  | { pageRef: string; effect: 'change' }
  | { pageRef: string; effect: 'preserve' }
  | { pageRef: string; effect: 'conflict'; reason: string }

export interface PageTextExpectation {
  baselineText: string
  candidateText: string
  shouldChange: boolean
}

export function expectedTextForScope(scope: ScopePageDecision, pageRef: string, baselineText: string, requestedText: string): PageTextExpectation {
  const shouldChange = scope.strategy === 'page-override'
    ? scope.localPageRef === pageRef
    : scope.includedRefs.includes(pageRef)
  return { baselineText, candidateText: shouldChange ? requestedText : baselineText, shouldChange }
}

export function pageTextValues(source: Pick<SourceNode, 'value' | 'pageOverrides'>, operation: EditOperation, pageRef: string): Pick<PageTextExpectation, 'baselineText'> & { requestedText: string } {
  const baselineText = source.pageOverrides?.[pageRef] ?? source.value ?? operation.before
  const requestedText = operation.overrideAction === 'remove' ? source.value ?? operation.before : operation.after
  return { baselineText, requestedText }
}

export function expectedTextForPage(source: Pick<SourceNode, 'value' | 'pageOverrides'>, operation: EditOperation, scope: ScopePageDecision, pageRef: string): PageTextExpectation {
  const { baselineText, requestedText } = pageTextValues(source, operation, pageRef)
  return expectedTextForScope(scope, pageRef, baselineText, requestedText)
}

/** Shared page-level Scope decision used by candidate enforcement and the workbench preview. */
export function evaluateOperationPageScope(scope: ScopePageDecision, affectedPageRefs: readonly string[]): OperationPageEffect[] {
  const included = new Set(scope.includedRefs)
  const excluded = new Set(scope.excludedRefs)
  const protectedRefs = new Set(scope.protectedRefs)
  const isExcluded = (pageRef: string) => excluded.has(pageRef) || protectedRefs.has(pageRef)

  if (scope.strategy !== 'page-override') {
    return affectedPageRefs.map(pageRef => {
      if (isExcluded(pageRef)) return { pageRef, effect: 'conflict', reason: `操作会影响 Scope 排除或保护的页面：${pageRef}` }
      if (!included.has(pageRef)) return { pageRef, effect: 'conflict', reason: `Scope 尚未明确包含受影响页面：${pageRef}` }
      return { pageRef, effect: 'change' }
    })
  }

  const localPageRef = scope.localPageRef
  if (!localPageRef || !included.has(localPageRef) || isExcluded(localPageRef)) {
    return affectedPageRefs.map(pageRef => ({ pageRef, effect: 'conflict', reason: '页面覆盖需要明确包含一个未排除或未保护的目标页面' }))
  }

  return affectedPageRefs.map(pageRef => {
    if (pageRef === localPageRef) return { pageRef, effect: 'change' }
    if (isExcluded(pageRef)) return { pageRef, effect: 'preserve' }
    return { pageRef, effect: 'conflict', reason: `页面覆盖要求明确排除或保护其他共享消费者：${pageRef}` }
  })
}

/** Follows only source-proven consumer edges; candidate writes fail closed on incomplete proof. */
export function sourceProvenPageImpact(graph: SourceGraph, sourceRef: string): PageImpact {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const target = nodes.get(sourceRef)
  if (!target) return { pageRefs: [], unresolved: [`目标不在当前源码图中：${sourceRef}`], certainty: 'unknown' }

  // Imports describe file dependencies, not proof that a file consumes a resource.
  // TEXT and TOKEN still use them to trace shared source definitions through modules;
  // MEDIA impact must start from an actual asset-consumer relation instead of the
  // definition file's `reads` edge or any page that merely imports that file.
  const traversableRelations = target.kind === 'media'
    ? mediaConsumerRelations
    : consumerRelations

  const incoming = new Map<string, Relation[]>()
  for (const edge of graph.edges) {
    if (!traversableRelations.has(edge.kind) && !(target.kind !== 'media' && fileDependencyRelations.has(edge.kind))) continue
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

