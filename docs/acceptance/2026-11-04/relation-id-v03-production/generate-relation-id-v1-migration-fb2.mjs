import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalJson, canonicalizeSelectorScope, createCssSelectorCandidateIdentity } from '../../../../src/core/relation-id-v1.ts'

const root = process.cwd()
const oldGraphPath = path.resolve(root, 'docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-graph-final34d2.json')
const oldGraphBytes = fs.readFileSync(oldGraphPath)
const graph = JSON.parse(oldGraphBytes.toString('utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const oldGraphSha256 = sha256(oldGraphBytes)
const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
const payloadFor = edge => ({ id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, certainty: edge.certainty, evidenceRefs: edge.evidenceRefs ?? [], sourceUse: edge.sourceUse ?? null, sourceRef: edge.sourceRef ?? null, selectorScope: edge.selectorScope ?? null, mediaContext: edge.mediaContext ?? null })
const payloadSha = edge => sha256(Buffer.from(canonicalJson(payloadFor(edge)), 'utf8'))
const occurrenceCounts = new Map()
const records = []
const unresolvedReasons = new Map()
const sortedEdges = graph.edges.map((edge, index) => ({ edge, index })).sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.index - b.index)
for (const { edge } of sortedEdges) {
  const ordinal = occurrenceCounts.get(edge.id) ?? 0
  occurrenceCounts.set(edge.id, ordinal + 1)
  const oldPayloadSha256 = payloadSha(edge)
  if (edge.kind !== 'css-cascade') {
    records.push({ oldRelationId: edge.id, oldOccurrenceOrdinal: ordinal, oldGraphSha256, oldPayloadSha256, producerPolicy: 'legacy', status: 'retained', newRelationId: edge.id, newPayloadSha256: oldPayloadSha256, reason: 'legacy-producer-id-is-out-of-scope' })
    continue
  }
  const useNode = nodeById.get(edge.from)
  const tokenName = typeof useNode?.label === 'string' && useNode.label.startsWith('var(') ? useNode.label.slice(4, -1) : undefined
  const useSelectorScope = useNode?.selectorScope ?? ''
  const definitions = graph.nodes.filter(node => node.kind === 'token' && node.label === tokenName && node.selectorScope === edge.selectorScope && JSON.stringify(node.mediaContext ?? []) === JSON.stringify(edge.mediaContext ?? []))
  const base = { oldRelationId: edge.id, oldOccurrenceOrdinal: ordinal, oldGraphSha256, oldPayloadSha256, producerPolicy: 'css-selector-candidate', sourceUse: edge.sourceUse ?? null, selectorScope: edge.selectorScope ?? null }
  if (!tokenName) {
    records.push({ ...base, status: 'unresolved', newRelationId: null, reason: 'missing-token-use-label' })
    continue
  }
  if (definitions.length !== 1) {
    records.push({ ...base, status: 'unresolved', newRelationId: null, reason: definitions.length === 0 ? 'definition-identity-not-found' : 'definition-identity-ambiguous', definitionCandidateCount: definitions.length })
    continue
  }
  const definition = definitions[0]
  const sourceUse = edge.sourceUse
  const definitionLocation = definition.location
  const rawScope = definition.selectorScope
  const sourceUseValid = sourceUse && typeof sourceUse.path === 'string' && sourceUse.path.trim() && Number.isSafeInteger(sourceUse.charOffset) && sourceUse.charOffset >= 0 && Number.isSafeInteger(sourceUse.byteOffset) && sourceUse.byteOffset >= 0 && typeof useSelectorScope === 'string' && useSelectorScope.trim()
  const definitionValid = definitionLocation && typeof definitionLocation.path === 'string' && definitionLocation.path.trim() && Number.isSafeInteger(definitionLocation.offset) && definitionLocation.offset >= 0 && Number.isSafeInteger(definition.byteOffset) && definition.byteOffset >= 0 && typeof rawScope === 'string' && rawScope.trim()
  if (!sourceUseValid || !definitionValid) {
    records.push({ ...base, status: 'unresolved', newRelationId: null, reason: 'missing-concrete-source-span-or-selector-scope' })
    continue
  }
  const canonicalScope = canonicalizeSelectorScope(rawScope).canonical
  const identity = createCssSelectorCandidateIdentity({
    kind: 'css-cascade', from: edge.from, to: edge.to,
    sourceUse: { path: sourceUse.path, charOffset: sourceUse.charOffset, byteOffset: sourceUse.byteOffset, offsetUnit: 'code-unit', selectorScope: useSelectorScope },
    definition: { id: definition.id, tokenName, tokenOrigin: 'css-custom-property', sourcePath: definitionLocation.path, charOffset: definitionLocation.offset, byteOffset: definition.byteOffset, offsetUnit: 'code-unit', rawSelectorScope: rawScope, canonicalSelectorScope: canonicalScope, selectorParserVersion: 'css-selector-static-subset/v1', mediaContext: [...(definition.mediaContext ?? [])] },
    relationRawSelectorScope: rawScope, relationCanonicalSelectorScope: canonicalScope, relationMediaContext: [...(edge.mediaContext ?? [])],
  })
  const newPayload = { from: edge.from, to: edge.to, kind: edge.kind, certainty: edge.certainty, evidenceRefs: edge.evidenceRefs ?? [], sourceUse: edge.sourceUse ?? null, selectorScope: edge.selectorScope ?? null, mediaContext: edge.mediaContext ?? null }
  records.push({ ...base, status: identity.id === edge.id ? 'retained' : 'renamed', newRelationId: identity.id, newPayloadSha256: sha256(Buffer.from(canonicalJson(newPayload), 'utf8')), definitionId: definition.id, definitionSourceRef: definition.location?.path && definition.location.offset !== undefined ? `css:${definition.location.path}#${definition.location.offset}` : null, mappingBasis: 'unique-definition-selector-media-sourceUse' })
}
const oldIdCounts = [...occurrenceCounts.entries()]
const relationIdDuplicateKeys = oldIdCounts.filter(([, count]) => count > 1).length
const relationIdExtraOccurrences = oldIdCounts.reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0)
const statusCounts = Object.fromEntries(['retained', 'renamed', 'split', 'unresolved', 'ambiguous', 'orphaned'].map(status => [status, records.filter(record => record.status === status).length]))
const incompatibleCandidateRelations = new Set(records.filter(record => record.reason === 'definition-identity-ambiguous').map(record => record.oldRelationId)).size
const manifest = {
  schemaVersion: 'relation-id-migration/v1', relationIdentityVersion: 'relation-id/v1', producerPolicyVersion: 'sourcegraph-identity/v2',
  generatedFrom: { oldGraphArtifact: path.relative(root, oldGraphPath).replaceAll('\\', '/'), oldGraphSha256, oldGraphGitCommit: graph.revision?.gitCommit ?? null, oldGraphSourceDigest: graph.revision?.sourceDigest ?? null },
  implementationBinding: { baseCommit: 'fb2efe35c447eadf262d55f1d9755bb26cecabda', implementationCommit: 'f6d1edf286d40314e83aa3121214dcf85d824fc0', implementationTree: '2e0eb49b3dcb8adf09b0cdb1312bbd3b65c0adf3', status: 'pending-final-graph-binding', note: 'This manifest is a deterministic audit projection of the frozen B1.1 graph. Final C graph evidence must replace implementationCommit and rerun the same generator against the final graph.' },
  identityCollisionHandling: { oldGraphRelationIdDuplicateKeys: relationIdDuplicateKeys, oldGraphExtraOccurrences: relationIdExtraOccurrences, newGraphExpectedDuplicateKeys: 0, newGraphExpectedExtraOccurrences: 0, duplicatePolicy: 'reject-every-repeated-governed-id; never silently deduplicate' },
  statusCounts,
  mappingStats: { totalOldOccurrences: records.length, retained: statusCounts.retained, renamed: statusCounts.renamed, split: statusCounts.split, unresolved: statusCounts.unresolved, missingMapping: records.filter(record => record.newRelationId === null).length, incompatibleCandidateRelations, note: 'split is determined only after binding the final graph; old-only records with ambiguous definition identity remain unresolved.' },
  records,
}
const out = path.resolve(root, 'docs/acceptance/2026-11-04/relation-id-v03-production/relation-id-v1-migration-manifest-fb2.json')
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ out, oldGraphSha256, records: records.length, statusCounts, relationIdDuplicateKeys, relationIdExtraOccurrences }, null, 2))
