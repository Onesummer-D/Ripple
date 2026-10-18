// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createServer, type ViteDevServer } from 'vite'
import { localProjectApiPlugin, withCandidateLock } from './local-project-api'
import { analyzeProject } from './project'
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

function makeGitProject(): string {
  const root = fs.mkdtempSync(path.join(tempParent, 'ripple-local-api-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'api-fixture', private: true }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `/* project supplied https://untrusted.invalid/pixel.png */ import { useState } from 'react'; import { HomePage } from './pages/HomePage'; export function App(){const [page]=useState('home'); return <>{page === 'home' && <HomePage />}</>}`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage(){return <main><h1>Baseline title</h1><button>Browse items</button></main>}`)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-test@example.invalid'); git('config', 'user.name', 'Ripple API test'); git('add', '.'); git('commit', '-qm', 'baseline')
  return root
}

async function startApi(): Promise<void> {
  server = await createServer({ configFile: false, logLevel: 'silent', plugins: [localProjectApiPlugin()], server: { host: '127.0.0.1', port: 0, strictPort: false } })
  await server.listen()
  const address = server.httpServer!.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await server?.close()
  server = undefined
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(apiStateRoot, { recursive: true, force: true })
})

describe('loopback Project API', () => {
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
      schemaVersion: 1, executor: 'playwright', completed: true, runId: run.id, candidateId: run.candidateId,
      scopeDecisionId: run.scopeDecisionId, scopeVersion: run.scopeVersion, baseSourceDigest: run.baseSourceDigest,
      patchHash: run.patchHash, candidateTreeDigest: run.candidateTreeDigest, runtimeFingerprint: run.runtimeFingerprint,
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
})
