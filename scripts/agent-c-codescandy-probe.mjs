/** Static-only SourceGraph probe. Never executes the target project's code. */
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'

const repo = process.argv[2]
const output = process.argv[3] ?? 'test-results/agent-c-codescandy-probe.json'
const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
if (!repo) throw new Error('Expected an explicit local codescandy checkout path')
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim()
if (actual !== expected) throw new Error(`Refusing unpinned project checkout: ${actual} !== ${expected}`)
const graph = analyzeProject(repo, true)
const target = graph.nodes.filter(node => node.kind === 'data' && node.value?.trim() === 'Overview' && node.location?.path.endsWith('ProfileHeader.tsx'))
const profileRoute = graph.nodes.find(node => node.kind === 'route' && node.page === '/pages/profile')
const routeEdges = graph.edges.filter(e => e.kind === 'renders' && e.from === profileRoute?.id)
const componentById = new Map(graph.nodes.map(n => [n.id, n]))
const targetMatches = target.map(node => ({
  id: node.id, path: node.location?.path, offset: node.location?.start,
  value: node.value,
  impact: sourceProvenPageImpact(graph, node.id),
}))
const result = {
  schemaVersion: 1,
  rippleSha: process.env.GITHUB_SHA ?? 'local-unpinned',
  codescandySha: actual,
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, routes: graph.nodes.filter(n=>n.kind==='route').length },
  unresolved: graph.unresolved,
  profileRoute: profileRoute ? {
    id: profileRoute.id, source: profileRoute.location,
    edges: routeEdges.map(edge=>({
      id: edge.id, certainty: edge.certainty,
      componentId: edge.to, component: componentById.get(edge.to)?.label,
      componentSource: componentById.get(edge.to)?.location?.path,
      componentProvenance: graph.edges.filter(x => x.from === edge.to && x.kind === 'imports' && x.id.startsWith('source:')).map(x => x.to),
    })),
  } : null,
  overviewTargets: targetMatches,
  candidateGate: targetMatches.length === 1 && targetMatches[0].impact.certainty === 'source-proven' && targetMatches[0].impact.unresolved.length === 0
    ? 'source-proof-satisfied-only (no CandidatePatch created; preview, approval and rollback NOT RUN)'
    : `BLOCKED: ${targetMatches.length !== 1 ? 'TEXT target is ambiguous/missing' : targetMatches[0].impact.unresolved.join('; ')}`,
  notes: ['Graph proof does not imply project preview support or completed lifecycle.', 'Static analysis only; target code was never executed.'],
}
fs.mkdirSync(path.dirname(output),{recursive:true})
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
