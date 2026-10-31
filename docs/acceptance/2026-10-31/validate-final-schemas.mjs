#!/usr/bin/env node
/** Evidence-only structural JSON Schema parity harness. */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalGraph, canonicalObservationBinding, validateGraphReference, OBSERVATION_REASON_NAMES } from './canonical-observation-digest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const vectors = resolve(here, 'vectors')
const read = async path => JSON.parse(await readFile(path, 'utf8'))
const graphSchema = await read(resolve(here, 'acp6-sourcegraph-v2-graph.schema.json'))
const observationSchema = await read(resolve(here, 'acp6-observation-v2-final.schema.json'))
const g0 = await read(resolve(vectors, 'g0.json'))
const g4 = await read(resolve(vectors, 'g4-nonascii.json'))
const b0 = await read(resolve(vectors, 'b0-observation.json'))
const sideGraph = structuredClone(g0)
const g5 = await read(resolve(vectors, 'g5-candidate-side.json'))
const missingRelationSourceIdentity = await read(resolve(vectors, 'negative-missing-relation-source-identity.json'))

const expectedNodeKinds = ['file', 'symbol', 'component', 'route', 'data', 'media', 'token', 'token-use', 'jsx-element', 'state']
const expectedEdgeKinds = ['imports', 'reads', 'renders', 'uses-token', 'token-reference', 'asset-consumer', 'css-cascade', 'same-copy', 'semantic-link']
const checks = {}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
checks.nodeKinds = equal(graphSchema.$defs.node.properties.kind.enum, expectedNodeKinds)
checks.edgeKinds = equal(graphSchema.$defs.edge.properties.kind.enum, expectedEdgeKinds)
checks.edgeEvidenceRefsRequired = graphSchema.$defs.edge.required.includes('evidenceRefs')
checks.pageOverridesNonEmptyKeys = graphSchema.$defs.pageOverrides.propertyNames?.minLength === 1
checks.graphIntegersBounded = [graphSchema.$defs.sourceUse.properties.charOffset, graphSchema.$defs.sourceUse.properties.byteOffset, graphSchema.$defs.node.properties.byteOffset, graphSchema.$defs.location.properties.start, graphSchema.$defs.location.properties.end, graphSchema.$defs.location.properties.offset, graphSchema.$defs.location.properties.byteOffset].every(item => item.maximum === 9007199254740991)
checks.observationIntegersBounded = [observationSchema.$defs.sourceUse.properties.charOffset, observationSchema.$defs.sourceUse.properties.byteOffset, observationSchema.$defs.viewport.properties.width, observationSchema.$defs.viewport.properties.height, observationSchema.$defs.artifact.properties.sizeBytes].every(item => item.maximum === 9007199254740991)
checks.reasonPatternClosed = OBSERVATION_REASON_NAMES.every(name => observationSchema.$defs.reasonCode.pattern.includes(`|${name}`) || observationSchema.$defs.reasonCode.pattern.includes(`(?:${name}`))

const cases = []
const accept = (name, input, validator) => {
  try { validator(input); cases.push({ name, expected: 'accept', actual: 'accept', pass: true, status: 'passed', prepared: true, executed: true, passed: true, failed: false, blocked: false }) }
  catch (error) { cases.push({ name, expected: 'accept', actual: error.code ?? error.message, pass: false, status: 'failed', prepared: true, executed: true, passed: false, failed: true, blocked: false }) }
}
const reject = (name, input, validator, expected) => {
  try { validator(input); cases.push({ name, expected, actual: 'unexpected-pass', pass: false, status: 'failed', prepared: true, executed: true, passed: false, failed: true, blocked: false }) }
  catch (error) { const passed = (error.code ?? error.message) === expected; cases.push({ name, expected, actual: error.code ?? error.message, pass: passed, status: passed ? 'passed' : 'failed', prepared: true, executed: true, passed, failed: !passed, blocked: false }) }
}
accept('g0.json', g0, canonicalGraph)
accept('g4-nonascii.json', g4, canonicalGraph)
accept('b0-observation.json', b0, canonicalObservationBinding)
reject('negative-unknown-location.json', await read(resolve(vectors, 'negative-unknown-location.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-page-overrides.json', await read(resolve(vectors, 'negative-page-overrides.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-missing-evidence-refs.json', await read(resolve(vectors, 'negative-missing-evidence-refs.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-kind.json', await read(resolve(vectors, 'negative-kind.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-unsafe-integer.json', await read(resolve(vectors, 'negative-unsafe-integer.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-empty-page-key.json', await read(resolve(vectors, 'negative-empty-page-key.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-route.json', await read(resolve(vectors, 'negative-route.json')), canonicalObservationBinding, 'observation-tuple-mismatch')
reject('negative-artifact-path.json', await read(resolve(vectors, 'negative-artifact-path.json')), canonicalObservationBinding, 'artifact-path-invalid')
reject('legacy-v5.json', await read(resolve(vectors, 'legacy-v5.json')), canonicalGraph, 'graph-schema-invalid')
reject('negative-opaque-source-ref.json', await read(resolve(vectors, 'negative-opaque-source-ref.json')), input => validateGraphReference(input, sideGraph), 'source-ref-not-in-graph')
reject('negative-declaration-node.json', await read(resolve(vectors, 'negative-declaration-node.json')), input => validateGraphReference(input, sideGraph), 'declaration-node-not-source-use')
reject('negative-cross-side-source-ref.json', await read(resolve(vectors, 'negative-cross-side-source-ref.json')), input => validateGraphReference(input, g5), 'source-ref-not-in-graph')

const pending = {
  'missing-relation-source-identity': {
    name: 'negative-missing-relation-source-identity.json',
    required: true,
    safetyBlocker: true,
    status: 'blocked',
    prepared: true,
    executed: false,
    passed: false,
    failed: false,
    blocked: true,
    expected: 'graph-schema-invalid',
    expectedObservationStatus: 'unavailable',
    actual: 'blocked: Relation.sourceIdentity presence is not frozen/enforced',
    fixtureLoaded: Boolean(missingRelationSourceIdentity),
  },
}
const corePassed = Object.values(checks).every(Boolean) && cases.every(item => item.pass)
const requiredSafetyCases = Object.values(pending).filter(item => item.required === true)
const requiredSafetyExecuted = requiredSafetyCases.length > 0 && requiredSafetyCases.every(item => item.executed === true && item.status === 'passed')
const requiredSafetyFailed = requiredSafetyCases.some(item => item.status === 'failed')

const result = {
  protocol: 'acp6-sourcegraph-observation-v2-schema-parity/v1',
  status: !corePassed ? 'failed' : (requiredSafetyFailed ? 'failed' : (requiredSafetyExecuted ? 'passed' : 'blocked')),
  executionSummary: { prepared: true, executed: true, passed: corePassed && requiredSafetyExecuted, failed: !corePassed || requiredSafetyFailed, blocked: corePassed && !requiredSafetyExecuted, requiredNegativeCaseCount: requiredSafetyCases.length, requiredNegativeExecutedCount: requiredSafetyCases.filter(item => item.executed === true).length },
  checks,
  cases,
  pending,
}
await writeFile(resolve(here, 'acp6-observation-v2-final-schema-report.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
if (result.status !== 'passed') process.exitCode = 1
