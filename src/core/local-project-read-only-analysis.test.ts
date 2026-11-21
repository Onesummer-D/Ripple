// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import { adaptSourceGraph } from './graph-identity-v2-adapter'
import { measureAnalyzerSourceBuild } from './graph-producer-evidence-v1'
import { createHostRegistryIssuerV1, type HostRegistryIssueResultV1 } from './host-registry-issuer-v1'
import { localProjectApiPlugin } from './local-project-api'
import { createLocalProjectReadOnlyAnalysis, type ReadOnlyAnalysisHost } from './local-project-read-only-analysis'
import { analyzeProject } from './project'

const urlPath = '/__ripple/api/project/read-only-analysis'
const roots: string[] = []
let server: ViteDevServer
let origin: string

function git(root: string, ...args: string[]): string {
  return execFileSync('git', [
    '-C', root, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Ripple Test', '-c', 'user.email=test@example.invalid', ...args,
  ], { encoding: 'utf8' }).trim()
}

function commit(root: string) {
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'snapshot')
}

function fixture(projectId: string, badSyntax = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'ripple-analysis-http-'))
  roots.push(root)
  git(root, 'init', '-q')
  writeFileSync(path.join(root, 'App.tsx'), badSyntax
    ? 'export const invalid = (' : 'import "./theme.css"; export const App = () => <main className="card">分析</main>\n')
  writeFileSync(path.join(root, 'theme.css'), '/* 字节 */ :root{--ink:blue} .card{color:var(--ink)}\n')
  commit(root)
  return registered(projectId, root)
}

function registered(projectId: string, root: string, repository = 'fixture/http') {
  const snapshot = captureFrozenSourceSnapshot(root)
  const { sourceDigest, gitHead, rootTree } = snapshot
  const expected = { projectId, repository, gitHead: gitHead!, rootTree: rootTree!, sourceDigest }
  return { root: snapshot.root, snapshot, expected }
}

type Registration = NonNullable<ReturnType<ReadOnlyAnalysisHost['resolveProject']>>
let project: ReturnType<typeof fixture>
let drift: ReturnType<typeof fixture>
let registry: Map<string, Registration>
let lookups = 0

beforeAll(async () => {
  project = fixture('registered-project')
  const missing = registered('missing-receipt', project.root)
  const forged = registered('forged-verification', project.root)
  const badSignature = registered('bad-signature', project.root)
  const badPin = registered('bad-build-pin', project.root)
  const redirected = registered('redirected-project', project.root)
  drift = fixture('drifted-project')
  const broken = fixture('analysis-failure', true)
  const fixedRoot = process.env.RIPPLE_HOST_PRODUCER_FIXED_PROJECT
  const fixed = fixedRoot ? registered('test-only:webportflio', fixedRoot, 'allanhue/webportflio') : undefined
  const fixtures = [project, missing, forged, badSignature, badPin, redirected, drift, broken, ...(fixed ? [fixed] : [])]
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const issue = createHostRegistryIssuerV1({ projects: fixtures.map(({ root, expected }) => ({
    checkoutRoot: root, binding: expected,
  })), privateKey })
  const pin = measureAnalyzerSourceBuild()
  registry = new Map(fixtures.map(({ root, expected }) => [expected.projectId, {
    checkoutRoot: root, expected, publicKey, analyzerBuildPin: pin, issueReceipt: () => issue(expected.projectId),
  }]))
  const override = (projectId: string, changes: Partial<Registration>) =>
    registry.set(projectId, { ...registry.get(projectId)!, ...changes })
  override(missing.expected.projectId, { issueReceipt: () => ({ status: 'unavailable', reason: 'signing-unavailable' }) })
  override(forged.expected.projectId, {
    issueReceipt: () => ({
      status: 'issued', receipt: { status: 'verified', binding: forged.expected },
    }) as unknown as HostRegistryIssueResultV1,
  })
  override(badSignature.expected.projectId, {
    issueReceipt: () => {
      const issued = issue(badSignature.expected.projectId)
      if (issued.status !== 'issued') throw new Error(JSON.stringify(issued))
      const signature = Buffer.from(issued.receipt.signature, 'base64url')
      signature[0] ^= 1
      return { status: 'issued', receipt: { ...issued.receipt, signature: signature.toString('base64url') } }
    },
  })
  override(badPin.expected.projectId, { analyzerBuildPin: { ...pin, buildSha256: '0'.repeat(64) } })
  const driftReceipt = issue(drift.expected.projectId)
  expect(driftReceipt.status).toBe('issued')
  override(drift.expected.projectId, { issueReceipt: () => driftReceipt })
  const linkRoot = mkdtempSync(path.join(tmpdir(), 'ripple-analysis-redirect-'))
  roots.unshift(linkRoot)
  const checkoutLink = path.join(linkRoot, 'checkout')
  symlinkSync(project.root, checkoutLink, process.platform === 'win32' ? 'junction' : 'dir')
  override(redirected.expected.projectId, { checkoutRoot: checkoutLink })

  server = await createServer({ configFile: false, logLevel: 'silent',
    plugins: [localProjectApiPlugin({ readOnlyAnalysisHost: { resolveProject(projectId) {
      lookups += 1
      return registry.get(projectId)
    } } })],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`
}, 30_000)

afterAll(async () => {
  await server?.close()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const post = (body: unknown, requestOrigin = origin, suffix = '') => fetch(origin + urlPath + suffix, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin }, body: JSON.stringify(body),
})

async function failed(projectId: string, status: number, code: string, hostReceiptStatus: string) {
  const response = await post({ projectId })
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ code, hostReceiptStatus, producerEvidenceStatus: 'unavailable' })
}

describe('registered read-only analysis over HTTP', () => {
  it('fails closed when the server is started without a trusted host', () => {
    expect(createLocalProjectReadOnlyAnalysis()('registered-project')).toEqual({
      status: 'failed', code: 'host-config-unavailable',
      hostReceiptStatus: 'unavailable', producerEvidenceStatus: 'unavailable',
    })
  })

  it('projects the independently verified frozen graph into exactly seven fields', async () => {
    const { expected, root, snapshot } = project
    const { gitHead, ...identity } = expected
    const direct = adaptSourceGraph({ graph: analyzeProject(snapshot), snapshot, registry: { ...identity, head: gitHead } })
    if (direct.status !== 'available-content-only') throw new Error(JSON.stringify(direct))
    const response = await post({ projectId: expected.projectId })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      projectId: expected.projectId, sourceDigest: expected.sourceDigest, graphDigest: direct.result.digest,
      mappingCount: 1, unresolvedCount: direct.result.canonical.unresolved.length,
      hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
    })
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(git(root, 'rev-parse', 'HEAD')).toBe(expected.gitHead)
  }, 40_000)

  it('rejects method, origin, query and caller-supplied authority before registry lookup', async () => {
    const before = lookups
    expect((await fetch(origin + urlPath)).status).toBe(405)
    expect((await post({ projectId: project.expected.projectId }, 'https://foreign.invalid')).status).toBe(403)
    expect((await post({ projectId: project.expected.projectId }, origin, '?head=caller')).status).toBe(400)
    for (const field of ['projectRoot', 'receipt', 'publicKey', 'analyzerBuildPin', 'verificationResult']) {
      const response = await post({ projectId: project.expected.projectId, [field]: 'caller-controlled' })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ code: 'invalid-request' })
    }
    expect(lookups).toBe(before)
    await failed(project.root, 404, 'project-unregistered', 'unavailable')
  })

  it('fails closed for a missing receipt, forged verified result and tampered signature', async () => {
    await failed('missing-receipt', 503, 'host-receipt-unavailable', 'unavailable')
    await failed('forged-verification', 409, 'host-receipt-rejected', 'rejected')
    await failed('bad-signature', 409, 'host-receipt-rejected', 'rejected')
  })

  it('returns no analysis summary with a wrong build pin', async () => {
    await failed('bad-build-pin', 503, 'producer-evidence-unavailable', 'verified')
  }, 20_000)

  it('rejects project drift even with a previously valid signed receipt', async () => {
    writeFileSync(path.join(drift.root, 'theme.css'), ':root{--ink:green}\n')
    commit(drift.root)
    await failed(drift.expected.projectId, 409, 'project-drift', 'rejected')
    await failed('redirected-project', 409, 'project-drift', 'rejected')
  })

  it('returns a public code when the Analyzer throws after receipt verification', async () => {
    await failed('analysis-failure', 503, 'analysis-failed', 'verified')
  })

  it.skipIf(!process.env.RIPPLE_HOST_PRODUCER_FIXED_PROJECT)('analyzes the pinned webportflio checkout through HTTP', async () => {
    const registration = registry.get('test-only:webportflio')!
    expect(registration.expected.gitHead).toBe('b244f857457d2a07f118155602eef9097fd322bd')
    const response = await post({ projectId: registration.expected.projectId })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      projectId: 'test-only:webportflio', sourceDigest: '8b290a1fad716fc674f572a93ad9256a509610925c1539d565afa115930a214c',
      graphDigest: 'f06aa70dfd13a88f0c32d33d00ffa368f8c984da9c567587cef47553952562d3', mappingCount: 252, unresolvedCount: 253,
      hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
    })
  }, 90_000)
})
