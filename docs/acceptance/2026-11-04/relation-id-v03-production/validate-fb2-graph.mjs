import fs from 'node:fs'
const graph = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const counts = new Map()
for (const edge of graph.edges) counts.set(edge.id, (counts.get(edge.id) ?? 0) + 1)
const duplicateKeys = [...counts.values()].filter(count => count > 1).length
const extraOccurrences = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
const result = { nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length, duplicateKeys, extraOccurrences, pass: duplicateKeys === 0 && extraOccurrences === 0 }
console.log(JSON.stringify(result, null, 2))
process.exit(result.pass ? 0 : 1)
