/** Static-only SourceGraph probe. Never executes the target project's code. */
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import ts from 'typescript'
import { resolveProjectConfigGraph } from '../src/core/project-config-resolver.mjs'

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
const nodeIds = new Set(graph.nodes.map(node => node.id))
const danglingSourceProven = graph.edges.filter(edge => edge.certainty === 'source-proven' &&
  (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))).map(edge => ({
  id: edge.id, from: edge.from, to: edge.to, kind: edge.kind,
  missingFrom: !nodeIds.has(edge.from), missingTo: !nodeIds.has(edge.to),
}))
// Find a *source-proven* component-consumption chain, not an arbitrary import
// file dependency. A separate uncertain JSX child edge guards DOM proof.
const consumptionPath = (from, to) => {
  if (!from || !to) return null
  const queue = [{at:from, steps:[]}]
  const seen = new Set()
  while(queue.length) {
    const {at,steps}=queue.shift()
    if(at===to) return steps
    if(seen.has(at)) continue
    seen.add(at)
    for(const edge of graph.edges) {
      if(edge.from!==at || edge.certainty!=='source-proven') continue
      if(edge.kind!=='renders' && edge.kind!=='reads') continue
      if(!nodeIds.has(edge.to)) continue
      queue.push({at:edge.to,steps:[...steps,{
        from:edge.from,to:edge.to,kind:edge.kind,certainty:edge.certainty,id:edge.id,
        fromLabel:componentById.get(edge.from)?.label,toLabel:componentById.get(edge.to)?.label,
      }]})
    }
  }
  return null
}
const targetMatches = target.map(node => ({
  id: node.id, path: node.location?.path, offset: node.location?.start,
  value: node.value,
  impact: sourceProvenPageImpact(graph, node.id),
  provenConsumptionPath: consumptionPath(profileRoute?.id,node.id),
  compositeChildDomRisks: graph.edges.filter(e=>e.to===node.id && e.certainty!=='source-proven')
    .map(e=>({id:e.id,from:e.from,kind:e.kind,certainty:e.certainty})),
  jsxSourceNodes: graph.edges.filter(e=>e.to===node.id && e.id.startsWith('jsx-text:'))
    .map(e=>({source:e.from,nodeExists:nodeIds.has(e.from)})),
}))
const config = resolveProjectConfigGraph(repo, ts)
const testModule = 'pages/dashboard/pages/Profile'
const resolvedTestModule = config.application.status === 'supported'
  ? ts.resolveModuleName(testModule, path.join(repo, 'src/App.tsx'), config.application.parsed.options, ts.sys).resolvedModule?.resolvedFileName
  : undefined
const debug = {
  appConfigStatus: config.application.status,
  appConfigPath: config.application.status === 'supported' ? path.relative(repo, config.application.configPath) : null,
  paths: config.application.status === 'supported' ? config.application.parsed.options.paths : null,
  pathsBasePath: config.application.status === 'supported' ? config.application.parsed.options.pathsBasePath : null,
  profileAliasResolved: resolvedTestModule ? path.relative(repo, resolvedTestModule) : null,
  appProfileImportEdges: graph.edges.filter(e => e.kind === 'imports' && e.id.startsWith('import:src/App.tsx') && e.to.includes('Profile')),
  profileComponents: graph.nodes.filter(n => n.kind === 'component' && n.label === 'Profile').map(n => ({ id: n.id, path: n.location?.path })),
}
const result = {
  debug,
  schemaVersion: 1,
  rippleSha: process.env.GITHUB_SHA ?? 'local-unpinned',
  codescandySha: actual,
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, routes: graph.nodes.filter(n=>n.kind==='route').length },
  unresolved: graph.unresolved,
  graphIntegrity: {
    sourceProvenEdges: graph.edges.filter(edge=>edge.certainty==='source-proven').length,
    danglingSourceProvenCount: danglingSourceProven.length,
    danglingSourceProven,
  },
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
  notes: ['Graph proof does not imply project preview support or completed lifecycle.',
    'Composite <Link> children are statically passed in JSX but their DOM propagation is not proven.',
    'Static analysis only; target code was never executed.'],
}
fs.mkdirSync(path.dirname(output),{recursive:true})
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
if (danglingSourceProven.length) process.exitCode = 1
console.log(JSON.stringify(result,null,2))
