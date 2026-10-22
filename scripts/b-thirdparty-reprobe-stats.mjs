/** B-side reprobe stats: media/TEXT/token/route comparison for codescandy (Issue #6).
 *  Static-only; never executes target project code. Reuses A/C+D analyzeProject. */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'

const repo = process.argv[2]
const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

const graph = analyzeProject(repo, true)
const byId = new Map(graph.nodes.map(n => [n.id, n]))

// Media accounting — strictly by edge kind. The comparable historical metric is
// asset-consumer (source-proven), NOT every edge pointing at a media node.
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'font', 'media'])
const mediaAssetNodes = graph.nodes.filter(n => MEDIA_KINDS.has(n.kind) || n.id.startsWith('asset:') || n.kind === 'media')
const mediaIds = new Set(mediaAssetNodes.map(n => n.id))
const edgesToMedia = graph.edges.filter(e => mediaIds.has(e.to))
const tally = (edges) => {
  const byCertainty = {}
  for (const e of edges) byCertainty[e.certainty] = (byCertainty[e.certainty] ?? 0) + 1
  return { total: edges.length, byCertainty }
}
const assetConsumerEdges = edgesToMedia.filter(e => e.kind === 'asset-consumer')
const otherEdgesToMediaByKind = {}
for (const e of edgesToMedia.filter(e => e.kind !== 'asset-consumer')) {
  otherEdgesToMediaByKind[e.kind] = otherEdgesToMediaByKind[e.kind] ?? { total: 0, byCertainty: {} }
  otherEdgesToMediaByKind[e.kind].total++
  otherEdgesToMediaByKind[e.kind].byCertainty[e.certainty] = (otherEdgesToMediaByKind[e.kind].byCertainty[e.certainty] ?? 0) + 1
}
const consumedMediaIds = new Set(edgesToMedia.map(e => e.to))
const mediaPageImpactTally = { 'source-proven': 0, partial: 0, unknown: 0 }
for (const m of mediaAssetNodes) {
  const impact = sourceProvenPageImpact(graph, m.id)
  mediaPageImpactTally[impact.certainty] = (mediaPageImpactTally[impact.certainty] ?? 0) + 1
}

// TEXT literal nodes consumed by components with source-proven reads edges
// (Ripple models JSX text as kind 'data'; the C+D probe uses the same filter)
const textLiterals = graph.nodes.filter(n => n.kind === 'data' && typeof n.value === 'string')
const textSourceProvenReads = graph.edges.filter(e =>
  e.kind === 'reads' && e.certainty === 'source-proven' && byId.get(e.to)?.kind === 'data')

// Routes
const routes = graph.nodes.filter(n => n.kind === 'route')
const routeEdgeKinds = {}
for (const e of graph.edges) if (e.from?.startsWith?.('page:') || byId.get(e.from)?.kind === 'route') routeEdgeKinds[e.kind] = (routeEdgeKinds[e.kind] ?? 0) + 1

// errorElement / conditional-route consumers still unproven
const unprovenRouteConsumers = graph.edges.filter(e =>
  (byId.get(e.from)?.kind === 'route' || e.from?.startsWith?.('data-router:')) && e.certainty !== 'source-proven')

// Tokens / SCSS
const tokenNodes = graph.nodes.filter(n => n.kind === 'token' || n.id.includes('token'))
const scssFiles = graph.nodes.filter(n => (n.location?.path ?? n.id).endsWith('.scss'))

const result = {
  schemaVersion: 2,
  codescandySha: actual,
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, routes: routes.length },
  unresolved: graph.unresolved,
  media: {
    assetNodes: mediaAssetNodes.length,
    uniqueConsumed: consumedMediaIds.size,
    unconsumed: mediaAssetNodes.length - consumedMediaIds.size,
    assetConsumer: tally(assetConsumerEdges),
    otherEdgesToMediaByKind,
    pageImpactTally: mediaPageImpactTally,
    comparisonNote: '旧基线 61 = asset-consumer source-proven，与本表 assetConsumer.byCertainty.source-proven 同口径；指向媒体节点的 reads 等其他边不计入该指标。',
  },
  text: {
    literalNodes: textLiterals.length,
    sourceProvenReadsEdges: textSourceProvenReads.length,
  },
  routes: {
    count: routes.length,
    sample: routes.slice(0, 40).map(r => ({ id: r.id, page: r.page, certainty: r.certainty })),
    routeEdgeKinds,
    unprovenRouteConsumerCount: unprovenRouteConsumers.length,
    unprovenRouteConsumers: unprovenRouteConsumers.slice(0, 20).map(e => ({ id: e.id, kind: e.kind, certainty: e.certainty })),
    coverageNote: 'unprovenRouteConsumerCount=0 不等于 graph.unresolved=0，也不等于完整路由覆盖已证明；当前 errorElement 条件回退消费者即经 graph.unresolved 记录，而非本计数。',
  },
  tokens: { tokenNodes: tokenNodes.length, scssFiles: scssFiles.map(n => n.location?.path ?? n.id) },
}
fs.mkdirSync('test-results', { recursive: true })
fs.writeFileSync('test-results/b-thirdparty-reprobe-stats.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
