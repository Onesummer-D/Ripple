import { createHash } from 'node:crypto'
import type { SourceGraph } from './model'
import { parseCssTokenSource } from './css-token-source'
import type { FrozenSourceSnapshot } from './frozen-source-snapshot'
import { isFrozenSourceSnapshot, readFrozenBytes, decodeFrozenUtf8 } from './frozen-project-snapshot'
import { canonicalGraph, validateGraphDigestV2, GRAPH_IDENTITY_VERSION, GRAPH_SCHEMA_VERSION, RELATION_IDENTITY_VERSION, SOURCE_MAPPING_VERSION, type GraphSourceMapping, type GraphDigestV2Result, type GraphDigestV2 } from './graph-identity-v2'

/** A binding supplied by the caller; this module does not authenticate an issuer. */
export interface HostProjectRegistryRecord {
  projectId: string
  repository: string
  head: string
  rootTree: string
  sourceDigest: string
}
export interface MappingDiagnostic { sourceRef: string; decision: 'accepted' | 'mapping-rejected'; reasonCode: string }
export type SourceGraphAdapterResult =
  | { status: 'rejected' | 'unavailable'; diagnostics: MappingDiagnostic[]; reasons: string[] }
  | { status: 'available-content-only'; diagnostics: MappingDiagnostic[]; reasons: string[]; result: GraphDigestV2Result; hostProvenance: 'unverified'; registryBinding: 'caller-supplied-unattested' }

// A mutation or a graph from another snapshot cannot reuse this receipt.
const receipts = new WeakMap<SourceGraph, { snapshot: FrozenSourceSnapshot; sha256: string }>()
const payloadDigest = (graph: SourceGraph) => createHash('sha256').update(JSON.stringify(graph)).digest('hex')
export function bindFrozenAnalysis(graph: SourceGraph, snapshot: FrozenSourceSnapshot): void {
  receipts.set(graph, { snapshot, sha256: payloadDigest(graph) })
}

/** Omit explicit undefined optional properties produced by TS object literals.
 * All present/unknown fields are retained so the pure validator can reject them. */
const optionalFields = new Set(['location', 'page', 'routePath', 'pages', 'selector', 'selectorScope', 'byteOffset', 'mediaContext', 'className', 'dynamicClassName', 'value', 'pageOverrides', 'tokenOrigin', 'sourceUse', 'producerIdentity', 'sourceIdentity', 'start', 'end', 'offset'])
function dto<T>(value: T, active = new WeakSet<object>()): T {
  if (value && typeof value === 'object') {
    if (active.has(value)) throw new Error('Cyclic graph input')
    active.add(value)
    try {
      if (Array.isArray(value)) return value.map(item => dto(item, active)) as T
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) throw new Error('Graph must contain plain data objects')
      const entries: Array<[string, unknown]> = []
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Graph must contain data fields only')
        if (descriptor.value === undefined && optionalFields.has(key)) continue
        entries.push([key, dto(descriptor.value, active)])
      }
      return Object.fromEntries(entries) as T
    } finally { active.delete(value) }
  }
  return value
}

function candidateNodeId(value: unknown): string | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, 'graphNodeId')
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined
  } catch { return undefined }
}

function plainDataRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Reflect.ownKeys(value).every(key => {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor?.enumerable && 'value' in descriptor)
    })
  } catch { return false }
}

const mappingCandidateFields = ['projectId', 'sourceRef', 'graphNodeId', 'sourceAnchorRelationId', 'sourceIdentity', 'sourceUse']
const mappingSourceUseFields = ['path', 'charOffset', 'byteOffset', 'offsetUnit']
function mappingCandidateShapeError(value: unknown): string | undefined {
  if (!plainDataRecord(value)) return 'mapping-candidate-object-invalid'
  const keys = Reflect.ownKeys(value).sort()
  if (keys.some(key => typeof key !== 'string' || !mappingCandidateFields.includes(key)) ||
      keys.length !== mappingCandidateFields.length || mappingCandidateFields.some(key => !keys.includes(key))) return 'mapping-candidate-fields-invalid'
  for (const key of ['projectId', 'sourceRef', 'graphNodeId', 'sourceAnchorRelationId'] as const) {
    const item = value[key]
    if (typeof item !== 'string' || !item.trim() || /^<[^>]+>$/.test(item)) return `mapping-candidate-${key}-invalid`
  }
  const sourceIdentity = value.sourceIdentity
  if (typeof sourceIdentity !== 'string' || !/^source:[0-9a-f]{64}:[^:]+:[0-9]+:[0-9]+$/.test(sourceIdentity)) return 'mapping-candidate-sourceIdentity-invalid'
  const sourceUse = value.sourceUse
  if (!plainDataRecord(sourceUse)) return 'mapping-candidate-sourceUse-invalid'
  const sourceUseKeys = Reflect.ownKeys(sourceUse).sort()
  if (sourceUseKeys.some(key => typeof key !== 'string' || !mappingSourceUseFields.includes(key)) ||
      sourceUseKeys.length !== mappingSourceUseFields.length || mappingSourceUseFields.some(key => !sourceUseKeys.includes(key))) return 'mapping-candidate-sourceUse-fields-invalid'
  const path = sourceUse.path
  if (typeof path !== 'string' || !path.trim() || path.startsWith('/') || /^[A-Za-z]:/.test(path) ||
      path.includes('\\') || path.includes('\0') || path.includes('//') || path.split('/').some(part => !part || part === '.' || part === '..')) return 'mapping-candidate-source-path-invalid'
  for (const key of ['charOffset', 'byteOffset'] as const) {
    const offset = sourceUse[key]
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0)) return `mapping-candidate-${key}-invalid`
  }
  if (sourceUse.offsetUnit !== 'code-unit') return 'mapping-candidate-offsetUnit-invalid'
  return undefined
}

function mappingCandidatesShapeError(value: unknown): { reasonCode: string; sourceRef: string } | undefined {
  try {
    if (!Array.isArray(value)) return { reasonCode: 'mapping-candidates-invalid', sourceRef: '' }
    const keys = Reflect.ownKeys(value)
    for (const key of keys) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) return { reasonCode: 'mapping-candidates-array-shape-invalid', sourceRef: '' }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return { reasonCode: 'mapping-candidates-array-shape-invalid', sourceRef: '' }
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return { reasonCode: 'mapping-candidates-array-sparse', sourceRef: '' }
      const candidate = value[index]
      const reasonCode = mappingCandidateShapeError(candidate)
      if (reasonCode) return { reasonCode, sourceRef: candidateNodeId(candidate) ?? '' }
    }
    return undefined
  } catch { return { reasonCode: 'mapping-candidates-array-invalid', sourceRef: '' } }
}

export function adaptSourceGraph(input: {
  graph: SourceGraph
  snapshot: FrozenSourceSnapshot
  registry?: HostProjectRegistryRecord
  mappingCandidates?: GraphSourceMapping[]
}): SourceGraphAdapterResult {
  const diagnostics: MappingDiagnostic[] = []
  const reasons: string[] = []
  const { graph, snapshot, registry } = input
  let canonicalInput: GraphDigestV2
  try {
    // Validate structure before missing-evidence checks: rejected has priority.
    const { id: _id, revision: _revision, nodes, edges, unresolved, ...unknown } = graph
    if (Object.keys(unknown).length) throw new Error('Unknown SourceGraph fields')
    canonicalInput = dto({ graphIdentityVersion: GRAPH_IDENTITY_VERSION, graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      relationIdentityVersion: RELATION_IDENTITY_VERSION, sourceMappingVersion: SOURCE_MAPPING_VERSION,
      projectId: registry?.projectId ?? graph.revision.projectId, sourceDigest: graph.revision.sourceDigest,
      nodes, edges, unresolved, sourceMappings: [] })
    validateGraphDigestV2(canonicalInput)
  } catch (error) { return { status: 'rejected', diagnostics, reasons: [error instanceof Error ? error.message : 'graph-schema-invalid'] } }

  const rawCandidates: unknown = input.mappingCandidates
  if (rawCandidates !== undefined) {
    const malformed = mappingCandidatesShapeError(rawCandidates)
    if (malformed) return { status: 'rejected', diagnostics: [{ sourceRef: malformed.sourceRef, decision: 'mapping-rejected', reasonCode: malformed.reasonCode }], reasons: [malformed.reasonCode] }
  }
  const candidateList = rawCandidates as GraphSourceMapping[] | undefined
  if (!isFrozenSourceSnapshot(snapshot)) return { status: 'unavailable', diagnostics, reasons: ['snapshot-unavailable'] }
  const receipt = receipts.get(graph)
  if (!receipt || receipt.snapshot !== snapshot || receipt.sha256 !== payloadDigest(graph)) reasons.push('graph-snapshot-unbound')
  if (graph.revision.sourceDigest !== snapshot.sourceDigest || graph.revision.gitCommit !== snapshot.gitHead) reasons.push('source-snapshot-mismatch')
  if (!registry || !registry.repository.trim() || !registry.projectId.trim() ||
      registry.head !== snapshot.gitHead || registry.rootTree !== snapshot.rootTree || registry.sourceDigest !== snapshot.sourceDigest) reasons.push('host-registry-unavailable')

  const mappings: GraphSourceMapping[] = []
  const uses = graph.nodes.filter(node => node.kind === 'token-use')
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
  const usedCandidateNodes = new Set<string>()
  const parsedFiles = new Map<string, { text: string; bytes: Buffer; uses: ReturnType<typeof parseCssTokenSource>['uses'] }>()
  for (const node of uses) {
    const fail = (reasonCode: string) => diagnostics.push({ sourceRef: node.id, decision: 'mapping-rejected', reasonCode })
    const location = node.location
    const anchors = graph.edges.filter(edge => edge.kind === 'reads' && edge.certainty === 'source-proven' && edge.to === node.id && nodeById.get(edge.from)?.kind === 'file')
    if (!location || anchors.length !== 1) { fail('mapping-anchor-nonunique-or-missing'); continue }
    const anchor = anchors[0]
    const sourceUse = anchor.sourceUse
    const file = nodeById.get(anchor.from)!
    if (!sourceUse || location.path !== sourceUse.path || (file.location?.path ?? file.label) !== sourceUse.path) { fail('mapping-path-mismatch'); continue }
    try {
      let parsed = parsedFiles.get(sourceUse.path)
      if (!parsed) {
        const bytes = readFrozenBytes(snapshot, sourceUse.path)
        if (!bytes) { fail('mapping-source-missing'); continue }
        const text = decodeFrozenUtf8(bytes)
        parsed = { text, bytes, uses: parseCssTokenSource(sourceUse.path, text).uses }
        parsedFiles.set(sourceUse.path, parsed)
      }
      const offset = sourceUse.charOffset
      const end = location.end
      if (!Number.isSafeInteger(offset) || offset < 0 || location.offset !== offset || sourceUse.offsetUnit !== 'code-unit' ||
          offset > parsed.text.length || (offset > 0 && /[\uD800-\uDBFF]/.test(parsed.text[offset - 1]) && /[\uDC00-\uDFFF]/.test(parsed.text[offset])) ||
          !Number.isSafeInteger(end) || end! <= offset || end! > parsed.text.length || location.start !== offset) { fail('mapping-char-offset-mismatch'); continue }
      const parserUses = parsed.uses.filter(use => use.offset === offset)
      const use = parserUses.length === 1 ? parserUses[0] : undefined
      if (!use || node.value !== `var(${use.name})` || end !== offset + 4 + use.name.length) { fail('mapping-span-mismatch'); continue }
      const byteOffset = Buffer.byteLength(parsed.text.slice(0, offset), 'utf8')
      if (!Number.isSafeInteger(node.byteOffset) || node.byteOffset !== byteOffset || sourceUse.byteOffset !== byteOffset ||
          use.byteOffset !== byteOffset || (location.byteOffset !== undefined && location.byteOffset !== byteOffset)) { fail('mapping-byte-offset-mismatch'); continue }
      if (!parsed.bytes.subarray(byteOffset, byteOffset + Buffer.byteLength(parsed.text.slice(offset, end))).equals(Buffer.from(parsed.text.slice(offset, end)))) { fail('mapping-span-mismatch'); continue }
      const mapping: GraphSourceMapping = {
        projectId: canonicalInput.projectId, sourceRef: node.id, graphNodeId: node.id, sourceAnchorRelationId: anchor.id,
        sourceIdentity: `source:${snapshot.sourceDigest}:${sourceUse.path}:${offset}:${byteOffset}`, sourceUse: { ...sourceUse },
      }
      if (candidateList) {
        const candidates = candidateList.filter(item => candidateNodeId(item) === node.id)
        if (candidates.length !== 1) { fail(candidates.length === 0 ? 'mapping-missing' : 'mapping-duplicate'); continue }
        usedCandidateNodes.add(node.id)
        try {
          validateGraphDigestV2({ ...canonicalInput, sourceMappings: candidates })
          if (canonicalGraph({ ...canonicalInput, sourceMappings: candidates }).canonicalJson !== canonicalGraph({ ...canonicalInput, sourceMappings: [mapping] }).canonicalJson) { fail('mapping-candidate-mismatch'); continue }
        } catch { fail('mapping-candidate-invalid'); continue }
      }
      mappings.push(mapping)
      diagnostics.push({ sourceRef: node.id, decision: 'accepted', reasonCode: 'mapping-byte-validated' })
    } catch (error) { fail(error && typeof error === 'object' && 'code' in error ? String(error.code) : 'mapping-source-invalid') }
  }
  if (candidateList) {
    const extra = candidateList.filter(candidate => {
      const id = candidateNodeId(candidate)
      return id === undefined || !uses.some(node => node.id === id)
    })
    for (const candidate of extra) diagnostics.push({ sourceRef: candidate && typeof candidate === 'object' ? String(candidate.sourceRef ?? '') : '', decision: 'mapping-rejected', reasonCode: 'mapping-extra' })
    for (const node of uses) if (!usedCandidateNodes.has(node.id)) {
      const prior = diagnostics.some(item => item.sourceRef === node.id && item.decision === 'mapping-rejected')
      if (!prior) diagnostics.push({ sourceRef: node.id, decision: 'mapping-rejected', reasonCode: 'mapping-missing' })
    }
    if (extra.length || usedCandidateNodes.size !== uses.length) reasons.push('mapping-coverage-incomplete')
  }
  if (mappings.length !== uses.length) reasons.push('mapping-coverage-incomplete')
  if (reasons.length) return { status: 'unavailable', diagnostics, reasons }
  try {
    return { status: 'available-content-only', diagnostics, reasons, result: canonicalGraph({ ...canonicalInput, sourceMappings: mappings }), hostProvenance: 'unverified', registryBinding: 'caller-supplied-unattested' }
  } catch (error) { return { status: 'rejected', diagnostics, reasons: [error instanceof Error ? error.message : 'graph-schema-invalid'] } }
}
