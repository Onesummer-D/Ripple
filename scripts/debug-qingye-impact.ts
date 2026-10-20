import { analyzeProject, readProjectSnapshot } from '../src/core/project'
import { sourceProvenPageImpact } from '../src/core/scope'

const root = process.argv[2]
const graph = analyzeProject(root)
console.log('revision', graph.revision.sourceDigest.slice(0, 12), 'nodes', graph.nodes.length)
const routes = graph.nodes.filter(n => n.kind === 'route')
console.log('routes:', routes.map(r => `${r.id} label=${r.label} page=${r.page}`).join('\n  '))
for (const node of graph.nodes.filter(n => n.kind === 'media')) {
  const impact = sourceProvenPageImpact(graph, node.id)
  const value = (node.value ?? '').slice(0, 70)
  console.log(`\nMEDIA ${node.id}\n  value=${value}\n  pages=[${impact.pageRefs.join(', ')}] certainty=${impact.certainty}\n  unresolved=${impact.unresolved.length}`)
  for (const u of impact.unresolved.slice(0, 4)) console.log(`    - ${u}`)
}
