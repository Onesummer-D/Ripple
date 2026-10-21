/**
 * Generic third-party project acceptance probe (Issue #6).
 *
 * Usage:
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/thirdparty-acceptance.ts <projectRoot> [outDir]
 *
 * Runs the public analyzeProject() entry point against ANY git checkout and
 * emits a capability-boundary report as JSON (stdout or <outDir>/report.json):
 * node/edge counts, media/token consumption stats, route-node coverage, and
 * the three known capability boundaries measured on the project
 * (react-router data-router routes, tsconfig references, SCSS tokens).
 *
 * The report never upgrades unsupported capabilities to PASS: boundaries are
 * reported as measured facts plus capability flags, never as claims of support.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'

const root = resolve(process.argv[2] ?? '')
const outDir = process.argv[3] ? resolve(process.argv[3]) : null
if (!process.argv[2]) {
  console.error('usage: thirdparty-acceptance.ts <projectRoot> [outDir]')
  process.exit(2)
}

function frozenSha(dir: string): string {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unavailable'
  }
}

const graph = analyzeProject(root)
const kinds: Record<string, number> = {}
for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1

const mediaNodes = graph.nodes.filter(n => n.kind === 'media')
const tokenNodes = graph.nodes.filter(n => n.kind === 'token')
const routeNodes = graph.nodes.filter(n => n.kind === 'route')
const assetConsumers = graph.edges.filter(e => e.kind === 'asset-consumer')
const tokenUsers = graph.edges.filter(e => e.kind === 'uses-token')

const report = {
  generatedAt: new Date().toISOString(),
  projectRoot: root,
  frozenSha: frozenSha(root),
  rippleHead: frozenSha(process.cwd()),
  stats: {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    kinds,
    media: { total: mediaNodes.length },
    tokens: { total: tokenNodes.length },
    routes: { total: routeNodes.length },
    assetConsumers: {
      total: assetConsumers.length,
      sourceProven: assetConsumers.filter(e => e.certainty === 'source-proven').length,
      semanticCandidate: assetConsumers.filter(e => e.certainty === 'semantic-candidate').length,
    },
    tokenConsumers: {
      total: tokenUsers.length,
      sourceProven: tokenUsers.filter(e => e.certainty === 'source-proven').length,
      semanticCandidate: tokenUsers.filter(e => e.certainty === 'semantic-candidate').length,
      unknown: tokenUsers.filter(e => e.certainty === 'unknown').length,
    },
  },
  mediaClosure: mediaNodes.map(node => {
    const impact = sourceProvenPageImpact(graph, node.id)
    return { id: node.id, label: node.label, certainty: impact.certainty, pageRefs: impact.pageRefs.length }
  }).reduce((acc, m) => {
    acc.total++
    acc[m.certainty === 'source-proven' ? 'full' : m.certainty === 'partial' ? 'partial' : 'unknown']++
    return acc
  }, { total: 0, full: 0, partial: 0, unknown: 0 } as Record<string, number>),
  capabilityBoundaries: {
    // Measured, never claimed as supported:
    scssTokensSupported: tokenNodes.some(n => n.location?.path?.endsWith('.scss')) ? 'measured-present' : 'none-present',
    routeNodesDerived: routeNodes.length,
    unresolvedCount: graph.unresolved.length,
    unresolvedSample: graph.unresolved.slice(0, 20),
  },
}

const json = JSON.stringify(report, null, 2)
if (outDir) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), json)
  console.log(`report written: ${join(outDir, 'report.json')}`)
} else {
  console.log(json)
}
