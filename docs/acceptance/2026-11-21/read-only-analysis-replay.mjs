import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { measureAnalyzerSourceBuild } from '../../../src/core/graph-producer-evidence-v1.ts'

const expected = {
  projectId: 'test-only:webportflio',
  repository: 'allanhue/webportflio',
  gitHead: 'b244f857457d2a07f118155602eef9097fd322bd',
  rootTree: '2a11c8c54d253e153585e88328a365ec5f4eb5cb',
  sourceDigest: '8b290a1fad716fc674f572a93ad9256a509610925c1539d565afa115930a214c',
}

if (!process.argv[2]) throw new Error('Pass the path to the exact webportflio checkout')
const checkoutRoot = realpathSync(process.argv[2])
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
assert.equal(git(checkoutRoot, 'rev-parse', 'HEAD'), expected.gitHead)
assert.equal(git(checkoutRoot, 'rev-parse', 'HEAD^{tree}'), expected.rootTree)
assert.equal(git(checkoutRoot, 'status', '--porcelain'), '')

const scratch = mkdtempSync(path.join(tmpdir(), 'ripple-read-only-analysis-'))
const configPath = path.join(scratch, 'analysis-host.json')
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const privateKeyPath = path.join(scratch, 'test-signing-key.pem')
const publicKeyPath = path.join(scratch, 'test-verification-key.pem')
const analyzerBuildPin = measureAnalyzerSourceBuild()
let server
try {
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))
  writeFileSync(configPath, JSON.stringify({
    version: 'ripple/local-project-analysis-host/v1',
    projects: [{ checkoutRoot, binding: expected }],
    privateKeyPath, publicKeyPath, analyzerBuildPin,
  }))
  process.env.RIPPLE_LOCAL_ANALYSIS_HOST_CONFIG = configPath
  process.env.RIPPLE_WORKBENCH_STATE_DIR = path.join(scratch, 'workbench')
  server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false } })
  await server.listen()
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port
  async function request(body, requestOrigin = origin) {
    const response = await fetch(origin + '/__ripple/api/project/read-only-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: requestOrigin },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return { status: response.status, body: await response.json() }
  }

  const summary = await request({ projectId: expected.projectId })
  assert.deepEqual(summary, { status: 200, body: {
    projectId: expected.projectId,
    sourceDigest: expected.sourceDigest,
    graphDigest: 'f06aa70dfd13a88f0c32d33d00ffa368f8c984da9c567587cef47553952562d3',
    mappingCount: 252, unresolvedCount: 253,
    hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
  } })
  const unknown = await request({ projectId: 'unregistered-project' })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.code, 'project-unregistered')
  const injected = await request({ projectId: expected.projectId, verified: true, buildPin: {}, publicKey: 'caller' })
  assert.deepEqual(injected, { status: 400, body: { code: 'invalid-request' } })
  const crossOrigin = await request({ projectId: expected.projectId }, 'https://example.invalid')
  assert.equal(crossOrigin.status, 403)
  assert.equal(git(checkoutRoot, 'status', '--porcelain'), '')

  console.log(JSON.stringify({
    implementationHead: git(process.cwd(), 'rev-parse', 'HEAD'),
    checkout: { head: expected.gitHead, rootTree: expected.rootTree },
    buildSha256: analyzerBuildPin.buildSha256, summary, unknown, injected, crossOrigin,
  }, null, 2))
} finally {
  try { await server?.close() } finally { rmSync(scratch, { recursive: true, force: true }) }
}
