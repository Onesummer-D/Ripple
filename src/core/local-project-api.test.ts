// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createServer, type ViteDevServer } from 'vite'
import { localProjectApiPlugin } from './local-project-api'

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
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react'; import { HomePage } from './pages/HomePage'; export function App(){const [page]=useState('home'); return <>{page === 'home' && <HomePage />}</>}`)
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
    const analysis = await response.json() as { revision: { projectId: string; sourceDigest: string }; graphId: string; routes: Array<{ id: string }>; targets: Array<{ id: string; label: string; value: string; impact: { pageRefs: string[]; unresolved: string[] } }> }
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
    }) })
    expect(candidateResponse.status).toBe(200)
    const candidate = await candidateResponse.json() as { candidate: { id: string; patchHash: string; candidateTreeDigest: string; operations: unknown[]; diff: string }; verification: { state: string } }
    expect(candidate.candidate.operations).toHaveLength(2)
    expect(candidate.candidate.diff).toContain('Candidate title')
    expect(candidate.candidate.diff).toContain('Explore items')
    expect(candidate.verification.state).toBe('not-run')
    expect(fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('Baseline title')
    const restoredResponse = await fetch(`${baseUrl}/__ripple/api/candidate/restore`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(restoredResponse.status).toBe(200)
    const restored = await restoredResponse.json() as { rawIntent: string; candidate: { id: string; patchHash: string; diff: string; operations: unknown[] } }
    expect(restored.rawIntent).toBe('Update the home hero while preserving other pages')
    expect(restored.candidate).toMatchObject({ id: candidate.candidate.id, patchHash: candidate.candidate.patchHash, diff: candidate.candidate.diff })
    expect(restored.candidate.operations).toHaveLength(2)
    const discard = await fetch(`${baseUrl}/__ripple/api/discard`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(discard.status).toBe(200)
    expect((await discard.json()).removed).toBe(true)
    const missingRestore = await fetch(`${baseUrl}/__ripple/api/candidate/restore`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ candidateId: candidate.candidate.id }) })
    expect(missingRestore.status).toBe(404)
  }, 30_000)

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
