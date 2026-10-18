import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { assertCandidateCurrent, CandidateError, createCandidate, removeCandidate } from './candidate'
import { analyzeProject, createRuntimeSourceMap, digestTrackedTree, readProjectSnapshot, resolveJsxSourceElement, resolveRuntimeElement, trackedProjectFiles } from './project'
import { sourceAnnotationPlugin } from './source-annotation'
import { sourceProvenPageImpact } from './scope'
import * as verificationApi from './verification'
import { applyApprovedCandidate, rollbackAppliedCandidate } from './apply'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from './session'
import type { EditOperation, ScopeDecision, VerificationRun } from './model'
import { attestBrowserExecution } from './verification-receipt'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-project-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })

function trustedRun(candidate: ReturnType<typeof createCandidate>, runtimeFingerprint: string, targetRef: string, artifactRoot: string): VerificationRun {
  fs.mkdirSync(artifactRoot, { recursive: true })
  const id = 'apply-run'
  const startedAt = '2026-10-18T00:00:00Z'
  const completedAt = '2026-10-18T00:01:00Z'
  const viewport = { width: 1280, height: 800 }
  const check = { id: 'home', route: '/', viewport, state: 'home-ready', description: 'Heading is visible', mandatory: true }
  const assertions = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors'].map(assertionId => ({ id: assertionId, passed: true, detail: `verified ${assertionId}` }))
  const artifactPath = path.join(artifactRoot, 'home.png')
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(artifactPath, screenshot)
  const run: VerificationRun = {
    id, candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
    candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint, startedAt, completedAt, checks: [check], assertions,
    evidence: [{ id: 'evidence-home', checkId: check.id, result: 'pass', capturedAt: '2026-10-18T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport, runtimeState: check.state, elementRefs: [targetRef], artifactPath, artifactHash: createHash('sha256').update(screenshot).digest('hex') }], status: 'incomplete',
  }
  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 1, executor: 'playwright', completed: true, runId: id, candidateId: candidate.id,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint, checks: [{ id: check.id, route: check.route, viewport, state: check.state, passed: true }], assertions,
    artifacts: [{ checkId: check.id, path: 'home.png', sha256: createHash('sha256').update(screenshot).digest('hex') }],
  }))
  return attestBrowserExecution(run, recordPath)
}

function sampleProject() {
  const container = temp()
  const root = path.join(container, 'site')
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', scripts: { build: 'vite build' } }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { Navigation } from './components/Navigation';\nimport { HomePage } from './pages/HomePage';\nimport { AutumnPage } from './pages/AutumnPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <><button aria-label="Home route" onClick={() => setCurrentPage('home')} /><button aria-label="Autumn route" onClick={() => setCurrentPage('autumn')} />{currentPage === 'home' && <><Navigation /><HomePage /></>}{currentPage === 'autumn' && <><Navigation /><AutumnPage /></>}</>; }`)
  fs.writeFileSync(path.join(root, 'src', 'components', 'Navigation.tsx'), `export function Navigation() { return <nav><a>Home</a></nav> }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage() {
      const product = { image: '/images/a.webp' };
      const unrelated = { image: '/images/unrelated.webp' };
  return (
    <main>
      <h1 className="text-ink-900">Home title</h1>
      <div><p>Nested child text</p></div>
      <img src={product.image} />
          <img src={unrelated.image} />
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
  it('keeps browser receipt issuance out of the public verification API', () => {
    expect('attestBrowserExecution' in verificationApi).toBe(false)
  })

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
    const imageEdges = graph.edges.filter(edge => edge.kind === 'asset-consumer' && edge.from.includes('HomePage'))
    expect(imageEdges).toHaveLength(2)
    expect(imageEdges.every(edge => edge.certainty === 'source-proven')).toBe(true)
    expect(new Set(imageEdges.map(edge => edge.to)).size).toBe(2)
    const homeElement = graph.nodes.find(node => node.kind === 'jsx-element' && node.location?.path === 'src/pages/HomePage.tsx' && node.label === '<h1>')
    expect(homeElement).toBeDefined()
    const selected = resolveJsxSourceElement(graph, homeElement!.id)
    expect(selected.editableText.map(node => node.label)).toEqual(['Home title'])
    const parentContainer = graph.nodes.find(node => node.kind === 'jsx-element' && node.location?.path === 'src/pages/HomePage.tsx' && node.label === '<div>')
    const nestedText = graph.nodes.find(node => node.kind === 'data' && node.label === 'Nested child text')
    const nestedParagraph = graph.nodes.find(node => node.kind === 'jsx-element' && node.location?.path === 'src/pages/HomePage.tsx' && node.label === '<p>')
    expect(resolveJsxSourceElement(graph, parentContainer!.id).editableText).toEqual([])
    expect(resolveJsxSourceElement(graph, nestedParagraph!.id).editableText.map(node => node.id)).toEqual([nestedText!.id])
    expect(snapshot.revision.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('adds runtime source references only to served JSX and keeps original project files untouched', async () => {
    const { root } = sampleProject()
    const file = path.join(root, 'src', 'pages', 'HomePage.tsx')
    const source = fs.readFileSync(file, 'utf8')
    const plugin = sourceAnnotationPlugin(root)
    if (!plugin.transform || typeof plugin.transform !== 'function') throw new Error('Expected a transform hook')
    const transformed = await Reflect.apply(plugin.transform, undefined, [source, file]) as { code?: string } | string | null
    const transformedCode = typeof transformed === 'object' && transformed && 'code' in transformed ? transformed.code : transformed
    expect(transformedCode).toContain(`data-ripple-source="jsx:src/pages/HomePage.tsx#${source.indexOf('<main>')}`)
    expect(transformedCode).toContain('data-ripple-instance={window.location.pathname +')
    expect(transformedCode).toContain('useId as __rippleUseId')
    expect(transformedCode).not.toContain('__rippleInstanceCounters')
    const graph = analyzeProject(root)
    const headingSource = graph.nodes.find(node => node.kind === 'jsx-element' && node.label === '<h1>')!
    const runtimeMap = createRuntimeSourceMap(graph, [{ sourceRef: headingSource.id, runtimeInstanceId: 'route:/home:card:42', certainty: 'stable-keyed-instance' }])
    expect(() => resolveRuntimeElement(graph, { sourceRef: headingSource.id, runtimeInstanceId: headingSource.id }, runtimeMap)).toThrow(/必须与 JSX/)
    expect(resolveRuntimeElement(graph, { sourceRef: headingSource.id, runtimeInstanceId: 'route:/home:card:42' }, runtimeMap).element.id).toBe(headingSource.id)
    expect(() => resolveRuntimeElement(graph, { sourceRef: 'jsx:src/pages/HomePage.tsx#0', runtimeInstanceId: 'route:/home:card:42' }, runtimeMap)).toThrow(/双向映射不匹配/)
    expect(() => createRuntimeSourceMap(graph, [{ sourceRef: headingSource.id, runtimeInstanceId: 'position-1', certainty: 'position-dependent' }])).not.toThrow()
    const positionalMap = createRuntimeSourceMap(graph, [{ sourceRef: headingSource.id, runtimeInstanceId: 'position-1', certainty: 'position-dependent' }])
    expect(() => resolveRuntimeElement(graph, { sourceRef: headingSource.id, runtimeInstanceId: 'position-1' }, positionalMap)).toThrow(/缺少稳定 key/)
    expect(() => resolveRuntimeElement(graph, { sourceRef: headingSource.id, runtimeInstanceId: 'route:/home:card:42' }, { ...runtimeMap, sourceDigest: 'old-source' })).toThrow(/不再对应/)
    expect(fs.readFileSync(file, 'utf8')).toBe(source)
  })

  it('injects stable-key identity into JSX without adding TypeScript-only syntax', async () => {
    const { root } = sampleProject()
    const file = path.join(root, 'src', 'pages', 'List.jsx')
    const source = `export const ProductList = ({ products }) => <ul>{products.map(product => <li key={product.id}><img src={product.image} />{product.name}</li>)}</ul>`
    const plugin = sourceAnnotationPlugin(root)
    if (!plugin.transform || typeof plugin.transform !== 'function') throw new Error('Expected a transform hook')
    const transformed = await Reflect.apply(plugin.transform, undefined, [source, file]) as { code?: string } | string | null
    const result = typeof transformed === 'object' && transformed && 'code' in transformed ? transformed.code! : String(transformed)
    expect(result).toContain(`data-ripple-source="jsx:src/pages/List.jsx#${source.indexOf('<ul>')}`)
    expect(result).toContain('data-ripple-list-key={String(product.id)}')
    expect(result).toContain('stable-react-instance')
    expect(result).toContain('String(product.id)')
    expect(result).not.toMatch(/\bas\s+(?:typeof|const|globalThis)\b/)
    expect(result).not.toMatch(/:\s*(?:string|number)\b/)
    expect(result).not.toContain('__rippleInstanceCounters')
  })

  it('marks unkeyed mapped elements as position-dependent instead of claiming stable identity', async () => {
    const { root } = sampleProject()
    const file = path.join(root, 'src', 'pages', 'List.jsx')
    const source = `export const ProductList = ({ products }) => <ul>{products.map(product => <li>{product.name}</li>)}</ul>`
    const plugin = sourceAnnotationPlugin(root)
    if (!plugin.transform || typeof plugin.transform !== 'function') throw new Error('Expected a transform hook')
    const transformed = await Reflect.apply(plugin.transform, undefined, [source, file]) as { code?: string } | string | null
    const result = typeof transformed === 'object' && transformed && 'code' in transformed ? transformed.code! : String(transformed)
    expect(result).toContain('position-dependent')
    expect(result).not.toContain('__rippleInstanceCounters')
  })

  it('rejects an execution record whose browser check is recorded as failed', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'scope-record', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation: EditOperation = { id: 'record-op', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Verified title' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-record'), artifactRoot: path.join(container, 'record-artifacts'), graph, scope, operations: [operation], candidateId: 'record-check' })
    const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'record-artifacts'))
    const recordPath = run.execution!.recordPath
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { checks: Array<{ passed: boolean }> }
    record.checks[0].passed = false
    fs.writeFileSync(recordPath, JSON.stringify(record))
    const session = openSession('record-session', graph.revision, 'Change one title')
    const staged = stageCandidate(stageOperations(chooseScope(recordSourceGraph(session, graph.id, graph.revision.sourceDigest), scope), [operation]), candidate)
    try {
      expect(() => registerVerification(staged, run)).toThrow(/execution checks do not match/i)
    } finally {
      removeCandidate(candidate)
    }
  })

  it('applies every in-scope operation to one isolated worktree without changing the original project', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const targets = graph.nodes.filter(node => node.kind === 'data')
    const includedRefs = [...targets.map(node => node.id), 'page:home', 'page:autumn']
    const scope: ScopeDecision = { id: 'scope-local-pages', version: 1, includedRefs, excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operations: EditOperation[] = targets.map((target, index) => ({ id: `text-${index}`, kind: 'TEXT', targetRef: target.id, before: target.value!, after: `Revised ${index}` }))
    const before = readProjectSnapshot(root).revision.sourceDigest
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate'), artifactRoot: path.join(container, 'artifacts'), graph, scope, operations, candidateId: 'two-edits' })
    try {
      expect(candidate.operations).toHaveLength(4)
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

  it('rejects a locally scoped edit when its source is consumed by an excluded page', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home')!
    const scope: ScopeDecision = {
      id: 'scope-local-nav', version: 1, includedRefs: [target.id, 'page:home'],
      excludedRefs: ['page:autumn'], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString(),
    }
    const operation: EditOperation = { id: 'local-nav', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Only home navigation' }
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-local-nav'), artifactRoot: path.join(container, 'local-nav-artifacts'), graph, scope, operations: [operation] })).toThrow(/影响 Scope 排除或保护的页面：page:autumn/)
    expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
  }, 15_000)

  it('stores a page-local override centrally while preserving the shared source value', async () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home')!
    expect(sourceProvenPageImpact(graph, target.id).pageRefs).toEqual(['page:autumn', 'page:home'])
    const scope: ScopeDecision = {
      id: 'scope-home-override', version: 1, strategy: 'page-override', localPageRef: 'page:home',
      includedRefs: [target.id, 'page:home'], excludedRefs: ['page:autumn'], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString(),
    }
    const operation: EditOperation = { id: 'local-nav-brand', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Home only brand' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-local-override'), artifactRoot: path.join(container, 'override-artifacts'), graph, scope, operations: [operation] })
    try {
      const patch = fs.readFileSync(candidate.artifactPath!, 'utf8')
      const navigation = fs.readFileSync(path.join(candidate.candidateRoot!, 'src', 'components', 'Navigation.tsx'), 'utf8')
      const registry = JSON.parse(fs.readFileSync(path.join(candidate.candidateRoot!, '.ripple', 'overrides.json'), 'utf8')) as { pages: Record<string, Record<string, string>> }
      expect(navigation).toContain('<RippleText')
      expect(navigation).not.toContain('Home only brand')
      expect(registry.pages['page:home'][target.id]).toBe('Home only brand')
      expect(fs.readFileSync(path.join(candidate.candidateRoot!, 'src', 'App.tsx'), 'utf8')).toContain('<RipplePageForState state={currentPage}')
      expect(patch).toContain('overrides-runtime.js')
      expect(candidate.modifiedPaths).toContain('.ripple/overrides.json')
      expect(candidate.candidateTreeDigest).not.toBe(candidate.baseSourceDigest)
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
      const dist = path.join(container, 'page-override-build')
      execFileSync(process.execPath, ['scripts/build-candidate-check.mjs', candidate.candidateRoot!, dist], { cwd: process.cwd(), stdio: 'pipe' })
      const builtJavaScript = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(dist, 'assets', file), 'utf8')).join('\n')
      expect(builtJavaScript).toContain('Home only brand')
      let session = recordSourceGraph(openSession('page-override-session', graph.revision, 'Change the shared label only on home'), graph.id, graph.revision.sourceDigest)
      session = stageCandidate(stageOperations(chooseScope(session, scope), candidate.operations), candidate)
      const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'override-evidence'))
      session = registerVerification(session, run)
      session = approve(session, { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-18T00:02:00Z' })
      session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))
      expect(digestTrackedTree(root, [...trackedProjectFiles(root), ...candidate.modifiedPaths])).toBe(candidate.candidateTreeDigest)
      expect(fs.existsSync(path.join(root, '.ripple', 'overrides.json'))).toBe(true)
      rollbackAppliedCandidate(session, candidate)
      expect(fs.existsSync(path.join(root, '.ripple', 'overrides.json'))).toBe(false)
      expect(digestTrackedTree(root)).toBe(graph.revision.sourceDigest)
    } finally { removeCandidate(candidate) }
  }, 15_000)

  it('applies the exact approved patch to the project and rolls back only that unchanged result', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'scope-apply', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation: EditOperation = { id: 'apply-title', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Exact approved title' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-apply'), artifactRoot: path.join(container, 'apply-artifacts'), graph, scope, operations: [operation], candidateId: 'apply-rollback' })
    try {
      let session = recordSourceGraph(openSession('apply-session', graph.revision, 'Update the home title'), graph.id, graph.revision.sourceDigest)
      session = chooseScope(session, scope)
      session = stageCandidate(stageOperations(session, candidate.operations), candidate)
      const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'evidence'))
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
