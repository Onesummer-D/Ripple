#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, 'golden-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

const allowedEnvironmentKeys = new Set([
  'projectId', 'runId', 'checkId', 'side', 'runtimeFingerprint',
  'browserName', 'browserVersion', 'playwrightVersion', 'collectorVersion',
  'timestamp', 'hostname', 'hostOS', 'os', 'pid', 'port', 'containerId',
  'tempDir', 'artifactPath', 'artifactSha256', 'logs', 'screenshotDimensions',
  'viewport', 'state', 'url',
])
const allowedGraphKeys = new Set(['schemaVersion', 'sourceDigest', 'nodes', 'edges', 'unresolved'])
const nodeKeys = new Set([
  'id', 'kind', 'label', 'location', 'page', 'routePath', 'pages', 'selector',
  'selectorScope', 'byteOffset', 'mediaContext', 'className', 'dynamicClassName',
  'value', 'pageOverrides', 'tokenOrigin',
])
const relationKeys = new Set([
  'id', 'from', 'to', 'kind', 'certainty', 'evidenceRefs', 'sourceUse',
  'selectorScope', 'mediaContext',
])
const locationKeys = new Set(['path', 'start', 'end', 'offset', 'byteOffset'])
const sourceUseKeys = new Set(['path', 'charOffset', 'byteOffset', 'offsetUnit'])
const nodeKinds = new Set(['file', 'symbol', 'component', 'route', 'data', 'media', 'token', 'token-use', 'jsx-element', 'state'])
const relationKinds = new Set(['imports', 'reads', 'renders', 'uses-token', 'token-reference', 'asset-consumer', 'css-cascade', 'same-copy', 'semantic-link'])
const certainties = new Set(['source-proven', 'runtime-observed', 'semantic-candidate', 'unknown'])
const tokenOrigins = new Set(['css-custom-property', 'tailwind-palette'])

function fail(message, code = 'graph-schema-invalid') {
  const error = new Error(message)
  error.code = code
  throw error
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function keysOnly(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is an unknown graph field`)
}

function string(value, label, { nonEmpty = true } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) fail(`${label} must be a non-empty string`)
  return value
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail(`${label} must be a non-negative safe integer`)
  return value
}

function stringSet(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const seen = new Set()
  for (const item of value) {
    string(item, `${label}[]`)
    if (seen.has(item)) fail(`${label} contains a duplicate member`)
    seen.add(item)
  }
  return value
}

function location(value, label) {
  object(value, label)
  keysOnly(value, locationKeys, label)
  string(value.path, `${label}.path`)
  for (const key of ['start', 'end', 'offset', 'byteOffset']) if (key in value) integer(value[key], `${label}.${key}`)
}

function sourceUse(value, label) {
  object(value, label)
  keysOnly(value, sourceUseKeys, label)
  string(value.path, `${label}.path`)
  integer(value.charOffset, `${label}.charOffset`)
  integer(value.byteOffset, `${label}.byteOffset`)
  if (value.offsetUnit !== 'code-unit') fail(`${label}.offsetUnit must be code-unit`)
}

function node(value, index) {
  const label = `nodes[${index}]`
  object(value, label)
  keysOnly(value, nodeKeys, label)
  string(value.id, `${label}.id`)
  if (!nodeKinds.has(value.kind)) fail(`${label}.kind is not canonical`)
  string(value.label, `${label}.label`)
  if ('location' in value) location(value.location, `${label}.location`)
  for (const key of ['page', 'routePath', 'selector', 'selectorScope', 'className', 'value']) if (key in value) string(value[key], `${label}.${key}`)
  if ('pages' in value) stringSet(value.pages, `${label}.pages`)
  if ('mediaContext' in value) stringSet(value.mediaContext, `${label}.mediaContext`)
  if ('byteOffset' in value) integer(value.byteOffset, `${label}.byteOffset`)
  if ('dynamicClassName' in value && typeof value.dynamicClassName !== 'boolean') fail(`${label}.dynamicClassName must be boolean`)
  if ('tokenOrigin' in value && !tokenOrigins.has(value.tokenOrigin)) fail(`${label}.tokenOrigin is not canonical`)
  if ('pageOverrides' in value) {
    object(value.pageOverrides, `${label}.pageOverrides`)
    for (const [key, item] of Object.entries(value.pageOverrides)) {
      string(key, `${label}.pageOverrides key`)
      string(item, `${label}.pageOverrides.${key}`)
    }
  }
}

function relation(value, index) {
  const label = `edges[${index}]`
  object(value, label)
  keysOnly(value, relationKeys, label)
  string(value.id, `${label}.id`)
  string(value.from, `${label}.from`)
  string(value.to, `${label}.to`)
  if (!relationKinds.has(value.kind)) fail(`${label}.kind is not canonical`)
  if (!certainties.has(value.certainty)) fail(`${label}.certainty is not canonical`)
  stringSet(value.evidenceRefs, `${label}.evidenceRefs`)
  if ('sourceUse' in value) sourceUse(value.sourceUse, `${label}.sourceUse`)
  if ('selectorScope' in value) string(value.selectorScope, `${label}.selectorScope`)
  if ('mediaContext' in value) stringSet(value.mediaContext, `${label}.mediaContext`)
}

function utf8Sort(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort(utf8Sort).map(key => [key, sortObject(value[key])]))
}

function canonicalGraph(input) {
  const graph = object(input, 'graph')
  if ('environment' in graph) {
    const environment = object(graph.environment, 'environment')
    for (const key of Object.keys(environment)) if (!allowedEnvironmentKeys.has(key)) fail(`environment.${key} is not an allowed excluded field`)
  }
  keysOnly(graph, new Set([...allowedGraphKeys, 'environment']), 'graph')
  if (graph.schemaVersion !== 'acp6-sourcegraph/v1') fail('schemaVersion is not acp6-sourcegraph/v1')
  if (!/^[0-9a-f]{64}$/.test(string(graph.sourceDigest, 'sourceDigest'))) fail('sourceDigest must be lowercase SHA-256')
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.unresolved)) fail('nodes, edges and unresolved must be arrays')
  graph.nodes.forEach(node)
  graph.edges.forEach(relation)
  stringSet(graph.unresolved, 'unresolved')

  const nodeIds = new Set()
  for (const item of graph.nodes) {
    if (nodeIds.has(item.id)) fail(`duplicate node.id: ${item.id}`)
    nodeIds.add(item.id)
  }
  const relationIds = new Set()
  for (const item of graph.edges) {
    if (relationIds.has(item.id)) fail(`duplicate Relation.id: ${item.id}`)
    relationIds.add(item.id)
    if (!nodeIds.has(item.from) || !nodeIds.has(item.to)) fail(`unknown relation endpoint: ${item.id}`)
  }

  const nodes = graph.nodes.map(item => {
    const clone = structuredClone(item)
    for (const key of ['pages', 'mediaContext']) if (key in clone) clone[key].sort(utf8Sort)
    if (clone.pageOverrides) clone.pageOverrides = Object.fromEntries(Object.entries(clone.pageOverrides).sort(([a], [b]) => utf8Sort(a, b)))
    return clone
  }).sort((a, b) => utf8Sort(a.id, b.id))
  const edges = graph.edges.map(item => {
    const clone = structuredClone(item)
    for (const key of ['evidenceRefs', 'mediaContext']) if (key in clone) clone[key].sort(utf8Sort)
    return clone
  }).sort((a, b) => utf8Sort(a.id, b.id))
  const canonical = sortObject({
    schemaVersion: graph.schemaVersion,
    sourceDigest: graph.sourceDigest,
    nodes,
    edges,
    unresolved: [...graph.unresolved].sort(utf8Sort),
  })
  const canonicalJson = JSON.stringify(canonical)
  const digest = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  return { canonicalJson, digest, counts: { nodes: nodes.length, edges: edges.length, unresolved: graph.unresolved.length } }
}

const args = process.argv.slice(2)
const requested = args.find(arg => arg.startsWith('--case='))?.slice('--case='.length)
const customInput = args.find(arg => arg.startsWith('--input='))?.slice('--input='.length)
const customExpected = args.find(arg => arg.startsWith('--expected='))?.slice('--expected='.length)
const executableCases = Object.entries(manifest.cases).filter(([, value]) => value.mode === 'executable')
const negativeCases = Object.entries(manifest.negativeCases ?? {}).map(([name, value]) => [name, { ...value, mode: 'negative', expectedDigest: null, expectReject: true }])
const selected = customInput
  ? [['CUSTOM', { fixture: customInput, mode: 'executable', expectedDigest: customExpected ?? null }]]
  : args.includes('--negative') ? (requested ? negativeCases.filter(([name]) => name === requested) : negativeCases)
  : requested ? executableCases.filter(([name]) => name === requested) : executableCases
if (requested && selected.length === 0) {
  console.error(JSON.stringify({ status: 'rejected', observationStatus: 'unavailable', reasonCode: 'graph-schema-invalid', graphDigest: null, trusted: false, message: `unknown executable case: ${requested}` }))
  process.exit(1)
}

const results = []
for (const [name, spec] of selected) {
  try {
    const input = JSON.parse(await readFile(resolve(here, spec.fixture), 'utf8'))
    const result = canonicalGraph(input)
    if (spec.expectReject) {
      results.push({ case: name, status: 'unexpected-pass', reasonCode: 'graph-schema-invalid', observationStatus: 'complete', graphDigest: result.digest, trusted: true, message: 'negative fixture unexpectedly canonicalized' })
      process.exitCode = 1
      continue
    }
    const passed = spec.expectedDigest == null || result.digest === spec.expectedDigest
    results.push({ case: name, status: passed ? 'pass' : 'rejected', digest: result.digest, canonicalJsonSha256: result.digest, ...(spec.expectedDigest == null ? {} : { expectedDigest: spec.expectedDigest }), counts: result.counts })
    if (!passed) process.exitCode = 1
  } catch (error) {
    if (spec.expectReject) {
      const actualReasonCode = error.code ?? 'graph-schema-invalid'
      const passed = actualReasonCode === spec.expectedReasonCode
      results.push({ case: name, status: passed ? 'pass' : 'rejected', observationStatus: 'unavailable', reasonCode: actualReasonCode, expectedReasonCode: spec.expectedReasonCode, graphDigest: null, trusted: false, message: error.message })
      if (!passed) process.exitCode = 1
    } else {
      results.push({ case: name, status: 'rejected', observationStatus: 'unavailable', reasonCode: error.code ?? 'graph-schema-invalid', graphDigest: null, trusted: false, message: error.message })
      process.exitCode = 1
    }
  }
}

console.log(JSON.stringify({ protocol: manifest.protocol, contractRevision: manifest.contractRevision, validatorVersion: manifest.validatorVersion, results }, null, 2))
