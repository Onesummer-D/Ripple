#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { canonicalGraph, canonicalObservationBinding, validateGraphReference, OBSERVATION_REASON_NAMES } from './canonical-observation-digest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const vectorDir = resolve(here, 'vectors')
const readJson = async name => JSON.parse(await readFile(resolve(vectorDir, name), 'utf8'))
const g0 = await readJson('g0.json')
const g1 = await readJson('g1-shuffled.json')
const g2 = await readJson('g2-byte-offset-changed.json')
const g3 = await readJson('g3-duplicate-relation.json')
const g4 = await readJson('g4-nonascii.json')
const g5 = await readJson('g5-candidate-side.json')
const graph0 = canonicalGraph(g0)
const graph1 = canonicalGraph(g1)
const graph2 = canonicalGraph(g2)
const graph4 = canonicalGraph(g4)
canonicalGraph(g5)
const b0 = await readJson('b0-observation.json')
b0.graph.graphDigest = graph0.digest
const binding0 = canonicalObservationBinding(b0)
const b1 = await readJson('b1-partial-no-relation.json')
const binding1 = canonicalObservationBinding(b1)
const rootRoute = canonicalObservationBinding({ ...b0, route: '/', page: { pathname: '/', search: '', hash: '' } })
const digestFieldMutation = canonicalObservationBinding({ ...b0, observationBindingDigest: '0'.repeat(64) })
const artifactMutation = canonicalObservationBinding({ ...b0, artifact: { ...b0.artifact, sha256: '2'.repeat(64) } })
const sideGraph = JSON.parse(JSON.stringify(g0))
const referencePass = validateGraphReference(b0, sideGraph)
const graphReferenceNegative = (binding, graph, expectedReasonCode, extra = {}) => {
  try { validateGraphReference(binding, graph); return { ...extra, pass: false, expectedReasonCode, reasonCode: 'unexpected-pass', message: 'reference was accepted' } }
  catch (error) { return { ...extra, pass: error.code === expectedReasonCode, expectedReasonCode, reasonCode: error.code, message: error.message } }
}
const referenceMismatchCase = graphReferenceNegative({ ...b0, sourceRef: 'node:other' }, sideGraph, 'source-ref-mismatch')
const sourceUseMismatchCase = graphReferenceNegative({ ...b0, sourceUseRef: { ...b0.sourceUseRef, sourceUse: { ...b0.sourceUseRef.sourceUse, byteOffset: 99 } } }, sideGraph, 'source-use-ref-mismatch')
const graphNodeMissingCase = graphReferenceNegative({ ...b0, sourceUseRef: { ...b0.sourceUseRef, graphNodeId: 'node:missing' } }, sideGraph, 'source-ref-not-in-graph')
const duplicateRelationCase = graphReferenceNegative(b0, { ...sideGraph, edges: [...sideGraph.edges, sideGraph.edges[0]] }, 'duplicate-relation-id')
const referenceMismatch = referenceMismatchCase.pass
const sourceUseMismatch = sourceUseMismatchCase.pass
const graphNodeMissing = graphNodeMissingCase.pass
const duplicateRelation = duplicateRelationCase.pass
const opaqueSourceRef = await readJson('negative-opaque-source-ref.json')
const declarationNode = await readJson('negative-declaration-node.json')
const crossSideSourceRef = await readJson('negative-cross-side-source-ref.json')
const opaqueSourceRefRejected = graphReferenceNegative(opaqueSourceRef, sideGraph, 'source-ref-not-in-graph')
const missingRelationSourceIdentityPending = {
  status: 'not-executed',
  expectedReasonCode: 'graph-schema-invalid',
  expectedObservationStatus: 'unavailable',
  trusted: false,
  fixture: 'negative-missing-relation-source-identity.json',
  message: 'A/E must freeze Relation.sourceIdentity presence before this case can be executed; current evidence validator treats the field as optional',
}
const declarationNodeRejected = graphReferenceNegative(declarationNode, sideGraph, 'declaration-node-not-source-use')
const crossSideSourceRefRejected = graphReferenceNegative(crossSideSourceRef, g5, 'source-ref-not-in-graph')
const partialReference = validateGraphReference(b1, sideGraph)
const missingSourceRefPartial = validateGraphReference({ ...b0, status: 'partial', sourceRef: undefined }, sideGraph)
const missingSourceUseRefPartial = validateGraphReference({ ...b0, status: 'partial', sourceUseRef: undefined }, sideGraph)
const artifactPathCases = [
  '../escape.json', '/absolute.json', '//server/share.json', 'runs//duplicate.json', 'runs/./dot.json', 'runs/../escape.json', 'C:/drive.json', 'runs\\backslash.json', `runs/${String.fromCharCode(0)}nul.json`,
].map(path => {
  try { canonicalObservationBinding({ ...b0, artifact: { ...b0.artifact, path } }); return { path, pass: false, reasonCode: 'unexpected-pass' } } catch (error) { return { path, pass: error.code === 'artifact-path-invalid', reasonCode: error.code } }
})
const captureFormatCases = [
  ['route', { ...b0, route: 'home' }],
  ['search', { ...b0, page: { ...b0.page, search: '?' } }],
  ['hash', { ...b0, page: { ...b0.page, hash: '#' } }],
  ['width', { ...b0, viewport: { ...b0.viewport, width: 0 } }],
].map(([field, value]) => { try { canonicalObservationBinding(value); return { field, pass: false, reasonCode: 'unexpected-pass' } } catch (error) { return { field, pass: error.code === 'observation-tuple-mismatch', reasonCode: error.code } } })
const negativeFiles = [
  ['negative-unknown-location.json', 'graph-schema-invalid', 'graph'],
  ['negative-page-overrides.json', 'graph-schema-invalid', 'graph'],
  ['negative-route.json', 'observation-tuple-mismatch', 'binding'],
  ['negative-artifact-path.json', 'artifact-path-invalid', 'binding'],
  ['legacy-v5.json', 'graph-schema-invalid', 'legacy'],
  ['negative-opaque-source-ref.json', 'source-ref-not-in-graph', 'reference'],
  ['negative-declaration-node.json', 'declaration-node-not-source-use', 'reference'],
  ['negative-cross-side-source-ref.json', 'source-ref-not-in-graph', 'cross-side-reference'],
  ['negative-missing-evidence-refs.json', 'graph-schema-invalid', 'graph'],
  ['negative-kind.json', 'graph-schema-invalid', 'graph'],
  ['negative-unsafe-integer.json', 'graph-schema-invalid', 'graph'],
  ['negative-empty-page-key.json', 'graph-schema-invalid', 'graph'],
]
const observationCode = code => code.startsWith('observation/') ? code : `observation/${code}`

const results = {
  protocol: 'acp6-sourcegraph-observation-v2-final',
  status: 'pass',
  vectors: {
    G0: { digest: graph0.digest, canonicalJson: graph0.canonicalJson, canonicalBytesSha256: createHash('sha256').update(graph0.canonicalJson, 'utf8').digest('hex'), canonicalBytesBase64: Buffer.from(graph0.canonicalJson, 'utf8').toString('base64') },
    G1: { digest: graph1.digest, equalTo: 'G0', stable: graph1.digest === graph0.digest },
    G2: { digest: graph2.digest, differsFrom: 'G0', changed: graph2.digest !== graph0.digest },
    G4: { digest: graph4.digest, nonAscii: true, canonicalBytesSha256: createHash('sha256').update(graph4.canonicalJson, 'utf8').digest('hex'), canonicalBytesBase64: Buffer.from(graph4.canonicalJson, 'utf8').toString('base64') },
    B0: { graphDigest: graph0.digest, digest: binding0.digest, canonicalJson: binding0.canonicalJson, canonicalBytesSha256: createHash('sha256').update(binding0.canonicalJson, 'utf8').digest('hex'), canonicalBytesBase64: Buffer.from(binding0.canonicalJson, 'utf8').toString('base64') },
    B1: { digest: binding1.digest, status: 'partial', relationId: 'omitted' },
    rootRouteAccepted: typeof rootRoute.digest === 'string',
    selfReferenceIgnored: digestFieldMutation.digest === binding0.digest,
    artifactMutationChanges: artifactMutation.digest !== binding0.digest,
    graphReferencePass: referencePass.trusted === true,
    referenceCases: {
      sourceRefMismatch: referenceMismatchCase,
      sourceUseMismatch: sourceUseMismatchCase,
      graphNodeMissing: graphNodeMissingCase,
      duplicateRelation: duplicateRelationCase,
    },
    sourceRefMismatchRejected: referenceMismatch,
    sourceUseMismatchRejected: sourceUseMismatch,
    graphNodeMissingRejected: graphNodeMissing,
    duplicateRelationRejected: duplicateRelation,
    opaqueSourceRefRejected,
    declarationNodeRejected,
    crossSideSourceRefRejected,
    partialWithoutRelationRemainsPartial: partialReference.status === 'partial' && partialReference.trusted === false,
    missingSourceRefRemainsPartial: missingSourceRefPartial.reasonCode === 'observation/missing-source-ref' && missingSourceRefPartial.status === 'partial',
    missingSourceUseRefRemainsPartial: missingSourceUseRefPartial.reasonCode === 'observation/missing-source-use-ref' && missingSourceUseRefPartial.status === 'partial',
    artifactPathCases,
    artifactPathCasesPass: artifactPathCases.every(item => item.pass),
    captureFormatCases,
    captureFormatCasesPass: captureFormatCases.every(item => item.pass),
  },
  negative: {},
  pending: {
    missingRelationSourceIdentity: missingRelationSourceIdentityPending,
  },
}
try {
  canonicalGraph(g3)
  results.status = 'fail'
  results.negative.G3 = { pass: false, expected: 'graph-schema-invalid', message: 'duplicate Relation.id was accepted' }
} catch (error) {
    results.negative.G3 = { pass: error.code === 'graph-schema-invalid', reasonCode: error.code, observationReasonCode: observationCode(error.code), message: error.message }
  if (!results.negative.G3.pass) results.status = 'fail'
}
try {
  canonicalObservationBinding({ ...b1, status: 'complete', primaryReasonCode: 'complete' })
  results.status = 'fail'
  results.negative.B2 = { pass: false, expected: 'relation-not-in-graph', message: 'complete record without relationId was accepted' }
} catch (error) {
    results.negative.B2 = { pass: error.code === 'relation-not-in-graph', reasonCode: error.code, observationReasonCode: observationCode(error.code), message: error.message }
  if (!results.negative.B2.pass) results.status = 'fail'
}
if (!results.vectors.G1.stable || !results.vectors.G2.changed || !results.vectors.selfReferenceIgnored || !results.vectors.artifactMutationChanges || !results.vectors.graphReferencePass || !results.vectors.sourceRefMismatchRejected || !results.vectors.sourceUseMismatchRejected || !results.vectors.graphNodeMissingRejected || !results.vectors.duplicateRelationRejected || !results.vectors.partialWithoutRelationRemainsPartial || !results.vectors.missingSourceRefRemainsPartial || !results.vectors.missingSourceUseRefRemainsPartial || !results.vectors.rootRouteAccepted || !results.vectors.artifactPathCasesPass || !results.vectors.captureFormatCasesPass) results.status = 'fail'
if (!results.vectors.opaqueSourceRefRejected.pass || !results.vectors.declarationNodeRejected.pass || !results.vectors.crossSideSourceRefRejected.pass) results.status = 'fail'
for (const [file, expectedCode, kind] of negativeFiles) {
  try {
    const input = await readJson(file)
    if (kind === 'graph' || kind === 'legacy') canonicalGraph(input)
    else if (kind === 'reference') validateGraphReference(input, sideGraph)
    else if (kind === 'cross-side-reference') validateGraphReference(input, g5)
    else canonicalObservationBinding(input)
    results.status = 'fail'; results.negative[file] = { pass: false, expectedReasonCode: expectedCode, reasonCode: 'unexpected-pass' }
  } catch (error) {
    results.negative[file] = { pass: error.code === expectedCode, expectedReasonCode: expectedCode, reasonCode: error.code, observationReasonCode: observationCode(error.code), message: error.message }
    if (error.code !== expectedCode) results.status = 'fail'
  }
}
const observedReasonNames = new Set()
const collectReasonCodes = value => {
  if (Array.isArray(value)) return value.forEach(collectReasonCodes)
  if (!value || typeof value !== 'object') return
  if (typeof value.reasonCode === 'string') observedReasonNames.add(value.reasonCode.startsWith('observation/') ? value.reasonCode.slice('observation/'.length) : value.reasonCode)
  for (const child of Object.values(value)) collectReasonCodes(child)
}
collectReasonCodes(results)
const reasonCodeClosedSet = [...observedReasonNames].every(name => OBSERVATION_REASON_NAMES.includes(name))
results.reasonCodeClosedSet = { pass: reasonCodeClosedSet, observed: [...observedReasonNames].sort(), allowedCount: OBSERVATION_REASON_NAMES.length }
if (!reasonCodeClosedSet) results.status = 'fail'

// The placeholders are replaced only in this evidence copy; source fixtures remain reusable.
const fixture = { ...b0, graph: { ...b0.graph, graphDigest: graph0.digest }, observationBindingDigest: binding0.digest }
await writeFile(resolve(vectorDir, 'b0-observation-resolved.json'), `${JSON.stringify(fixture, null, 2)}\n`)
await writeFile(resolve(here, 'acp6-observation-v2-final-digest-report.json'), `${JSON.stringify(results, null, 2)}\n`)
console.log(JSON.stringify({ status: results.status, G0: graph0.digest, G1: graph1.digest, G2: graph2.digest, G4: graph4.digest, B0: binding0.digest, G3: results.negative.G3 }, null, 2))
if (results.status !== 'pass') process.exitCode = 1
