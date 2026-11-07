import { describe, expect, it } from 'vitest'
import type { Relation, SourceGraph } from './model'
import {
  computeHostGraphDigestV1,
  computeHostSourceDigestV1,
  createHostTrustRegistryV1,
  createHostTrustRegistryV1TestDouble,
  type HostTrustRegistryState,
  type HostTrustSideBinding,
  type ObservationStatus,
} from './observation-host-registry-v1'
import {
  hostTrustResultIsComplete,
  validateHostObservationV1,
  type ObservationBindingV1,
} from './observation-host-trust-v1'

const page = { pathname: '/', search: '', hash: '' }
const pointBase = { runId: 'run-h0', checkId: 'check-home-wide', route: '/', viewport: { width: 1440, height: 900 }, state: 'rendered' }

function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

async function makeSide(side: 'baseline' | 'candidate', sourceText: string, status: ObservationStatus = 'complete') {
  const sourceSnapshot = { files: [{ path: 'src/App.tsx', bytes: bytes(sourceText) }] }
  const sourceDigest = await computeHostSourceDigestV1(sourceSnapshot)
  const graph: SourceGraph = {
    id: `graph-${side}`,
    revision: { projectId: 'project-h0', sourceDigest, runtimeFingerprint: `fingerprint-${side}` },
    nodes: [
      { id: `file-${side}`, kind: 'file', label: 'src/App.tsx', location: { path: 'src/App.tsx' } },
      { id: `token-use-${side}`, kind: 'token-use', label: 'App token use', location: { path: 'src/App.tsx', offset: 0, byteOffset: 0 } },
    ],
    edges: [{ id: `relation-${side}`, from: `file-${side}`, to: `token-use-${side}`, kind: 'reads', certainty: 'source-proven', evidenceRefs: [`evidence-${side}`], sourceUse: { path: 'src/App.tsx', charOffset: 0, byteOffset: 0, offsetUnit: 'code-unit' } } satisfies Relation],
    unresolved: [],
  }
  const sourceMappings = [{ projectId: 'project-h0', sourceRef: `token-use-${side}`, graphNodeId: `token-use-${side}`, sourceAnchorRelationId: `relation-${side}`, sourceIdentity: `source:${sourceDigest}:src/App.tsx:0:0`, sourceUse: { path: 'src/App.tsx', charOffset: 0, byteOffset: 0, offsetUnit: 'code-unit' as const } }]
  const bindingWithoutDigest: HostTrustSideBinding = {
    projectId: 'project-h0', runId: pointBase.runId, checkId: pointBase.checkId, side, status,
    sourceDigest, graphDigest: '', graphSchemaVersion: 'acp6-sourcegraph/v1', graphIdentityVersion: 'sourcegraph-identity/v2', relationIdentityVersion: 'relation-id/v1', sourceMappingVersion: 'sourcegraph-source-mapping/v1',
    sourceSnapshot, graph, sourceMappings,
  }
  const graphDigest = await computeHostGraphDigestV1(bindingWithoutDigest)
  const binding: HostTrustSideBinding = { ...bindingWithoutDigest, graphDigest }
  const artifactBytes = bytes(`${side}-snapshot`)
  const artifact = {
    path: `${side}.snapshot.json`,
    sha256: await (await import('./observation-host-registry-v1')).sha256Hex(artifactBytes),
    sizeBytes: artifactBytes.length,
    bytes: artifactBytes,
    lineage: { projectId: 'project-h0', runId: pointBase.runId, checkId: pointBase.checkId, side, route: pointBase.route, page, viewport: pointBase.viewport, state: pointBase.state },
  }
  const runPoint = {
    projectId: 'project-h0', ...pointBase, side, page, sourceDigest, graphDigest,
    graphSchemaVersion: binding.graphSchemaVersion, graphIdentityVersion: binding.graphIdentityVersion, relationIdentityVersion: binding.relationIdentityVersion, sourceMappingVersion: binding.sourceMappingVersion, artifactPath: artifact.path,
  }
  return { binding, artifact, runPoint, sourceDigest, graphDigest }
}

async function makeFixture(options: { status?: ObservationStatus; mutate?: (state: HostTrustRegistryState) => void } = {}) {
  const baseline = await makeSide('baseline', 'export const App = 1')
  const candidate = await makeSide('candidate', 'export const App = 2', options.status ?? 'complete')
  const state: HostTrustRegistryState = {
    projects: [{ projectId: 'project-h0', sourceDigests: { baseline: baseline.sourceDigest, candidate: candidate.sourceDigest } }],
    runPoints: [baseline.runPoint, candidate.runPoint],
    sideBindings: [baseline.binding, candidate.binding],
    artifacts: [baseline.artifact, candidate.artifact],
  }
  options.mutate?.(state)
  const registry = createHostTrustRegistryV1TestDouble(state)
  const envelope: ObservationBindingV1 = {
    protocol: 'ripple-observation-binding/v1', projectId: 'project-h0', runId: pointBase.runId, checkId: pointBase.checkId, side: 'baseline',
    route: pointBase.route, page, viewport: pointBase.viewport, state: pointBase.state, status: 'complete',
    artifact: { path: baseline.artifact.path, sha256: baseline.artifact.sha256, sizeBytes: baseline.artifact.sizeBytes },
    sourceDigest: baseline.sourceDigest, graphDigest: baseline.graphDigest,
    graphSchemaVersion: baseline.binding.graphSchemaVersion, graphIdentityVersion: baseline.binding.graphIdentityVersion, relationIdentityVersion: baseline.binding.relationIdentityVersion, sourceMappingVersion: baseline.binding.sourceMappingVersion,
  }
  return { registry, state, envelope, baseline, candidate }
}

describe('Host Trust Wrapper v1 — E-H0', () => {
  it('matches the frozen D Graph Digest golden vector and uses the formal domain separator', async () => {
    const sourceDigest = 'a'.repeat(64)
    const sourceUse = { path: 'src/App.tsx', charOffset: 0, byteOffset: 0, offsetUnit: 'code-unit' as const }
    const graph: SourceGraph = {
      id: 'graph-golden',
      revision: { projectId: 'project-h0', sourceDigest, runtimeFingerprint: 'fingerprint-golden' },
      nodes: [
        { id: 'file-baseline', kind: 'file', label: 'src/App.tsx', location: { path: 'src/App.tsx' } },
        { id: 'token-use-baseline', kind: 'token-use', label: 'App token use', location: { path: 'src/App.tsx', offset: 0, byteOffset: 0 } },
      ],
      edges: [{ id: 'relation-baseline', from: 'file-baseline', to: 'token-use-baseline', kind: 'reads', certainty: 'source-proven', evidenceRefs: ['evidence-baseline'], sourceUse } satisfies Relation],
      unresolved: [],
    }
    const digest = await computeHostGraphDigestV1({
      projectId: 'project-h0', sourceDigest, graphSchemaVersion: 'acp6-sourcegraph/v1', graphIdentityVersion: 'sourcegraph-identity/v2', relationIdentityVersion: 'relation-id/v1', sourceMappingVersion: 'sourcegraph-source-mapping/v1', graph,
      sourceMappings: [{ projectId: 'project-h0', sourceRef: 'token-use-baseline', graphNodeId: 'token-use-baseline', sourceAnchorRelationId: 'relation-baseline', sourceIdentity: `source:${sourceDigest}:src/App.tsx:0:0`, sourceUse }],
    })
    expect(digest).toBe('48ec3e0130910c3b95e04ce39265de92b16f50c5f24d41f4e69694cf9dff13f5')
  })

  it.each(['unknown node kind', 'duplicate evidenceRefs', 'duplicate relation ID', 'empty pageOverrides', 'unsafe integer'])('rejects frozen Graph Digest schema case: %s', async label => {
    const fixture = await makeFixture()
    const binding = fixture.baseline.binding
    const graph = structuredClone(binding.graph) as unknown as SourceGraph & { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
    if (label === 'unknown node kind') (graph.nodes[0] as Record<string, unknown>).kind = 'not-a-node-kind'
    if (label === 'duplicate evidenceRefs') graph.edges[0].evidenceRefs = ['same', 'same']
    if (label === 'duplicate relation ID') graph.edges.push({ ...graph.edges[0] })
    if (label === 'empty pageOverrides') graph.nodes[0].pageOverrides = { '': 'bad' }
    if (label === 'unsafe integer') graph.nodes[0].location = { path: 'src/App.tsx', offset: Number.MAX_SAFE_INTEGER + 1 }
    await expect(computeHostGraphDigestV1({ ...binding, graph })).rejects.toThrow('graph-schema-invalid')
  })

  it('H0-01 rejects caller graphDigest mutation', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, graphDigest: 'f'.repeat(64) }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/observation-tuple-mismatch' })
  })

  it('H0-01b rejects a self-consistent forged Graph, mapping, and host binding', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({
      ...fixture.envelope,
      callerClaims: { graph: { id: 'forged' }, sourceMappings: [{ sourceRef: 'fake' }], hostSideBinding: { projectId: 'project-h0' } },
    }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/caller-authority-supplied' })
  })

  it('H0-01c rejects a self-consistent forged registry created through the public factory', async () => {
    const fixture = await makeFixture()
    const callerRegistry = createHostTrustRegistryV1(fixture.state)
    const result = await validateHostObservationV1(fixture.envelope, callerRegistry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/registry-unavailable' })
  })

  it('H0-02 rejects caller registry replacement and exposes no write capability', async () => {
    const fixture = await makeFixture()
    expect(Object.isFrozen(fixture.registry)).toBe(true)
    expect('write' in fixture.registry).toBe(false)
    expect('update' in fixture.registry).toBe(false)
    expect(Reflect.set(fixture.registry as unknown as object, 'readProject', () => ({ kind: 'missing' }))).toBe(false)
    const fakeRegistry = {
      readProject: () => ({ kind: 'unique', value: { projectId: 'project-h0', sourceDigests: {} } }),
      readRunPoint: () => ({ kind: 'missing' }), readSideBinding: () => ({ kind: 'missing' }), readArtifact: () => ({ kind: 'missing' }),
    }
    const result = await validateHostObservationV1(fixture.envelope, fakeRegistry as never)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/registry-unavailable' })
  })

  it('H0-03 rejects a borrowed projectId', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, projectId: 'other-project' }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/project-unregistered' })
  })

  it('H0-04 rejects baseline/candidate side reuse', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, side: 'candidate', artifact: { ...fixture.envelope.artifact, path: fixture.candidate.artifact.path } }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/observation-tuple-mismatch' })
  })

  it('H0-05 rejects an old Graph digest on a new Graph', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, graphDigest: '0'.repeat(64) }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false })
  })

  it('H0-06 rejects a sourceDigest that does not match the source snapshot', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, sourceDigest: '1'.repeat(64) }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/observation-tuple-mismatch' })
  })

  it('H0-07 rejects sourceMappings that are not bound to the host Graph', async () => {
    const fixture = await makeFixture({ mutate: state => {
      const binding = state.sideBindings[0]
      state.sideBindings = [{ ...binding, sourceMappings: [{ ...binding.sourceMappings[0], graphNodeId: 'missing-node' }] }, ...state.sideBindings.slice(1)]
    } })
    const result = await validateHostObservationV1(fixture.envelope, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/mapping-invalid' })
  })

  it.each([
    ['sourceRef mismatch', (mapping: HostTrustSideBinding['sourceMappings'][number]) => ({ ...mapping, sourceRef: 'wrong-ref' })],
    ['declaration node target', (mapping: HostTrustSideBinding['sourceMappings'][number]) => ({ ...mapping, sourceRef: 'file-baseline', graphNodeId: 'file-baseline' })],
    ['relation endpoint mismatch', (mapping: HostTrustSideBinding['sourceMappings'][number]) => ({ ...mapping })],
    ['sourceUse mismatch', (mapping: HostTrustSideBinding['sourceMappings'][number]) => ({ ...mapping, sourceUse: { ...mapping.sourceUse, charOffset: 1 } })],
    ['non-strict certainty', (mapping: HostTrustSideBinding['sourceMappings'][number]) => ({ ...mapping })],
  ])('P0 strict source-use mapping rejects %s', async (label, mappingEdit) => {
    const fixture = await makeFixture({ mutate: state => {
      const binding = state.sideBindings[0]
      let nextMapping = mappingEdit(binding.sourceMappings[0])
      if (label === 'relation endpoint mismatch') state.sideBindings = [{ ...binding, graph: { ...binding.graph, edges: binding.graph.edges.map(edge => ({ ...edge, to: 'file-baseline' })) }, sourceMappings: [nextMapping] }, ...state.sideBindings.slice(1)]
      else if (label === 'non-strict certainty') state.sideBindings = [{ ...binding, graph: { ...binding.graph, edges: binding.graph.edges.map(edge => ({ ...edge, certainty: 'semantic-candidate' })) }, sourceMappings: [nextMapping] }, ...state.sideBindings.slice(1)]
      else state.sideBindings = [{ ...binding, sourceMappings: [nextMapping] }, ...state.sideBindings.slice(1)]
    } })
    const result = await validateHostObservationV1(fixture.envelope, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: expect.stringMatching(/^host-trust\/(mapping-invalid|graph-invalid|graph-digest-mismatch)$/) })
  })

  it('H0-08 rejects an unregistered run/check', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, runId: 'run-not-registered' }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/run-point-unregistered' })
  })

  it.each([
    ['route', { route: '/other' }],
    ['page', { page: { pathname: '/', search: '?changed=1', hash: '' } }],
    ['viewport', { viewport: { width: 375, height: 812 } }],
    ['state', { state: 'after:click' }],
  ])('H0-09 rejects a trusted check-plan %s replacement', async (_label, override) => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, ...override }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/observation-tuple-mismatch' })
  })

  it('H0-10 rejects duplicate and conflicting bindings', async () => {
    const duplicate = await makeFixture({ mutate: state => { state.sideBindings = [...state.sideBindings, state.sideBindings[0]] } })
    const duplicateResult = await validateHostObservationV1(duplicate.envelope, duplicate.registry)
    expect(duplicateResult).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/side-binding-duplicate' })
    const conflict = await makeFixture({ mutate: state => {
      const binding = state.sideBindings[0]
      state.sideBindings = [...state.sideBindings, { ...binding, graphDigest: '2'.repeat(64) }]
    } })
    const conflictResult = await validateHostObservationV1(conflict.envelope, conflict.registry)
    expect(conflictResult).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/side-binding-conflict' })
  })

  it.each(['unknown', 'partial', 'unavailable', 'stale'] as const)('H0-11 keeps %s fail-closed', async status => {
    const fixture = await makeFixture({ status, mutate: state => {
      state.sideBindings = [state.sideBindings[0], { ...state.sideBindings[1], status }]
    } })
    const result = await validateHostObservationV1({ ...fixture.envelope, status }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/status-not-complete' })
  })

  it('H0-12 rejects historical artifact replay under a new run', async () => {
    const fixture = await makeFixture({ mutate: state => {
      state.artifacts = state.artifacts.map(artifact => artifact.lineage.side === 'baseline' ? { ...artifact, lineage: { ...artifact.lineage, runId: 'old-run' } } : artifact)
    } })
    const result = await validateHostObservationV1(fixture.envelope, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false })
    expect(['host-trust/artifact-unavailable', 'host-trust/artifact-lineage-mismatch']).toContain(result.reasonCode)
  })

  it('H0-13 keeps static source-proven reads separate from runtime proof and authorization', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, staticRelation: { from: 'file-baseline', to: 'token-use-baseline', kind: 'reads', certainty: 'source-proven' } }, fixture.registry)
    expect(hostTrustResultIsComplete(result)).toBe(true)
    expect(result).toMatchObject({ ok: true, trusted: true, trustState: 'host-bound-complete', runtimeProof: 'none', authorizationEligible: false })
  })

  it('P0 refuses to upgrade a static relation aimed at a JSX consumer into runtime proof', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, staticRelation: { from: 'file-baseline', to: 'jsx-consumer', kind: 'reads', certainty: 'source-proven' } }, fixture.registry)
    expect(result).toMatchObject({ ok: true, trusted: true, runtimeProof: 'none', authorizationEligible: false })
    expect(hostTrustResultIsComplete(result)).toBe(true)
  })

  it('H0-14 rejects artifact byte, SHA, size, and duplicate archive failures', async () => {
    const tampered = await makeFixture({ mutate: state => {
      const artifact = state.artifacts[0]
      state.artifacts = [{ ...artifact, bytes: [...artifact.bytes, 0] }, ...state.artifacts.slice(1)]
    } })
    const tamperedResult = await validateHostObservationV1(tampered.envelope, tampered.registry)
    expect(tamperedResult).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/artifact-size-mismatch' })
    const duplicate = await makeFixture({ mutate: state => { state.artifacts = [...state.artifacts, state.artifacts[0]] } })
    const duplicateResult = await validateHostObservationV1(duplicate.envelope, duplicate.registry)
    expect(duplicateResult).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/artifact-duplicate' })
  })

  it('H0-15 refuses caller runtime-proof claims when RI Assessment is missing or non-proving', async () => {
    const fixture = await makeFixture()
    const result = await validateHostObservationV1({ ...fixture.envelope, callerClaims: { runtimeProof: { assessmentStatus: 'missing', reasons: ['instance-unavailable'] } } }, fixture.registry)
    expect(result).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/caller-authority-supplied' })
  })

  it('malformed envelope and host snapshot data fail closed without throwing', async () => {
    const fixture = await makeFixture()
    const malformedEnvelope = await validateHostObservationV1(null as never, fixture.registry)
    expect(malformedEnvelope).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/observation-tuple-mismatch' })
    const malformedHost = await makeFixture({ mutate: state => {
      const binding = state.sideBindings[0]
      state.sideBindings = [{ ...binding, sourceSnapshot: undefined as never }, ...state.sideBindings.slice(1)]
    } })
    const malformedBinding = await validateHostObservationV1(malformedHost.envelope, malformedHost.registry)
    expect(malformedBinding).toMatchObject({ ok: false, trusted: false })
    const malformedRunPoint = await makeFixture({ mutate: state => { state.runPoints = undefined as never } })
    const malformedRunResult = await validateHostObservationV1(malformedRunPoint.envelope, malformedRunPoint.registry)
    expect(malformedRunResult).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/run-point-conflict' })
    const malformedArtifactPath = await validateHostObservationV1({ ...fixture.envelope, artifact: { ...fixture.envelope.artifact, path: '../escape.json' } }, fixture.registry)
    expect(malformedArtifactPath).toMatchObject({ ok: false, trusted: false, reasonCode: 'host-trust/observation-tuple-mismatch' })
  })
})
