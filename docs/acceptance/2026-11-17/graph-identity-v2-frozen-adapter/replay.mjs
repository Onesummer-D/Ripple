import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { captureFrozenSourceSnapshot } from '../../../../src/core/frozen-project-snapshot.ts'
import { analyzeProject, digestTrackedTree } from '../../../../src/core/project.ts'
import { adaptSourceGraph } from '../../../../src/core/graph-identity-v2-adapter.ts'

const [root, output] = process.argv.slice(2)
if (!root || !output) throw new Error('Usage: node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/replay.mjs <project-root> <output-dir>')
fs.mkdirSync(output, { recursive: true })
const snapshot = captureFrozenSourceSnapshot(root)
if (snapshot.gitHead !== 'b244f857457d2a07f118155602eef9097fd322bd') throw new Error('Fixed project HEAD mismatch')
const independentProductionDigest = digestTrackedTree(root)
if (snapshot.sourceDigest !== independentProductionDigest) {
  throw new Error(`Snapshot sourceDigest mismatch: snapshot=${snapshot.sourceDigest}; digestTrackedTree=${independentProductionDigest}`)
}
const graph = analyzeProject(snapshot)
// This controlled record exercises content adaptation only. No issuer is claimed.
const registry = { projectId: 'test-only:webportflio', repository: 'allanhue/webportflio', head: snapshot.gitHead, rootTree: snapshot.rootTree, sourceDigest: snapshot.sourceDigest }
const adapted = adaptSourceGraph({ graph, snapshot, registry })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
fs.writeFileSync(path.join(output, 'sourcegraph.json'), JSON.stringify(graph, null, 2) + '\n')
fs.writeFileSync(path.join(output, 'mapping-diagnostics.json'), JSON.stringify(adapted.diagnostics, null, 2) + '\n')
if (adapted.status === 'available-content-only') {
  fs.writeFileSync(path.join(output, 'canonical-graph.json'), adapted.result.canonicalBytes)
}
const report = {
  status: adapted.status, reasons: adapted.reasons, projectHead: snapshot.gitHead, rootTree: snapshot.rootTree,
  sourceDigest: snapshot.sourceDigest, independentProductionDigest,
  sortingContract: "localeCompare(path, 'en'); no migration to historical bytewise order",
  trackedFiles: snapshot.trackedFiles.length,
  nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length,
  tokenUses: graph.nodes.filter(node => node.kind === 'token-use').length,
  accepted: adapted.diagnostics.filter(item => item.decision === 'accepted').length,
  rejected: adapted.diagnostics.filter(item => item.decision === 'mapping-rejected').length,
  sourceTrust: 'content-only', hostProvenance: 'unverified', registry: 'controlled-test-fixture; no production issuer',
  ...(adapted.status === 'available-content-only' ? { canonicalBytesSha256: adapted.result.canonicalBytesSha256, digest: adapted.result.digest } : {}),
  artifacts: Object.fromEntries(fs.readdirSync(output).filter(file => file.endsWith('.json') && file !== 'replay-result.json').map(file => [file, sha(fs.readFileSync(path.join(output, file)))])),
}
fs.writeFileSync(path.join(output, 'replay-result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = adapted.status === 'available-content-only' ? 0 : 2
