import type { SourceGraph } from './model'

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
  sourceRef: string
  sourceFile: string
  graphNodeId: string
  sourceDigest: string
  relationIds: readonly string[]
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
  mappingVersion: string
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
  mappingVersion: string
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

const registryInstances = new WeakSet<object>()
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
export function createHostTrustRegistryV1(state: HostTrustRegistryState): HostTrustRegistryV1 {
  const frozen = cloneAndFreeze(state) as HostTrustRegistryState
  const registry = {
    [registryBrand]: true as const,
    readProject: (projectId: string): HostRegistryLookup<HostTrustProject> =>
      lookup(frozen.projects, item => item.projectId === projectId),
    readRunPoint: (runId: string, checkId: string, side: ObservationSide): HostRegistryLookup<HostTrustRunPoint> =>
      lookup(frozen.runPoints, item => item.runId === runId && item.checkId === checkId && item.side === side),
    readSideBinding: (runId: string, checkId: string, side: ObservationSide): HostRegistryLookup<HostTrustSideBinding> =>
      lookup(frozen.sideBindings, item => item.runId === runId && item.checkId === checkId && item.side === side),
    readArtifact: (path: string, runId: string, checkId: string, side: ObservationSide): HostRegistryLookup<HostTrustArtifact> =>
      lookup(frozen.artifacts, item => !!item && typeof item === 'object' && !!item.lineage && item.path === path && item.lineage.runId === runId && item.lineage.checkId === checkId && item.lineage.side === side),
  } satisfies HostTrustRegistryV1 & RegistryBranded
  registryInstances.add(registry)
  return registry
}

export function isHostTrustRegistryV1(value: unknown): value is HostTrustRegistryV1 {
  return typeof value === 'object' && value !== null && registryInstances.has(value)
}

export function canonicalizeHostTrustValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => canonicalizeHostTrustValue(item))
  const object = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(object).sort().flatMap(key => {
    const item = object[key]
    return item === undefined ? [] : [[key, canonicalizeHostTrustValue(item)]]
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
  const files = [...snapshot.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0).map(file => ({ path: file.path, bytes: [...file.bytes] }))
  return sha256Hex(Array.from(new TextEncoder().encode(canonicalHostTrustJson(files))))
}

export async function computeHostGraphDigestV1(binding: Pick<HostTrustSideBinding, 'projectId' | 'side' | 'sourceDigest' | 'graphSchemaVersion' | 'graphIdentityVersion' | 'mappingVersion' | 'graph' | 'sourceMappings'>): Promise<string> {
  const sourceMappings = [...binding.sourceMappings].sort((left, right) => {
    if (left.sourceRef !== right.sourceRef) return left.sourceRef < right.sourceRef ? -1 : 1
    if (left.graphNodeId !== right.graphNodeId) return left.graphNodeId < right.graphNodeId ? -1 : 1
    const leftRelations = canonicalHostTrustJson(left.relationIds)
    const rightRelations = canonicalHostTrustJson(right.relationIds)
    return leftRelations < rightRelations ? -1 : leftRelations > rightRelations ? 1 : 0
  })
  return sha256Hex(Array.from(new TextEncoder().encode(canonicalHostTrustJson({
    projectId: binding.projectId,
    side: binding.side,
    sourceDigest: binding.sourceDigest,
    graphSchemaVersion: binding.graphSchemaVersion,
    graphIdentityVersion: binding.graphIdentityVersion,
    mappingVersion: binding.mappingVersion,
    graph: binding.graph,
    sourceMappings,
  }))))
}
