import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import { assertCandidateCurrent, assertCandidateIntegrity, CandidateError, createCandidate, removeCandidate } from './candidate'
import type { CandidateOperationExecutor } from './candidate-operation-executors'
import { analyzeProject, createRuntimeSourceMap, digestTrackedTree, readProjectSnapshot, resolveJsxSourceElement, resolveRuntimeElement, trackedProjectFiles } from './project'
import { sourceAnnotationPlugin } from './source-annotation'
import { expectedTextForPage, sourceProvenPageImpact } from './scope'
import * as verificationApi from './verification'
import { applyApprovedCandidate, isAppliedCandidateRollbackable, rollbackAppliedCandidate } from './apply'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from './session'
import type { BrowserVerificationContract, EditOperation, ScopeDecision, VerificationRun } from './model'
import { attestBrowserExecution } from './verification-receipt'
import { sourceBindings } from './verification-runner'
import { verificationContractHash } from './verification-contract'
import { inspectProjectCapabilities } from './project-capabilities'
import { resolveProjectConfigGraph, toViteAliasRules } from './project-config-resolver.mjs'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-project-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })

function contractFor(scope: ScopeDecision): BrowserVerificationContract {
  const pageRefs = [...scope.includedRefs, ...scope.excludedRefs, ...scope.protectedRefs].filter(ref => ref.startsWith('page:'))
  const pages = [...new Set(pageRefs)].map(pageRef => ({
    pageRef,
    path: '/',
    markerText: pageRef === 'page:autumn' ? 'Autumn page' : 'Home page',
    ...(pageRef === 'page:autumn' ? { navigateBy: { role: 'button' as const, name: 'Autumn route' } } : {}),
  }))
  return { pages, interactions: [{ pageRef: 'page:home', role: 'button', name: 'Home route', expectedText: 'Home page' }] }
}

function trustedRun(candidate: ReturnType<typeof createCandidate>, runtimeFingerprint: string, targetRef: string, artifactRoot: string, scope: ScopeDecision): VerificationRun {
  fs.mkdirSync(artifactRoot, { recursive: true })
  const id = 'apply-run'
  const startedAt = '2026-10-18T00:00:00Z'
  const completedAt = '2026-10-18T00:01:00Z'
  const viewport = { width: 1280, height: 800 }
  const contract = contractFor(scope)
  const check = { id: 'home', route: '/', viewport, state: 'home-ready', description: 'Heading is visible', mandatory: true }
  const assertions = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors'].map(assertionId => ({ id: assertionId, result: 'pass' as const, detail: `verified ${assertionId}` }))
  const artifactPath = path.join(artifactRoot, 'home.png')
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(artifactPath, screenshot)
  const baselineSnapshot = `<main>${targetRef}</main>`
  const comparisonPath = path.join(artifactRoot, 'comparison.json')
  const comparisonBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, route: '/', viewport, baselineSnapshot, candidateSnapshot: baselineSnapshot, maskedOperationIds: ['test-operation'] }))
  fs.writeFileSync(comparisonPath, comparisonBytes)
  const comparisonDigest = createHash('sha256').update(baselineSnapshot).digest('hex')
  const baselineComparisons = [{ route: '/', viewport, baselineDigest: comparisonDigest, candidateDigest: comparisonDigest, maskedOperationIds: ['test-operation'], matched: true, artifactPath: comparisonPath, artifactHash: createHash('sha256').update(comparisonBytes).digest('hex') }]
  const scopeObservations = contract.pages.map(page => ({ pageRef: page.pageRef, route: page.path, viewport, markerText: page.markerText, baselineMarkerVisible: true, candidateMarkerVisible: true, baselineMarkerMatchCount: 1, candidateMarkerMatchCount: 1, baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const, operations: candidate.operations.map(operation => {
    const source = { value: operation.before }
    const expectation = expectedTextForPage(source, operation, scope, page.pageRef)
    return { operationId: operation.id, expectedBaselineText: expectation.baselineText, expectedCandidateText: expectation.candidateText, baselineValues: [expectation.baselineText], candidateValues: [expectation.candidateText] }
  }) }))
  const interactionObservations = [{ interactionIndex: 0, pageRef: 'page:home', route: '/', viewport, role: 'button' as const, name: 'Home route', expectedText: 'Home page', baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const, baselinePassed: true, candidatePassed: true }]
  const run: VerificationRun = {
    id, candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint, startedAt, completedAt, checks: [check], assertions,
    verificationContractHash: verificationContractHash(contract),
    evidence: [{ id: 'evidence-home', checkId: check.id, result: 'pass', capturedAt: '2026-10-18T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport, runtimeState: check.state, elementRefs: [targetRef], artifactPath, artifactHash: createHash('sha256').update(screenshot).digest('hex') }], baselineComparisons, scopeObservations, interactionObservations, status: 'incomplete',
  }
  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 4, executor: 'playwright', completed: true, runId: id, candidateId: candidate.id,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint, verificationContractHash: verificationContractHash(contract), viewports: [{ name: 'desktop', width: viewport.width, height: viewport.height }], checks: [{ id: check.id, route: check.route, viewport, state: check.state, passed: true }],
    baselineComparisons: [{ ...baselineComparisons[0], artifactPath: path.basename(comparisonPath) }], scopeObservations, interactionObservations, assertions,
    evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })),
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

type MediaSwapOperation = Extract<EditOperation, { action: 'asset-swap' }>

function mediaSwapFixture(graph: ReturnType<typeof analyzeProject>) {
  const target = graph.nodes.find(node => node.kind === 'media' && node.location?.path === 'src/pages/HomePage.tsx' && node.value === '/images/a.webp')!
  const bytes = Buffer.from([0, 255, 17, 0, 128, 42, 9])
  const assetHash = createHash('sha256').update(bytes).digest('hex')
  const assetRef = 'public/media/product-new.webp'
  const operation: MediaSwapOperation = {
    id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
    before: target.value!, after: '/media/product-new.webp',
    payload: { assetRef, assetHash },
  }
  const scope: ScopeDecision = {
    id: 'media-scope', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [],
    decidedBy: 'test-user', decidedAt: new Date().toISOString(),
  }
  const executor: CandidateOperationExecutor<MediaSwapOperation> = {
    kind: 'MEDIA', action: 'asset-swap',
    validate(value): value is MediaSwapOperation {
      if (!value || typeof value !== 'object') return false
      const candidate = value as Record<string, unknown>
      const payload = candidate.payload as Record<string, unknown> | undefined
      return candidate.kind === 'MEDIA' && candidate.action === 'asset-swap' &&
        typeof candidate.before === 'string' && typeof candidate.after === 'string' &&
        !!payload && payload.assetRef === assetRef && payload.assetHash === assetHash
    },
    plan({ operation: current, target: sourceTarget, readStagedAsset }) {
      return {
        sourceEdits: [{ path: sourceTarget.location!.path, start: sourceTarget.location!.start!, end: sourceTarget.location!.end!, before: current.before, after: current.after }],
        fileWrites: [{ path: current.payload.assetRef, bytes: readStagedAsset(current.payload.assetHash) }],
      }
    },
  }
  const readStagedAsset = (expectedHash: string) => expectedHash === assetHash ? bytes : new Uint8Array()
  return { target, bytes, assetHash, assetRef, operation, scope, executor, executors: [executor], readStagedAsset }
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

  it('reports bounded project capabilities from arbitrary referenced and extended app config names', () => {
    const { root } = sampleProject()
    fs.mkdirSync(path.join(root, 'tooling'), { recursive: true })
    fs.mkdirSync(path.join(root, 'configs'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { react: '19.0.0', 'react-dom': '19.0.0' } }))
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: 'tooling/react-site.config.json' }] }))
    fs.writeFileSync(path.join(root, 'configs', 'shared-aliases.json'), JSON.stringify({ compilerOptions: { baseUrl: '..', jsx: 'react-jsx', paths: { '@/*': ['src/*'] } } }))
    fs.writeFileSync(path.join(root, 'tooling', 'react-site.config.json'), JSON.stringify({ extends: '../configs/shared-aliases.json', include: ['../src'] }))
    fs.writeFileSync(path.join(root, 'vite.config.ts'), 'throw new Error("must not execute")')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'add arbitrary referenced app config')

    const graph = analyzeProject(root)
    const capabilities = inspectProjectCapabilities(root, graph, 'linux')
    expect(capabilities).toMatchObject({
      schemaVersion: 'ripple-project-capabilities/v1',
      sourceDigest: graph.revision.sourceDigest,
      framework: { status: 'supported', value: 'react-dom-spa' },
      entry: { status: 'supported', value: { modules: ['src/main.tsx'], pageCount: 2 } },
      typescriptAliases: { status: 'supported', value: { configPath: path.join(root, 'tooling', 'react-site.config.json') } },
      devPreview: { status: 'supported', value: { adapter: 'ripple-bounded-react-vite' } },
      projectViteConfig: { status: 'unsupported', value: { loaded: false } },
      productionBuild: { status: 'unsupported', value: { executed: false } },
      serverRendering: { status: 'unsupported', value: { executed: false } },
    })
    expect(capabilities.typescriptAliases.value?.rules).toEqual([{ pattern: '@/*', target: path.join(root, 'src', '*') }])
    const aliasGraph = resolveProjectConfigGraph(root, ts)
    const viteAlias = toViteAliasRules(aliasGraph)
    expect(viteAlias).toHaveLength(1)
    expect(viteAlias[0].find).toBeInstanceOf(RegExp)
    expect((viteAlias[0].find as RegExp).test('@/components/Navigation')).toBe(true)

    fs.writeFileSync(path.join(root, 'configs', 'shared-aliases.json'), JSON.stringify({ compilerOptions: { baseUrl: '..', jsx: 'react-jsx', paths: { '@/*': ['src/*', 'other/*'] } } }))
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'make aliases ambiguous')
    const ambiguous = inspectProjectCapabilities(root, analyzeProject(root), 'linux')
    expect(ambiguous.typescriptAliases.status).toBe('ambiguous')
    expect(ambiguous.devPreview.status).toBe('ambiguous')
  })

  it('retains valid TypeScript source aliases when the bounded Vite adapter cannot reproduce their fallback', () => {
    const { root } = sampleProject()
    const appPath = path.join(root, 'src', 'App.tsx')
    fs.writeFileSync(appPath, fs.readFileSync(appPath, 'utf8').replace("'./components/Navigation'", "'components/Navigation'"))
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', baseUrl: '.', paths: { '*': ['src/*'] } }, include: ['src'] }))
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'use application alias with TypeScript fallback')
    const graph = analyzeProject(root)
    expect(graph.edges.some(edge => edge.kind === 'imports' && edge.from === 'file:src/App.tsx' && edge.to === 'file:src/components/Navigation.tsx')).toBe(true)
    const navigation = graph.nodes.find(node => node.kind === 'component' && node.label === 'Navigation')!
    expect(navigation.pages?.sort()).toEqual(['autumn', 'home'])
    expect(inspectProjectCapabilities(root, graph, 'linux').typescriptAliases.status).toBe('ambiguous')
  })

  it('proves component token use but keeps imported CSS token usage unknown without cascade evidence', () => {
    const { root } = sampleProject()
    const homePath = path.join(root, 'src', 'pages', 'HomePage.tsx')
    const aboutPath = path.join(root, 'src', 'pages', 'AutumnPage.tsx')
    fs.mkdirSync(path.join(root, 'src', 'styles'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'styles', 'a-theme.css'), ':root { --unused-accent: #123; --brand-accent: #456; }')
    fs.writeFileSync(path.join(root, 'src', 'styles', 'z-card.css'), '.home-card { color: var(--brand-accent); }')
    const homeSource = fs.readFileSync(homePath, 'utf8')
    expect(homeSource).not.toContain('home-card')
    fs.writeFileSync(homePath, `import '../styles/a-theme.css';\nimport '../styles/z-card.css';\n${homeSource}`)
    fs.writeFileSync(aboutPath, `import '../styles/a-theme.css';\n${fs.readFileSync(aboutPath, 'utf8')}`)
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'add CSS token import without matching selector')

    const graph = analyzeProject(root)
    const unused = graph.nodes.find(node => node.kind === 'token' && node.label === '--unused-accent')!
    const importedCssToken = graph.nodes.find(node => node.kind === 'token' && node.label === '--brand-accent')!
    const jsxToken = graph.nodes.find(node => node.kind === 'token' && node.label === 'ink.900')!

    expect(sourceProvenPageImpact(graph, unused.id)).toMatchObject({
      pageRefs: [], certainty: 'unknown',
    })
    expect(sourceProvenPageImpact(graph, importedCssToken.id)).toMatchObject({
      pageRefs: [], certainty: 'unknown',
    })
    expect(graph.edges.some(edge => edge.kind === 'uses-token' && edge.to === importedCssToken.id && graph.nodes.find(node => node.id === edge.from)?.kind === 'file')).toBe(true)
    expect(sourceProvenPageImpact(graph, jsxToken.id)).toMatchObject({
      pageRefs: ['page:home'], certainty: 'source-proven', unresolved: [],
    })
  })

  it('does not execute a structured action through the literal candidate replacement path', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'structured-edit', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation = {
      id: 'structured-text', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Literal fallback must not run',
      action: 'asset-swap', payload: { assetRef: 'assets/unused.webp', assetHash: 'a'.repeat(64) },
    } as unknown as EditOperation
    const candidateRoot = path.join(container, 'structured-candidate')
    expect(() => createCandidate({ projectRoot: root, candidateRoot, artifactRoot: path.join(container, 'structured-artifacts'), graph, scope, operations: [operation] })).toThrow(CandidateError)
    expect(fs.existsSync(candidateRoot)).toBe(false)
    expect(fs.readFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('Home title')
  })

  it('executes a registered structured operation as one binary patch and applies then rolls back those exact bytes', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const fixture = mediaSwapFixture(graph)
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'media-candidate'), artifactRoot: path.join(container, 'media-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: fixture.executors, readStagedAsset: fixture.readStagedAsset })
    try {
      expect(candidate.modifiedPaths).toContain(fixture.assetRef)
      const patch = fs.readFileSync(candidate.artifactPath!, 'utf8')
      expect(patch).toContain('GIT binary patch')
      expect(patch).toContain('src/pages/HomePage.tsx')
      expect(fs.readFileSync(path.join(candidate.candidateRoot!, fixture.assetRef))).toEqual(fixture.bytes)
      assertCandidateCurrent(candidate)

      let session = recordSourceGraph(openSession('structured-apply-session', graph.revision, 'Replace the product image', [], contractFor(fixture.scope)), graph.id, graph.revision.sourceDigest)
      session = stageOperations(chooseScope(session, fixture.scope), [fixture.operation], fixture.executors)
      session = stageCandidate(session, candidate)
      const run = trustedRun(candidate, graph.revision.runtimeFingerprint, fixture.target.id, path.join(container, 'media-evidence'), fixture.scope)
      session = approve(registerVerification(session, run), { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-19T00:02:00Z' })
      session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))
      expect(fs.readFileSync(path.join(root, fixture.assetRef))).toEqual(fixture.bytes)
      expect(digestTrackedTree(root, [...trackedProjectFiles(root), fixture.assetRef])).toBe(candidate.candidateTreeDigest)
      expect(fs.readFileSync(path.join(root, fixture.target.location!.path), 'utf8')).toContain(fixture.operation.after)

      rollbackAppliedCandidate(session, candidate)
      expect(fs.existsSync(path.join(root, fixture.assetRef))).toBe(false)
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
      expect(fs.readFileSync(path.join(root, fixture.target.location!.path), 'utf8')).toContain(fixture.operation.before)
    } finally { removeCandidate(candidate) }
  }, 30_000)

  it('fails closed for unknown, malformed and protected structured actions before the executor can plan writes', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const fixture = mediaSwapFixture(graph)
    let planned = 0
    const executor = { ...fixture.executor, plan: (input: Parameters<typeof fixture.executor.plan>[0]) => { planned += 1; return fixture.executor.plan(input) } }
    const candidateRoot = path.join(container, 'rejected-structured-candidate')
    const request = { projectRoot: root, candidateRoot, artifactRoot: path.join(container, 'rejected-structured-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: [executor], readStagedAsset: fixture.readStagedAsset }
    const unknown = { ...fixture.operation, action: 'unregistered' } as unknown as EditOperation
    expect(() => createCandidate({ ...request, operations: [unknown] })).toThrow(CandidateError)
    const malformed = { ...fixture.operation, payload: { ...fixture.operation.payload, assetHash: 'bad' } } as unknown as EditOperation
    expect(() => createCandidate({ ...request, operations: [malformed] })).toThrow(CandidateError)
    const protectedScope = { ...fixture.scope, protectedRefs: [fixture.target.id] }
    expect(() => createCandidate({ ...request, scope: protectedScope })).toThrow(CandidateError)
    expect(planned).toBe(0)
    expect(fs.existsSync(candidateRoot)).toBe(false)
    expect(fs.readFileSync(path.join(root, fixture.target.location!.path), 'utf8')).toContain(fixture.operation.before)
  })

  it('detects binary worktree tampering, patch artifact tampering and unregistered candidate writes', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const fixture = mediaSwapFixture(graph)
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'tamper-candidate'), artifactRoot: path.join(container, 'tamper-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: fixture.executors, readStagedAsset: fixture.readStagedAsset })
    try {
      const output = path.join(candidate.candidateRoot!, fixture.assetRef)
      fs.writeFileSync(output, Buffer.from([1, 2, 3]))
      expect(() => assertCandidateIntegrity(candidate)).toThrow(/候选代码或补丁哈希已变化/)
      fs.writeFileSync(output, fixture.bytes)
      assertCandidateIntegrity(candidate)

      const originalPatch = fs.readFileSync(candidate.artifactPath!)
      fs.writeFileSync(candidate.artifactPath!, Buffer.concat([originalPatch, Buffer.from('tamper')]))
      expect(() => assertCandidateIntegrity(candidate)).toThrow(/候选补丁哈希已变化/)
      fs.writeFileSync(candidate.artifactPath!, originalPatch)
      assertCandidateIntegrity(candidate)

      fs.writeFileSync(path.join(candidate.candidateRoot!, 'unregistered.txt'), 'not in CandidatePatch')
      expect(() => assertCandidateIntegrity(candidate)).toThrow(/未经记录的文件变更/)
    } finally { removeCandidate(candidate) }
  }, 30_000)

  it('rejects staged asset input whose bytes do not match the requested SHA-256', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const fixture = mediaSwapFixture(graph)
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'bad-input-candidate'), artifactRoot: path.join(container, 'bad-input-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: fixture.executors, readStagedAsset: () => Buffer.from([9, 8, 7]) })).toThrow(/暂存资产字节与 SHA-256 不匹配/)
    expect(fs.existsSync(path.join(container, 'bad-input-candidate'))).toBe(false)
    expect(fs.existsSync(path.join(root, fixture.assetRef))).toBe(false)
  })

  it('rejects structured source drift and candidate-relative path escape before writing', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const fixture = mediaSwapFixture(graph)
    const driftExecutor: CandidateOperationExecutor<MediaSwapOperation> = {
      ...fixture.executor,
      plan(input) {
        const plan = fixture.executor.plan(input)
        return { ...plan, sourceEdits: plan.sourceEdits?.map(edit => ({ ...edit, before: 'stale source' })) }
      },
    }
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'drift-candidate'), artifactRoot: path.join(container, 'drift-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: [driftExecutor], readStagedAsset: fixture.readStagedAsset })).toThrow(/源码已漂移/)

    const escapeExecutor: CandidateOperationExecutor<MediaSwapOperation> = {
      ...fixture.executor,
      plan(input) {
        const plan = fixture.executor.plan(input)
        return { ...plan, fileWrites: plan.fileWrites?.map(write => ({ ...write, path: '../escape.webp' })) }
      },
    }
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'escape-candidate'), artifactRoot: path.join(container, 'escape-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: [escapeExecutor], readStagedAsset: fixture.readStagedAsset })).toThrow(/相对路径|越界/)
    expect(fs.existsSync(path.join(container, 'escape.webp'))).toBe(false)

    const overwriteExecutor: CandidateOperationExecutor<MediaSwapOperation> = {
      ...fixture.executor,
      plan(input) {
        const plan = fixture.executor.plan(input)
        return { ...plan, fileWrites: plan.fileWrites?.map(write => ({ ...write, path: 'src/pages/AutumnPage.tsx' })) }
      },
    }
    const protectedPage = fs.readFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), 'utf8')
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'overwrite-candidate'), artifactRoot: path.join(container, 'overwrite-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: [overwriteExecutor], readStagedAsset: fixture.readStagedAsset })).toThrow(/只允许新增文件/)
    expect(fs.readFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), 'utf8')).toBe(protectedPage)
  })

  it.skipIf(process.platform === 'win32')('rejects structured output paths that traverse a project symlink', () => {
    const { container, root } = sampleProject()
    const outside = path.join(container, 'outside')
    fs.mkdirSync(path.join(root, 'public'), { recursive: true })
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(root, 'public', 'linked'), 'dir')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'add output symlink')
    const graph = analyzeProject(root)
    const fixture = mediaSwapFixture(graph)
    const symlinkExecutor: CandidateOperationExecutor<MediaSwapOperation> = {
      ...fixture.executor,
      plan(input) {
        const plan = fixture.executor.plan(input)
        return { ...plan, fileWrites: plan.fileWrites?.map(write => ({ ...write, path: 'public/linked/escape.webp' })) }
      },
    }
    expect(() => createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'symlink-candidate'), artifactRoot: path.join(container, 'symlink-artifacts'), graph, scope: fixture.scope, operations: [fixture.operation], executors: [symlinkExecutor], readStagedAsset: fixture.readStagedAsset })).toThrow(/符号链接/)
    expect(fs.readdirSync(outside)).toEqual([])
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
    expect(() => resolveRuntimeElement(graph, { sourceRef: headingSource.id, runtimeInstanceId: 'position-1' }, positionalMap)).toThrow(/身份不稳定/)
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
    // Tightened (task D round 2): the key is evaluated once where it was written and its
    // value captured; annotation never repeats `product.id` (getters/Proxies could run).
    // The key value itself is never read by annotation: host ids defer it to the collector.
    expect(result).toContain('+ ":~"')
    expect(result).not.toContain('data-ripple-list-key')
    expect(result).toContain('stable-react-instance')
    expect(result.match(/product\.id/g)).toHaveLength(source.match(/product\.id/g)!.length)
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
    expect(result).toMatch(/products\.map\(\(product, __rippleIndex\d+\)\s*=>/)
    expect(result).toContain('String(__rippleIndex')
    expect(result).not.toMatch(/\bas\s+(?:typeof|const|globalThis)\b/)
    expect(result).not.toContain('__rippleInstanceCounters')
  })

  it('rejects an execution record whose browser check is recorded as failed', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'scope-record', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation: EditOperation = { id: 'record-op', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Verified title' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-record'), artifactRoot: path.join(container, 'record-artifacts'), graph, scope, operations: [operation], candidateId: 'record-check' })
    const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'record-artifacts'), scope)
    const recordPath = run.execution!.recordPath
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { checks: Array<{ passed: boolean }> }
    record.checks[0].passed = false
    fs.writeFileSync(recordPath, JSON.stringify(record))
    const session = openSession('record-session', graph.revision, 'Change one title', [], contractFor(scope))
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
    const evidenceRoot = path.join(path.dirname(candidate.artifactPath!), 'verification', candidate.id)
    try {
      fs.mkdirSync(path.join(evidenceRoot, 'run-1'), { recursive: true })
      fs.writeFileSync(path.join(evidenceRoot, 'run-1', 'execution.json'), '{}')
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
    expect(fs.existsSync(evidenceRoot)).toBe(false)
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
      const registry = JSON.parse(fs.readFileSync(path.join(candidate.candidateRoot!, '.ripple', 'overrides.json'), 'utf8')) as { schemaVersion: number; targets: Record<string, { original: string }>; pages: Record<string, Record<string, string>> }
      const stableTargetId = Object.keys(registry.targets)[0]
      expect(navigation).toContain('<RippleText')
      expect(stableTargetId).toMatch(/^override:[\da-f-]{36}$/i)
      expect(navigation).toContain(`targetRef="${stableTargetId}"`)
      expect(navigation).not.toContain('Home only brand')
      expect(registry.schemaVersion).toBe(2)
      expect(registry.targets[stableTargetId].original).toBe(target.value)
      expect(registry.pages['page:home'][stableTargetId]).toBe('Home only brand')
      expect(fs.readFileSync(path.join(candidate.candidateRoot!, 'src', 'App.tsx'), 'utf8')).toContain('<RipplePageForState state={currentPage}')
      expect(patch).toContain('overrides-runtime.js')
      expect(candidate.modifiedPaths).toContain('.ripple/overrides.json')
      expect(candidate.operationTargetRefs[operation.id]).toBe(stableTargetId)
      expect(candidate.candidateTreeDigest).not.toBe(candidate.baseSourceDigest)
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
      const dist = path.join(container, 'page-override-build')
      execFileSync(process.execPath, ['scripts/build-candidate-check.mjs', candidate.candidateRoot!, dist], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, RIPPLE_BUILD_ONLY: '1' } })
      const builtJavaScript = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(dist, 'assets', file), 'utf8')).join('\n')
      expect(builtJavaScript).toContain('Home only brand')
      let session = recordSourceGraph(openSession('page-override-session', graph.revision, 'Change the shared label only on home', [], contractFor(scope)), graph.id, graph.revision.sourceDigest)
      session = stageCandidate(stageOperations(chooseScope(session, scope), candidate.operations), candidate)
      const candidateGraph = analyzeProject(candidate.candidateRoot!, false)
      const binding = sourceBindings(candidate, graph, candidateGraph, session)[0]
      expect(binding.expectedText).toBe(operation.after)
      expect(binding.beforeText).toBe(operation.before)
      expect(binding.pageExpectations['page:home']).toMatchObject({ baselineText: operation.before, candidateText: operation.after, shouldChange: true })
      expect(binding.pageExpectations['page:autumn']).toMatchObject({ baselineText: target.value, candidateText: target.value, shouldChange: false })
      expect(binding.baselineSourceRefs).toHaveLength(1)
      expect(binding.sourceRefs).toHaveLength(1)
      expect(binding.sourceRefs[0]).toMatch(/^jsx:src\/components\/Navigation\.tsx#/)
      const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'override-evidence'), scope)
      session = registerVerification(session, run)
      session = approve(session, { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-18T00:02:00Z' })
      session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))
      expect(digestTrackedTree(root, [...trackedProjectFiles(root), ...candidate.modifiedPaths])).toBe(candidate.candidateTreeDigest)
      expect(fs.existsSync(path.join(root, '.ripple', 'overrides.json'))).toBe(true)
      expect(isAppliedCandidateRollbackable(session, candidate)).toBe(true)
      rollbackAppliedCandidate(session, candidate)
      expect(fs.existsSync(path.join(root, '.ripple', 'overrides.json'))).toBe(false)
      expect(digestTrackedTree(root)).toBe(graph.revision.sourceDigest)
    } finally { removeCandidate(candidate) }
  }, 60_000)

  it('binds removal of the final page override to its restored shared JSX text', () => {
    const { container, root } = sampleProject()
    const firstGraph = analyzeProject(root)
    const sharedTarget = firstGraph.nodes.find(node => node.kind === 'data' && node.location?.path === 'src/components/Navigation.tsx' && node.value?.trim() === 'Home')!
    const firstScope: ScopeDecision = {
      id: 'scope-create-removal-binding', version: 1, strategy: 'page-override', localPageRef: 'page:home',
      includedRefs: [sharedTarget.id, 'page:home'], excludedRefs: ['page:autumn'], protectedRefs: [],
      decidedBy: 'test-user', decidedAt: new Date().toISOString(),
    }
    const firstOperation: EditOperation = { id: 'create-removal-binding', kind: 'TEXT', targetRef: sharedTarget.id, before: sharedTarget.value!, after: 'Home maintained' }
    const firstCandidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-create-removal-binding'), artifactRoot: path.join(container, 'create-removal-artifacts'), graph: firstGraph, scope: firstScope, operations: [firstOperation] })
    let removalCandidate: ReturnType<typeof createCandidate> | undefined
    try {
      let firstSession = recordSourceGraph(openSession('create-removal-session', firstGraph.revision, 'Create a home-only text override', [], contractFor(firstScope)), firstGraph.id, firstGraph.revision.sourceDigest)
      firstSession = stageCandidate(stageOperations(chooseScope(firstSession, firstScope), firstCandidate.operations), firstCandidate)
      firstSession = approve(registerVerification(firstSession, trustedRun(firstCandidate, firstGraph.revision.runtimeFingerprint, sharedTarget.id, path.join(container, 'create-removal-evidence'), firstScope)), {
        candidateId: firstCandidate.id, verificationRunId: 'apply-run', by: 'test-user', at: '2026-10-18T00:02:00Z',
      })
      applyApprovedCandidate(firstSession, firstCandidate)
      git(root, 'add', '-A')
      git(root, 'commit', '-qm', 'apply home-only override')

      const graph = analyzeProject(root)
      const existingOverride = graph.nodes.find(node => node.kind === 'data' && node.pageOverrides?.['page:home'] === 'Home maintained')!
      const scope: ScopeDecision = {
        id: 'scope-remove-binding', version: 1, strategy: 'page-override', localPageRef: 'page:home',
        includedRefs: [existingOverride.id, 'page:home'], excludedRefs: ['page:autumn'], protectedRefs: [],
        decidedBy: 'test-user', decidedAt: new Date().toISOString(),
      }
      const operation: EditOperation = { id: 'remove-binding', kind: 'TEXT', targetRef: existingOverride.id, before: existingOverride.value!, after: existingOverride.value!, overrideAction: 'remove' }
      removalCandidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-remove-binding'), artifactRoot: path.join(container, 'remove-artifacts'), graph, scope, operations: [operation] })
      let session = recordSourceGraph(openSession('remove-binding-session', graph.revision, 'Remove this page override', [], contractFor(scope)), graph.id, graph.revision.sourceDigest)
      session = stageCandidate(stageOperations(chooseScope(session, scope), removalCandidate.operations), removalCandidate)
      const binding = sourceBindings(removalCandidate, graph, analyzeProject(removalCandidate.candidateRoot!, false), session)[0]
      expect(binding.baselineSourceRefs).toHaveLength(1)
      expect(binding.sourceRefs).toHaveLength(1)
      expect(binding.pageExpectations['page:home']).toMatchObject({ baselineText: 'Home maintained', candidateText: 'Home', shouldChange: true })
      expect(binding.pageExpectations['page:autumn']).toMatchObject({ baselineText: 'Home', candidateText: 'Home', shouldChange: false })
    } finally {
      if (removalCandidate) removeCandidate(removalCandidate)
      removeCandidate(firstCandidate)
    }
  }, 30_000)

  it('applies the exact approved patch to the project and rolls back only that unchanged result', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'scope-apply', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation: EditOperation = { id: 'apply-title', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Exact approved title' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-apply'), artifactRoot: path.join(container, 'apply-artifacts'), graph, scope, operations: [operation], candidateId: 'apply-rollback' })
    try {
      let session = recordSourceGraph(openSession('apply-session', graph.revision, 'Update the home title', [], contractFor(scope)), graph.id, graph.revision.sourceDigest)
      session = chooseScope(session, scope)
      session = stageCandidate(stageOperations(session, candidate.operations), candidate)
      const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'evidence'), scope)
      session = registerVerification(session, run)
      session = approve(session, { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-18T00:02:00Z' })

      const applied = applyApprovedCandidate(session, candidate, '2026-10-18T00:03:00Z')
      session = recordAppliedRevision(session, applied)
      expect(session.status).toBe('applied')
      expect(readProjectSnapshot(root, false).revision.sourceDigest).toBe(candidate.candidateTreeDigest)
      expect(fs.readFileSync(path.join(root, target.location!.path), 'utf8')).toContain('Exact approved title')
      expect(isAppliedCandidateRollbackable(session, candidate)).toBe(true)

      rollbackAppliedCandidate(session, candidate)
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
      expect(fs.readFileSync(path.join(root, target.location!.path), 'utf8')).toContain('Home title')
    } finally {
      removeCandidate(candidate)
    }
  }, 15_000)

  it('refuses rollback after a user adds a new edit to the applied project', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'data' && node.label === 'Home title')!
    const scope: ScopeDecision = { id: 'scope-rollback-conflict', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: new Date().toISOString() }
    const operation: EditOperation = { id: 'rollback-conflict-title', kind: 'TEXT', targetRef: target.id, before: target.value!, after: 'Approved title' }
    const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'candidate-rollback-conflict'), artifactRoot: path.join(container, 'rollback-conflict-artifacts'), graph, scope, operations: [operation], candidateId: 'rollback-conflict' })
    try {
      let session = recordSourceGraph(openSession('rollback-conflict-session', graph.revision, 'Update title', [], contractFor(scope)), graph.id, graph.revision.sourceDigest)
      session = stageCandidate(stageOperations(chooseScope(session, scope), candidate.operations), candidate)
      const run = trustedRun(candidate, graph.revision.runtimeFingerprint, target.id, path.join(container, 'rollback-conflict-evidence'), scope)
      session = approve(registerVerification(session, run), { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-18T00:02:00Z' })
      session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))
      fs.writeFileSync(path.join(root, 'user-added.txt'), 'user data')
      expect(isAppliedCandidateRollbackable(session, candidate)).toBe(false)
      fs.unlinkSync(path.join(root, 'user-added.txt'))
      const appliedFile = path.join(root, target.location!.path)
      fs.appendFileSync(appliedFile, '\n// user edit after Ripple application\n')
      expect(isAppliedCandidateRollbackable(session, candidate)).toBe(false)
      expect(() => rollbackAppliedCandidate(session, candidate)).toThrow(/拒绝回滚/)
      expect(fs.readFileSync(appliedFile, 'utf8')).toContain('Approved title')
      expect(fs.readFileSync(appliedFile, 'utf8')).toContain('user edit after Ripple application')
    } finally { removeCandidate(candidate) }
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
