import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { assertCandidateCurrent, CandidateError, createCandidate, removeCandidate } from './candidate'
import { analyzeProject, readProjectSnapshot, resolveRenderedElement } from './project'
import { sourceAnnotationPlugin } from './source-annotation'
import { applyApprovedCandidate, rollbackAppliedCandidate } from './apply'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate } from './session'
import type { EditOperation, ScopeDecision, VerificationRun } from './model'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-project-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })

function sampleProject() {
  const container = temp()
  const root = path.join(container, 'site')
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', scripts: { build: 'vite build' } }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { Navigation } from './components/Navigation';\nimport { HomePage } from './pages/HomePage';\nimport { AutumnPage } from './pages/AutumnPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <><Navigation />{currentPage === 'home' && <HomePage />}{currentPage === 'autumn' && <AutumnPage />}</>; }`)
  fs.writeFileSync(path.join(root, 'src', 'components', 'Navigation.tsx'), `export function Navigation() { return <nav><a>Home</a></nav> }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage() {
  const product = { image: '/images/a.webp' };
  return (
    <main>
      <h1 className="text-ink-900">Home title</h1>
      <img src={product.image} />
    </main>
  );
}`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), `export function AutumnPage() { return <main><h1>Autumn title</h1></main> }`)
  fs.writeFileSync(path.join(root, 'tailwind.config.js'), `export default { theme: { extend: { colors: { ink: { 900: '#1a1611' } } } } }`)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return { container, root }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('real project graph and candidate executor', () => {
  it('reads a clean Git project, proves page/component consumers and resolves a rendered host element to source text', () => {
    const { root } = sampleProject()
    const snapshot = readProjectSnapshot(root)
    const graph = analyzeProject(root)
    const pages = graph.nodes.filter(node => node.kind === 'route').map(node => node.page).sort()
    expect(pages).toEqual(['autumn', 'home'])
    const navigation = graph.nodes.find(node => node.kind === 'component' && node.label === 'Navigation')
    expect(navigation?.pages?.sort()).toEqual(['autumn', 'home'])
    const palette = graph.nodes.find(node => node.kind === 'token' && node.label === 'ink.900')
    expect(palette?.value).toBe('#1a1611')
    expect(graph.edges.some(edge => edge.kind === 'uses-token' && edge.to === palette?.id)).toBe(true)
    expect(graph.edges.some(edge => edge.kind === 'asset-consumer' && edge.from.includes('HomePage'))).toBe(true)
    const homeElement = graph.nodes.find(node => node.kind === 'dom-instance' && node.location?.path === 'src/pages/HomePage.tsx' && node.label === '<h1>')
    expect(homeElement).toBeDefined()
    const selected = resolveRenderedElement(graph, homeElement!.id)
    expect(selected.editableText.map(node => node.label)).toEqual(['Home title'])
    expect(snapshot.revision.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('adds runtime source references only to served JSX and keeps original project files untouched', async () => {
    const { root } = sampleProject()
    const file = path.join(root, 'src', 'pages', 'HomePage.tsx')
    const source = fs.readFileSync(file, 'utf8')
    const plugin = sourceAnnotationPlugin(root)
    if (!plugin.transform || typeof plugin.transform !== 'function') throw new Error('Expected a transform hook')
    const transformed = await Reflect.apply(plugin.transform, undefined, [source, file]) as { code?: string } | string | null
    expect(typeof transformed === 'object' && transformed && 'code' in transformed ? transformed.code : transformed).toContain(`data-ripple-source="jsx:src/pages/HomePage.tsx#${source.indexOf('<main>')}`)
    expect(fs.readFileSync(file, 'utf8')).toBe(source)
  })

  it('applies every in-scope operation to one isolated worktree without changing the original project', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const targets = graph.nodes.filter(node => node.kind === 'data')
    const includedRefs = targets.map(node => node.id)
    const scope: ScopeDecision = { id: 'scope-local-pages', version: 1, includedRefs, excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operations: EditOperation[] = targets.map((target, index) => ({ id: `text-${index}`, kind: 'TEXT', targetRef: target.id, before: target.value!, after: `Revised ${index}` }))
    const before = readProjectSnapshot(root).revision.sourceDigest
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate'), artifactRoot: path.join(container, 'artifacts'), graph, scope, operations, candidateId: 'two-edits' })
    try {
      expect(candidate.operations).toHaveLength(3)
      expect(fs.readFileSync(candidate.artifactPath!, 'utf8')).toContain('Revised 0')
      expect(fs.readFileSync(candidate.artifactPath!, 'utf8')).toContain('Revised 1')
      expect(candidate.candidateTreeDigest).not.toBe(candidate.baseSourceDigest)
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(before)
      assertCandidateCurrent(candidate)
      const targetPath = path.join(candidate.candidateRoot!, candidate.modifiedPaths[0])
      fs.appendFileSync(targetPath, '\n')
      expect(() => assertCandidateCurrent(candidate)).toThrow(/哈希已变化/)
    } finally {
      removeCandidate(candidate)
    }
  }, 15_000)

  it('applies the exact approved patch to the project and rolls back only that unchanged result', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'scope-apply', version: 1, includedRefs: [target.id], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation: EditOperation = { id: 'apply-title', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Exact approved title' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-apply'), artifactRoot: path.join(container, 'apply-artifacts'), graph, scope, operations: [operation], candidateId: 'apply-rollback' })
    try {
      let session = recordSourceGraph(openSession('apply-session', graph.revision, 'Update the home title'), graph.id, graph.revision.sourceDigest)
      session = chooseScope(session, scope)
      session = stageCandidate(session, candidate)
      const run: VerificationRun = {
        id: 'apply-run', candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
        candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint: graph.revision.runtimeFingerprint,
        startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z', status: 'incomplete',
        checks: [{ id: 'home', route: '/', viewport: { width: 1280, height: 800 }, state: 'home-ready', description: 'Heading is visible', mandatory: true }],
        evidence: [{ id: 'evidence-home', checkId: 'home', result: 'pass', capturedAt: '2026-10-18T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport: { width: 1280, height: 800 }, runtimeState: 'home-ready', elementRefs: [target.id], artifactPath: 'evidence/home.png', artifactHash: 'b'.repeat(64) }],
      }
      session = registerVerification(session, run)
      session = approve(session, { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-18T00:02:00Z' })

      const applied = applyApprovedCandidate(session, candidate, '2026-10-18T00:03:00Z')
      session = recordAppliedRevision(session, applied)
      expect(session.status).toBe('applied')
      expect(readProjectSnapshot(root, false).revision.sourceDigest).toBe(candidate.candidateTreeDigest)
      expect(fs.readFileSync(path.join(root, target.location!.path), 'utf8')).toContain('Exact approved title')

      rollbackAppliedCandidate(session, candidate)
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
      expect(fs.readFileSync(path.join(root, target.location!.path), 'utf8')).toContain('Home title')
    } finally {
      removeCandidate(candidate)
    }
  }, 15_000)

  it('rejects a dirty baseline and rejects protected targets before creating a worktree', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data')!
    const operation: EditOperation = { id: 'protected-edit', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'changed' }
    const scope: ScopeDecision = { id: 'scope-protected', version: 1, includedRefs: [target.id], excludedRefs: [], protectedRefs: [target.id], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'protected'), artifactRoot: path.join(container, 'artifacts'), graph, scope, operations: [operation] })).toThrow(CandidateError)
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'preserve')
    expect(() => readProjectSnapshot(root)).toThrow(/不干净/)
    expect(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8')).toBe('preserve')
  }, 15_000)
})
