import type { Relation, SourceGraph, SourceNode } from './model'

export type ObservationSide = 'baseline' | 'candidate'
export type ObservationStatus = 'complete' | 'partial' | 'unknown' | 'unavailable' | 'stale'

export interface ObservationPageTuple {
  pathname: string
  search: string
  hash: string
}

export interface ObservationViewport {
  width: number
  height: number
}

export interface HostSourceFile {
  path: string
  bytes: readonly number[]
}

export interface HostSourceSnapshot {
  files: readonly HostSourceFile[]
}

export interface HostSourceMapping {
  projectId: string
  sourceRef: string
  graphNodeId: string
  sourceAnchorRelationId: string
  sourceIdentity: string
  sourceUse: {
    path: string
    charOffset: number
    byteOffset: number
    offsetUnit: 'code-unit'
  }
}

export interface HostTrustArtifact {
  path: string
  sha256: string
  sizeBytes: number
  bytes: readonly number[]
  lineage: {
    projectId: string
    runId: string
    checkId: string
    side: ObservationSide
    route: string
    page: ObservationPageTuple
    viewport: ObservationViewport
    state: string
  }
}

export interface HostTrustProject {
  projectId: string
  sourceDigests: Record<ObservationSide, string>
}

export interface HostTrustRunPoint {
  projectId: string
  runId: string
  checkId: string
  side: ObservationSide
  route: string
  page: ObservationPageTuple
  viewport: ObservationViewport
  state: string
  sourceDigest: string
  graphDigest: string
  graphSchemaVersion: string
  graphIdentityVersion: string
  relationIdentityVersion: string
  sourceMappingVersion: string
  artifactPath: string
}

export interface HostTrustSideBinding {
  projectId: string
  runId: string
  checkId: string
  side: ObservationSide
  status: ObservationStatus
  sourceDigest: string
  graphDigest: string
  graphSchemaVersion: string
  graphIdentityVersion: string
  relationIdentityVersion: string
  sourceMappingVersion: string
  sourceSnapshot: HostSourceSnapshot
  graph: SourceGraph
  sourceMappings: readonly HostSourceMapping[]
}

export interface HostTrustRegistryState {
  projects: HostTrustProject[]
  runPoints: HostTrustRunPoint[]
  sideBindings: HostTrustSideBinding[]
  artifacts: HostTrustArtifact[]
}

export type HostRegistryLookup<T> =
  | { kind: 'missing' }
  | { kind: 'unique'; value: T }
  | { kind: 'duplicate'; values: readonly T[] }
  | { kind: 'conflict'; values: readonly T[] }

export interface HostTrustRegistryV1 {
  readonly readProject: (projectId: string) => HostRegistryLookup<HostTrustProject>
  readonly readRunPoint: (runId: string, checkId: string, side: ObservationSide) => HostRegistryLookup<HostTrustRunPoint>
  readonly readSideBinding: (runId: string, checkId: string, side: ObservationSide) => HostRegistryLookup<HostTrustSideBinding>
  readonly readArtifact: (path: string, runId: string, checkId: string, side: ObservationSide) => HostRegistryLookup<HostTrustArtifact>
}

const registryInstances = new WeakMap<object, { authoritative: boolean }>()
const registryBrand = Symbol('ripple.host-trust-registry-v1')

type RegistryBranded = { readonly [registryBrand]: true }

function cloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const cloned = value.map(item => cloneAndFreeze(item))
    return Object.freeze(cloned) as T
  }
  const source = value as Record<string, unknown>
  const target: Record<string, unknown> = {}
  for (const key of Object.keys(source)) target[key] = cloneAndFreeze(source[key])
  return Object.freeze(target) as T
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function lookup<T>(values: readonly T[], predicate: (value: T) => boolean): HostRegistryLookup<T> {
  if (!Array.isArray(values)) return { kind: 'conflict', values: [] }
  const matches: T[] = []
  try {
    for (const value of values) if (predicate(value)) matches.push(value)
  } catch {
    return { kind: 'conflict', values: [] }
  }
  if (matches.length === 0) return { kind: 'missing' }
  if (matches.length === 1) return { kind: 'unique', value: matches[0] }
  return matches.every(value => sameCanonicalValue(value, matches[0]))
    ? { kind: 'duplicate', values: matches }
    : { kind: 'conflict', values: matches }
}

/**
 * Host-only construction boundary. The returned object has no write/update
 * method and owns a deep-frozen snapshot, so a caller cannot mutate the host
 * registry after construction or replace its contents in place.
 */
function buildRegistry(state: HostTrustRegistryState, authoritative: boolean): HostTrustRegistryV1 {
  const frozen = cloneAndFreeze(state) as HostTrustRegistryState
  const registry = Object.freeze({
    [registryBrand]: true as const,
    readProject: (projectId: string): HostRegistryLookup<HostTrustProject> =>
      lookup(frozen.projects, item => item.projectId === projectId),
    readRunPoint: (runId: string, checkId: string, side: ObservationSide): HostRegistryLookup<HostTrustRunPoint> =>
      lookup(frozen.runPoints, item => item.runId === runId && item.checkId === checkId && item.side === side),
    readSideBinding: (runId: string, checkId: string, side: ObservationSide): HostRegistryLookup<HostTrustSideBinding> =>
      lookup(frozen.sideBindings, item => item.runId === runId && item.checkId === checkId && item.side === side),
    readArtifact: (path: string, runId: string, checkId: string, side: ObservationSide): HostRegistryLookup<HostTrustArtifact> =>
      lookup(frozen.artifacts, item => !!item && typeof item === 'object' && !!item.lineage && item.path === path && item.lineage.runId === runId && item.lineage.checkId === checkId && item.lineage.side === side),
  } satisfies HostTrustRegistryV1 & RegistryBranded)
  registryInstances.set(registry, { authoritative })
  return registry
}

/**
 * Public callers can construct an immutable diagnostic snapshot, but it is
 * deliberately non-authoritative. Only a host-owned integration boundary may
 * issue the authoritative registry used by the validator. This public factory
 * therefore cannot produce host-bound-complete by itself.
 */
export function createHostTrustRegistryV1(state: HostTrustRegistryState): HostTrustRegistryV1 {
  return buildRegistry(state, false)
}

/**
 * Vitest-only host-owned test double. A production build has no issuer for
 * this capability and throws, so the test double cannot become a production
 * caller-injectable trust root.
 */
export function createHostTrustRegistryV1TestDouble(state: HostTrustRegistryState): HostTrustRegistryV1 {
  if (import.meta.env?.MODE !== 'test') throw new Error('host-registry-test-double-unavailable')
  return buildRegistry(state, true)
}

export function isHostTrustRegistryV1(value: unknown): value is HostTrustRegistryV1 {
  return typeof value === 'object' && value !== null && registryInstances.get(value)?.authoritative === true
}

const GRAPH_DIGEST_DOMAIN = 'ripple/sourcegraph-identity/v2/graphDigest\0'
const GRAPH_IDENTITY_VERSION = 'sourcegraph-identity/v2'
const SOURCE_MAPPING_VERSION = 'sourcegraph-source-mapping/v1'
const RELATION_IDENTITY_VERSION = 'relation-id/v1'
const GRAPH_SCHEMA_VERSION = 'acp6-sourcegraph/v1'
const NODE_KINDS = new Set(['file', 'symbol', 'component', 'route', 'data', 'media', 'token', 'token-use', 'jsx-element', 'state'])
const EDGE_KINDS = new Set(['imports', 'reads', 'renders', 'uses-token', 'token-reference', 'asset-consumer', 'css-cascade', 'same-copy', 'semantic-link'])
const CERTAINTIES = new Set(['source-proven', 'runtime-observed', 'semantic-candidate', 'unknown'])
const NODE_KEYS = new Set(['id', 'kind', 'label', 'location', 'page', 'routePath', 'pages', 'selector', 'selectorScope', 'byteOffset', 'mediaContext', 'className', 'dynamicClassName', 'value', 'pageOverrides', 'tokenOrigin'])
const EDGE_KEYS = new Set(['id', 'from', 'to', 'kind', 'certainty', 'evidenceRefs', 'sourceUse', 'selectorScope', 'mediaContext', 'producerIdentity', 'sourceIdentity'])
const SOURCE_USE_KEYS = new Set(['path', 'charOffset', 'byteOffset', 'offsetUnit'])
const LOCATION_KEYS = new Set(['path', 'start', 'end', 'offset', 'byteOffset'])
const MAPPING_KEYS = new Set(['projectId', 'sourceRef', 'graphNodeId', 'sourceAnchorRelationId', 'sourceIdentity', 'sourceUse'])

function utf8Compare(left: string, right: string): number {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
  return a.length - b.length
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function validBytes(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function sha256String(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function rejectNullOrUnsafe(value: unknown): void {
  if (value === undefined || value === null) throw new Error('graph-schema-invalid')
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) throw new Error('graph-schema-invalid')
  if (Array.isArray(value)) for (const item of value) rejectNullOrUnsafe(item)
  else if (typeof value === 'object') for (const item of Object.values(value as Record<string, unknown>)) rejectNullOrUnsafe(item)
}

function keysOnly(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key))
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => nonEmptyString(item)) && new Set(value).size === value.length
}

function validRelativePath(value: unknown): value is string {
  return nonEmptyString(value) && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
}

function validSourceUse(value: unknown): value is HostSourceMapping['sourceUse'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const sourceUse = value as Record<string, unknown>
  return keysOnly(sourceUse, SOURCE_USE_KEYS) && validRelativePath(sourceUse.path) && safeInteger(sourceUse.charOffset) && safeInteger(sourceUse.byteOffset) && sourceUse.offsetUnit === 'code-unit'
}

function validLocation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const location = value as Record<string, unknown>
  return keysOnly(location, LOCATION_KEYS) && validRelativePath(location.path) && ['start', 'end', 'offset', 'byteOffset'].every(key => !(key in location) || safeInteger(location[key]))
}

function validPageOverrides(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(([key, item]) => nonEmptyString(key) && nonEmptyString(item))
}

function validNode(value: unknown): value is SourceNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  if (!keysOnly(node, NODE_KEYS) || !nonEmptyString(node.id) || typeof node.kind !== 'string' || !NODE_KINDS.has(node.kind)) return false
  if ('label' in node && !nonEmptyString(node.label)) return false
  for (const key of ['page', 'routePath', 'selector', 'selectorScope', 'className', 'value']) if (key in node && !nonEmptyString(node[key])) return false
  for (const key of ['pages', 'mediaContext']) if (key in node && !uniqueStrings(node[key])) return false
  if ('byteOffset' in node && !safeInteger(node.byteOffset)) return false
  if ('dynamicClassName' in node && typeof node.dynamicClassName !== 'boolean') return false
  if ('pageOverrides' in node && !validPageOverrides(node.pageOverrides)) return false
  if ('location' in node && !validLocation(node.location)) return false
  if ('tokenOrigin' in node && node.tokenOrigin !== 'css-custom-property' && node.tokenOrigin !== 'tailwind-palette') return false
  return true
}

function validEdge(value: unknown): value is Relation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const edge = value as Record<string, unknown>
  if (!keysOnly(edge, EDGE_KEYS) || !nonEmptyString(edge.id) || !nonEmptyString(edge.from) || !nonEmptyString(edge.to) || typeof edge.kind !== 'string' || !EDGE_KINDS.has(edge.kind) || typeof edge.certainty !== 'string' || !CERTAINTIES.has(edge.certainty) || !uniqueStrings(edge.evidenceRefs)) return false
  if ('sourceUse' in edge && !validSourceUse(edge.sourceUse)) return false
  if ('selectorScope' in edge && !nonEmptyString(edge.selectorScope)) return false
  if ('mediaContext' in edge && !uniqueStrings(edge.mediaContext)) return false
  if ('producerIdentity' in edge && !nonEmptyString(edge.producerIdentity)) return false
  if ('sourceIdentity' in edge && !nonEmptyString(edge.sourceIdentity)) return false
  return true
}

function expectedSourceIdentity(sourceDigest: string, mapping: HostSourceMapping): string {
  return `source:${sourceDigest}:${mapping.sourceUse.path}:${mapping.sourceUse.charOffset}:${mapping.sourceUse.byteOffset}`
}

function sameSourceUse(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  return a.path === b.path && a.charOffset === b.charOffset && a.byteOffset === b.byteOffset && a.offsetUnit === b.offsetUnit
}

function validateGraphForDigest(binding: Pick<HostTrustSideBinding, 'projectId' | 'sourceDigest' | 'graphIdentityVersion' | 'graphSchemaVersion' | 'relationIdentityVersion' | 'sourceMappingVersion' | 'graph' | 'sourceMappings'>): Record<string, unknown> {
  if (binding.graphIdentityVersion !== GRAPH_IDENTITY_VERSION || binding.graphSchemaVersion !== GRAPH_SCHEMA_VERSION || binding.relationIdentityVersion !== RELATION_IDENTITY_VERSION || binding.sourceMappingVersion !== SOURCE_MAPPING_VERSION || !nonEmptyString(binding.projectId) || !sha256String(binding.sourceDigest)) throw new Error('graph-schema-invalid')
  const graph = binding.graph as unknown as Record<string, unknown>
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.unresolved) || !Array.isArray(binding.sourceMappings) || !keysOnly(graph, new Set(['id', 'revision', 'nodes', 'edges', 'unresolved']))) throw new Error('graph-schema-invalid')
  if (!uniqueStrings(graph.unresolved)) throw new Error('graph-schema-invalid')
  const nodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (!validNode(node) || nodeIds.has(node.id)) throw new Error('graph-schema-invalid')
    nodeIds.add(node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (!validEdge(edge) || edgeIds.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error('graph-schema-invalid')
    edgeIds.add(edge.id)
  }
  const mappingRefs = new Set<string>()
  const mappingNodes = new Set<string>()
  const mappingAnchors = new Set<string>()
  for (const mapping of binding.sourceMappings) {
    const raw = mapping as unknown as Record<string, unknown>
    if (!keysOnly(raw, MAPPING_KEYS) || raw.projectId !== binding.projectId || !nonEmptyString(raw.sourceRef) || raw.sourceRef !== raw.graphNodeId || !nonEmptyString(raw.graphNodeId) || !nonEmptyString(raw.sourceAnchorRelationId) || !nonEmptyString(raw.sourceIdentity) || !validSourceUse(raw.sourceUse) || mappingRefs.has(raw.sourceRef) || mappingNodes.has(raw.graphNodeId) || mappingAnchors.has(raw.sourceAnchorRelationId) || !nodeIds.has(raw.graphNodeId)) throw new Error('graph-schema-invalid')
    const sourceNode = graph.nodes.find(node => (node as SourceNode).id === raw.graphNodeId) as SourceNode | undefined
    if (!sourceNode || sourceNode.kind !== 'token-use') throw new Error('graph-schema-invalid')
    const anchors = graph.edges.filter(edge => (edge as Relation).id === raw.sourceAnchorRelationId) as Relation[]
    if (anchors.length !== 1) throw new Error('graph-schema-invalid')
    const anchor = anchors[0]
    const from = graph.nodes.filter(node => (node as SourceNode).id === anchor.from) as SourceNode[]
    if (from.length !== 1 || from[0].kind !== 'file' || anchor.kind !== 'reads' || anchor.certainty !== 'source-proven' || anchor.to !== raw.graphNodeId || !sameSourceUse(anchor.sourceUse, raw.sourceUse) || raw.sourceIdentity !== expectedSourceIdentity(binding.sourceDigest, mapping)) throw new Error('graph-schema-invalid')
    mappingRefs.add(raw.sourceRef as string); mappingNodes.add(raw.graphNodeId as string); mappingAnchors.add(raw.sourceAnchorRelationId as string)
  }
  const sourceMappings = binding.sourceMappings.map(mapping => ({
    projectId: mapping.projectId,
    sourceRef: mapping.sourceRef,
    graphNodeId: mapping.graphNodeId,
    sourceAnchorRelationId: mapping.sourceAnchorRelationId,
    sourceIdentity: mapping.sourceIdentity,
    sourceUse: mapping.sourceUse,
  })).sort((left, right) => utf8Compare(left.sourceRef, right.sourceRef))
  const normalizedNodes = graph.nodes.map(node => {
    const copy = { ...(node as unknown as Record<string, unknown>) }
    for (const key of ['pages', 'mediaContext']) if (key in copy && Array.isArray(copy[key])) copy[key] = [...copy[key] as string[]].sort(utf8Compare)
    return copy
  }).sort((left, right) => utf8Compare(left.id as string, right.id as string))
  const normalizedEdges = graph.edges.map(edge => {
    const copy = { ...(edge as unknown as Record<string, unknown>) }
    for (const key of ['evidenceRefs', 'mediaContext']) if (key in copy && Array.isArray(copy[key])) copy[key] = [...copy[key] as string[]].sort(utf8Compare)
    return copy
  }).sort((left, right) => utf8Compare(left.id as string, right.id as string))
  return { graphIdentityVersion: binding.graphIdentityVersion, graphSchemaVersion: binding.graphSchemaVersion, relationIdentityVersion: binding.relationIdentityVersion, sourceMappingVersion: binding.sourceMappingVersion, projectId: binding.projectId, sourceMappings, sourceDigest: binding.sourceDigest, nodes: normalizedNodes, edges: normalizedEdges, unresolved: [...graph.unresolved as string[]].sort(utf8Compare) }
}

export function canonicalizeHostTrustValue(value: unknown): unknown {
  rejectNullOrUnsafe(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => canonicalizeHostTrustValue(item))
  const object = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(object).sort(utf8Compare).map(key => {
    const item = object[key]
    return [key, canonicalizeHostTrustValue(item)]
  }))
}

export function canonicalHostTrustJson(value: unknown): string {
  return JSON.stringify(canonicalizeHostTrustValue(value))
}

export async function sha256Hex(bytes: readonly number[]): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('web-crypto-unavailable')
  const digest = await subtle.digest('SHA-256', Uint8Array.from(bytes))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function computeHostSourceDigestV1(snapshot: HostSourceSnapshot): Promise<string> {
  if (!snapshot || !Array.isArray(snapshot.files) || snapshot.files.some(file => !file || !validRelativePath(file.path) || !validBytes(file.bytes))) throw new Error('source-snapshot-invalid')
  const files = [...snapshot.files].sort((left, right) => utf8Compare(left.path, right.path)).map(file => ({ path: file.path, bytes: [...file.bytes] }))
  return sha256Hex(Array.from(new TextEncoder().encode(canonicalHostTrustJson(files))))
}

export async function computeHostGraphDigestV1(binding: Pick<HostTrustSideBinding, 'projectId' | 'sourceDigest' | 'graphSchemaVersion' | 'graphIdentityVersion' | 'relationIdentityVersion' | 'sourceMappingVersion' | 'graph' | 'sourceMappings'>): Promise<string> {
  const canonical = canonicalHostTrustJson(validateGraphForDigest(binding))
  return sha256Hex(Array.from(new TextEncoder().encode(GRAPH_DIGEST_DOMAIN + canonical)))
}
