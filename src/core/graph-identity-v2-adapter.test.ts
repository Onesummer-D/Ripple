// @vitest-environment node
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import { analyzeProject } from './project'
import { adaptSourceGraph, type HostProjectRegistryRecord } from './graph-identity-v2-adapter'
import { computeGraphDigestV2, type GraphSourceMapping } from './graph-identity-v2'
import type { SourceGraph } from './model'

const roots: string[] = []
function fixture(css = '/* 中文 😀 � */\r\n:root{--x:red}.title{color:var(--x);background:var(--x)}') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-adapter-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'App.tsx'), 'import "./theme.css";export function App(){return <h1 className="title">Hello</h1>}')
  fs.writeFileSync(path.join(root, 'theme.css'), css)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test'); git('config', 'core.autocrlf', 'false'); git('add', '.'); git('commit', '-m', 'fixture')
  const snapshot = captureFrozenSourceSnapshot(root)
  const graph = analyzeProject(snapshot)
  const registry: HostProjectRegistryRecord = { projectId: 'test-project', repository: 'fixture-only', head: snapshot.gitHead!, rootTree: snapshot.rootTree!, sourceDigest: snapshot.sourceDigest }
  return { root, snapshot, graph, registry }
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function mappings(input: ReturnType<typeof fixture>): GraphSourceMapping[] {
  const result = adaptSourceGraph(input)
  expect(result.status, JSON.stringify(result)).toBe('available-content-only')
  if (result.status !== 'available-content-only') throw new Error(JSON.stringify(result))
  return result.result.canonical.sourceMappings
}

describe('real SourceGraph -> GraphDigestV2 adapter', () => {
  it('produces canonical bytes/digest from actual analyzer, keeps SM-03 option 2 and content-only trust', () => {
    const input = fixture()
    const result = adaptSourceGraph(input)
    expect(result.status, JSON.stringify(result)).toBe('available-content-only')
    if (result.status !== 'available-content-only') throw new Error(JSON.stringify(result))
    expect(result.result.canonical.sourceMappings).toHaveLength(2)
    expect(result.diagnostics.every(item => item.decision === 'accepted')).toBe(true)
    expect(result.result.canonicalBytes.length).toBeGreaterThan(100)
    expect(computeGraphDigestV2(result.result.canonical)).toBe(result.result.digest)
    expect(result.hostProvenance).toBe('unverified')
    expect(result.result.sourceTrust).toBe('content-only')
    for (const node of result.result.canonical.nodes.filter(node => node.kind === 'token-use')) expect(node.location?.byteOffset).toBeUndefined()
    expect(adaptSourceGraph({ ...input, mappingCandidates: mappings(input) }).status).toBe('available-content-only')
  })
  it('requires registry evidence even when mappings and content digest are valid', () => {
    const input = fixture()
    expect(adaptSourceGraph({ ...input, registry: undefined }).status).toBe('unavailable')
    expect(adaptSourceGraph({ ...input, registry: { ...input.registry, rootTree: '0'.repeat(40) } }).status).toBe('unavailable')
    expect(adaptSourceGraph({ ...input, graph: { ...input.graph } }).status).toBe('unavailable')
  })
  it('covers zero-token-use with empty mappings; registry is still required', () => {
    const input = fixture('.title{color:red}')
    expect(mappings(input)).toEqual([])
    expect(adaptSourceGraph({ ...input, registry: undefined }).status).toBe('unavailable')
  })
  it.each([
    ['path', (graph: SourceGraph) => { graph.nodes.find(n => n.kind === 'token-use')!.location!.path = 'App.tsx' }, 'mapping-path-mismatch'],
    ['char', (graph: SourceGraph) => { graph.nodes.find(n => n.kind === 'token-use')!.location!.offset! += 1 }, 'mapping-char-offset-mismatch'],
    ['node-byte', (graph: SourceGraph) => { graph.nodes.find(n => n.kind === 'token-use')!.byteOffset! += 1 }, 'mapping-byte-offset-mismatch'],
    ['optional-byte', (graph: SourceGraph) => { graph.nodes.find(n => n.kind === 'token-use')!.location!.byteOffset = 0 }, 'mapping-byte-offset-mismatch'],
    ['missing-node-byte', (graph: SourceGraph) => { delete graph.nodes.find(n => n.kind === 'token-use')!.byteOffset }, 'mapping-byte-offset-mismatch'],
    ['missing-anchor', (graph: SourceGraph) => { graph.edges = graph.edges.filter(e => !(e.kind === 'reads' && graph.nodes.some(n => n.id === e.from && n.kind === 'file'))) }, 'mapping-anchor-nonunique-or-missing'],
    ['span', (graph: SourceGraph) => { graph.nodes.find(n => n.kind === 'token-use')!.location!.end! += 1 }, 'mapping-span-mismatch'],
  ] as const)('rejects %s byte-proof contradiction as mapping diagnostic', (_name, mutate, reason) => {
    const input = fixture()
    mutate(input.graph)
    const result = adaptSourceGraph(input)
    expect(result.status).toBe('unavailable')
    expect(result.diagnostics.some(d => d.decision === 'mapping-rejected' && d.reasonCode === reason)).toBe(true)
  })
  it('keeps incomplete candidate coverage unavailable and rejects malformed collection shape', () => {
    const input = fixture()
    const original = mappings(input)
    const partial = adaptSourceGraph({ ...input, mappingCandidates: original.slice(1) })
    expect(partial.status).toBe('unavailable')
    expect(partial.diagnostics.some(item => item.reasonCode === 'mapping-missing')).toBe(true)
    const duplicate = adaptSourceGraph({ ...input, mappingCandidates: [...original, original[0]] })
    expect(duplicate.status).toBe('unavailable')
    expect(duplicate.diagnostics.some(item => item.reasonCode === 'mapping-duplicate')).toBe(true)
    const conflict = adaptSourceGraph({ ...input, mappingCandidates: [{ ...original[0], sourceIdentity: 'source:' + '0'.repeat(64) + ':x.css:0:0' }, original[1]] })
    expect(conflict.status).toBe('unavailable')
    expect(conflict.diagnostics.some(item => item.reasonCode === 'mapping-candidate-invalid')).toBe(true)
    const extra = adaptSourceGraph({ ...input, mappingCandidates: [...original, { ...original[0], graphNodeId: 'unknown-token-use', sourceRef: 'unknown-token-use' }] })
    expect(extra.status).toBe('unavailable')
    expect(extra.diagnostics.some(item => item.reasonCode === 'mapping-extra')).toBe(true)
    const invalid = adaptSourceGraph({ ...input, mappingCandidates: [{ ...original[0], trusted: true }, original[1]] as GraphSourceMapping[] })
    expect(invalid.status).toBe('rejected')
    expect(invalid.diagnostics.some(item => item.reasonCode === 'mapping-candidate-fields-invalid')).toBe(true)
    const nullMember = adaptSourceGraph({ ...input, mappingCandidates: [...original, null] as unknown as GraphSourceMapping[] })
    expect(nullMember.status).toBe('rejected')
    expect(nullMember.diagnostics.some(item => item.reasonCode === 'mapping-candidate-object-invalid')).toBe(true)
    const sparse = original.slice() as Array<GraphSourceMapping | undefined>
    delete sparse[0]
    expect(adaptSourceGraph({ ...input, mappingCandidates: sparse as GraphSourceMapping[] }).status).toBe('rejected')
    expect(adaptSourceGraph({ ...input, mappingCandidates: null as unknown as GraphSourceMapping[] }).status).toBe('rejected')
    expect(adaptSourceGraph({ ...input, mappingCandidates: {} as unknown as GraphSourceMapping[] }).status).toBe('rejected')
    const graph = { ...input.graph, trusted: true }
    expect(adaptSourceGraph({ ...input, graph, registry: undefined }).status).toBe('rejected')
    input.graph.edges.push({ ...input.graph.edges[0] })
    expect(adaptSourceGraph(input).status).toBe('rejected')
  })
})
