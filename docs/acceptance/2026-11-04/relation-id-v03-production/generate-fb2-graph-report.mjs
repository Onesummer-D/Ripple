import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd()
const dir = path.resolve(root, 'docs/acceptance/2026-11-04/relation-id-v03-production')
const basePath = path.join(dir, 'graph-base-fb2.json')
const finalPath = path.join(dir, 'graph-final-fb2.json')
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'))
const final = JSON.parse(fs.readFileSync(finalPath, 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fileSha = file => sha256(fs.readFileSync(file))
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
const payloadKey = edge => canonical(Object.fromEntries(Object.entries(edge).filter(([key]) => key !== 'id')))
const multiset = graph => {
  const result = new Map()
  for (const edge of graph.edges) result.set(payloadKey(edge), (result.get(payloadKey(edge)) ?? 0) + 1)
  return result
}
const diff = (left, right) => {
  let removed = 0
  let added = 0
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if ((left.get(key) ?? 0) > (right.get(key) ?? 0)) removed += (left.get(key) ?? 0) - (right.get(key) ?? 0)
    if ((right.get(key) ?? 0) > (left.get(key) ?? 0)) added += (right.get(key) ?? 0) - (left.get(key) ?? 0)
  }
  return { removed, added }
}
const stats = graph => {
  const ids = new Map()
  for (const edge of graph.edges) ids.set(edge.id, (ids.get(edge.id) ?? 0) + 1)
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    unresolved: graph.unresolved.length,
    duplicateRelationIdKeys: [...ids.values()].filter(count => count > 1).length,
    extraOccurrences: [...ids.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    certainty: Object.fromEntries(['source-proven', 'runtime-observed', 'semantic-candidate', 'unknown'].map(certainty => [certainty, graph.edges.filter(edge => edge.certainty === certainty).length])),
  }
}
const sourceProvenPayload = graph => new Map(graph.edges.filter(edge => edge.certainty === 'source-proven').map(edge => [edge.id, sha256(Buffer.from(payloadKey(edge), 'utf8'))]))
const baseProven = sourceProvenPayload(base)
const finalProven = sourceProvenPayload(final)
const sourceProvenRemoved = [...baseProven.keys()].filter(id => !finalProven.has(id))
const sourceProvenChanged = [...baseProven.keys()].filter(id => finalProven.has(id) && baseProven.get(id) !== finalProven.get(id))
const basePayloads = multiset(base)
const finalPayloads = multiset(final)
const payloadDiff = diff(basePayloads, finalPayloads)
const sourceFields = graph => new Map(graph.edges.map(edge => [canonical({ from: edge.from, to: edge.to, kind: edge.kind, sourceUse: edge.sourceUse ?? null, selectorScope: edge.selectorScope ?? null, mediaContext: edge.mediaContext ?? null }), 1]))
const report = {
  schemaVersion: 'relation-id-v03-fb2-graph-report/v1',
  provenance: { project: 'allanhue/webportflio', requestedCommit: 'b244f857457d2a07f118155602eef9097fd322bd', exactCheckout: false, sourceSnapshot: { requestedProjectSha: 'b244f857457d2a07f118155602eef9097fd322bd', localStructuralSnapshotGitSha: 'a2876ab6e79d4e7b9fdafd301bd3549c92e9ae71', sourceDigest: '0b291f7df4aa8cdc168ad42cb4f7f1e4edb79e76108e64254fdc5977d70ac6b7', exactCheckout: false }, note: 'Structural reproduction uses the archived source-text-plus-binary-placeholder checkout; exact third-party bytes and B v5 are not claimed.' },
  base: { coreSha: 'fb2efe35c447eadf262d55f1d9755bb26cecabda', coreTree: 'e942bf8d12e3c7224b79d673705fdc253c0cf552', analyzerSha: 'fb2efe35c447eadf262d55f1d9755bb26cecabda', analyzerTree: 'e942bf8d12e3c7224b79d673705fdc253c0cf552', artifact: path.relative(root, basePath).replaceAll('\\', '/'), sha256: fileSha(basePath), stats: stats(base) },
  final: { implementationSha: 'f6d1edf286d40314e83aa3121214dcf85d824fc0', implementationTree: '2e0eb49b3dcb8adf09b0cdb1312bbd3b65c0adf3', analyzerSha: 'f6d1edf286d40314e83aa3121214dcf85d824fc0', analyzerTree: '2e0eb49b3dcb8adf09b0cdb1312bbd3b65c0adf3', artifact: path.relative(root, finalPath).replaceAll('\\', '/'), sha256: fileSha(finalPath), stats: stats(final) },
  payloadMultiset: { removedCount: payloadDiff.removed, addedCount: payloadDiff.added, equal: payloadDiff.removed === 0 && payloadDiff.added === 0 },
  sourceProven: { baseCount: baseProven.size, finalCount: finalProven.size, removedIds: sourceProvenRemoved, changedPayloadIds: sourceProvenChanged, equal: sourceProvenRemoved.length === 0 && sourceProvenChanged.length === 0 },
  sourceFieldKeyCount: { base: sourceFields(base).size, final: sourceFields(final).size },
  unresolved: { base: base.unresolved.length, final: final.unresolved.length, unchanged: JSON.stringify(base.unresolved) === JSON.stringify(final.unresolved) },
  relationIdUniqueness: { baseExitCode: stats(base).duplicateRelationIdKeys === 0 ? 0 : 1, finalExitCode: stats(final).duplicateRelationIdKeys === 0 ? 0 : 1 },
}
const out = path.join(dir, 'relation-id-v03-fb2-graph-report.json')
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
