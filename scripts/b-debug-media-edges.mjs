import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'

const repo = process.argv[2]
const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)
const graph = analyzeProject(repo, true)
const byId = new Map(graph.nodes.map(n => [n.id, n]))
const mediaNodes = graph.nodes.filter(n => n.kind === 'media')
const mediaIds = new Set(mediaNodes.map(n => n.id))
const edgesToMedia = graph.edges.filter(e => mediaIds.has(e.to))
const byKind = {}
for (const e of edgesToMedia) {
  byKind[e.kind] ??= { total: 0, byCertainty: {} }
  byKind[e.kind].total++
  byKind[e.kind].byCertainty[e.certainty] = (byKind[e.kind].byCertainty[e.certainty] ?? 0) + 1
}
const assetConsumer = byKind['asset-consumer'] ?? null
const consumedIds = new Set(edgesToMedia.map(e => e.to))
const impacts = { 'source-proven': 0, partial: 0, unknown: 0, other: 0 }
for (const m of mediaNodes) {
  const impact = sourceProvenPageImpact(graph, m.id)
  impacts[impact.certainty] = (impacts[impact.certainty] ?? 0) + 1
}
console.log(JSON.stringify({
  mediaNodes: mediaNodes.length,
  uniqueMediaConsumed: consumedIds.size,
  unconsumedMedia: mediaNodes.length - consumedIds.size,
  edgesToMediaByKind: byKind,
  assetConsumer,
  mediaPageImpactTally: impacts,
}, null, 2))
