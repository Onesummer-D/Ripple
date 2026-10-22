// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createServer, type ViteDevServer } from 'vite'
import { localProjectApiPlugin, withCandidateLock, type LocalProjectApiOptions } from './local-project-api'
import { analyzeProject } from './project'
import type { CandidateOperationExecutor, StructuredEditOperation } from './candidate-operation-executors'
import { attestBrowserExecution } from './verification-receipt'
import { REQUIRED_VERIFICATION_ASSERTION_IDS, type VerificationRun } from './model'
import type { StoredCandidate } from './workbench-store'

const roots: string[] = []
const tempParent = path.join(process.cwd(), 'node_modules', '.tmp')
fs.mkdirSync(tempParent, { recursive: true })
const apiStateRoot = fs.mkdtempSync(path.join(tempParent, 'ripple-api-state-'))
process.env.RIPPLE_WORKBENCH_STATE_DIR = apiStateRoot
let server: ViteDevServer | undefined
let baseUrl = ''

/** Windows refuses to delete read-only Git object files; clear attributes before removing. */
function removeTree(root: string): void {
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      try { fs.chmodSync(target, 0o666) } catch { /* keep walking */ }
      if (entry.isDirectory()) walk(target)
    }
  }
  try { walk(root) } catch { /* root may already be gone */ }
  fs.rmSync(root, { recursive: true, force: true })
}

function makeGitProject(): string {
  const root = fs.mkdtempSync(path.join(tempParent, 'ripple-local-api-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'api-fixture', private: true }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `/* project supplied https://untrusted.invalid/pixel.png */ import { useState } from 'react'; import { HomePage } from './pages/HomePage'; export function App(){const [page]=useState('home'); return <>{page === 'home' && <HomePage />}</>}`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage(){return <main><h1>Baseline title</h1><button>Browse items</button><img src="/images/old.webp" /></main>}`)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-test@example.invalid'); git('config', 'user.name', 'Ripple API test'); git('add', '.'); git('commit', '-qm', 'baseline')
  return root
}

async function startApi(options?: LocalProjectApiOptions): Promise<void> {
  server = await createServer({ configFile: false, logLevel: 'silent', plugins: [localProjectApiPlugin(options)], server: { host: '127.0.0.1', port: 0, strictPort: false } })
  await server.listen()
  const address = server.httpServer!.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await server?.close()
  server = undefined
  for (const root of roots.splice(0)) removeTree(root)
  removeTree(apiStateRoot)
})

describe('loopback Project API', () => {
  it('rejects project element selections without a current preview and refuses stale source preview baselines', async () => {
    const projectRoot = makeGitProject()
    await startApi()
    const request = (route: string, body: unknown) => fetch(`${baseUrl}/__ripple/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) })
    const analysis = await (await request('analyze', { projectRoot })).json() as { revision: { projectId: string; sourceDigest: string }; capabilities: { schemaVersion: string; projectViteConfig: { status: string }; productionBuild: { status: string }; serverRendering: { status: string } } }
    expect(analysis.capabilities).toMatchObject({ schemaVersion: 'ripple-project-capabilities/v1', projectViteConfig: { status: 'unsupported' }, productionBuild: { status: 'unsupported' }, serverRendering: { status: 'unsupported' } })
    const unissuedSelection = await request('project/source-selection', {
      projectId: analysis.revision.projectId, previewId: 'project-preview-unissued', sourceDigest: analysis.revision.sourceDigest, sourceRef: 'jsx:src/pages/HomePage.tsx#0',
    })
    expect(unissuedSelection.status).toBe(409)

    fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), 'export function HomePage(){return <main><h1>Changed after analyze</h1></main>}')
    const stalePreview = await request('project/preview', { projectId: analysis.revision.projectId })
    expect(stalePreview.status).toBe(409)
    expect((await stalePreview.json()).error).toMatch(/工作树已发生修改/)
  })

  it('analyzes a real Git project, forwards explicit local Scope to a multi-op worktree candidate and discards it', async () => {
    const projectRoot = makeGitProject()
    await startApi()
    const response = await fetch(`${baseUrl}/__ripple/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ projectRoot }) })
    expect(response.status).toBe(200)
    const analysis = await response.json() as { revision: { projectId: string; sourceDigest: string }; graphId: string; routes: Array<{ id: string }>; previewResources: { referencedUrls: string[]; authorizedUrls: string[] }; targets: Array<{ id: string; label: string; value: string; impact: { pageRefs: string[]; unresolved: string[] } }> }
    expect(analysis.previewResources).toEqual({ referencedUrls: ['https://untrusted.invalid/pixel.png'], authorizedUrls: [] })
    const authorizeResource = await fetch(`${baseUrl}/__ripple/api/preview/resources`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ projectId: analysis.revision.projectId, urls: ['https://assets.example.test/static/approved.webp'] }) })
    expect(authorizeResource.status).toBe(200)
    expect((await authorizeResource.json()).previewResources.authorizedUrls).toEqual(['https://assets.example.test/static/approved.webp'])
    const rejectUntrustedResource = await fetch(`${baseUrl}/__ripple/api/preview/resources`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ projectId: analysis.revision.projectId, urls: ['https://127.0.0.1/private.png'] }) })
    expect(rejectUntrustedResource.status).toBe(400)
    expect(analysis.routes.map(route => route.id)).toEqual(['page:home'])
    const title = analysis.targets.find(target => target.label === 'Baseline title')!
    const cta = analysis.targets.find(target => target.label === 'Browse items')!
    expect(title.impact).toEqual({ pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' })
    const scope = { id: 'scope-local-home', version: 1, includedRefs: ['page:home', title.id, cta.id], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const malformedOperation = await fetch(`${baseUrl}/__ripple/api/candidate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({
      projectId: analysis.revision.projectId, rawIntent: 'Reject a malformed structured operation', scope,
      operations: [{ id: 'missing-payload', kind: 'MEDIA', targetRef: title.id, before: 'old.jpg', after: 'new.jpg', action: 'asset-swap' }],
      verificationContract: { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Baseline title' }], interactions: [] },
    }) })
    expect(malformedOperation.status).toBe(409)
    expect(await malformedOperation.json()).toMatchObject({ code: 'invalid-operation', path: 'operations[0].payload' })
    const candidateResponse = await fetch(`${baseUrl}/__ripple/api/candidate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({
      projectId: analysis.revision.projectId, rawIntent: 'Update the home hero while preserving other pages', scope,
      operations: [
        { id: 'title-op', kind: 'TEXT', targetRef: title.id, before: title.value, after: 'Candidate title' },
        { id: 'cta-op', kind: 'TEXT', targetRef: cta.id, before: cta.value, after: 'Explore items' },
      ],
      verificationContract: { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Baseline title' }], interactions: [] },
    }) })
    expect(candidateResponse.status).toBe(200)
    const candidate = await candidateResponse.json() as { sessionId: string; candidate: { id: string; patchHash: string; candidateTreeDigest: string; operations: unknown[]; diff: string }; verification: { state: string } }
    expect(candidate.candidate.operations).toHaveLength(2)
    expect(candidate.candidate.diff).toContain('Candidate title')
    expect(candidate.candidate.diff).toContain('Explore items')
    expect(candidate.verification.state).toBe('not-run')
    expect(fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('Baseline title')
    const candidateGraph = analyzeProject(path.join(apiStateRoot, candidate.sessionId, 'candidate'), false)
    const candidateHeading = candidateGraph.nodes.find(node => node.kind === 'jsx-element' && node.label === '<h1>')!
    const mappedResponse = await fetch(`${baseUrl}/__ripple/api/candidate/source-selection`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id, sourceRef: candidateHeading.id }) })
    expect(mappedResponse.status).toBe(200)
    const mapped = await mappedResponse.json() as { candidateId: string; patchHash: string; sourceDigest: string; element: { id: string; location: { path: string } }; editableText: Array<{ value: string }> }
    expect(mapped).toMatchObject({ candidateId: candidate.candidate.id, patchHash: candidate.candidate.patchHash, sourceDigest: candidate.candidate.candidateTreeDigest, element: { id: candidateHeading.id, location: { path: 'src/pages/HomePage.tsx' } } })
    expect(mapped.editableText.map(item => item.value)).toContain('Candidate title')
    const forgedProjectSelection = await fetch(`${baseUrl}/__ripple/api/project/source-selection`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({
      projectId: analysis.revision.projectId, previewId: 'project-preview-forged', sourceDigest: analysis.revision.sourceDigest, sourceRef: candidateHeading.id,
    }) })
    expect(forgedProjectSelection.status).toBe(409)
    const previewWithoutProjectDependencies = await fetch(`${baseUrl}/__ripple/api/candidate/preview`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id, dependencyRoot: process.cwd() }) })
    expect(previewWithoutProjectDependencies.status).toBe(503)
    expect((await previewWithoutProjectDependencies.json()).error).toMatch(/项目 node_modules/)
    const failedRun = await fetch(`${baseUrl}/__ripple/api/candidate/verify`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(failedRun.status).toBe(503)
    expect((await failedRun.json()).error).toMatch(/项目 node_modules/)
    const restoredResponse = await fetch(`${baseUrl}/__ripple/api/candidate/restore`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(restoredResponse.status).toBe(200)
    const restored = await restoredResponse.json() as { rawIntent: string; verificationContract: { pages: Array<{ pageRef: string; markerText: string }> }; candidate: { id: string; patchHash: string; diff: string; operations: unknown[] }; verification: { state: string; reason?: string } }
    expect(restored.rawIntent).toBe('Update the home hero while preserving other pages')
    expect(restored.verificationContract.pages).toEqual([{ pageRef: 'page:home', path: '/', markerText: 'Baseline title' }])
    expect(restored.candidate).toMatchObject({ id: candidate.candidate.id, patchHash: candidate.candidate.patchHash, diff: candidate.candidate.diff })
    expect(restored.candidate.operations).toHaveLength(2)
    expect(restored.verification).toMatchObject({ state: 'failed-to-run' })
    expect(restored.verification.reason).toMatch(/项目 node_modules/)
    const invalidContract = await fetch(`${baseUrl}/__ripple/api/candidate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({
      projectId: analysis.revision.projectId, rawIntent: 'Reject a remote browser path', scope,
      operations: [{ id: 'invalid-path-op', kind: 'TEXT', targetRef: title.id, before: title.value, after: 'Another title' }],
      verificationContract: { pages: [{ pageRef: 'page:home', path: 'https://attacker.invalid/', markerText: 'Home' }], interactions: [] },
    }) })
    expect(invalidContract.status).toBe(400)
    const discard = await fetch(`${baseUrl}/__ripple/api/discard`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(discard.status).toBe(200)
    expect((await discard.json()).removed).toBe(true)
    const missingRestore = await fetch(`${baseUrl}/__ripple/api/candidate/restore`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(missingRestore.status).toBe(404)
  }, 30_000)

  it('injects one explicit structured executor through Session and Candidate in the local API', async () => {
    const projectRoot = makeGitProject()
    const assetBytes = Buffer.from([0, 254, 11, 0, 123])
    const assetHash = createHash('sha256').update(assetBytes).digest('hex')
    const assetRef = 'public/assets/api-image.webp'
    type MediaOperation = Extract<StructuredEditOperation, { action: 'asset-swap' }>
    const executor: CandidateOperationExecutor<MediaOperation> = {
      kind: 'MEDIA', action: 'asset-swap',
      validate(value): value is MediaOperation {
        if (!value || typeof value !== 'object') return false
        const operation = value as Record<string, unknown>
        const payload = operation.payload as Record<string, unknown> | undefined
        return operation.kind === 'MEDIA' && operation.action === 'asset-swap' && !!payload && payload.assetRef === assetRef && payload.assetHash === assetHash
      },
      plan({ operation, target, readStagedAsset }) {
        return {
          sourceEdits: [{ path: target.location!.path, start: target.location!.start!, end: target.location!.end!, before: operation.before, after: operation.after }],
          fileWrites: [{ path: operation.payload.assetRef, bytes: readStagedAsset(operation.payload.assetHash) }],
        }
      },
    }
    await startApi({ candidateOperationExecutors: [executor], readStagedAsset: hash => hash === assetHash ? assetBytes : new Uint8Array() })
    const request = (route: string, body: unknown) => fetch(`${baseUrl}/__ripple/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) })
    const analysis = await (await request('analyze', { projectRoot })).json() as { revision: { projectId: string }; targets: Array<{ id: string; kind: string; value: string }>; routes: Array<{ id: string }> }
    const media = analysis.targets.find(target => target.kind === 'media')!
    const scope = { id: 'media-api-scope', version: 1, includedRefs: [analysis.routes[0].id, media.id], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const response = await request('candidate', {
      projectId: analysis.revision.projectId, rawIntent: 'Replace hero image', scope,
      operations: [{ id: 'media-api-op', kind: 'MEDIA', action: 'asset-swap', targetRef: media.id, before: media.value, after: '/assets/api-image.webp', payload: { assetRef, assetHash } }],
      verificationContract: { pages: [{ pageRef: analysis.routes[0].id, path: '/', markerText: 'Baseline title' }], interactions: [] },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { candidate: { id: string; diff: string; modifiedPaths: string[] }; verification: { state: string } }
    expect(body.candidate.diff).toContain('GIT binary patch')
    expect(body.candidate.modifiedPaths).toContain(assetRef)
    expect(body.verification.state).toBe('not-run')
    const discard = await request('discard', { candidateId: body.candidate.id })
    expect(discard.status).toBe(200)
  }, 30_000)

  it('holds a candidate operation lock until async verification or cleanup has finished', async () => {
    let releaseFirst!: () => void
    let enteredFirst!: () => void
    const entered = new Promise<void>(resolve => { enteredFirst = resolve })
    const first = withCandidateLock('candidate-concurrent-test', async () => {
      enteredFirst()
      await new Promise<void>(resolve => { releaseFirst = resolve })
      return 'finished'
    })
    await entered
    await expect(withCandidateLock('candidate-concurrent-test', async () => 'invalid concurrent result')).rejects.toThrow(/正在执行/)
    releaseFirst()
    await expect(first).resolves.toBe('finished')
    await expect(withCandidateLock('candidate-concurrent-test', async () => 'subsequent operation')).resolves.toBe('subsequent operation')
  })

  it('retires superseded and reanalyzed candidates without leaving Git worktrees behind', async () => {
    const projectRoot = makeGitProject()
    await startApi()
    const request = async (route: string, body: unknown) => fetch(`${baseUrl}/__ripple/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) })
    const worktreeCount = () => execFileSync('git', ['-C', projectRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.startsWith('worktree ')).length
    const analysisResponse = await request('analyze', { projectRoot })
    const analysis = await analysisResponse.json() as { revision: { projectId: string }; targets: Array<{ id: string; value: string; impact: { pageRefs: string[] } }> }
    const target = analysis.targets.find(item => item.value === 'Baseline title')!
    const makeCandidate = (previousCandidateId?: string) => request('candidate', {
      projectId: analysis.revision.projectId, rawIntent: 'Change the title', previousCandidateId,
      scope: { id: `scope-${crypto.randomUUID()}`, version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() },
      operations: [{ id: `op-${crypto.randomUUID()}`, kind: 'TEXT', targetRef: target.id, before: target.value, after: 'Replacement title' }],
    })
    const firstResponse = await makeCandidate()
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as { candidate: { id: string } }
    expect(worktreeCount()).toBe(2)

    const secondResponse = await makeCandidate(first.candidate.id)
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as { candidate: { id: string } }
    expect(worktreeCount()).toBe(2)
    expect((await request('discard', { candidateId: first.candidate.id })).status).toBe(404)

    const reanalysis = await request('analyze', { projectRoot, previousCandidateId: second.candidate.id })
    expect(reanalysis.status).toBe(200)
    expect(worktreeCount()).toBe(1)
    expect((await request('discard', { candidateId: second.candidate.id })).status).toBe(404)

    const currentAnalysis = await (await request('analyze', { projectRoot })).json() as { revision: { projectId: string }; targets: Array<{ id: string; value: string }> }
    const currentTarget = currentAnalysis.targets.find(item => item.value === 'Baseline title')!
    const staleResponse = await request('candidate', {
      projectId: currentAnalysis.revision.projectId, rawIntent: 'Change the title',
      scope: { id: 'scope-stale-source', version: 1, includedRefs: [currentTarget.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() },
      operations: [{ id: 'op-stale-source', kind: 'TEXT', targetRef: currentTarget.id, before: currentTarget.value, after: 'Candidate title' }],
    })
    const staleCandidate = await staleResponse.json() as { candidate: { id: string } }
    expect(staleResponse.status).toBe(200)
    expect(worktreeCount()).toBe(2)
    fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), `export function HomePage(){return <main><h1>Externally changed title</h1><button>Browse items</button></main>}`)
    expect((await request('candidate/restore', { candidateId: staleCandidate.candidate.id })).status).toBe(409)
    expect(worktreeCount()).toBe(1)
    expect((await request('discard', { candidateId: staleCandidate.candidate.id })).status).toBe(404)
  }, 30_000)

  it('restores the same candidate after an API process restart and keeps discarded audit artifacts', async () => {
    const projectRoot = makeGitProject()
    await startApi()
    const request = (route: string, body: unknown) => fetch(`${baseUrl}/__ripple/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) })
    const analysis = await (await request('analyze', { projectRoot })).json() as { revision: { projectId: string }; targets: Array<{ id: string; value: string }> }
    const target = analysis.targets.find(item => item.value === 'Baseline title')!
    const createdResponse = await request('candidate', {
      projectId: analysis.revision.projectId, rawIntent: 'Change title and retain the same patch through restart',
      scope: { id: 'scope-restart', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() },
      operations: [{ id: 'op-restart', kind: 'TEXT', targetRef: target.id, before: target.value, after: 'Persisted candidate title' }],
    })
    expect(createdResponse.status).toBe(200)
    const created = await createdResponse.json() as { sessionId: string; candidate: { id: string; patchHash: string; candidateTreeDigest: string; diff: string } }

    const storedPath = path.join(apiStateRoot, created.sessionId, 'session.json')
    const stored = JSON.parse(fs.readFileSync(storedPath, 'utf8')) as StoredCandidate
    const verificationRoot = path.join(apiStateRoot, created.sessionId, 'artifacts', 'verification', created.candidate.id, 'restart-run')
    fs.mkdirSync(verificationRoot, { recursive: true })
    const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
    const screenshotPath = path.join(verificationRoot, 'home.png')
    fs.writeFileSync(screenshotPath, screenshot)
    const artifactHash = createHash('sha256').update(screenshot).digest('hex')
    const assertions = REQUIRED_VERIFICATION_ASSERTION_IDS.map(id => ({ id, result: 'unknown' as const, detail: `${id} is not yet an automated product assertion` }))
    const viewport = { width: 1280, height: 800 }
    const run: VerificationRun = {
      id: 'verification-restart', candidateId: created.candidate.id, scopeDecisionId: stored.record.scopeDecisionId, scopeVersion: stored.record.scopeVersion,
      baseSourceDigest: stored.record.baseSourceDigest, patchHash: stored.record.patchHash, candidateTreeDigest: stored.record.candidateTreeDigest,
      runtimeFingerprint: stored.session.projectRevision.runtimeFingerprint, startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z',
      checks: [{ id: 'home-desktop', route: '/', viewport, state: 'loaded', description: 'home loaded', mandatory: true }], assertions,
      evidence: [{ id: 'evidence-restart', checkId: 'home-desktop', result: 'pass', capturedAt: '2026-10-18T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport, runtimeState: 'loaded', elementRefs: [], artifactPath: screenshotPath, artifactHash }], status: 'incomplete',
    }
    const recordPath = path.join(verificationRoot, 'execution.json')
    fs.writeFileSync(recordPath, JSON.stringify({
      schemaVersion: 4, executor: 'playwright', completed: true, runId: run.id, candidateId: run.candidateId,
      scopeDecisionId: run.scopeDecisionId, scopeVersion: run.scopeVersion, baseSourceDigest: run.baseSourceDigest,
      patchHash: run.patchHash, candidateTreeDigest: run.candidateTreeDigest, runtimeFingerprint: run.runtimeFingerprint,
      viewports: [{ name: 'restart', width: viewport.width, height: viewport.height }],
      checks: run.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: true })),
      assertions, evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })),
      artifacts: [{ checkId: 'home-desktop', path: path.basename(screenshotPath), sha256: artifactHash }],
    }))
    stored.session.runs.push(attestBrowserExecution(run, recordPath))
    fs.writeFileSync(storedPath, JSON.stringify(stored))

    await server?.close()
    server = undefined
    await startApi()
    const restoredResponse = await request('candidate/restore', { candidateId: created.candidate.id })
    expect(restoredResponse.status).toBe(200)
    const restored = await restoredResponse.json() as { candidate: { id: string; patchHash: string; candidateTreeDigest: string; diff: string }; verification: { state: string; runId?: string }; workflow: { lifecycle: string } }
    expect(restored.candidate).toMatchObject({ ...created.candidate, operations: expect.any(Array), modifiedPaths: expect.any(Array) })
    expect(restored.workflow.lifecycle).toBe('active')
    expect(restored.verification).toMatchObject({ state: 'incomplete', runId: 'verification-restart' })
    expect((await request('candidate/approve', { candidateId: created.candidate.id, runId: 'unverified-run' })).status).toBe(409)
    expect((await request('candidate/apply', { candidateId: created.candidate.id })).status).toBe(409)

    expect((await request('discard', { candidateId: created.candidate.id })).status).toBe(200)
    const historyResponse = await fetch(`${baseUrl}/__ripple/api/history?projectId=${encodeURIComponent(analysis.revision.projectId)}`, { headers: { origin: baseUrl } })
    expect(historyResponse.status).toBe(200)
    const history = await historyResponse.json() as { history: Array<{ candidateId: string; lifecycle: string; patchHash: string }> }
    expect(history.history).toContainEqual(expect.objectContaining({ candidateId: created.candidate.id, lifecycle: 'discarded', patchHash: created.candidate.patchHash }))
    expect(fs.readFileSync(path.join(apiStateRoot, created.sessionId, 'artifacts', `${created.candidate.id}.patch`), 'utf8')).toContain('Persisted candidate title')
  }, 30_000)

  it('rejects foreign origins, non-POST methods and dirty project roots', async () => {
    const projectRoot = makeGitProject()
    await startApi()
    expect((await fetch(`${baseUrl}/__ripple/api/analyze`, { headers: { origin: baseUrl } })).status).toBe(405)
    expect((await fetch(`${baseUrl}/__ripple/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://attacker.invalid' }, body: JSON.stringify({ projectRoot }) })).status).toBe(403)
    fs.writeFileSync(path.join(projectRoot, 'untracked.txt'), 'keep')
    const dirty = await fetch(`${baseUrl}/__ripple/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ projectRoot }) })
    expect(dirty.status).toBe(400)
    expect(fs.readFileSync(path.join(projectRoot, 'untracked.txt'), 'utf8')).toBe('keep')
  })

  it('previews the applied revision only by explicit candidate identity and keeps every other dirty-tree gate', async () => {
    const projectRoot = makeGitProject()
    await startApi()
    const request = (route: string, body: unknown) => fetch(`${baseUrl}/__ripple/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) })
    const analysis = await (await request('analyze', { projectRoot })).json() as { revision: { projectId: string }; targets: Array<{ id: string; value: string }> }
    const target = analysis.targets.find(item => item.value === 'Baseline title')!

    const cleanPreview = await request('project/preview', { projectId: analysis.revision.projectId })
    expect(cleanPreview.status).toBe(503)
    expect((await cleanPreview.json()).error).toMatch(/node_modules|Linux 容器/)
    const emptyIdentity = await request('project/preview', { projectId: analysis.revision.projectId, appliedCandidateId: '' })
    expect(emptyIdentity.status).toBe(400)
    const missingIdentity = await request('project/preview', { projectId: analysis.revision.projectId, appliedCandidateId: 'missing-candidate' })
    expect(missingIdentity.status).toBe(404)

    const createdResponse = await request('candidate', {
      projectId: analysis.revision.projectId, rawIntent: 'Change the title and preview the applied revision',
      scope: { id: 'scope-applied-preview', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() },
      operations: [{ id: 'op-applied-preview', kind: 'TEXT', targetRef: target.id, before: target.value, after: 'Applied preview title' }],
    })
    expect(createdResponse.status).toBe(200)
    const created = await createdResponse.json() as { sessionId: string; candidate: { id: string; patchHash: string; candidateTreeDigest: string; baseSourceDigest: string } }

    const storedPath = path.join(apiStateRoot, created.sessionId, 'session.json')
    const stored = JSON.parse(fs.readFileSync(storedPath, 'utf8')) as StoredCandidate
    const verificationRoot = path.join(apiStateRoot, created.sessionId, 'artifacts', 'verification', created.candidate.id, 'applied-preview-run')
    fs.mkdirSync(verificationRoot, { recursive: true })
    const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
    const screenshotPath = path.join(verificationRoot, 'home.png')
    fs.writeFileSync(screenshotPath, screenshot)
    const artifactHash = createHash('sha256').update(screenshot).digest('hex')
    const assertions = REQUIRED_VERIFICATION_ASSERTION_IDS.map(id => ({ id, result: 'unknown' as const, detail: `${id} is not exercised by this fixture` }))
    const viewport = { width: 1280, height: 800 }
    const run: VerificationRun = {
      id: 'verification-applied-preview', candidateId: created.candidate.id, scopeDecisionId: stored.record.scopeDecisionId, scopeVersion: stored.record.scopeVersion,
      baseSourceDigest: stored.record.baseSourceDigest, patchHash: stored.record.patchHash, candidateTreeDigest: stored.record.candidateTreeDigest,
      runtimeFingerprint: stored.session.projectRevision.runtimeFingerprint, startedAt: '2026-10-22T00:00:00Z', completedAt: '2026-10-22T00:01:00Z',
      checks: [{ id: 'home-desktop', route: '/', viewport, state: 'loaded', description: 'home loaded', mandatory: true }], assertions,
      evidence: [{ id: 'evidence-applied-preview', checkId: 'home-desktop', result: 'pass', capturedAt: '2026-10-22T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport, runtimeState: 'loaded', elementRefs: [], artifactPath: screenshotPath, artifactHash }], status: 'passed',
    }
    const recordPath = path.join(verificationRoot, 'execution.json')
    fs.writeFileSync(recordPath, JSON.stringify({
      schemaVersion: 4, executor: 'playwright', completed: true, runId: run.id, candidateId: run.candidateId,
      scopeDecisionId: run.scopeDecisionId, scopeVersion: run.scopeVersion, baseSourceDigest: run.baseSourceDigest,
      patchHash: run.patchHash, candidateTreeDigest: run.candidateTreeDigest, runtimeFingerprint: run.runtimeFingerprint,
      viewports: [{ name: 'applied-preview', width: viewport.width, height: viewport.height }],
      checks: run.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: true })),
      assertions, evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })),
      artifacts: [{ checkId: 'home-desktop', path: path.basename(screenshotPath), sha256: artifactHash }],
    }))
    stored.session.runs.push(attestBrowserExecution(run, recordPath))
    stored.session.status = 'verified'
    fs.writeFileSync(storedPath, JSON.stringify(stored))

    await server?.close()
    server = undefined
    await startApi()
    expect((await request('candidate/restore', { candidateId: created.candidate.id })).status).toBe(200)
    expect((await request('candidate/approve', { candidateId: created.candidate.id, runId: 'verification-applied-preview' })).status).toBe(200)
    expect((await request('candidate/apply', { candidateId: created.candidate.id })).status).toBe(200)
    const homePagePath = path.join(projectRoot, 'src', 'pages', 'HomePage.tsx')
    const appliedSource = fs.readFileSync(homePagePath, 'utf8')
    expect(appliedSource).toContain('Applied preview title')

    const dirtyPreview = await request('project/preview', { projectId: analysis.revision.projectId })
    expect(dirtyPreview.status).toBe(409)
    expect((await dirtyPreview.json()).error).toMatch(/工作树已发生修改/)
    const appliedPreview = await request('project/preview', { projectId: analysis.revision.projectId, appliedCandidateId: created.candidate.id })
    expect(appliedPreview.status).toBe(503)
    expect((await appliedPreview.json()).error).toMatch(/node_modules|Linux 容器/)

    fs.writeFileSync(homePagePath, `${appliedSource}\n// externally rewritten after apply\n`)
    const modifiedPreview = await request('project/preview', { projectId: analysis.revision.projectId, appliedCandidateId: created.candidate.id })
    expect(modifiedPreview.status).toBe(409)
    expect((await modifiedPreview.json()).error).toMatch(/拒绝预览/)
    fs.writeFileSync(homePagePath, appliedSource)

    fs.writeFileSync(path.join(projectRoot, 'unexpected.txt'), 'surprise')
    const untrackedPreview = await request('project/preview', { projectId: analysis.revision.projectId, appliedCandidateId: created.candidate.id })
    expect(untrackedPreview.status).toBe(409)
    expect((await untrackedPreview.json()).error).toMatch(/拒绝预览/)
    fs.rmSync(path.join(projectRoot, 'unexpected.txt'))

    expect((await request('candidate/rollback', { candidateId: created.candidate.id })).status).toBe(200)
    expect(fs.readFileSync(homePagePath, 'utf8')).toContain('Baseline title')
    expect(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')
    const rolledBackPreview = await request('project/preview', { projectId: analysis.revision.projectId, appliedCandidateId: created.candidate.id })
    expect(rolledBackPreview.status).toBe(409)
    expect((await rolledBackPreview.json()).error).toMatch(/已成功应用/)
    const cleanAgainPreview = await request('project/preview', { projectId: analysis.revision.projectId })
    expect(cleanAgainPreview.status).toBe(503)
    expect((await cleanAgainPreview.json()).error).toMatch(/node_modules|Linux 容器/)
  }, 90_000)
})
