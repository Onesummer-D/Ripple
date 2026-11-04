import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd()
const dir = path.resolve(root, 'docs/acceptance/2026-11-04/relation-id-v03-production')
const oldPath = path.resolve(root, 'docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-graph-final34d2.json')
const finalPath = path.join(dir, 'graph-final-fb2.json')
const migrationPath = path.join(dir, 'relation-id-v1-migration-manifest-fb2.json')
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = file => ({ bytes: fs.readFileSync(file), value: JSON.parse(fs.readFileSync(file, 'utf8')) })
const old = readJson(oldPath)
const final = readJson(finalPath)
const migration = JSON.parse(fs.readFileSync(migrationPath, 'utf8'))
const edgePayload = edge => ({
  from: edge.from,
  to: edge.to,
  kind: edge.kind,
  certainty: edge.certainty,
  evidenceRefs: edge.evidenceRefs ?? [],
  sourceUse: edge.sourceUse ?? null,
  sourceRef: edge.sourceRef ?? null,
  selectorScope: edge.selectorScope ?? null,
  mediaContext: edge.mediaContext ?? null,
})
const edgePayloadWithoutId = edge => ({
  from: edge.from,
  to: edge.to,
  kind: edge.kind,
  certainty: edge.certainty,
  evidenceRefs: edge.evidenceRefs ?? [],
  sourceUse: edge.sourceUse ?? null,
  selectorScope: edge.selectorScope ?? null,
  mediaContext: edge.mediaContext ?? null,
})
const payloadKey = edge => canonical(edgePayloadWithoutId(edge))
const payloadSha = edge => sha256(Buffer.from(canonical(edgePayload(edge)), 'utf8'))
const finalPayloadSha = edge => sha256(Buffer.from(canonical(edgePayloadWithoutId(edge)), 'utf8'))
const occurrenceRows = graph => {
  const counts = new Map()
  return graph.edges
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.index - b.index)
    .map(({ edge }) => {
      const occurrenceOrdinal = counts.get(edge.id) ?? 0
      counts.set(edge.id, occurrenceOrdinal + 1)
      return { edge, occurrenceOrdinal }
    })
}
const oldRows = occurrenceRows(old.value)
const finalRows = occurrenceRows(final.value)
const oldPayloadCandidates = new Map()
for (const row of oldRows) {
  const key = payloadKey(row.edge)
  const list = oldPayloadCandidates.get(key) ?? []
  list.push({ oldRelationId: row.edge.id, oldOccurrenceOrdinal: row.occurrenceOrdinal })
  oldPayloadCandidates.set(key, list)
}
const migrationByNewId = new Map()
for (const record of migration.records) {
  if (!record.newRelationId) continue
  const list = migrationByNewId.get(record.newRelationId) ?? []
  list.push(record)
  migrationByNewId.set(record.newRelationId, list)
}
const reverseRecords = finalRows.map(({ edge, occurrenceOrdinal }) => {
  const direct = migrationByNewId.get(edge.id) ?? []
  const payloadCandidates = oldPayloadCandidates.get(payloadKey(edge)) ?? []
  const candidates = direct.length ? direct : payloadCandidates.map(candidate => {
    const record = migration.records.find(item => item.oldRelationId === candidate.oldRelationId && item.oldOccurrenceOrdinal === candidate.oldOccurrenceOrdinal)
    return record ? { ...candidate, status: record.status, oldPayloadSha256: record.oldPayloadSha256 } : candidate
  })
  const status = direct.length === 1 ? 'mapped' : direct.length > 1 ? 'ambiguous' : candidates.length ? 'unresolved' : 'orphaned'
  return {
    finalRelationId: edge.id,
    finalOccurrenceOrdinal: occurrenceOrdinal,
    finalPayloadSha256: finalPayloadSha(edge),
    sourceUse: edge.sourceUse ?? null,
    sourceRef: edge.sourceRef ?? null,
    selectorScope: edge.selectorScope ?? null,
    mediaContext: edge.mediaContext ?? null,
    status,
    oldOccurrenceCandidates: candidates,
    reason: status === 'mapped' ? 'unique-new-id-mapping' : status === 'ambiguous' ? 'multiple-old-occurrences-share-new-id' : status === 'unresolved' ? 'payload-only-candidate-without-unique-new-id' : 'no-old-occurrence-candidate',
  }
})
const oldPayloadKeys = new Map()
for (const row of oldRows) oldPayloadKeys.set(payloadKey(row.edge), (oldPayloadKeys.get(payloadKey(row.edge)) ?? 0) + 1)
// Recompute the multiset comparison without relying on emission order.
const finalPayloadKeys = new Map()
for (const row of finalRows) finalPayloadKeys.set(payloadKey(row.edge), (finalPayloadKeys.get(payloadKey(row.edge)) ?? 0) + 1)
let payloadMismatchOld = 0
let payloadMismatchFinal = 0
for (const [key, count] of oldPayloadKeys) payloadMismatchOld += Math.max(0, count - (finalPayloadKeys.get(key) ?? 0))
for (const [key, count] of finalPayloadKeys) payloadMismatchFinal += Math.max(0, count - (oldPayloadKeys.get(key) ?? 0))
const statusCounts = Object.fromEntries(['mapped', 'ambiguous', 'unresolved', 'orphaned'].map(status => [status, reverseRecords.filter(record => record.status === status).length]))
const out = {
  schemaVersion: 'relation-id-migration/bidirectional-audit/v1',
  implementationBinding: {
    baseCommit: 'fb2efe35c447eadf262d55f1d9755bb26cecabda',
    implementationCommit: 'f6d1edf286d40314e83aa3121214dcf85d824fc0',
    implementationTree: '2e0eb49b3dcb8adf09b0cdb1312bbd3b65c0adf3',
    finalArchiveParent: 'b2c33056a0d67841a4b8fd08f16b35ab93d0df48',
  },
  oldGraph: { artifact: path.relative(root, oldPath).replaceAll('\\', '/'), sha256: sha256(old.bytes), edgeCount: old.value.edges.length },
  finalGraph: { artifact: path.relative(root, finalPath).replaceAll('\\', '/'), sha256: sha256(final.bytes), edgeCount: final.value.edges.length },
  oldToNew: {
    manifest: path.relative(root, migrationPath).replaceAll('\\', '/'),
    totalOccurrences: migration.records.length,
    statusCounts: migration.statusCounts,
    everyOccurrenceHasOldGraphPayload: migration.records.every(record => record.oldGraphSha256 === sha256(old.bytes) && typeof record.oldPayloadSha256 === 'string'),
    everyUnresolvedHasReason: migration.records.filter(record => record.status === 'unresolved').every(record => record.newRelationId === null && typeof record.reason === 'string'),
  },
  newToOld: { totalOccurrences: reverseRecords.length, statusCounts, records: reverseRecords },
  historicalPayloadComparison: {
    oldToFinalPayloadMismatch: payloadMismatchOld,
    finalToOldPayloadMismatch: payloadMismatchFinal,
    matchedPayloadOccurrences: old.value.edges.length - payloadMismatchOld,
    status: 'not-proven',
    reason: 'The historical B1.1 graph and the fb2 structural reproduction do not share sufficient exact project provenance for payload equivalence to prove migration identity.',
  },
}
const output = path.join(dir, 'relation-id-v03-fb2-bidirectional-audit.json')
fs.writeFileSync(output, `${JSON.stringify(out, null, 2)}\n`)
console.log(JSON.stringify({ output, oldGraphSha256: sha256(old.bytes), finalGraphSha256: sha256(final.bytes), payloadMismatchOld: payloadMismatchOld, payloadMismatchFinal, reverseStatusCounts: statusCounts }, null, 2))
