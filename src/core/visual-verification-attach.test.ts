// End-to-end attachment test: the isolated runner captures (screenshots + DOM
// geometry + descriptors), the manifest records SHA-256 bindings, and the
// host analyses the captures into supplementary, read-only, never-pass
// visual evidence attached to the run. Conservative states are pinned:
// compared-but-not-pass → 'unknown'; never-made capture → 'not-run';
// tampered bytes → 'failed-to-run'; wrong source digest → 'stale'.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CandidateRecord } from './candidate'
import type { ProjectRevision, VerificationRun } from './model'
import { attachVisualEvidence, attachVisualEvidenceSafely, VISUAL_ANALYSIS_DIR } from './visual-verification-attach'

const CANDIDATE_HOST = '127.0.0.24'
const BASELINE_HOST = '127.0.0.25'
const RUNTIME = 'attach-test-runtime'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const BASE_DIGEST = sha('attach-test-base')
const TREE_DIGEST = sha('attach-test-tree')
const PATCH = sha('attach-test-patch')

const page = (brand: string) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:0}main{padding:24px}</style></head><body>
  <div id="root"><main data-ripple-source="src/App.tsx#main" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance">
    <h1 data-ripple-source="src/App.tsx#h1" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance">${brand}</h1>
  </main></div></body></html>`

const servers: http.Server[] = []
let browser: Browser

beforeAll(async () => {
  for (const [host, brand] of [[CANDIDATE_HOST, 'New brand'], [BASELINE_HOST, 'Old brand']] as const) {
    const server = http.createServer((_request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(page(brand))
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(5173, host, resolve) })
    servers.push(server)
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
})

function input(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-attach', candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 1,
    baseSourceDigest: BASE_DIGEST, patchHash: PATCH, candidateTreeDigest: TREE_DIGEST, runtimeFingerprint: RUNTIME,
    verificationContractHash: 'contract',
    viewports: [{ name: 'desktop', width: 900, height: 700 }],
    previewHost: CANDIDATE_HOST, baselineHost: BASELINE_HOST,
    targetBindings: [], baselineComparisonPageRef: 'page:home', routeRefs: ['page:home'],
    operations: [], scopeTargetPageRefs: {}, verificationContract: { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Home page' }], interactions: [] },
    resourceSnapshots: [], unavailableResources: [],
    ...overrides,
  }
}

// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { executeVerification } from './verification-execution.mjs'

async function execute(inputValue: Record<string, unknown>) {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-visual-attach-'))
  const outcome = await executeVerification({ input: inputValue, browser, evidenceRoot })
  return { manifest: outcome.manifest as Record<string, any>, evidenceRoot }
}

function runStub(): VerificationRun {
  return {
    id: 'run-attach', candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 1,
    baseSourceDigest: BASE_DIGEST, patchHash: PATCH, candidateTreeDigest: TREE_DIGEST, runtimeFingerprint: RUNTIME,
    startedAt: '2026-10-23T00:00:00.000Z', completedAt: '2026-10-23T00:00:01.000Z',
    checks: [], assertions: [], evidence: [], status: 'incomplete',
  }
}
const candidateStub = { id: 'candidate-1', baseSourceDigest: BASE_DIGEST, scopeDecisionId: 'scope-1', scopeVersion: 1, patchHash: PATCH, candidateTreeDigest: TREE_DIGEST } as CandidateRecord
const revisionStub = { projectId: 'project-1', runtimeFingerprint: RUNTIME } as ProjectRevision

describe('visual evidence attached to a verification run', () => {
  it('captures in the runner, analyses on the host, and attaches read-only never-pass evidence', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    expect(manifest.completed).toBe(true)
    const captures = manifest.visualCaptures
    expect(captures).toHaveLength(1)
    const capture = captures[0]
    expect(capture.checkId).toBe('run-attach-desktop')
    expect(capture.route).toBe('/')
    expect(capture.state).toBe('rendered')
    // The manifest records hashes; the files underneath match them.
    for (const side of ['baseline', 'candidate']) {
      for (const kind of ['screenshot', 'geometry']) {
        const ref = capture[side][kind]
        const bytes = fs.readFileSync(path.join(evidenceRoot, ref.path))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256)
      }
      expect(capture[side].descriptor.screenshot.declaredSha256).toBe(capture[side].screenshot.sha256)
      expect(capture[side].descriptor.capture.stable).toBe(true)
    }

    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, ['src/App.tsx#h1'])
    expect(run.visualEvidences).toHaveLength(1)
    const attached = run.visualEvidences![0]
    // The brand text changed inside the declared target: an observation, never PASS.
    expect(attached.result).toBe('unknown')
    expect(attached.resultReason).toContain('Compared: changed')
    expect((attached.evidence as any).identity.status).toBe('consistent')
    expect((attached.evidence as any).comparability.comparable).toBe(true)
    expect((attached.evidence as any).geometry.target.status).toBe('mapped')
    expect((attached.view as any).state).toBe('unknown')
    expect((attached.view as any).stateLabel).toBe('视觉未知')
    expect((attached.view as any).summary).toContain('不构成通过判定')
    // Host-written artifacts exist and hash-match.
    const evidenceBytes = fs.readFileSync(attached.artifacts.evidenceJson!.path)
    expect(createHash('sha256').update(evidenceBytes).digest('hex')).toBe(attached.artifacts.evidenceJson!.sha256)
    expect(fs.existsSync(path.join(evidenceRoot, VISUAL_ANALYSIS_DIR, '0', 'diff.png'))).toBe(true)
    expect(attached.artifacts.diff).not.toBeNull()
    expect(attached.artifacts.baseline!.sha256).toBe(capture.baseline.screenshot.sha256)
  }, 90_000)

  it('maps a never-made capture to not-run and never to pass', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    manifest.visualCaptures[0].baseline.descriptor = null
    manifest.visualCaptures[0].baseline.failure = 'runner budget exhausted before visual capture'
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('not-run')
    expect(run.visualEvidences![0].evidence).toBeNull()
    expect(run.visualEvidences![0].view).toBeNull()
  }, 90_000)

  it('maps tampered screenshot bytes to failed-to-run, not to a conclusion', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    const ref = manifest.visualCaptures[0].candidate.screenshot
    fs.writeFileSync(path.join(evidenceRoot, ref.path), Buffer.from('tampered bytes'))
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
  }, 90_000)

  it('maps a capture from the wrong source tree to stale', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    manifest.visualCaptures[0].candidate.descriptor.sourceDigest = sha('attach-test-older-tree')
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('stale')
    expect((run.visualEvidences![0].evidence as any).comparability.comparable).toBe(false)
  }, 90_000)

  it('maps a tampered geometry file to failed-to-run', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    const ref = manifest.visualCaptures[0].baseline.geometry
    fs.writeFileSync(path.join(evidenceRoot, ref.path), JSON.stringify({ schema: 'ripple-dom-geometry/v1', forged: true }))
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('SHA-256')
  }, 90_000)

  it('rejects manifest entries whose recorded paths escape the capture directory', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    manifest.visualCaptures[0].candidate.screenshot.path = 'visual/../execution.json'
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('invalid')
  }, 90_000)

  it('rejects a manifest-recorded screenshot hash tampered without touching the PNG bytes', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    // Only the manifest record changes; the PNG bytes stay exactly what the
    // container delivered. The record is unbound and must not produce a
    // conclusion.
    manifest.visualCaptures[0].candidate.screenshot.sha256 = sha('tampered-manifest-hash')
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('manifest-recorded SHA-256')
  }, 90_000)

  it('rejects a declared screenshot hash that disagrees with the untouched bytes', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    manifest.visualCaptures[0].candidate.descriptor.screenshot.declaredSha256 = sha('tampered-declared-hash')
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('declared SHA-256')
  }, 90_000)

  it('converts a host write failure into failed-to-run and leaves the formal run untouched', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    // Occupy the analysis directory path with a regular file: mkdir throws.
    fs.writeFileSync(path.join(evidenceRoot, VISUAL_ANALYSIS_DIR), 'occupied')
    const stub = runStub()
    const formalBefore = JSON.stringify({ checks: stub.checks, assertions: stub.assertions, status: stub.status, evidence: stub.evidence })
    const run = attachVisualEvidence(stub, manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences).toHaveLength(1)
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('Visual evidence attachment failed')
    expect(run.visualEvidences![0].artifacts.evidenceJson).toBeNull()
    expect(run.visualEvidences![0].artifacts.diff).toBeNull()
    // The formal verification record is byte-identical: a supplementary
    // failure must never be mistaken for, or leak into, the formal result.
    expect(JSON.stringify({ checks: run.checks, assertions: run.assertions, status: run.status, evidence: run.evidence })).toBe(formalBefore)
  }, 90_000)

  it('survives a hostile manifest and records the abort instead of throwing', () => {
    const hostile = { get visualCaptures() { throw new Error('hostile manifest') } }
    const run = attachVisualEvidence(runStub(), hostile, '/nonexistent', candidateStub, revisionStub, [])
    expect(run.visualEvidences).toHaveLength(1)
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('could not be read')
  })

  it('isolates a hostile capture record and continues with the remaining captures', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    manifest.visualCaptures.unshift({ get checkId() { throw new Error('hostile record') } })
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences).toHaveLength(2)
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('could not be read')
    // The genuine capture still analyses normally after the hostile one.
    expect(run.visualEvidences![1].result).toBe('unknown')
    expect(run.visualEvidences![1].checkId).toBe('run-attach-desktop')
  }, 90_000)

  it('does not follow a parent-directory symlink outside the evidence root for geometry', async () => {
    if (process.platform === 'win32') return // symlink creation privilege
    const { manifest, evidenceRoot } = await execute(input())
    const dir = path.join(evidenceRoot, 'visual', 'desktop')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-visual-outside-'))
    fs.cpSync(dir, outside, { recursive: true })
    fs.rmSync(dir, { recursive: true, force: true })
    fs.symlinkSync(outside, dir, 'dir')
    const run = attachVisualEvidence(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('Geometry sample bytes do not match')
  }, 90_000)

  it('runner boundary: an unexpected attach throw keeps the formal run and records a failed-to-run diagnostic', () => {
    // A proxy that passes Array.isArray but has no callable forEach drives the
    // REAL attachVisualEvidence into a TypeError. The runner-level boundary
    // must absorb it: formal record untouched, explicit failed-to-run visual
    // diagnostic, bounded diagnostic file.
    const hostile = { visualCaptures: new Proxy([], { get: (target, prop) => (prop === 'forEach' ? undefined : Reflect.get(target, prop)) }) }
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-visual-safe-'))
    const stub = runStub()
    const formalBefore = JSON.stringify({ checks: stub.checks, assertions: stub.assertions, status: stub.status, evidence: stub.evidence })
    const run = attachVisualEvidenceSafely(stub, hostile, evidenceRoot, candidateStub, revisionStub, [])
    expect(run.visualEvidences).toHaveLength(1)
    expect(run.visualEvidences![0].checkId).toBe('visual-attach')
    expect(run.visualEvidences![0].result).toBe('failed-to-run')
    expect(run.visualEvidences![0].resultReason).toContain('failed unexpectedly')
    expect(run.visualEvidences![0].evidence).toBeNull()
    expect(JSON.stringify({ checks: run.checks, assertions: run.assertions, status: run.status, evidence: run.evidence })).toBe(formalBefore)
    const diagnostic = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'visual-attach-failure.json'), 'utf8'))
    expect(diagnostic.phase).toBe('visual-evidence-attach')
    expect(typeof diagnostic.detail).toBe('string')
  })

  it('runner boundary: a healthy manifest passes through with normal semantics', async () => {
    const { manifest, evidenceRoot } = await execute(input())
    const run = attachVisualEvidenceSafely(runStub(), manifest, evidenceRoot, candidateStub, revisionStub, ['src/App.tsx#h1'])
    expect(run.visualEvidences).toHaveLength(1)
    expect(run.visualEvidences![0].result).toBe('unknown')
    expect(fs.existsSync(path.join(evidenceRoot, 'visual-attach-failure.json'))).toBe(false)
  }, 90_000)
})
