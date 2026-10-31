#!/usr/bin/env node
/**
 * Evidence-only canonical serializer for AC-P6 v2.
 * This file is deliberately outside src/ and is never imported by production.
 */
import { createHash } from 'node:crypto'

export const GRAPH_DOMAIN = 'ripple/sourcegraph-identity/v2/graphDigest\0'
export const BINDING_DOMAIN = 'ripple/sourcegraph-observation-binding/v1/observationBindingDigest\0'
export const OFFSET_UNIT = 'code-unit'

const graphKeys = new Set(['graphIdentityVersion', 'graphSchemaVersion', 'relationIdentityVersion', 'sourceDigest', 'nodes', 'edges', 'unresolved'])
const nodeKeys = new Set(['id', 'kind', 'label', 'location', 'page', 'routePath', 'pages', 'selector', 'selectorScope', 'byteOffset', 'mediaContext', 'className', 'dynamicClassName', 'value', 'pageOverrides', 'tokenOrigin'])
const edgeKeys = new Set(['id', 'from', 'to', 'kind', 'certainty', 'evidenceRefs', 'sourceUse', 'selectorScope', 'mediaContext', 'producerIdentity', 'sourceIdentity'])
const sourceUseKeys = new Set(['path', 'charOffset', 'byteOffset', 'offsetUnit'])
const locationKeys = new Set(['path', 'start', 'end', 'offset', 'byteOffset'])
const nodeKinds = new Set(['file', 'symbol', 'component', 'route', 'data', 'media', 'token', 'token-use', 'jsx-element', 'state'])
const edgeKinds = new Set(['imports', 'reads', 'renders', 'uses-token', 'token-reference', 'asset-consumer', 'css-cascade', 'same-copy', 'semantic-link'])
const certainties = new Set(['source-proven', 'runtime-observed', 'semantic-candidate', 'unknown'])
const bindingKeys = new Set(['observationBindingVersion', 'graph', 'sourceRef', 'sourceUseRef', 'runId', 'checkId', 'side', 'route', 'page', 'viewport', 'state', 'artifact'])
export const SOURCE_USE_NODE_KINDS = Object.freeze(['token-use'])
export const OBSERVATION_REASON_NAMES = Object.freeze([
  'complete', 'missing-side', 'missing-artifact', 'artifact-hash-mismatch',
  'artifact-path-invalid', 'artifact-changed-after-validation', 'graph-schema-invalid',
  'cross-run', 'cross-check', 'side-mismatch', 'logical-project-mismatch',
  'untrusted-capture', 'required-verification-not-pass', 'source-digest-mismatch',
  'graph-digest-mismatch', 'runtime-version-stale', 'route-namespace-stale',
  'geometry-only', 'runtime-location-conflict', 'declaration-node-not-source-use',
  'relation-not-in-graph', 'source-use-location-mismatch', 'duplicate-record',
  'duplicate-artifact-conflict', 'page-context-mismatch', 'viewport-mismatch',
  'state-mismatch', 'identity-not-stable', 'pseudo-element-without-host-proof',
  'non-strict-consumer-edge', 'missing-consumer-edge', 'runtime-instance-without-edge',
  'dynamic-without-runtime-map', 'page-impact-not-proven', 'missing-cross-side-map',
  'missing-source-ref', 'missing-source-use-ref', 'missing-source-use',
  'source-ref-mismatch', 'graph-node-not-unique', 'source-ref-not-in-graph',
  'missing-relation-id', 'duplicate-relation-id', 'source-use-ref-mismatch',
  'page-context-unverified', 'artifact-missing', 'artifact-digest-mismatch',
  'observation-tuple-mismatch',
])

export function fail(message, code = 'graph-schema-invalid') {
  const error = new Error(message)
  error.code = code
  throw error
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function keysOnly(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is not allowed`)
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail(`${label} must be a non-negative safe integer`)
  return value
}

function positiveInteger(value, label) {
  safeInteger(value, label)
  if (value < 1) fail(`${label} must be at least 1`, 'observation-tuple-mismatch')
  return value
}

function sha256String(value, label) {
  if (!/^[0-9a-f]{64}$/.test(nonEmptyString(value, label))) fail(`${label} must be lowercase SHA-256`)
}

function utf8Compare(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function rejectNullOrUnsafe(value, path = '$') {
  if (value === undefined) fail(`${path} undefined is not allowed`)
  if (value === null) fail(`${path} explicit null is not allowed`)
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) fail(`${path} number is not canonical`)
  if (typeof value === 'object') {
    if (Array.isArray(value)) value.forEach((item, i) => rejectNullOrUnsafe(item, `${path}[${i}]`))
    else for (const [key, item] of Object.entries(value)) {
      if (item === undefined) fail(`${path}.${key} undefined is not allowed in digest input`)
      rejectNullOrUnsafe(item, `${path}.${key}`)
    }
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort(utf8Compare).map(key => [key, sortKeys(value[key])]))
}

function uniqueStringArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const seen = new Set()
  for (const item of value) {
    nonEmptyString(item, `${label}[]`)
    if (seen.has(item)) fail(`${label} contains duplicate member`)
    seen.add(item)
  }
  return value
}

function sourceUse(value, label) {
  object(value, label)
  keysOnly(value, sourceUseKeys, label)
  nonEmptyString(value.path, `${label}.path`)
  safeInteger(value.charOffset, `${label}.charOffset`)
  safeInteger(value.byteOffset, `${label}.byteOffset`)
  if (value.offsetUnit !== OFFSET_UNIT) fail(`${label}.offsetUnit must be '${OFFSET_UNIT}'`)
}

function location(value, label) {
  object(value, label)
  keysOnly(value, locationKeys, label)
  nonEmptyString(value.path, `${label}.path`)
  for (const key of ['start', 'end', 'offset', 'byteOffset']) if (key in value) safeInteger(value[key], `${label}.${key}`)
}

function pageOverrides(value, label) {
  object(value, label)
  for (const [key, item] of Object.entries(value)) {
    nonEmptyString(key, `${label} key`)
    nonEmptyString(item, `${label}.${key}`)
  }
}

function validateGraph(graph) {
  object(graph, 'graph')
  keysOnly(graph, graphKeys, 'graph')
  if (graph.graphIdentityVersion !== 'sourcegraph-identity/v2') fail('graphIdentityVersion mismatch')
  nonEmptyString(graph.graphSchemaVersion, 'graphSchemaVersion')
  nonEmptyString(graph.relationIdentityVersion, 'relationIdentityVersion')
  sha256String(graph.sourceDigest, 'sourceDigest')
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.unresolved)) fail('nodes, edges and unresolved must be arrays')
  uniqueStringArray(graph.unresolved, 'unresolved')
  const nodeIds = new Set()
  for (const [index, node] of graph.nodes.entries()) {
    const label = `nodes[${index}]`
    object(node, label); keysOnly(node, nodeKeys, label)
    nonEmptyString(node.id, `${label}.id`)
    nonEmptyString(node.kind, `${label}.kind`)
    if (!nodeKinds.has(node.kind)) fail(`${label}.kind is not canonical`)
    if (nodeIds.has(node.id)) fail(`duplicate node.id: ${node.id}`)
    nodeIds.add(node.id)
    if ('label' in node) nonEmptyString(node.label, `${label}.label`)
    for (const key of ['page', 'routePath', 'selector', 'selectorScope', 'className', 'value']) if (key in node) nonEmptyString(node[key], `${label}.${key}`)
    for (const key of ['pages', 'mediaContext']) if (key in node) uniqueStringArray(node[key], `${label}.${key}`)
    if ('byteOffset' in node) safeInteger(node.byteOffset, `${label}.byteOffset`)
    if ('dynamicClassName' in node && typeof node.dynamicClassName !== 'boolean') fail(`${label}.dynamicClassName must be boolean`)
    if ('pageOverrides' in node) pageOverrides(node.pageOverrides, `${label}.pageOverrides`)
    if ('location' in node) location(node.location, `${label}.location`)
  }
  const relationIds = new Set()
  for (const [index, edge] of graph.edges.entries()) {
    const label = `edges[${index}]`
    object(edge, label); keysOnly(edge, edgeKeys, label)
    nonEmptyString(edge.id, `${label}.id`)
    if (relationIds.has(edge.id)) fail(`duplicate Relation.id: ${edge.id}`)
    relationIds.add(edge.id)
    nonEmptyString(edge.from, `${label}.from`); nonEmptyString(edge.to, `${label}.to`)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail(`unknown relation endpoint: ${edge.id}`)
    if (!edgeKinds.has(edge.kind)) fail(`${label}.kind is not canonical`)
    if (!certainties.has(edge.certainty)) fail(`${label}.certainty is not canonical`)
    if (!('evidenceRefs' in edge)) fail(`${label}.evidenceRefs is required`)
    uniqueStringArray(edge.evidenceRefs, `${label}.evidenceRefs`)
    if ('sourceUse' in edge) sourceUse(edge.sourceUse, `${label}.sourceUse`)
    if ('selectorScope' in edge) nonEmptyString(edge.selectorScope, `${label}.selectorScope`)
    if ('mediaContext' in edge) uniqueStringArray(edge.mediaContext, `${label}.mediaContext`)
    if ('producerIdentity' in edge) nonEmptyString(edge.producerIdentity, `${label}.producerIdentity`)
    if ('sourceIdentity' in edge) nonEmptyString(edge.sourceIdentity, `${label}.sourceIdentity`)
  }
  return { nodeIds, relationIds }
}

function normalizeGraph(graph) {
  validateGraph(graph)
  const clone = structuredClone({
    graphIdentityVersion: graph.graphIdentityVersion,
    graphSchemaVersion: graph.graphSchemaVersion,
    relationIdentityVersion: graph.relationIdentityVersion,
    sourceDigest: graph.sourceDigest,
    nodes: graph.nodes,
    edges: graph.edges,
    unresolved: graph.unresolved,
  })
  for (const node of clone.nodes) for (const key of ['pages', 'mediaContext']) if (key in node) node[key].sort(utf8Compare)
  for (const edge of clone.edges) for (const key of ['evidenceRefs', 'mediaContext']) if (key in edge) edge[key].sort(utf8Compare)
  clone.nodes.sort((a, b) => utf8Compare(a.id, b.id)); clone.edges.sort((a, b) => utf8Compare(a.id, b.id)); clone.unresolved.sort(utf8Compare)
  rejectNullOrUnsafe(clone)
  return sortKeys(clone)
}

export function canonicalGraph(graph) {
  const canonical = normalizeGraph(graph)
  const canonicalJson = JSON.stringify(canonical)
  const digest = createHash('sha256').update(GRAPH_DOMAIN + canonicalJson, 'utf8').digest('hex')
  return { canonical, canonicalJson, digest }
}

function relativeArtifactPath(path) {
  nonEmptyString(path, 'artifact.path')
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:/.test(path) || path.includes('//') || path.split('/').some(segment => segment === '.' || segment === '..' || segment.length === 0)) fail('artifact.path must be a relative POSIX path inside trusted archive', 'artifact-path-invalid')
}

function pagePath(value, label) {
  nonEmptyString(value, label)
  if (!value.startsWith('/') || value.includes('?') || value.includes('#') || /[\u0000-\u0020\u007f]/.test(value)) fail(`${label} must be a non-empty pathname`, 'observation-tuple-mismatch')
}

function pageSearch(value, label) {
  if (typeof value !== 'string' || value === '#' || (!value.startsWith('?') && value !== '') || value.includes('#') || /[\u0000-\u0020\u007f]/.test(value) || (value.startsWith('?') && value.length === 1)) fail(`${label} must be empty or a valid ?query`, 'observation-tuple-mismatch')
}

function pageHash(value, label) {
  if (typeof value !== 'string' || (!value.startsWith('#') && value !== '') || /[\u0000-\u0020\u007f]/.test(value) || (value.startsWith('#') && value.length === 1)) fail(`${label} must be empty or a valid #hash`, 'observation-tuple-mismatch')
}

function route(value, label) {
  nonEmptyString(value, label)
  if (/[\\\u0000-\u0020\u007f]/.test(value)) fail(`${label} contains invalid route characters`, 'observation-tuple-mismatch')
  const match = value.match(/^([^?#]+)(\?[^#]+)?(#.+)?$/)
  if (!match) fail(`${label} must be pathname[?search][#hash]`, 'observation-tuple-mismatch')
  pagePath(match[1], `${label}.pathname`)
  pageSearch(match[2] ?? '', `${label}.search`)
  pageHash(match[3] ?? '', `${label}.hash`)
}

function validateSourceUseRef(ref, label) {
  object(ref, label); keysOnly(ref, new Set(['sourceRef', 'graphNodeId', 'relationId', 'sourceUse']), label)
  nonEmptyString(ref.sourceRef, `${label}.sourceRef`); nonEmptyString(ref.graphNodeId, `${label}.graphNodeId`)
  if ('relationId' in ref) nonEmptyString(ref.relationId, `${label}.relationId`)
  if (!('sourceUse' in ref)) fail(`${label}.sourceUse is missing`, 'missing-source-use')
  sourceUse(ref.sourceUse, `${label}.sourceUse`)
}

export function bindingDigestInput(envelope) {
  object(envelope, 'observation')
  keysOnly(envelope, new Set([...bindingKeys, 'status', 'proof', 'primaryReasonCode', 'secondaryReasonCodes', 'observationBindingDigest', 'diagnostic']), 'observation')
  if (envelope.observationBindingVersion !== 'sourcegraph-observation-binding/v1') fail('observationBindingVersion mismatch')
  validateGraphIdentity(envelope.graph)
  if ('sourceRef' in envelope) nonEmptyString(envelope.sourceRef, 'sourceRef')
  if ('sourceUseRef' in envelope) validateSourceUseRef(envelope.sourceUseRef, 'sourceUseRef')
  nonEmptyString(envelope.runId, 'runId'); nonEmptyString(envelope.checkId, 'checkId')
  if (envelope.side !== 'baseline' && envelope.side !== 'candidate') fail('side must be baseline or candidate')
  route(envelope.route, 'route')
  object(envelope.page, 'page'); keysOnly(envelope.page, new Set(['pathname', 'search', 'hash']), 'page'); pagePath(envelope.page.pathname, 'page.pathname'); pageSearch(envelope.page.search, 'page.search'); pageHash(envelope.page.hash, 'page.hash')
  object(envelope.viewport, 'viewport'); keysOnly(envelope.viewport, new Set(['width', 'height', 'deviceScaleFactor']), 'viewport'); positiveInteger(envelope.viewport.width, 'viewport.width'); positiveInteger(envelope.viewport.height, 'viewport.height')
  if ('deviceScaleFactor' in envelope.viewport && (typeof envelope.viewport.deviceScaleFactor !== 'number' || !Number.isFinite(envelope.viewport.deviceScaleFactor) || envelope.viewport.deviceScaleFactor <= 0)) fail('viewport.deviceScaleFactor invalid')
  object(envelope.state, 'state'); nonEmptyString(envelope.state.id, 'state.id'); if ('digest' in envelope.state) sha256String(envelope.state.digest, 'state.digest')
  object(envelope.artifact, 'artifact'); keysOnly(envelope.artifact, new Set(['kind', 'path', 'sha256', 'sizeBytes']), 'artifact')
  if (!new Set(['observation-json', 'runtime-snapshot', 'mapping']).has(envelope.artifact.kind)) fail('artifact.kind invalid')
  relativeArtifactPath(envelope.artifact.path); sha256String(envelope.artifact.sha256, 'artifact.sha256'); safeInteger(envelope.artifact.sizeBytes, 'artifact.sizeBytes')
  const input = structuredClone({ ...envelope })
  for (const key of ['status', 'proof', 'primaryReasonCode', 'secondaryReasonCodes', 'observationBindingDigest', 'diagnostic']) delete input[key]
  rejectNullOrUnsafe(input)
  return sortKeys(input)
}

function validateGraphIdentity(graph) {
  object(graph, 'graph')
  const keys = new Set(['graphIdentityVersion', 'graphSchemaVersion', 'relationIdentityVersion', 'projectId', 'sourceDigest', 'graphDigest'])
  keysOnly(graph, keys, 'graph')
  if (graph.graphIdentityVersion !== 'sourcegraph-identity/v2') fail('graph.graphIdentityVersion mismatch')
  nonEmptyString(graph.graphSchemaVersion, 'graph.graphSchemaVersion'); nonEmptyString(graph.relationIdentityVersion, 'graph.relationIdentityVersion'); nonEmptyString(graph.projectId, 'graph.projectId')
  sha256String(graph.sourceDigest, 'graph.sourceDigest'); sha256String(graph.graphDigest, 'graph.graphDigest')
}

export function canonicalObservationBinding(envelope) {
  if (envelope.status === 'complete' && envelope.sourceUseRef && !envelope.sourceUseRef.relationId) fail('complete source-use observation requires one relationId', 'relation-not-in-graph')
  if (envelope.status === 'complete' && envelope.primaryReasonCode && envelope.primaryReasonCode !== 'observation/complete') fail('complete observation requires primaryReasonCode=observation/complete', 'observation-tuple-mismatch')
  const canonical = bindingDigestInput(envelope)
  const canonicalJson = JSON.stringify(canonical)
  const digest = createHash('sha256').update(BINDING_DOMAIN + canonicalJson, 'utf8').digest('hex')
  return { canonical, canonicalJson, digest }
}

function sourceUseEqual(left, right) {
  return left?.path === right?.path && left?.charOffset === right?.charOffset && left?.byteOffset === right?.byteOffset && left?.offsetUnit === right?.offsetUnit
}

/** Validate a binding against the already selected side graph. This is an
 * evidence-tool helper; it does not read or mutate production state. */
export function validateGraphReference(envelope, sideGraph) {
  object(sideGraph, 'sideGraph')
  if (envelope.sourceUseRef && envelope.sourceRef === undefined) {
    if (envelope.status === 'complete') fail('complete observation requires sourceRef', 'missing-source-ref')
    return { status: 'partial', reasonCode: 'observation/missing-source-ref', trusted: false }
  }
  if (envelope.sourceUseRef && envelope.sourceRef !== envelope.sourceUseRef.sourceRef) fail('sourceRef and sourceUseRef.sourceRef differ', 'source-ref-mismatch')
  const graphNodes = Array.isArray(sideGraph.nodes) ? sideGraph.nodes : []
  const graphEdges = Array.isArray(sideGraph.edges) ? sideGraph.edges : []
  if (!envelope.sourceUseRef) return { status: envelope.status ?? 'partial', reasonCode: 'observation/missing-source-use-ref', trusted: false }
  if (!envelope.sourceUseRef.sourceUse) fail('sourceUseRef.sourceUse is missing', 'missing-source-use')
  const nodeMatches = graphNodes.filter(node => node?.id === envelope.sourceUseRef.graphNodeId)
  if (nodeMatches.length === 0) fail('graphNodeId is absent from selected side graph', 'source-ref-not-in-graph')
  if (nodeMatches.length !== 1) fail('graphNodeId is not unique in selected side graph', 'graph-node-not-unique')
  const sourceNode = nodeMatches[0]
  if (!SOURCE_USE_NODE_KINDS.includes(sourceNode?.kind)) fail('graphNodeId does not resolve to a source-use node', 'declaration-node-not-source-use')
  if (sourceNode.id !== envelope.sourceRef || sourceNode.id !== envelope.sourceUseRef.sourceRef) fail('sourceRef has no side-local node mapping', 'source-ref-not-in-graph')
  if (envelope.sourceUseRef.relationId === undefined) {
    if (envelope.status === 'complete') fail('complete source-use observation requires one relationId', 'relation-not-in-graph')
    return { status: 'partial', reasonCode: 'observation/missing-relation-id', trusted: false }
  }
  const relationMatches = graphEdges.filter(edge => edge?.id === envelope.sourceUseRef.relationId)
  if (relationMatches.length === 0) fail('relationId is absent from selected side graph', 'relation-not-in-graph')
  if (relationMatches.length !== 1) fail('relationId is not unique in selected side graph', 'duplicate-relation-id')
  const relation = relationMatches[0]
  if (relation.from !== envelope.sourceUseRef.graphNodeId || !sourceUseEqual(relation.sourceUse, envelope.sourceUseRef.sourceUse)) fail('relation sourceUse or endpoint differs from sourceUseRef', 'source-use-ref-mismatch')
  if ('sourceIdentity' in relation && relation.sourceIdentity !== envelope.sourceRef) fail('relation source identity differs from sourceRef', 'source-ref-mismatch')
  return { status: envelope.status ?? 'partial', reasonCode: 'observation/complete', trusted: true }
}
