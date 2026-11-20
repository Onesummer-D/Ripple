import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { captureFrozenSourceSnapshot } from '../../../src/core/frozen-project-snapshot.ts'
import { analyzeProject, digestTrackedTree } from '../../../src/core/project.ts'
import { adaptSourceGraph } from '../../../src/core/graph-identity-v2-adapter.ts'
import { createGraphProducerEvidenceVerifier, measureAnalyzerSourceBuild } from '../../../src/core/graph-producer-evidence-v1.ts'

const [sourceRoot, outputRoot] = process.argv.slice(2)
assert.ok(sourceRoot && outputRoot, 'Usage: graph-producer-evidence-replay.mjs <fixed-project> <output-dir>')
const snapshot = captureFrozenSourceSnapshot(sourceRoot)
assert.equal(snapshot.gitHead, 'b244f857457d2a07f118155602eef9097fd322bd')
assert.equal(snapshot.rootTree, '2a11c8c54d253e153585e88328a365ec5f4eb5cb')
assert.equal(snapshot.sourceDigest, digestTrackedTree(sourceRoot))
const binding = {
  projectId: 'test-only:webportflio', repository: 'allanhue/webportflio',
  head: snapshot.gitHead, rootTree: snapshot.rootTree, sourceDigest: snapshot.sourceDigest,
}
const graph = analyzeProject(snapshot)
const adapted = adaptSourceGraph({ graph, snapshot, registry: binding })
assert.equal(adapted.status, 'available-content-only')
const build = measureAnalyzerSourceBuild()
const verifier = createGraphProducerEvidenceVerifier(build)
const input = { snapshot, binding }
const result = verifier.generate(input)
assert.equal(result.status, 'available-producer-evidence', JSON.stringify(result))
assert.deepEqual(result.rawGraphBytes, Buffer.from(JSON.stringify(graph)))
assert.equal(result.evidence.graphDigest, adapted.result.digest)
assert.equal(result.evidence.canonicalBytesSha256, adapted.result.canonicalBytesSha256)
assert.equal(result.evidence.graphDigest, 'f06aa70dfd13a88f0c32d33d00ffa368f8c984da9c567587cef47553952562d3')
assert.deepEqual([graph.nodes.length, graph.edges.length, graph.unresolved.length, adapted.result.canonical.sourceMappings.length],
  [675, 3046, 253, 252])
const verification = verifier.verify(input, result.evidence, result.rawGraphBytes)
assert.equal(verification.status, 'available-producer-evidence')
const differentRawBytes = Buffer.concat([result.rawGraphBytes, Buffer.from('\n')])
const negatives = {
  appendedByte: verifier.verify(input, result.evidence, differentRawBytes),
  forgedProducer: verifier.verify(input, { ...result.evidence, build: { ...build, producer: 'other' } }, result.rawGraphBytes),
  missingBuild: createGraphProducerEvidenceVerifier().verify(input, result.evidence, result.rawGraphBytes),
  wrongTree: verifier.generate({ snapshot, binding: { ...binding, rootTree: '0'.repeat(40) } }),
}
assert.deepEqual(Object.values(negatives).map(value => [value.status, value.reason]), [
  ['unavailable', 'graph-artifact-mismatch'], ['unavailable', 'evidence-mismatch'],
  ['unavailable', 'build-identity-unavailable'], ['unavailable', 'project-binding-mismatch'],
])

const report = {
  evidence: result.evidence,
  verification: 'replayed',
  directAnalyzerRawBytesEqual: true,
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length,
    mappings: adapted.result.canonical.sourceMappings.length },
  adapterStatus: adapted.status,
  hostProvenance: adapted.hostProvenance,
  negatives,
}
mkdirSync(outputRoot, { recursive: true })
for (const [name, bytes] of [
  ['graph-producer-evidence-result.json', JSON.stringify(report, null, 2) + '\n'],
  ['graph-producer-evidence-raw-graph.json', result.rawGraphBytes],
]) {
  writeFileSync(join(outputRoot, name), bytes)
  console.log(createHash('sha256').update(bytes).digest('hex'), name)
}
console.log(JSON.stringify(report, null, 2))
