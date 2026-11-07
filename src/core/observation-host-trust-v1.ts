import type { SourceGraph } from './model'
import {
  canonicalHostTrustJson,
  computeHostGraphDigestV1,
  computeHostSourceDigestV1,
  isHostTrustRegistryV1,
  sha256Hex,
  type HostRegistryLookup,
  type HostTrustArtifact,
  type HostTrustRegistryV1,
  type HostTrustRunPoint,
  type HostTrustSideBinding,
  type ObservationPageTuple,
  type ObservationSide,
  type ObservationStatus,
  type ObservationViewport,
} from './observation-host-registry-v1'

export interface ObservationBindingV1 {
  protocol: 'ripple-observation-binding/v1'
  projectId: string
  runId: string
  checkId: string
  side: ObservationSide
  route: string
  page: ObservationPageTuple
  viewport: ObservationViewport
  state: string
  status: ObservationStatus
  artifact: { path: string; sha256: string; sizeBytes: number }
  sourceDigest?: string
  graphDigest?: string
  graphSchemaVersion?: string
  graphIdentityVersion?: string
  mappingVersion?: string
  /** Caller claims are diagnostic input only; they can never become registry authority. */
  callerClaims?: {
    hostSideBinding?: unknown
    graph?: unknown
    sourceMappings?: unknown
    runtimeProof?: unknown
  }
  /** Static relation evidence is deliberately kept separate from runtime proof. */
  staticRelation?: { from: string; to: string; kind: 'reads'; certainty: 'source-proven' }
}

export type HostTrustReasonCode =
  | 'host-trust/registry-unavailable'
  | 'host-trust/caller-authority-supplied'
  | 'host-trust/project-unregistered'
  | 'host-trust/project-duplicate'
  | 'host-trust/project-conflict'
  | 'host-trust/run-point-unregistered'
  | 'host-trust/run-point-duplicate'
  | 'host-trust/run-point-conflict'
  | 'host-trust/side-binding-unavailable'
  | 'host-trust/side-binding-duplicate'
  | 'host-trust/side-binding-conflict'
  | 'host-trust/observation-tuple-mismatch'
  | 'host-trust/status-not-complete'
  | 'host-trust/source-snapshot-invalid'
  | 'host-trust/source-digest-mismatch'
  | 'host-trust/graph-invalid'
  | 'host-trust/mapping-invalid'
  | 'host-trust/graph-digest-mismatch'
  | 'host-trust/artifact-unavailable'
  | 'host-trust/artifact-duplicate'
  | 'host-trust/artifact-conflict'
  | 'host-trust/artifact-lineage-mismatch'
  | 'host-trust/artifact-digest-mismatch'
  | 'host-trust/artifact-size-mismatch'
  | 'host-trust/crypto-unavailable'

export interface HostTrustSuccess {
  ok: true
  trusted: true
  trustState: 'host-bound-complete'
  hostBinding: 'verified'
  observationStatus: 'complete'
  graphReference: 'verified'
  /** Runtime Identity v1.2 Assessment is the only source of runtime proof. */
  runtimeProof: 'none'
  /** This wrapper never grants Verification, Scope, Approval, Apply or Rollback authority. */
  authorizationEligible: false
  reasonCode: 'host-trust/complete'
  diagnostics: readonly string[]
}

export interface HostTrustFailure {
  ok: false
  trusted: false
  trustState: 'rejected' | 'unavailable' | 'conflict' | 'stale'
  hostBinding: 'rejected' | 'unavailable' | 'conflict' | 'stale'
  observationStatus: ObservationStatus
  graphReference: 'rejected' | 'unavailable'
  runtimeProof: 'none'
  authorizationEligible: false
  reasonCode: HostTrustReasonCode
  diagnostics: readonly string[]
}

export type HostTrustResult = HostTrustSuccess | HostTrustFailure

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function samePage(left: ObservationPageTuple, right: ObservationPageTuple): boolean {
  return left.pathname === right.pathname && left.search === right.search && left.hash === right.hash
}

function sameViewport(left: ObservationViewport, right: ObservationViewport): boolean {
  return left.width === right.width && left.height === right.height
}

function validPage(value: unknown): value is ObservationPageTuple {
  if (!value || typeof value !== 'object') return false
  const page = value as Record<string, unknown>
  return typeof page.pathname === 'string' && typeof page.search === 'string' && typeof page.hash === 'string'
}

function validViewport(value: unknown): value is ObservationViewport {
  if (!value || typeof value !== 'object') return false
  const viewport = value as Record<string, unknown>
  return Number.isSafeInteger(viewport.width) && Number.isSafeInteger(viewport.height) &&
    Number(viewport.width) > 0 && Number(viewport.height) > 0
}

function failed(
  state: HostTrustFailure['trustState'],
  status: ObservationStatus,
  reasonCode: HostTrustReasonCode,
  diagnostics: readonly string[],
  graphReference: HostTrustFailure['graphReference'] = 'unavailable',
): HostTrustFailure {
  return {
    ok: false,
    trusted: false,
    trustState: state,
    hostBinding: state,
    observationStatus: status,
    graphReference,
    runtimeProof: 'none',
    authorizationEligible: false,
    reasonCode,
    diagnostics,
  }
}

function lookupFailure<T>(lookup: HostRegistryLookup<T>, missing: HostTrustReasonCode, duplicate: HostTrustReasonCode, conflict: HostTrustReasonCode): HostTrustFailure | undefined {
  if (lookup.kind === 'missing') return failed('unavailable', 'unavailable', missing, ['host registry returned no matching authoritative entry'])
  if (lookup.kind === 'duplicate') return failed('conflict', 'unavailable', duplicate, ['host registry returned duplicate equivalent entries'])
  if (lookup.kind === 'conflict') return failed('conflict', 'unavailable', conflict, ['host registry returned conflicting entries'])
  return undefined
}

function validBytes(bytes: readonly number[]): boolean {
  return Array.isArray(bytes) && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function validSourceSnapshot(binding: HostTrustSideBinding): boolean {
  if (!binding || !binding.sourceSnapshot || typeof binding.sourceSnapshot !== 'object') return false
  const files = binding.sourceSnapshot.files
  return Array.isArray(files) && files.length > 0 &&
    files.every(file => !!file && isNonEmptyString(file.path) && validBytes(file.bytes)) &&
    new Set(files.map(file => file.path)).size === files.length
}

function graphShapeError(graph: SourceGraph): string | undefined {
  if (!graph || typeof graph !== 'object' || !isNonEmptyString(graph.id) || !graph.revision || !isNonEmptyString(graph.revision.projectId) || !isNonEmptyString(graph.revision.sourceDigest)) return 'graph identity or revision is incomplete'
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.unresolved)) return 'graph arrays are malformed'
  const nodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (!node || !isNonEmptyString(node.id) || nodeIds.has(node.id)) return 'graph node IDs are missing or duplicated'
    nodeIds.add(node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (!edge || !isNonEmptyString(edge.id) || edgeIds.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to) ||
      !Array.isArray(edge.evidenceRefs) || edge.evidenceRefs.length === 0 || edge.evidenceRefs.some(ref => !isNonEmptyString(ref))) {
      return 'graph edge endpoints, IDs, or evidenceRefs are invalid'
    }
    edgeIds.add(edge.id)
  }
  return undefined
}

function mappingShapeError(binding: HostTrustSideBinding): string | undefined {
  const mappings = binding.sourceMappings
  if (!Array.isArray(mappings)) return 'sourceMappings is not an array'
  const graphNodeIds = new Set(binding.graph.nodes.map(node => node.id))
  const relationIds = new Set(binding.graph.edges.map(edge => edge.id))
  const sourceFiles = new Set(binding.sourceSnapshot.files.map(file => file.path))
  const sourceRefs = new Set<string>()
  for (const mapping of mappings) {
    if (!mapping || !isNonEmptyString(mapping.sourceRef) || !isNonEmptyString(mapping.sourceFile) || !isNonEmptyString(mapping.graphNodeId) ||
      !sourceFiles.has(mapping.sourceFile) || !graphNodeIds.has(mapping.graphNodeId) || !isNonEmptyString(mapping.sourceDigest) || mapping.sourceDigest !== binding.sourceDigest ||
      !Array.isArray(mapping.relationIds) || mapping.relationIds.length === 0 || mapping.relationIds.some((id: string) => !relationIds.has(id)) || sourceRefs.has(mapping.sourceRef)) {
      return 'sourceMappings are missing, duplicated, or not bound to the host graph'
    }
    sourceRefs.add(mapping.sourceRef)
  }
  return undefined
}

function sameLineage(artifact: HostTrustArtifact, point: HostTrustRunPoint, envelope: ObservationBindingV1): boolean {
  if (!artifact || !artifact.lineage) return false
  return artifact.lineage.projectId === point.projectId && artifact.lineage.runId === point.runId && artifact.lineage.checkId === point.checkId &&
    artifact.lineage.side === point.side && artifact.lineage.route === point.route && samePage(artifact.lineage.page, point.page) &&
    sameViewport(artifact.lineage.viewport, point.viewport) && artifact.lineage.state === point.state &&
    artifact.lineage.projectId === envelope.projectId && artifact.lineage.runId === envelope.runId && artifact.lineage.checkId === envelope.checkId &&
    artifact.lineage.side === envelope.side && artifact.lineage.route === envelope.route && samePage(artifact.lineage.page, envelope.page) &&
    sameViewport(artifact.lineage.viewport, envelope.viewport) && artifact.lineage.state === envelope.state
}

function hasCallerAuthorityClaims(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== 'object') return false
  const claims = (envelope as ObservationBindingV1).callerClaims
  return !!claims && Object.keys(claims).length > 0
}

function comparePoint(envelope: ObservationBindingV1, point: HostTrustRunPoint): string | undefined {
  if (envelope.projectId !== point.projectId || envelope.runId !== point.runId || envelope.checkId !== point.checkId || envelope.side !== point.side ||
    envelope.route !== point.route || !samePage(envelope.page, point.page) || !sameViewport(envelope.viewport, point.viewport) || envelope.state !== point.state ||
    (envelope.sourceDigest !== undefined && envelope.sourceDigest !== point.sourceDigest) ||
    (envelope.graphDigest !== undefined && envelope.graphDigest !== point.graphDigest) ||
    (envelope.graphSchemaVersion !== undefined && envelope.graphSchemaVersion !== point.graphSchemaVersion) ||
    (envelope.graphIdentityVersion !== undefined && envelope.graphIdentityVersion !== point.graphIdentityVersion) ||
    (envelope.mappingVersion !== undefined && envelope.mappingVersion !== point.mappingVersion)) return 'caller observation does not match the host check plan'
  return undefined
}

async function validateSourceAndGraph(projectId: string, binding: HostTrustSideBinding, point: HostTrustRunPoint, envelope: ObservationBindingV1): Promise<HostTrustFailure | undefined> {
  if (!validSourceSnapshot(binding)) return failed('rejected', binding.status, 'host-trust/source-snapshot-invalid', ['host source snapshot is malformed'])
  const sourceDigest = await computeHostSourceDigestV1(binding.sourceSnapshot)
  if (sourceDigest !== binding.sourceDigest || sourceDigest !== point.sourceDigest) {
    return failed('rejected', binding.status, 'host-trust/source-digest-mismatch', ['host source bytes do not match the registered sourceDigest'])
  }
  if (envelope.sourceDigest !== undefined && envelope.sourceDigest !== sourceDigest) {
    return failed('rejected', binding.status, 'host-trust/source-digest-mismatch', ['caller sourceDigest claim differs from the host recomputation'])
  }
  const graphError = graphShapeError(binding.graph)
  if (graphError) return failed('rejected', binding.status, 'host-trust/graph-invalid', [graphError], 'rejected')
  if (binding.graph.revision.projectId !== projectId || binding.graph.revision.sourceDigest !== sourceDigest) {
    return failed('rejected', binding.status, 'host-trust/graph-invalid', ['graph revision is not bound to the host project and source snapshot'], 'rejected')
  }
  const mappingError = mappingShapeError(binding)
  if (mappingError) return failed('rejected', binding.status, 'host-trust/mapping-invalid', [mappingError], 'rejected')
  const graphDigest = await computeHostGraphDigestV1(binding)
  if (graphDigest !== binding.graphDigest || graphDigest !== point.graphDigest) {
    return failed('rejected', binding.status, 'host-trust/graph-digest-mismatch', ['host graph bytes or sourceMappings do not match the registered graphDigest'], 'rejected')
  }
  if (envelope.graphDigest !== undefined && envelope.graphDigest !== graphDigest) {
    return failed('rejected', binding.status, 'host-trust/graph-digest-mismatch', ['caller graphDigest claim differs from the host recomputation'], 'rejected')
  }
  return undefined
}

async function validateArtifact(envelope: ObservationBindingV1, point: HostTrustRunPoint, registry: HostTrustRegistryV1): Promise<HostTrustFailure | undefined> {
  const artifactLookup = registry.readArtifact(envelope.artifact.path, point.runId, point.checkId, point.side)
  const lookupError = lookupFailure(artifactLookup, 'host-trust/artifact-unavailable', 'host-trust/artifact-duplicate', 'host-trust/artifact-conflict')
  if (lookupError) return lookupError
  if (artifactLookup.kind !== 'unique') return failed('unavailable', 'unavailable', 'host-trust/artifact-unavailable', ['artifact lookup did not yield one authoritative artifact'])
  const artifact = artifactLookup.value
  if (!artifact || typeof artifact !== 'object' || !artifact.lineage) return failed('rejected', 'complete', 'host-trust/artifact-lineage-mismatch', ['host artifact record is malformed'])
  if (point.artifactPath !== artifact.path || envelope.artifact.path !== artifact.path || envelope.artifact.sha256 !== artifact.sha256 || envelope.artifact.sizeBytes !== artifact.sizeBytes) {
    return failed('rejected', 'complete', 'host-trust/artifact-lineage-mismatch', ['artifact path, digest, or declared size does not match the host run point'])
  }
  if (!sameLineage(artifact, point, envelope)) return failed('rejected', 'complete', 'host-trust/artifact-lineage-mismatch', ['artifact lineage is not bound to this run/check/side/page tuple'])
  if (!validBytes(artifact.bytes) || artifact.bytes.length !== artifact.sizeBytes) return failed('rejected', 'complete', 'host-trust/artifact-size-mismatch', ['artifact bytes do not match the immutable registered size'])
  const digest = await sha256Hex(artifact.bytes)
  if (digest !== artifact.sha256) return failed('rejected', 'complete', 'host-trust/artifact-digest-mismatch', ['artifact bytes do not match the registered SHA-256'])
  return undefined
}

/**
 * Validates an observation against host-owned state. The evidence-only helper's
 * `trusted` value is intentionally never consumed here; graph and artifact
 * checks are recomputed from the immutable registry snapshot.
 */
export async function validateHostObservationV1(envelope: ObservationBindingV1, registry: HostTrustRegistryV1): Promise<HostTrustResult> {
  if (!isHostTrustRegistryV1(registry)) return failed('unavailable', 'unavailable', 'host-trust/registry-unavailable', ['registry is not a host-created immutable registry'])
  if (!envelope || typeof envelope !== 'object') return failed('rejected', 'unavailable', 'host-trust/observation-tuple-mismatch', ['observation envelope is not an object'])
  if (hasCallerAuthorityClaims(envelope)) {
    const claimedStatus = (envelope as { status?: unknown }).status
    const status: ObservationStatus = typeof claimedStatus === 'string' && ['complete', 'partial', 'unknown', 'unavailable', 'stale'].includes(claimedStatus)
      ? claimedStatus as ObservationStatus
      : 'unavailable'
    return failed('rejected', status, 'host-trust/caller-authority-supplied', ['caller-supplied graph, mapping, host binding, or runtime proof claims are never authoritative'])
  }
  if (envelope.protocol !== 'ripple-observation-binding/v1' || !isNonEmptyString(envelope.projectId) || !isNonEmptyString(envelope.runId) || !isNonEmptyString(envelope.checkId) ||
    !isNonEmptyString(envelope.route) || !validPage(envelope.page) || !validViewport(envelope.viewport) || !isNonEmptyString(envelope.state) ||
    !['baseline', 'candidate'].includes(envelope.side) || !['complete', 'partial', 'unknown', 'unavailable', 'stale'].includes(envelope.status) ||
    !envelope.artifact || !isNonEmptyString(envelope.artifact.path) || !/^[a-f0-9]{64}$/.test(envelope.artifact.sha256) || !Number.isSafeInteger(envelope.artifact.sizeBytes) || envelope.artifact.sizeBytes < 0) {
    return failed('rejected', 'unavailable', 'host-trust/observation-tuple-mismatch', ['observation envelope is malformed'])
  }
  const projectLookup = registry.readProject(envelope.projectId)
  const projectError = lookupFailure(projectLookup, 'host-trust/project-unregistered', 'host-trust/project-duplicate', 'host-trust/project-conflict')
  if (projectError) return projectError
  if (projectLookup.kind !== 'unique') return failed('unavailable', 'unavailable', 'host-trust/project-unregistered', ['project lookup did not yield one authoritative project'])
  const pointLookup = registry.readRunPoint(envelope.runId, envelope.checkId, envelope.side)
  const pointError = lookupFailure(pointLookup, 'host-trust/run-point-unregistered', 'host-trust/run-point-duplicate', 'host-trust/run-point-conflict')
  if (pointError) return pointError
  if (pointLookup.kind !== 'unique') return failed('unavailable', 'unavailable', 'host-trust/run-point-unregistered', ['run point lookup did not yield one authoritative point'])
  const point = pointLookup.value
  const tupleError = comparePoint(envelope, point)
  if (tupleError) return failed('rejected', envelope.status, 'host-trust/observation-tuple-mismatch', [tupleError])
  const bindingLookup = registry.readSideBinding(point.runId, point.checkId, point.side)
  const bindingError = lookupFailure(bindingLookup, 'host-trust/side-binding-unavailable', 'host-trust/side-binding-duplicate', 'host-trust/side-binding-conflict')
  if (bindingError) return bindingError
  if (bindingLookup.kind !== 'unique') return failed('unavailable', 'unavailable', 'host-trust/side-binding-unavailable', ['side binding lookup did not yield one authoritative binding'])
  const binding = bindingLookup.value
  if (binding.projectId !== projectLookup.value.projectId || binding.runId !== point.runId || binding.checkId !== point.checkId || binding.side !== point.side ||
    binding.graphSchemaVersion !== point.graphSchemaVersion || binding.graphIdentityVersion !== point.graphIdentityVersion || binding.mappingVersion !== point.mappingVersion ||
    binding.sourceDigest !== point.sourceDigest || binding.graphDigest !== point.graphDigest) {
    return failed('conflict', binding.status, 'host-trust/side-binding-conflict', ['side binding does not match the host project and run point'])
  }
  if (projectLookup.value.sourceDigests[point.side] !== point.sourceDigest) {
    return failed('conflict', binding.status, 'host-trust/source-digest-mismatch', ['side sourceDigest does not match the host project registry'])
  }
  if (binding.status !== 'complete' || envelope.status !== 'complete' || envelope.status !== binding.status) {
    const statusState: HostTrustFailure['trustState'] = binding.status === 'stale' ? 'stale' : 'rejected'
    return failed(statusState, binding.status, 'host-trust/status-not-complete', ['only complete host observations can become host-bound-complete'])
  }
  try {
    const sourceGraphError = await validateSourceAndGraph(projectLookup.value.projectId, binding, point, envelope)
    if (sourceGraphError) return sourceGraphError
    const artifactError = await validateArtifact(envelope, point, registry)
    if (artifactError) return artifactError
  } catch (error) {
    if (error instanceof Error && error.message === 'web-crypto-unavailable') return failed('unavailable', binding.status, 'host-trust/crypto-unavailable', ['Web Crypto SHA-256 is unavailable in this runtime'])
    throw error
  }
  const diagnostics = [
    'host project, run point, side binding, source snapshot, graph, sourceMappings, and artifact lineage verified',
    'host-bound-complete is an observation binding state only; Runtime Identity strict proof remains separate',
    ...(envelope.staticRelation ? ['static source-proven relation retained as evidence; runtimeProof remains none'] : []),
  ]
  return {
    ok: true,
    trusted: true,
    trustState: 'host-bound-complete',
    hostBinding: 'verified',
    observationStatus: 'complete',
    graphReference: 'verified',
    runtimeProof: 'none',
    authorizationEligible: false,
    reasonCode: 'host-trust/complete',
    diagnostics,
  }
}

export function hostTrustResultIsComplete(result: HostTrustResult): result is HostTrustSuccess {
  return result.ok === true && result.trustState === 'host-bound-complete' && result.trusted === true && result.authorizationEligible === false
}

export function hostTrustCanonicalEnvelope(envelope: ObservationBindingV1): string {
  return canonicalHostTrustJson(envelope)
}
