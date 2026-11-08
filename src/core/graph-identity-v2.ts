import { createHash } from 'node:crypto'

export const GRAPH_IDENTITY_VERSION = 'sourcegraph-identity/v2' as const
export const GRAPH_SCHEMA_VERSION = 'acp6-sourcegraph/v1' as const
export const SOURCE_MAPPING_VERSION = 'sourcegraph-source-mapping/v1' as const
export const GRAPH_DIGEST_DOMAIN = 'ripple/sourcegraph-identity/v2/graphDigest\0' as const
export const SOURCE_OFFSET_UNIT = 'code-unit' as const

export const GRAPH_FIELDS = [
  'graphIdentityVersion',
  'graphSchemaVersion',
  'relationIdentityVersion',
  'sourceMappingVersion',
  'projectId',
  'sourceDigest',
  'sourceMappings',
  'nodes',
  'edges',
  'unresolved',
] as const

const NODE_FIELDS = [
  'id', 'kind', 'label', 'location', 'page', 'routePath', 'pages', 'selector',
  'selectorScope', 'byteOffset', 'mediaContext', 'className', 'dynamicClassName',
  'value', 'pageOverrides', 'tokenOrigin',
] as const
const EDGE_FIELDS = [
  'id', 'from', 'to', 'kind', 'certainty', 'evidenceRefs', 'sourceUse',
  'selectorScope', 'mediaContext', 'producerIdentity', 'sourceIdentity',
] as const
const SOURCE_USE_FIELDS = ['path', 'charOffset', 'byteOffset', 'offsetUnit'] as const
const LOCATION_FIELDS = ['path', 'start', 'end', 'offset', 'byteOffset'] as const
const SOURCE_MAPPING_FIELDS = [
  'projectId', 'sourceRef', 'graphNodeId', 'sourceAnchorRelationId', 'sourceIdentity', 'sourceUse',
] as const

export const NODE_KINDS = [
  'file', 'symbol', 'component', 'route', 'data', 'media', 'token', 'token-use', 'jsx-element', 'state',
] as const
export const EDGE_KINDS = [
  'imports', 'reads', 'renders', 'uses-token', 'token-reference', 'asset-consumer', 'css-cascade', 'same-copy', 'semantic-link',
] as const
export const RELATION_CERTAINTIES = ['source-proven', 'runtime-observed', 'semantic-candidate', 'unknown'] as const
export const TOKEN_ORIGINS = ['css-custom-property', 'tailwind-palette'] as const

type NodeKind = typeof NODE_KINDS[number]
type EdgeKind = typeof EDGE_KINDS[number]
type RelationCertainty = typeof RELATION_CERTAINTIES[number]
type TokenOrigin = typeof TOKEN_ORIGINS[number]
type JsonPrimitive = boolean | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface GraphSourceUse {
  path: string
  charOffset: number
  byteOffset: number
  offsetUnit: typeof SOURCE_OFFSET_UNIT
}

export interface GraphLocation {
  path: string
  start?: number
  end?: number
  offset?: number
  byteOffset?: number
}

export interface GraphNode {
  id: string
  kind: NodeKind
  label?: string
  location?: GraphLocation
  page?: string
  routePath?: string
  pages?: string[]
  selector?: string
  selectorScope?: string
  byteOffset?: number
  mediaContext?: string[]
  className?: string
  dynamicClassName?: boolean
  value?: string
  pageOverrides?: Record<string, string>
  tokenOrigin?: TokenOrigin
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  certainty: RelationCertainty
  evidenceRefs: string[]
  sourceUse?: GraphSourceUse
  selectorScope?: string
  mediaContext?: string[]
  producerIdentity?: string
  sourceIdentity?: string
}

export interface GraphSourceMapping {
  projectId: string
  sourceRef: string
  graphNodeId: string
  sourceAnchorRelationId: string
  sourceIdentity: string
  sourceUse: GraphSourceUse
}

export interface GraphDigestV2 {
  graphIdentityVersion: string
  graphSchemaVersion: string
  relationIdentityVersion: string
  sourceMappingVersion: typeof SOURCE_MAPPING_VERSION
  projectId: string
  sourceDigest: string
  sourceMappings: GraphSourceMapping[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: string[]
}

export type GraphValidationCode =
  | 'graph-schema-invalid'
  | 'duplicate-node-id'
  | 'duplicate-relation-id'
  | 'unknown-endpoint'
  | 'source-mapping-invalid'

export class GraphIdentityValidationError extends TypeError {
  readonly code: GraphValidationCode

  constructor(message: string, code: GraphValidationCode = 'graph-schema-invalid') {
    super(message)
    this.name = 'GraphIdentityValidationError'
    this.code = code
  }
}

function fail(message: string, code: GraphValidationCode = 'graph-schema-invalid'): never {
  throw new GraphIdentityValidationError(message, code)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return false
  }
  return true
}

function assertExactFields(value: unknown, field: string, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) fail(`${field} must be a plain data object`)
  const allowedSet = new Set(allowed)
  const keys = Reflect.ownKeys(value)
  const unknown = keys.filter(key => typeof key !== 'string' || !allowedSet.has(key))
  if (unknown.length > 0) fail(`${field} contains unknown field(s): ${unknown.map(String).join(', ')}`)
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) fail(`${field} must be a non-empty string`)
}

function assertConcreteString(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field)
  if (value.trim().length === 0 || /^<[^>]+>$/.test(value)) fail(`${field} must be concrete`)
}

function assertSafeOffset(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    fail(`${field} must be a non-negative safe integer`)
  }
}

function assertSha256(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field)
  if (!/^[0-9a-f]{64}$/.test(value)) fail(`${field} must be lowercase SHA-256`)
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function assertRelativePosixPath(value: unknown, field: string): asserts value is string {
  assertConcreteString(value, field)
  if (value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) fail(`${field} must be repository-relative POSIX path`)
  if (value.includes('\\') || value.includes('\0') || value.includes('//')) fail(`${field} contains invalid path separator`)
  const segments = value.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) fail(`${field} contains invalid path segment`)
}

function assertArrayShape(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`)
  const ownKeys = Reflect.ownKeys(value)
  for (const key of ownKeys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) fail(`${field} has a non-canonical array property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${field} has a non-data array property`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail(`${field} must not be sparse`)
  }
}

function assertUniqueStringArray(value: unknown, field: string): asserts value is string[] {
  assertArrayShape(value, field)
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${field}[${index}]`)
    if (seen.has(item)) fail(`${field} contains duplicate member`)
    seen.add(item)
  }
}

function assertSourceUse(value: unknown, field: string): asserts value is GraphSourceUse {
  assertExactFields(value, field, SOURCE_USE_FIELDS)
  assertRelativePosixPath(value.path, `${field}.path`)
  assertSafeOffset(value.charOffset, `${field}.charOffset`)
  assertSafeOffset(value.byteOffset, `${field}.byteOffset`)
  if (value.offsetUnit !== SOURCE_OFFSET_UNIT) fail(`${field}.offsetUnit must be '${SOURCE_OFFSET_UNIT}'`)
}

function sourceUseEqual(left: GraphSourceUse | undefined, right: GraphSourceUse | undefined): boolean {
  return left?.path === right?.path
    && left?.charOffset === right?.charOffset
    && left?.byteOffset === right?.byteOffset
    && left?.offsetUnit === right?.offsetUnit
}

function assertLocation(value: unknown, field: string): asserts value is GraphLocation {
  assertExactFields(value, field, LOCATION_FIELDS)
  assertRelativePosixPath(value.path, `${field}.path`)
  for (const key of ['start', 'end', 'offset', 'byteOffset'] as const) {
    if (key in value) assertSafeOffset(value[key], `${field}.${key}`)
  }
}

function assertPageOverrides(value: unknown, field: string): asserts value is Record<string, string> {
  if (!isPlainRecord(value)) fail(`${field} must be a plain data object`)
  for (const [key, item] of Object.entries(value)) {
    assertNonEmptyString(key, `${field} key`)
    assertNonEmptyString(item, `${field}.${key}`)
  }
}

function assertNode(value: unknown, index: number): asserts value is GraphNode {
  const field = `nodes[${index}]`
  assertExactFields(value, field, NODE_FIELDS)
  assertConcreteString(value.id, `${field}.id`)
  assertNonEmptyString(value.kind, `${field}.kind`)
  if (!(NODE_KINDS as readonly string[]).includes(value.kind)) fail(`${field}.kind is not canonical`)
  if ('label' in value) assertNonEmptyString(value.label, `${field}.label`)
  for (const key of ['page', 'routePath', 'selector', 'selectorScope', 'className', 'value'] as const) {
    if (key in value) assertNonEmptyString(value[key], `${field}.${key}`)
  }
  for (const key of ['pages', 'mediaContext'] as const) {
    if (key in value) assertUniqueStringArray(value[key], `${field}.${key}`)
  }
  if ('byteOffset' in value) assertSafeOffset(value.byteOffset, `${field}.byteOffset`)
  if ('dynamicClassName' in value && typeof value.dynamicClassName !== 'boolean') fail(`${field}.dynamicClassName must be boolean`)
  if ('pageOverrides' in value) assertPageOverrides(value.pageOverrides, `${field}.pageOverrides`)
  if ('tokenOrigin' in value) {
    assertNonEmptyString(value.tokenOrigin, `${field}.tokenOrigin`)
    if (!(TOKEN_ORIGINS as readonly string[]).includes(value.tokenOrigin)) fail(`${field}.tokenOrigin is not canonical`)
  }
  if ('location' in value) assertLocation(value.location, `${field}.location`)
}

function assertEdge(value: unknown, index: number): asserts value is GraphEdge {
  const field = `edges[${index}]`
  assertExactFields(value, field, EDGE_FIELDS)
  assertConcreteString(value.id, `${field}.id`)
  assertConcreteString(value.from, `${field}.from`)
  assertConcreteString(value.to, `${field}.to`)
  assertNonEmptyString(value.kind, `${field}.kind`)
  if (!(EDGE_KINDS as readonly string[]).includes(value.kind)) fail(`${field}.kind is not canonical`)
  assertNonEmptyString(value.certainty, `${field}.certainty`)
  if (!(RELATION_CERTAINTIES as readonly string[]).includes(value.certainty)) fail(`${field}.certainty is not canonical`)
  if (!('evidenceRefs' in value)) fail(`${field}.evidenceRefs is required`)
  assertUniqueStringArray(value.evidenceRefs, `${field}.evidenceRefs`)
  if ('sourceUse' in value) assertSourceUse(value.sourceUse, `${field}.sourceUse`)
  if ('selectorScope' in value) assertNonEmptyString(value.selectorScope, `${field}.selectorScope`)
  if ('mediaContext' in value) assertUniqueStringArray(value.mediaContext, `${field}.mediaContext`)
  if ('producerIdentity' in value) assertConcreteString(value.producerIdentity, `${field}.producerIdentity`)
  if ('sourceIdentity' in value) assertConcreteString(value.sourceIdentity, `${field}.sourceIdentity`)
}

function expectedSourceIdentity(graph: GraphDigestV2, mapping: GraphSourceMapping): string {
  return `source:${graph.sourceDigest}:${mapping.sourceUse.path}:${mapping.sourceUse.charOffset}:${mapping.sourceUse.byteOffset}`
}

function assertSourceIdentity(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field)
  if (!/^source:[0-9a-f]{64}:[^:]+:[0-9]+:[0-9]+$/.test(value)) fail(`${field} must be a source identity`, 'source-mapping-invalid')
}

function assertSourceMapping(value: unknown, index: number): asserts value is GraphSourceMapping {
  const field = `sourceMappings[${index}]`
  assertExactFields(value, field, SOURCE_MAPPING_FIELDS)
  assertConcreteString(value.projectId, `${field}.projectId`)
  assertConcreteString(value.sourceRef, `${field}.sourceRef`)
  assertConcreteString(value.graphNodeId, `${field}.graphNodeId`)
  assertConcreteString(value.sourceAnchorRelationId, `${field}.sourceAnchorRelationId`)
  assertSourceIdentity(value.sourceIdentity, `${field}.sourceIdentity`)
  assertSourceUse(value.sourceUse, `${field}.sourceUse`)
}

export function validateGraphDigestV2(value: unknown): asserts value is GraphDigestV2 {
  assertExactFields(value, 'graph', GRAPH_FIELDS)
  const graph = value
  if (graph.graphIdentityVersion !== GRAPH_IDENTITY_VERSION) fail('graphIdentityVersion mismatch')
  assertNonEmptyString(graph.graphSchemaVersion, 'graphSchemaVersion')
  assertNonEmptyString(graph.relationIdentityVersion, 'relationIdentityVersion')
  if (graph.sourceMappingVersion !== SOURCE_MAPPING_VERSION) fail('sourceMappingVersion mismatch')
  assertConcreteString(graph.projectId, 'projectId')
  assertSha256(graph.sourceDigest, 'sourceDigest')
  assertArrayShape(graph.sourceMappings, 'sourceMappings')
  assertArrayShape(graph.nodes, 'nodes')
  assertArrayShape(graph.edges, 'edges')
  assertUniqueStringArray(graph.unresolved, 'unresolved')

  const sourceMappings = graph.sourceMappings as unknown as GraphSourceMapping[]
  const nodes = graph.nodes as unknown as GraphNode[]
  const edges = graph.edges as unknown as GraphEdge[]

  const nodeIds = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    assertNode(node, index)
    if (nodeIds.has(node.id)) fail(`duplicate node.id: ${node.id}`, 'duplicate-node-id')
    nodeIds.add(node.id)
  }

  const relationIds = new Set<string>()
  for (const [index, edge] of edges.entries()) {
    assertEdge(edge, index)
    if (relationIds.has(edge.id)) fail(`duplicate Relation.id: ${edge.id}`, 'duplicate-relation-id')
    relationIds.add(edge.id)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail(`unknown relation endpoint: ${edge.id}`, 'unknown-endpoint')
  }

  const mappingRefs = new Set<string>()
  const mappingNodes = new Set<string>()
  const mappingAnchors = new Set<string>()
  for (const [index, mapping] of sourceMappings.entries()) {
    assertSourceMapping(mapping, index)
    if (mapping.projectId !== graph.projectId) fail(`source mapping projectId differs from graph: ${mapping.sourceRef}`, 'source-mapping-invalid')
    if (mapping.sourceRef !== mapping.graphNodeId) fail(`source mapping sourceRef must equal graphNodeId: ${mapping.sourceRef}`, 'source-mapping-invalid')
    if (mappingRefs.has(mapping.sourceRef) || mappingNodes.has(mapping.graphNodeId) || mappingAnchors.has(mapping.sourceAnchorRelationId)) {
      fail(`duplicate source mapping: ${mapping.sourceRef}`, 'source-mapping-invalid')
    }
    mappingRefs.add(mapping.sourceRef)
    mappingNodes.add(mapping.graphNodeId)
    mappingAnchors.add(mapping.sourceAnchorRelationId)
    const sourceNode = nodes.find(node => node.id === mapping.graphNodeId)
    if (!sourceNode || sourceNode.kind !== 'token-use') fail(`source mapping graphNodeId is not token-use: ${mapping.graphNodeId}`, 'source-mapping-invalid')
    const anchors = edges.filter(edge => edge.id === mapping.sourceAnchorRelationId)
    if (anchors.length !== 1) fail(`source mapping anchor is not unique: ${mapping.sourceAnchorRelationId}`, 'source-mapping-invalid')
    const anchor = anchors[0]
    const anchorFrom = nodes.find(node => node.id === anchor.from)
    if (!anchorFrom || anchorFrom.kind !== 'file') fail(`source mapping anchor is not a file source: ${mapping.sourceRef}`, 'source-mapping-invalid')
    if (anchor.kind !== 'reads' || anchor.certainty !== 'source-proven' || anchor.to !== mapping.graphNodeId || !sourceUseEqual(anchor.sourceUse, mapping.sourceUse)) {
      fail(`source mapping anchor is not trusted: ${mapping.sourceRef}`, 'source-mapping-invalid')
    }
    if (mapping.sourceIdentity !== expectedSourceIdentity(graph as unknown as GraphDigestV2, mapping)) fail(`source mapping sourceIdentity is not derived from graph sourceDigest: ${mapping.sourceRef}`, 'source-mapping-invalid')
  }
}

function canonicalJsonValue(value: unknown, active: WeakSet<object>, path: string): string {
  if (value === null) fail(`${path} null is not allowed`)
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail(`${path} number is not canonical`)
    return JSON.stringify(value)
  }
  if (value === undefined) fail(`${path} undefined is not allowed`)
  if (typeof value !== 'object') fail(`${path} has unsupported type`)
  if (active.has(value)) fail(`${path} contains a cyclic object`)
  active.add(value)
  try {
    if (Array.isArray(value)) {
      assertArrayShape(value, path)
      return `[${value.map((item, index) => canonicalJsonValue(item, active, `${path}[${index}]`)).join(',')}]`
    }
    if (!isPlainRecord(value)) fail(`${path} must be a plain data object`)
    const keys = Reflect.ownKeys(value)
    const stringKeys = keys as string[]
    stringKeys.sort(utf8Compare)
    return `{${stringKeys.map(key => `${JSON.stringify(key)}:${canonicalJsonValue(value[key], active, `${path}.${key}`)}`).join(',')}}`
  } finally {
    active.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new WeakSet<object>(), '$')
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeGraph(graph: GraphDigestV2): GraphDigestV2 {
  const normalizedNodes = graph.nodes.map(node => ({
    ...node,
    ...(node.location ? { location: { ...node.location } } : {}),
    ...(node.pages ? { pages: [...node.pages].sort(utf8Compare) } : {}),
    ...(node.mediaContext ? { mediaContext: [...node.mediaContext].sort(utf8Compare) } : {}),
    ...(node.pageOverrides ? { pageOverrides: { ...node.pageOverrides } } : {}),
  })).sort((left, right) => utf8Compare(left.id, right.id))
  const normalizedEdges = graph.edges.map(edge => ({
    ...edge,
    evidenceRefs: [...edge.evidenceRefs].sort(utf8Compare),
    ...(edge.sourceUse ? { sourceUse: { ...edge.sourceUse } } : {}),
    ...(edge.mediaContext ? { mediaContext: [...edge.mediaContext].sort(utf8Compare) } : {}),
  })).sort((left, right) => utf8Compare(left.id, right.id))
  const normalizedMappings = graph.sourceMappings.map(mapping => ({
    ...mapping,
    sourceUse: { ...mapping.sourceUse },
  })).sort((left, right) => {
    const sourceCompare = utf8Compare(left.sourceRef, right.sourceRef)
    return sourceCompare !== 0 ? sourceCompare : utf8Compare(left.sourceAnchorRelationId, right.sourceAnchorRelationId)
  })
  return {
    graphIdentityVersion: graph.graphIdentityVersion,
    graphSchemaVersion: graph.graphSchemaVersion,
    relationIdentityVersion: graph.relationIdentityVersion,
    sourceMappingVersion: graph.sourceMappingVersion,
    projectId: graph.projectId,
    sourceDigest: graph.sourceDigest,
    sourceMappings: normalizedMappings,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    unresolved: [...graph.unresolved].sort(utf8Compare),
  }
}

export interface GraphDigestV2Result {
  canonical: GraphDigestV2
  canonicalJson: string
  canonicalBytes: Uint8Array
  canonicalBytesSha256: string
  digest: string
  sourceTrust: 'content-only'
}

export function canonicalGraph(graph: unknown): GraphDigestV2Result {
  validateGraphDigestV2(graph)
  const canonical = normalizeGraph(graph)
  const canonicalJsonText = canonicalJson(canonical)
  const canonicalBytes = Buffer.from(canonicalJsonText, 'utf8')
  const domainBytes = Buffer.from(GRAPH_DIGEST_DOMAIN, 'utf8')
  const digest = sha256Bytes(Buffer.concat([domainBytes, canonicalBytes]))
  return {
    canonical,
    canonicalJson: canonicalJsonText,
    canonicalBytes,
    canonicalBytesSha256: sha256Bytes(canonicalBytes),
    digest,
    sourceTrust: 'content-only',
  }
}

export function computeGraphDigestV2(graph: unknown): string {
  return canonicalGraph(graph).digest
}
