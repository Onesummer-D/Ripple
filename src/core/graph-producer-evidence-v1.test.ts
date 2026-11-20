// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import { canonicalJson } from './graph-identity-v2'
import { adaptSourceGraph } from './graph-identity-v2-adapter'
import { createGraphProducerEvidenceVerifier, measureAnalyzerSourceBuild } from './graph-producer-evidence-v1'
import { analyzeProject } from './project'

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
let root: string
let input: Parameters<ReturnType<typeof createGraphProducerEvidenceVerifier>['generate']>[0]
let build: ReturnType<typeof measureAnalyzerSourceBuild>
let verifier: ReturnType<typeof createGraphProducerEvidenceVerifier>
let result: Extract<ReturnType<typeof verifier.generate>, { status: 'available-producer-evidence' }>

function git(...args: string[]) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-producer-evidence-test-'))
  git('init', '-q')
  git('config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(root, 'App.tsx'), 'import "./theme.css"; export const App = () => <main className="card">证据</main>\n')
  fs.writeFileSync(path.join(root, 'theme.css'), '/* 中文 */ :root{--ink: blue} .card{color:var(--ink)}\n')
  git('add', '.')
  git('-c', 'user.name=Ripple Test', '-c', 'user.email=ripple-test@example.com', 'commit', '-qm', 'Fixture')
  const snapshot = captureFrozenSourceSnapshot(root)
  input = { snapshot, binding: {
    projectId: 'fixture:producer', repository: 'fixture/producer', head: snapshot.gitHead!,
    rootTree: snapshot.rootTree!, sourceDigest: snapshot.sourceDigest,
  } }
  build = measureAnalyzerSourceBuild()
  verifier = createGraphProducerEvidenceVerifier(build)
  const generated = verifier.generate(input)
  if (generated.status !== 'available-producer-evidence') throw new Error(JSON.stringify(generated))
  result = generated
}, 30_000)

afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }) })

describe('GraphProducerEvidenceV1', () => {
  it('binds actual Analyzer output and replays with the pinned source build', () => {
    const graph = analyzeProject(input.snapshot)
    const adapted = adaptSourceGraph({ ...input, graph, registry: input.binding })
    if (adapted.status !== 'available-content-only') throw new Error(JSON.stringify(adapted))
    expect(adapted.result.canonical.sourceMappings).toHaveLength(1)
    expect(result.rawGraphBytes).toEqual(Buffer.from(JSON.stringify(graph)))
    expect(result.evidence).toMatchObject({
      source: { ...input.binding, trackedSetSha256: input.snapshot.trackedSetSha256 },
      build,
      graphDigest: adapted.result.digest,
      canonicalBytesSha256: adapted.result.canonicalBytesSha256,
      rawGraphArtifactSha256: sha256(result.rawGraphBytes),
    })
    expect(build.runtime.nodeVersion).toBe(process.version)
    expect(verifier.verify(input, JSON.parse(JSON.stringify(result.evidence)), result.rawGraphBytes)).toEqual(result)
    expect(result).not.toHaveProperty('authorizationEligible')
    expect(result).not.toHaveProperty('runtimeProof')
  }, 30_000)

  it('requires an independent build pin and rejects a different build or invalid build version', () => {
    expect(createGraphProducerEvidenceVerifier().verify(input, result.evidence, result.rawGraphBytes))
      .toEqual({ status: 'unavailable', reason: 'build-identity-unavailable' })
    expect(createGraphProducerEvidenceVerifier({ ...build, buildSha256: '0'.repeat(64) }).generate(input))
      .toEqual({ status: 'unavailable', reason: 'build-identity-mismatch' })
    expect(createGraphProducerEvidenceVerifier({ ...build, version: 'unknown' as typeof build.version }).generate(input))
      .toEqual({ status: 'unavailable', reason: 'build-identity-mismatch' })
  })

  it('requires a captured snapshot and an exact project binding', () => {
    for (const binding of [undefined, { ...input.binding!, head: '0'.repeat(40) },
      { ...input.binding!, rootTree: '0'.repeat(40) }, { ...input.binding!, sourceDigest: '0'.repeat(64) }]) {
      expect(verifier.generate({ ...input, binding })).toEqual({ status: 'unavailable', reason: 'project-binding-mismatch' })
    }
    expect(verifier.generate({ ...input, snapshot: { ...input.snapshot } }))
      .toEqual({ status: 'unavailable', reason: 'project-binding-mismatch' })
  })

  it('rejects forged producer metadata even with a correctly recomputed evidence hash', () => {
    const { evidenceSha256: _original, ...body } = result.evidence
    const forged = { ...body, build: { ...body.build, producer: 'other-analyzer' } }
    const evidenceSha256 = sha256(body.version + '\0' + canonicalJson(forged))
    expect(verifier.verify(input, { ...forged, evidenceSha256 }, result.rawGraphBytes))
      .toEqual({ status: 'unavailable', reason: 'evidence-mismatch' })
    expect(verifier.verify(input, { ...result.evidence, version: 'unknown' }, result.rawGraphBytes))
      .toEqual({ status: 'unavailable', reason: 'evidence-mismatch' })
  }, 30_000)

  it('rejects a different expected project and different raw bytes with identical JSON content', () => {
    const alternate = { ...input, binding: { ...input.binding!, projectId: 'fixture:other' } }
    expect(verifier.verify(alternate, result.evidence, result.rawGraphBytes))
      .toEqual({ status: 'unavailable', reason: 'evidence-mismatch' })
    const equivalentJson = Buffer.concat([result.rawGraphBytes, Buffer.from('\n')])
    expect(verifier.verify(input, result.evidence, equivalentJson))
      .toEqual({ status: 'unavailable', reason: 'graph-artifact-mismatch' })
  }, 30_000)

  it('fails closed if the selected checkout advances after capture', () => {
    fs.writeFileSync(path.join(root, 'theme.css'), ':root{--ink:green} .card{color:var(--ink)}\n')
    git('add', 'theme.css')
    git('-c', 'user.name=Ripple Test', '-c', 'user.email=ripple-test@example.com', 'commit', '-qm', 'New source')
    try {
      expect(verifier.generate(input)).toEqual({ status: 'unavailable', reason: 'snapshot-mismatch' })
    } finally {
      git('checkout', '--detach', input.snapshot.gitHead!)
    }
  }, 30_000)
})
