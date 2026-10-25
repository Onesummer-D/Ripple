// Strict evidence matching helpers for AC6.2–AC6.4.
// Source offsets are explicit: CSS byte offsets are UTF-8 byte offsets; JSX offsets are JS source indices.
const ELEMENT_KINDS = new Set(['jsx-element', 'host-element', 'element'])

export function sourcePath(node) {
  return node?.location?.path ?? node?.file ?? node?.sourceFile ?? null
}

export function sourceByteOffset(node) {
  const value = node?.byteOffset ?? node?.location?.byteOffset ?? node?.sourceRange?.byteStart ??
    node?.range?.byteStart
  return Number.isInteger(value) ? value : null
}

export function sourceElementOffset(node) {
  const value = node?.elementOffset ?? node?.sourceOffset ?? node?.location?.start ??
    node?.range?.start ?? node?.sourceRange?.start ?? node?.offset
  return Number.isInteger(value) ? value : null
}

export function sourceScope(node) {
  const value = node?.selectorScope ?? node?.location?.selectorScope ?? node?.scope?.selector ?? node?.scope ?? node?.tokenScope?.selectorScope ?? node?.selector ?? null
  return typeof value === 'string' ? value : value?.selector ?? value?.selectorScope ?? null
}

export function exactDefinitionNodes(declaration, nodes) {
  return nodes.filter(node =>
    node.kind === 'token' &&
    node.label === declaration.token &&
    sourcePath(node) === declaration.file &&
    sourceByteOffset(node) === declaration.byteOffset &&
    sourceScope(node) === declaration.selector,
  )
}

export function normalizeRoutePath(raw) {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  value = value.replace(/^(?:route|page)\s*:\s*/i, '')
  if (value.startsWith('#/')) value = value.slice(1)
  if (!value.startsWith('/')) return null
  value = value.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/')
  if (value.length > 1) value = value.replace(/\/+$/, '')
  return value || '/'
}

function nodeRoutePaths(node) {
  return [...new Set([node.routePath, node.path, node.page, node.label, node.id]
    .map(normalizeRoutePath).filter(Boolean))]
}

export function matchExactRoutes(expectedRoutes, routeNodes) {
  const normalized = expectedRoutes.map(route => ({ route, identity: normalizeRoutePath(route) }))
  const validExpected = normalized.every(item => item.identity) &&
    new Set(normalized.map(item => item.identity)).size === normalized.length
  const matches = normalized.map(item => {
    const candidates = routeNodes.filter(node => nodeRoutePaths(node).includes(item.identity))
    return {
      route: item.route,
      normalizedRoute: item.identity,
      graphNodeIds: candidates.map(node => node.id),
      matched: Boolean(item.identity) && candidates.length === 1,
    }
  })
  const assignedIds = matches.flatMap(item => item.matched ? item.graphNodeIds : [])
  const uniqueAssignments = new Set(assignedIds).size === assignedIds.length
  return { matches, pass: validExpected && matches.length > 0 && matches.every(item => item.matched) && uniqueAssignments }
}

export function selectorClassTokens(selector) {
  if (typeof selector !== 'string') return []
  const tokens = []
  let inAttribute = 0
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '[') { inAttribute++; continue }
    if (ch === ']' && inAttribute) { inAttribute--; continue }
    if (inAttribute || ch !== '.') continue
    let j = i + 1
    while (j < selector.length && /[\w-]/.test(selector[j])) j++
    if (j > i + 1) tokens.push(selector.slice(i + 1, j))
    i = j - 1
  }
  return [...new Set(tokens)]
}

export function classNameTokens(value) {
  return typeof value === 'string' ? [...new Set(value.trim().split(/\s+/).filter(Boolean))] : []
}

function edgeUseMatches(edge, use) {
  const sources = [edge.sourceUse, edge.use, edge.location, edge.sourcePosition].filter(Boolean)
  for (const source of sources) {
    const file = source.path ?? source.file ?? source.location?.path
    const charOffset = source.charOffset ?? source.codeUnitOffset ??
      (['code-unit', 'utf16'].includes(source.offsetUnit) ? source.offset ?? source.location?.offset : null)
    const byteOffset = source.byteOffset ?? source.location?.byteOffset
    if (file === use.file && (
      (Number.isInteger(byteOffset) && byteOffset === use.byteOffset) ||
      (Number.isInteger(charOffset) && charOffset === use.index)
    )) return true
  }
  const refs = [
    edge.id,
    edge.provenance,
    edge.evidenceRef,
    ...(Array.isArray(edge.evidenceRefs) ? edge.evidenceRefs : []),
  ].filter(value => typeof value === 'string')
  return refs.some(ref => {
    const match = ref.match(/^css-token-use:(.*):(\d+)$/)
    return Boolean(match && match[1] === use.file && Number(match[2]) === use.index)
  })
}

export function consumerNodeMatches(pair, node) {
  if (!ELEMENT_KINDS.has(node?.kind) || pair?.dynamic === true || node?.dynamicClassName === true) return false
  if (sourcePath(node) !== pair.file || sourceElementOffset(node) !== pair.elementOffset) return false
  const expected = pair.matchedClass
  if (typeof expected !== 'string' || !expected) return false
  if (typeof node.matchedClass === 'string' && node.matchedClass !== expected) return false
  if (typeof node.className === 'string' && !classNameTokens(node.className).includes(expected)) return false
  if (Array.isArray(node.classes) && !node.classes.includes(expected)) return false
  const selectorClasses = selectorClassTokens(node.selector)
  if (selectorClasses.length && !selectorClasses.includes(expected)) return false
  return true
}

export function strictTokenConsumerEdge(edge, tokenNode, consumerNode, use, pair, declaration) {
  if (edge?.kind !== 'uses-token') return { matches: false, reason: 'wrong-edge-kind' }
  const endpoints = [edge.from, edge.to]
  if (!endpoints.includes(tokenNode?.id) || !endpoints.includes(consumerNode?.id) ||
      endpoints[0] === endpoints[1] || new Set(endpoints).size !== 2) {
    return { matches: false, reason: 'endpoints-do-not-bind-token-to-consumer' }
  }
  if (tokenNode.label !== declaration.token || sourcePath(tokenNode) !== declaration.file ||
      sourceByteOffset(tokenNode) !== declaration.byteOffset || sourceScope(tokenNode) !== declaration.selector) {
    return { matches: false, reason: 'token-endpoint-does-not-match-source-declaration-scope' }
  }
  if (!consumerNodeMatches(pair, consumerNode)) return { matches: false, reason: 'consumer-endpoint-does-not-match-static-source-element' }
  if (!edgeUseMatches(edge, use)) return { matches: false, reason: 'edge-has-no-matching-var-source-position' }
  const edgeScope = edge.selectorScope ?? edge.scope?.selector ?? edge.tokenScope?.selectorScope
  if (edgeScope != null && edgeScope !== declaration.selector) return { matches: false, reason: 'edge-scope-does-not-match-declaration' }
  return { matches: true, reason: null }
}

export function evaluateAc62({ declarations, uses, nodes, edges }) {
  const tokenNodes = nodes.filter(node => node.kind === 'token')
  const consumers = nodes.filter(node => ELEMENT_KINDS.has(node.kind))
  const usedTokens = [...new Set(uses.map(use => use.token))]
  const declarationSetCoverage = usedTokens.map(token => {
    const tokenDeclarations = declarations.filter(declaration => declaration.token === token)
    const tokenUses = uses.filter(use => use.token === token)
    const links = tokenDeclarations.map(declaration => {
      const definitions = exactDefinitionNodes(declaration, tokenNodes)
      const valid = []
      if (definitions.length === 1) {
        for (const use of tokenUses) {
          for (const pair of use.consumerElements ?? []) {
            for (const consumer of consumers) {
              for (const edge of edges) {
                const result = strictTokenConsumerEdge(edge, definitions[0], consumer, use, pair, declaration)
                if (result.matches) valid.push({ useOffset: use.index, consumerId: consumer.id, edgeId: edge.id ?? null })
              }
            }
          }
        }
      }
      return {
        file: declaration.file,
        byteOffset: declaration.byteOffset,
        selectorScope: declaration.selector,
        graphNodeIds: definitions.map(node => node.id),
        matchedExactlyOnce: definitions.length === 1,
        linkedStrictEdges: valid.length,
        covered: definitions.length === 1 && valid.length > 0,
      }
    })
    const sourceUseCoverage = tokenUses.map(use => {
      const valid = []
      for (const declaration of tokenDeclarations) {
        const definitions = exactDefinitionNodes(declaration, tokenNodes)
        if (definitions.length !== 1) continue
        for (const pair of use.consumerElements ?? []) {
          for (const consumer of consumers) {
            for (const edge of edges) {
              const result = strictTokenConsumerEdge(edge, definitions[0], consumer, use, pair, declaration)
              if (result.matches) valid.push({ consumerId: consumer.id, edgeId: edge.id ?? null })
            }
          }
        }
      }
      return { file: use.file, offset: use.index, byteOffset: use.byteOffset, selector: use.selector, candidateConsumers: (use.consumerElements ?? []).length, linkedStrictEdges: valid.length, covered: valid.length > 0 }
    })
    return {
      token,
      declarationCount: tokenDeclarations.length,
      connectedDeclarationCount: links.filter(link => link.covered).length,
      links,
      sourceUseCoverage,
      covered: tokenDeclarations.length > 0 && links.every(link => link.covered) && sourceUseCoverage.length > 0 && sourceUseCoverage.every(use => use.covered),
    }
  })
  return {
    pass: usedTokens.length > 0 && declarationSetCoverage.every(item => item.covered),
    usedTokens,
    declarationSetCoverage,
    coveredTokens: declarationSetCoverage.filter(item => item.covered).map(item => item.token),
    uncoveredTokens: declarationSetCoverage.filter(item => !item.covered).map(item => item.token),
  }
}


export function evaluateAc64({ pairs, declarations, uses, nodes, edges }) {
  const consumerNodes = nodes.filter(node => ELEMENT_KINDS.has(node.kind))
  const anchoredConsumerPairs = pairs.map(pair => {
    const matches = []
    for (const sourceUse of pair.sourceUses ?? []) {
      const use = uses.find(item => item.token === pair.token && item.file === sourceUse.file && item.index === sourceUse.index)
      if (!use) continue
      for (const declaration of declarations.filter(item => item.token === pair.token)) {
        const definitions = exactDefinitionNodes(declaration, nodes)
        if (definitions.length !== 1) continue
        for (const consumer of consumerNodes) {
          for (const edge of edges) {
            const result = strictTokenConsumerEdge(edge, definitions[0], consumer, use, pair, declaration)
            if (result.matches) matches.push({ edgeId: edge.id ?? null, from: edge.from, to: edge.to, consumerId: consumer.id, sourceUse: sourceUse })
          }
        }
      }
    }
    return { ...pair, edgeCount: matches.length, edgeIds: matches, anchored: matches.length > 0 }
  })
  return {
    pass: pairs.length > 0 && anchoredConsumerPairs.every(pair => pair.anchored),
    anchoredConsumerPairs,
    uncoveredConsumerPairs: anchoredConsumerPairs.filter(pair => !pair.anchored),
  }
}
