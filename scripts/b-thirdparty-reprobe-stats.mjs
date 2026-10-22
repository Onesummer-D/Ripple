/** B-side reprobe stats: media/TEXT/token/route comparison for codescandy (Issue #6).
 *  Static-only; never executes target project code. Reuses A/C+D analyzeProject. */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'

const repo = process.argv[2]
const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

const graph = analyzeProject(repo, true)
const byId = new Map(graph.nodes.map(n => [n.id, n]))

// Media consumption proofs: source-proven edges whose target is a media asset node
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'font', 'media'])
const mediaAssetNodes = graph.nodes.filter(n => MEDIA_KINDS.has(n.kind) || n.id.startsWith('asset:'))
const mediaConsumptionProofs = graph.edges.filter(e =>
  e.certainty === 'source-proven' && mediaAssetNodes.some(m => m.id === e.to))
const mediaAllConsumption = graph.edges.filter(e => mediaAssetNodes.some(m => m.id === e.to))

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
  schemaVersion: 1,
  codescandySha: actual,
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, routes: routes.length },
  unresolved: graph.unresolved,
  media: {
    assetNodes: mediaAssetNodes.length,
    consumptionProofsSourceProven: mediaConsumptionProofs.length,
    consumptionEdgesAll: mediaAllConsumption.length,
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
  },
  tokens: { tokenNodes: tokenNodes.length, scssFiles: scssFiles.map(n => n.location?.path ?? n.id) },
}
fs.mkdirSync('test-results', { recursive: true })
fs.writeFileSync('test-results/b-thirdparty-reprobe-stats.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
