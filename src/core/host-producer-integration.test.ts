// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import { adaptSourceGraph } from './graph-identity-v2-adapter'
import { createGraphProducerEvidenceVerifier, measureAnalyzerSourceBuild } from './graph-producer-evidence-v1'
import { createHostRegistryIssuerV1, createHostRegistryVerifierV1 } from './host-registry-issuer-v1'
import { analyzeProject, digestTrackedTree } from './project'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root,
  '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=Ripple Integration', '-c', 'user.email=integration@example.test',
  ...args], { encoding: 'utf8' }).trim()

function projectAt(root: string, projectId: string, repository: string) {
  const checkoutRoot = realpathSync(root)
  const expected = {
    projectId, repository, gitHead: git(checkoutRoot, 'rev-parse', 'HEAD'),
    rootTree: git(checkoutRoot, 'rev-parse', 'HEAD^{tree}'), sourceDigest: digestTrackedTree(checkoutRoot),
  }
  const host = generateKeyPairSync('ed25519')
  const issue = createHostRegistryIssuerV1({
    projects: [{ checkoutRoot, binding: expected }],
    privateKey: host.privateKey,
  })
  const verifyReceipt = createHostRegistryVerifierV1({ expected, publicKey: host.publicKey })
  const issued = issue(projectId)
  if (issued.status !== 'issued') throw new Error(JSON.stringify(issued))
  const receipt = JSON.parse(JSON.stringify(issued.receipt)) as typeof issued.receipt
  const verified = verifyReceipt(receipt)
  expect(verified).toEqual({ status: 'verified', binding: expected })
  if (verified.status !== 'verified') throw new Error(JSON.stringify(verified))
  const { gitHead, ...identity } = verified.binding
  const input = { snapshot: captureFrozenSourceSnapshot(checkoutRoot), binding: { ...identity, head: gitHead } }
  return { checkoutRoot, expected, issue, verifyReceipt, receipt, input }
}

function replayProject(project: ReturnType<typeof projectAt>, producer: ReturnType<typeof createGraphProducerEvidenceVerifier>) {
  const { input } = project
  const generated = producer.generate(input)
  if (generated.status !== 'available-producer-evidence') throw new Error(JSON.stringify(generated))
  const replayed = producer.verify(input, JSON.parse(JSON.stringify(generated.evidence)), generated.rawGraphBytes)
  expect(replayed).toEqual(generated)

  const graph = analyzeProject(input.snapshot)
  const adapted = adaptSourceGraph({ snapshot: input.snapshot, graph, registry: input.binding })
  if (adapted.status !== 'available-content-only') throw new Error(JSON.stringify(adapted))
  expect(adapted.hostProvenance).toBe('unverified')
  expect(generated.rawGraphBytes).toEqual(Buffer.from(JSON.stringify(graph)))
  expect(generated.evidence).toMatchObject({
    source: { ...input.binding, trackedSetSha256: input.snapshot.trackedSetSha256 },
    rawGraphArtifactSha256: sha256(generated.rawGraphBytes),
    graphDigest: adapted.result.digest,
    canonicalBytesSha256: adapted.result.canonicalBytesSha256,
  })
  return {
    generated,
    counts: {
      nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length,
      mappings: adapted.result.canonical.sourceMappings.length,
    },
  }
}

const buildPin = measureAnalyzerSourceBuild()
const producer = createGraphProducerEvidenceVerifier(buildPin)

describe('Host Registry and Graph Producer Evidence', () => {
  let root: string
  let project: ReturnType<typeof projectAt>
  let result: ReturnType<typeof replayProject>

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ripple-host-producer-'))
    git(root, 'init', '--quiet', '--object-format=sha1')
    writeFileSync(path.join(root, 'App.tsx'), 'import "./theme.css"; export const App = () => <main className="card">证据</main>\n')
    writeFileSync(path.join(root, 'theme.css'), '/* 中文 */ :root{--ink:blue} .card{color:var(--ink)}\n')
    git(root, 'add', 'App.tsx', 'theme.css')
    git(root, 'commit', '--quiet', '--no-verify', '-m', 'Committed source fixture')
    project = projectAt(root, 'test-only:host-producer', 'fixture/host-producer')
    result = replayProject(project, producer)
  }, 90_000)

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('verifies the signed snapshot binding and replays its graph with an independent build pin', () => {
    expect(result.counts.mappings).toBe(1)
    expect(result.generated.evidence.build).toEqual(buildPin)
    expect(result.generated.evidence).not.toHaveProperty('runtimeProof')
    expect(result.generated.evidence).not.toHaveProperty('authorizationEligible')
  })

  it('rejects a forged signature', () => {
    const signature = Buffer.from(project.receipt.signature, 'base64url')
    signature[0] ^= 1
    expect(project.verifyReceipt({ ...project.receipt, signature: signature.toString('base64url') }))
      .toEqual({ status: 'rejected', reason: 'signature-invalid' })
  })

  it('rejects a self-consistent receipt from a replacement public key', () => {
    const replacement = generateKeyPairSync('ed25519')
    const issue = createHostRegistryIssuerV1({
      privateKey: replacement.privateKey, projects: [{ checkoutRoot: project.checkoutRoot, binding: project.expected }],
    })
    const forged = issue(project.expected.projectId)
    if (forged.status !== 'issued') throw new Error(JSON.stringify(forged))
    expect(project.verifyReceipt(forged.receipt)).toEqual({ status: 'rejected', reason: 'key-mismatch' })
  })

  it('rejects a valid receipt when the expected project differs', () => {
    // Use a fresh issuer and pin to isolate the project check from signature and key checks.
    const host = generateKeyPairSync('ed25519')
    const issue = createHostRegistryIssuerV1({
      privateKey: host.privateKey, projects: [{ checkoutRoot: project.checkoutRoot, binding: project.expected }],
    })
    const issued = issue(project.expected.projectId)
    if (issued.status !== 'issued') throw new Error(JSON.stringify(issued))
    const verify = createHostRegistryVerifierV1({
      expected: { ...project.expected, projectId: 'test-only:other' }, publicKey: host.publicKey,
    })
    expect(verify(issued.receipt)).toEqual({ status: 'rejected', reason: 'binding-mismatch' })
  })

  it('rejects a different Analyzer build pin', () => {
    const other = createGraphProducerEvidenceVerifier({ ...buildPin, buildSha256: '0'.repeat(64) })
    const { evidence, rawGraphBytes } = result.generated
    expect(other.verify(project.input, evidence, rawGraphBytes))
      .toEqual({ status: 'unavailable', reason: 'build-identity-mismatch' })
  })

  it('rejects changed Graph artifact bytes with the original evidence', () => {
    const { evidence, rawGraphBytes } = result.generated
    const tampered = Buffer.concat([rawGraphBytes, Buffer.from('\n')])
    expect(producer.verify(project.input, evidence, tampered))
      .toEqual({ status: 'unavailable', reason: 'graph-artifact-mismatch' })
  }, 60_000)

  it('rejects snapshot drift even when the original signed receipt still verifies', () => {
    writeFileSync(path.join(root, 'theme.css'), ':root{--ink:green} .card{color:var(--ink)}\n')
    git(root, 'add', 'theme.css')
    git(root, 'commit', '--quiet', '--no-verify', '-m', 'Different committed source')
    try {
      expect(project.verifyReceipt(project.receipt).status).toBe('verified')
      expect(project.issue(project.expected.projectId)).toEqual({ status: 'rejected', reason: 'snapshot-binding-mismatch' })
      const { evidence, rawGraphBytes } = result.generated
      expect(producer.verify(project.input, evidence, rawGraphBytes))
        .toEqual({ status: 'unavailable', reason: 'snapshot-mismatch' })
    } finally {
      git(root, 'checkout', '--detach', project.expected.gitHead)
    }
  }, 60_000)
})

it.skipIf(!process.env.RIPPLE_HOST_PRODUCER_FIXED_PROJECT)('replays the exact webportflio checkout', () => {
  const project = projectAt(process.env.RIPPLE_HOST_PRODUCER_FIXED_PROJECT!, 'test-only:webportflio', 'allanhue/webportflio')
  expect(project.expected).toMatchObject({
    gitHead: 'b244f857457d2a07f118155602eef9097fd322bd',
    rootTree: '2a11c8c54d253e153585e88328a365ec5f4eb5cb',
    sourceDigest: '8b290a1fad716fc674f572a93ad9256a509610925c1539d565afa115930a214c',
  })
  const { generated, counts } = replayProject(project, producer)
  expect(counts).toEqual({ nodes: 675, edges: 3046, unresolved: 253, mappings: 252 })
  expect(generated.evidence).toMatchObject({
    graphDigest: 'f06aa70dfd13a88f0c32d33d00ffa368f8c984da9c567587cef47553952562d3',
    canonicalBytesSha256: '319a0d6dbae1bda9a3e1036939624b3b399f62ad80fecadd53053eaa70455af6',
  })
  console.info(JSON.stringify({ status: 'verified-and-replayed', counts, evidence: generated.evidence }))
}, 180_000)
