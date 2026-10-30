import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const basePath = args.get('--base') ?? 'docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-graph-base.json'
const finalPath = args.get('--final') ?? 'docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-graph-final34d2.json'
const outputPath = args.get('--output') ?? 'docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-relation-id-duplicate-diagnostic.json'

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function withoutId(edge) {
  const copy = { ...edge }
  delete copy.id
  return copy
}
function fileInfo(file) {
  const bytes = fs.readFileSync(file)
  return { path: file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
}
function unique(values) { return [...new Set(values)] }
function prefixOf(id) { return id.split(':', 1)[0] }
function varyingFields(entries) {
  const fields = unique(entries.flatMap(edge => Object.keys(edge).filter(key => key !== 'id')))
  return fields.filter(field => unique(entries.map(edge => stable(edge[field] ?? null))).length > 1).sort()
}

function analyze(label, file) {
  const graph = JSON.parse(fs.readFileSync(file, 'utf8'))
  const byId = new Map()
  for (const edge of graph.edges) {
    const entries = byId.get(edge.id) ?? []
    entries.push(edge)
    byId.set(edge.id, entries)
  }
  const duplicateEntries = [...byId.entries()].filter(([, entries]) => entries.length > 1)
  const prefixStats = {}
  const multiplicity = {}
  const duplicateIds = duplicateEntries.map(([id, entries]) => {
    multiplicity[entries.length] = (multiplicity[entries.length] ?? 0) + 1
    const producerPrefix = prefixOf(id)
    const payloadKeys = unique(entries.map(edge => stable(withoutId(edge))))
    const endpointKeys = unique(entries.map(edge => `${edge.from}\u0000${edge.to}`))
    const kindVariants = unique(entries.map(edge => edge.kind)).sort()
    const certaintyVariants = unique(entries.map(edge => edge.certainty)).sort()
    const selectorScopes = unique(entries.map(edge => edge.selectorScope ?? null)).sort((a, b) => String(a).localeCompare(String(b)))
    const mediaContexts = unique(entries.map(edge => stable(edge.mediaContext ?? null))).sort()
    const varying = varyingFields(entries)
    const prefixRecord = prefixStats[producerPrefix] ?? {
      duplicateKeys: 0,
      duplicateExtra: 0,
      edgeKinds: {},
      payloadSameKeys: 0,
      payloadVaryingKeys: 0,
      endpointVaryingKeys: 0,
      varyingFieldCounts: {},
    }
    prefixRecord.duplicateKeys += 1
    prefixRecord.duplicateExtra += entries.length - 1
    for (const kind of kindVariants) prefixRecord.edgeKinds[kind] = (prefixRecord.edgeKinds[kind] ?? 0) + 1
    if (payloadKeys.length === 1) prefixRecord.payloadSameKeys += 1
    else prefixRecord.payloadVaryingKeys += 1
    if (endpointKeys.length > 1) prefixRecord.endpointVaryingKeys += 1
    const varyingKey = varying.join(',') || '<none>'
    prefixRecord.varyingFieldCounts[varyingKey] = (prefixRecord.varyingFieldCounts[varyingKey] ?? 0) + 1
    prefixStats[producerPrefix] = prefixRecord
    const payloads = new Map()
    for (const edge of entries) payloads.set(stable(withoutId(edge)), withoutId(edge))
    return {
      id,
      count: entries.length,
      duplicateExtra: entries.length - 1,
      producerPrefix,
      payloadVariantCount: payloadKeys.length,
      endpointVariantCount: endpointKeys.length,
      varyingPayloadFields: varying,
      kindVariants,
      certaintyVariants,
      selectorScopes,
      mediaContexts,
      sourceUses: unique(entries.map(edge => stable(edge.sourceUse ?? null))).sort(),
      evidenceRefs: unique(entries.flatMap(edge => edge.evidenceRefs ?? [])).sort(),
      payloads: [...payloads.values()],
    }
  })
  return {
    label,
    input: fileInfo(file),
    graphRevision: graph.revision ?? null,
    edges: graph.edges.length,
    uniqueRelationIds: byId.size,
    duplicateRelationIdKeys: duplicateEntries.length,
    duplicateExtraOccurrences: duplicateEntries.reduce((sum, [, entries]) => sum + entries.length - 1, 0),
    uniqueUnresolved: unique(graph.unresolved ?? []).length,
    duplicateUnresolvedKeys: (graph.unresolved ?? []).length - unique(graph.unresolved ?? []).length,
    multiplicity,
    prefixStats,
    duplicateIds,
  }
}

const result = {
  schemaVersion: 2,
  diagnostic: 'read-only; no Relation ID, graph schema, or source production changes',
  generatedFrom: {
    baseCoreSha: '5b75fe699afce98638e6fd6ad110911d83389dc8',
    implementationSha: '34d2a22e696c9eb1af15d5cd9800cf76b7cf7883',
    archiveHead: '6388abec96183cc28824dc2b7fa486e4e944d305',
    archiveTree: '8455bfc0c6f2ff5491dad8a418c8b8a7bc78ba2e',
    relationIdMethod: 'group exact edge.id; compare stable payload excluding id; compare endpoint, kind, certainty, selectorScope, mediaContext, sourceUse and evidenceRefs sets',
  },
  base: analyze('base', basePath),
  final: analyze('final', finalPath),
}
const baseIds = new Set(result.base.duplicateIds.map(item => item.id))
const finalIds = new Set(result.final.duplicateIds.map(item => item.id))
result.crossGraph = {
  duplicateIdsRetained: [...baseIds].filter(id => finalIds.has(id)).sort(),
  duplicateIdsBaseOnly: [...baseIds].filter(id => !finalIds.has(id)).sort(),
  duplicateIdsFinalOnly: [...finalIds].filter(id => !baseIds.has(id)).sort(),
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({
  output: outputPath,
  base: { edges: result.base.edges, unique: result.base.uniqueRelationIds, duplicateKeys: result.base.duplicateRelationIdKeys, extra: result.base.duplicateExtraOccurrences, multiplicity: result.base.multiplicity },
  final: { edges: result.final.edges, unique: result.final.uniqueRelationIds, duplicateKeys: result.final.duplicateRelationIdKeys, extra: result.final.duplicateExtraOccurrences, multiplicity: result.final.multiplicity },
  crossGraph: { retained: result.crossGraph.duplicateIdsRetained.length, baseOnly: result.crossGraph.duplicateIdsBaseOnly.length, finalOnly: result.crossGraph.duplicateIdsFinalOnly.length },
}, null, 2))
