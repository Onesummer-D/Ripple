import { expect, test } from '@playwright/test'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from '../src/core/session'
import { applyApprovedCandidate } from '../src/core/apply'
import { createCandidate, removeCandidate, type CandidateRecord } from '../src/core/candidate'
import { analyzeProject } from '../src/core/project'
import type { BrowserVerificationContract, EditOperation, EditSession, InteractionObservation, ScopeDecision, ScopePropagationObservation, SourceGraph, SourceNode, VerificationRun } from '../src/core/model'
import { startCandidateBaseline, startCandidatePreview, startHostRelay, stopCandidateBaseline, stopCandidatePreview } from '../src/core/candidate-preview'
import { attestBrowserExecution } from '../src/core/verification-receipt'
import { sourceBindings } from '../src/core/verification-runner'
import { verificationContractHash } from '../src/core/verification-contract'

const dockerAvailable = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0
const fixtureRoot = path.join(process.cwd(), 'node_modules', '.tmp')
fs.mkdirSync(fixtureRoot, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(fixtureRoot, 'ripple-override-lifecycle-'))
const projectRoot = path.join(sandbox, 'site')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence-overrides')
const candidates: CandidateRecord[] = []
const previews = new Set<string>()
const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim()
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function createFixture(): void {
  fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\ndist/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'ripple-page-override-lifecycle', private: true, type: 'module' }))
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.jsx"></script>')
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.jsx'), "import React from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<App />)\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.jsx'), `import { useState } from 'react';
import { Navigation } from './components/Navigation.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { AutumnPage } from './pages/AutumnPage.jsx';
export function App() {
  const [currentPage, setCurrentPage] = useState('home');
  return <><button onClick={() => setCurrentPage('home')}>Home route</button><button onClick={() => setCurrentPage('autumn')}>Autumn route</button>{currentPage === 'home' && <><Navigation /><HomePage /></>}{currentPage === 'autumn' && <><Navigation /><AutumnPage /></>}</>
}
`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'components', 'Navigation.jsx'), `export function Navigation() { return <nav aria-label="Primary"><a href="#home">Home</a><a href="#products">Products</a></nav> }
`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), `import { useState } from 'react';
export function HomePage() { const [count, setCount] = useState(0); return <main><h1>Home page</h1><button onClick={() => setCount(count + 1)}>Clicks {count}</button></main> }
`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'AutumnPage.jsx'), `export function AutumnPage() { return <main><h1>Autumn page</h1></main> }
`)
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  execFileSync('git', ['-C', projectRoot, 'init', '-q'], { stdio: 'pipe' })
  git('config', 'user.email', 'ripple-override@example.invalid')
  git('config', 'user.name', 'Ripple lifecycle test')
  git('add', '.')
  git('commit', '-qm', 'fixture baseline')
}

function target(graph: SourceGraph, value: string): SourceNode {
  const matches = graph.nodes.filter(node => node.kind === 'data' && node.location?.path === 'src/components/Navigation.jsx' && node.value?.trim() === value)
  expect(matches, `unique shared navigation text ${value}`).toHaveLength(1)
  return matches[0]
}

async function createOverrideCandidate(graph: SourceGraph, node: SourceNode, after: string, id: string, action?: 'remove') {
  const localPageRef = 'page:home'
  const routes = graph.nodes.filter(item => item.kind === 'route')
  expect(routes.map(route => route.id).sort()).toEqual(['page:autumn', 'page:home'])
  const scope: ScopeDecision = {
    id: `scope-${id}`, version: 1, strategy: 'page-override', localPageRef,
    includedRefs: [node.id, localPageRef], excludedRefs: routes.filter(route => route.id !== localPageRef).map(route => route.id),
    protectedRefs: [], decidedBy: 'playwright-lifecycle-test', decidedAt: new Date().toISOString(),
  }
  const operation: EditOperation = { id: `operation-${id}`, kind: 'TEXT', targetRef: node.id, before: node.value!, after, ...(action ? { overrideAction: action } : {}) }
  const candidate = createCandidate({ projectRoot, candidateRoot: path.join(sandbox, `candidate-${id}`), artifactRoot: path.join(sandbox, 'patches'), graph, scope, operations: [operation], candidateId: `candidate-${id}` })
  candidates.push(candidate)
  const verificationContract: BrowserVerificationContract = {
    pages: [
      { pageRef: 'page:home', path: '/', markerText: 'Home page' },
      { pageRef: 'page:autumn', path: '/', markerText: 'Autumn page', navigateBy: { role: 'button', name: 'Autumn route' } },
    ],
    interactions: [{ pageRef: 'page:home', role: 'button', name: 'Clicks 0', expectedText: 'Clicks 1' }],
  }
  let session = recordSourceGraph(openSession(`session-${id}`, graph.revision, `Maintain a home-only page override for ${node.label}`, [], verificationContract), graph.id, graph.revision.sourceDigest)
  session = chooseScope(session, scope)
  session = stageOperations(session, [operation])
  session = stageCandidate(session, candidate)
  return { candidate, operation, scope, session }
}

async function snapshotOutsideTargets(page: import('@playwright/test').Page, bindings: ReturnType<typeof sourceBindings>, baseline: boolean, baselinePageRef?: string) {
  const specs = bindings.map(binding => ({
    operationId: binding.operationId,
    sourceRefs: baseline ? binding.baselineSourceRefs : binding.sourceRefs,
    text: baseline
      ? binding.baselineTextByPage[baselinePageRef ?? ''] ?? (new Set(Object.values(binding.baselineTextByPage)).size === 1 ? Object.values(binding.baselineTextByPage)[0] : '')
      : binding.expectedText,
  }))
  return page.evaluate(specs => {
    const root = document.querySelector('#root')
    if (!root) return { ok: false as const, reason: 'The rendered application root is missing.' }
    const clone = root.cloneNode(true) as Element
    const elements = [clone, ...Array.from(clone.querySelectorAll('*'))].filter(node => node instanceof Element)
    const maskedOperationIds: string[] = []
    for (const spec of specs) {
      if (spec.sourceRefs.length !== 1 || !spec.text.trim()) return { ok: false as const, reason: `Source binding for ${spec.operationId} is not unique.` }
      const targets = elements.filter(element => element.getAttribute('data-ripple-source') === spec.sourceRefs[0])
      if (!targets.length) return { ok: false as const, reason: `Source target for ${spec.operationId} is not rendered.` }
      let matchedInstances = 0
      for (const target of targets) {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
        const matches: Node[] = []
        while (walker.nextNode()) if ((walker.currentNode.textContent ?? '').trim() === spec.text.trim()) matches.push(walker.currentNode)
        if (matches.length) matchedInstances += 1
        for (const node of matches) node.textContent = `__RIPPLE_TARGET_${spec.operationId}__`
      }
      if (matchedInstances !== targets.length) return { ok: false as const, reason: `Not every rendered instance of ${spec.operationId} contains the expected target text.` }
      maskedOperationIds.push(spec.operationId)
    }
    for (const element of elements) for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-ripple-')) element.removeAttribute(attribute.name)
    }
    for (const input of Array.from(clone.querySelectorAll('input,textarea,select'))) {
      if (input instanceof HTMLInputElement) input.setAttribute('value', input.value)
      else if (input instanceof HTMLTextAreaElement) input.textContent = input.value
      else if (input instanceof HTMLSelectElement) input.setAttribute('data-ripple-selected-index', String(input.selectedIndex))
    }
    return { ok: true as const, snapshot: clone.outerHTML, maskedOperationIds }
  }, specs)
}

async function verifyPreview(page: import('@playwright/test').Page, candidate: CandidateRecord, session: EditSession, expectedHome: string[], expectedAutumn: string[], evidenceId: string): Promise<VerificationRun> {
  const startedAt = new Date().toISOString()
  const preview = await startCandidatePreview(candidate)
  previews.add(candidate.id)
  const baseGraph = analyzeProject(projectRoot, false)
  const candidateGraph = analyzeProject(candidate.candidateRoot!, false)
  const bindings = sourceBindings(candidate, baseGraph, candidateGraph, session)
  const checks: VerificationRun['checks'] = []
  const evidence: VerificationRun['evidence'] = []
  const baselineComparisons: NonNullable<VerificationRun['baselineComparisons']> = []
  const scopeObservations: ScopePropagationObservation[] = []
  const interactionObservations: InteractionObservation[] = []
  const browserErrors: string[] = []
  const onPageError = (error: Error) => browserErrors.push(error.message)
  const onConsole = (message: import('@playwright/test').ConsoleMessage) => { if (message.type() === 'error') browserErrors.push(message.text()) }
  page.on('pageerror', onPageError)
  page.on('console', onConsole)
  let baseline: Awaited<ReturnType<typeof startCandidateBaseline>> | undefined
  let baselineRelay: Awaited<ReturnType<typeof startHostRelay>> | undefined
  let baselinePage: import('@playwright/test').Page | undefined
  try {
    baseline = await startCandidateBaseline(candidate, preview)
    baselineRelay = await startHostRelay(baseline.address)
    baselinePage = await page.context().newPage()
    baselinePage.on('pageerror', onPageError)
    baselinePage.on('console', onConsole)
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await baselinePage.setViewportSize(viewport)
      await baselinePage.goto(baselineRelay.url)
      await page.goto(preview.url)
      await expect(baselinePage.getByRole('heading', { name: 'Home page' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Home page' })).toBeVisible()
      for (const value of expectedHome) await expect(page.getByText(value, { exact: true })).toBeVisible()
      const mapped = page.locator('[data-ripple-source^="jsx:src/components/Navigation.jsx#"]').first()
      expect(await mapped.getAttribute('data-ripple-source')).toMatch(/^jsx:src\/components\/Navigation\.jsx#\d+$/)
      expect(await mapped.getAttribute('data-ripple-instance')).toBeTruthy()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
      const [baselineSnapshot, candidateSnapshot] = await Promise.all([
        snapshotOutsideTargets(baselinePage, bindings, true, session.verificationContract?.pages.find(spec => spec.path === '/' && !spec.navigateBy)?.pageRef),
        snapshotOutsideTargets(page, bindings, false),
      ])
      if (!baselineSnapshot.ok) throw new Error(baselineSnapshot.reason)
      if (!candidateSnapshot.ok) throw new Error(candidateSnapshot.reason)
      const baselineDigest = sha256(Buffer.from(baselineSnapshot.snapshot))
      const candidateDigest = sha256(Buffer.from(candidateSnapshot.snapshot))
      const comparisonPath = path.join(evidenceRoot, `${evidenceId}-home-${viewport.width}-baseline.json`)
      const comparisonBytes = Buffer.from(JSON.stringify({
        schemaVersion: 1, route: '/', viewport, baselineSnapshot: baselineSnapshot.snapshot, candidateSnapshot: candidateSnapshot.snapshot,
        maskedOperationIds: baselineSnapshot.maskedOperationIds,
      }, null, 2))
      fs.mkdirSync(path.dirname(comparisonPath), { recursive: true })
      fs.writeFileSync(comparisonPath, comparisonBytes)
      baselineComparisons.push({
        route: '/', viewport, baselineDigest, candidateDigest, maskedOperationIds: baselineSnapshot.maskedOperationIds,
        matched: baselineDigest === candidateDigest, artifactPath: comparisonPath, artifactHash: sha256(comparisonBytes),
      })
      expect(baselineDigest, 'the candidate changed DOM outside the uniquely mapped text target').toBe(candidateDigest)
      for (const spec of session.verificationContract!.pages) {
        await baselinePage.goto(baselineRelay.url)
        await page.goto(preview.url)
        if (spec.navigateBy) {
          await baselinePage.getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true }).click()
          await page.getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true }).click()
        }
        const baselineMarkerVisible = await baselinePage.getByText(spec.markerText, { exact: true }).first().isVisible()
        const candidateMarkerVisible = await page.getByText(spec.markerText, { exact: true }).first().isVisible()
        expect(baselineMarkerVisible && candidateMarkerVisible).toBe(true)
        const operations = await Promise.all(bindings.map(async binding => {
          const read = async (targetPage: import('@playwright/test').Page, sourceRefs: string[]) => sourceRefs.length === 1
            ? targetPage.locator('[data-ripple-source]').evaluateAll((elements, sourceRef) => elements.filter(element => element.getAttribute('data-ripple-source') === sourceRef).map(element => (element.textContent ?? '').trim()), sourceRefs[0])
            : []
          const [baselineValues, candidateValues] = await Promise.all([read(baselinePage!, binding.baselineSourceRefs), read(page, binding.sourceRefs)])
          return { operationId: binding.operationId, expectedBaselineText: binding.baselineTextByPage[spec.pageRef] ?? '', baselineValues, candidateValues }
        }))
        scopeObservations.push({ pageRef: spec.pageRef, route: spec.path, viewport, markerText: spec.markerText, baselineMarkerVisible, candidateMarkerVisible, operations })
        if (spec.pageRef === 'page:home') {
          for (const value of expectedHome) await expect(page.getByText(value, { exact: true })).toBeVisible()
        } else {
          for (const value of expectedAutumn) await expect(page.getByText(value, { exact: true })).toBeVisible()
          for (const value of expectedHome) if (!['Home', 'Products'].includes(value)) await expect(page.getByText(value, { exact: true })).toHaveCount(0)
        }
      }
      await baselinePage.goto(baselineRelay.url)
      await page.goto(preview.url)
      await baselinePage.getByRole('button', { name: 'Clicks 0', exact: true }).click()
      await page.getByRole('button', { name: 'Clicks 0', exact: true }).click()
      const [baselineInteraction, candidateInteraction] = await Promise.all([
        baselinePage.getByText('Clicks 1', { exact: true }).isVisible(), page.getByText('Clicks 1', { exact: true }).isVisible(),
      ])
      interactionObservations.push({ interactionIndex: 0, pageRef: 'page:home', route: '/', viewport, role: 'button', name: 'Clicks 0', expectedText: 'Clicks 1', baselinePassed: baselineInteraction, candidatePassed: candidateInteraction })
      expect(baselineInteraction && candidateInteraction).toBe(true)
      await page.goto(preview.url)
      const checkId = `${evidenceId}-home-${viewport.width}`
      checks.push({ id: checkId, route: '/', viewport, state: `home-ready-${viewport.width}`, description: 'Target navigation values, non-target preservation, source mapping and responsive layout', mandatory: true })
      const screenshotPath = path.join(evidenceRoot, `${checkId}.png`)
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
      await page.screenshot({ path: screenshotPath, fullPage: true })
      evidence.push({ id: `evidence-${checkId}`, checkId, result: 'pass', capturedAt: new Date().toISOString(), pageUrl: preview.url, viewport, runtimeState: `home-ready-${viewport.width}`, elementRefs: [candidate.operations[0].targetRef], artifactPath: screenshotPath, artifactHash: sha256(fs.readFileSync(screenshotPath)) })
    }
    expect(browserErrors, 'the candidate preview emitted browser errors').toEqual([])
  } finally {
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
    await baselinePage?.close()
    if (baselineRelay) {
      baselineRelay.server.closeAllConnections()
      await new Promise<void>(resolve => baselineRelay!.server.close(() => resolve()))
    }
    if (baseline) await stopCandidateBaseline(baseline)
    await stopCandidatePreview(candidate.id)
    previews.delete(candidate.id)
  }

  const assertions: VerificationRun['assertions'] = [
    { id: 'target-change', result: 'pass', detail: 'Playwright asserted each intended navigation value in the candidate DOM.' },
    { id: 'non-target-preserved', result: 'pass', detail: 'Playwright navigated to the non-target route and asserted baseline shared labels.' },
    { id: 'scope-propagation', result: 'pass', detail: 'Home override changed only the included page; autumn retained the shared source text.' },
    { id: 'interaction', result: 'pass', detail: 'Route switching and the home counter event handler worked.' },
    { id: 'responsive-layout', result: 'pass', detail: 'No horizontal overflow at 1440, 768, and 390 pixel viewports.' },
    { id: 'source-mapping', result: 'pass', detail: 'Runtime DOM source annotation resolves to Navigation.jsx and has an instance identity.' },
    { id: 'browser-errors', result: 'pass', detail: 'Playwright observed no page errors or console errors.' },
  ]
  const completedAt = new Date().toISOString()
  const runId = `playwright-${evidenceId}`
  const recordPath = path.join(evidenceRoot, `${evidenceId}.json`)
  const artifacts = evidence.map(item => ({ checkId: item.checkId, path: path.basename(item.artifactPath!), sha256: item.artifactHash! }))
  const record = {
    schemaVersion: 1, executor: 'playwright' as const, completed: true, runId, candidateId: candidate.id,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint: analyzeProject(projectRoot).revision.runtimeFingerprint,
    verificationContractHash: verificationContractHash(session.verificationContract),
    checks: checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: true })), assertions,
    baselineComparisons: baselineComparisons.map(comparison => ({ ...comparison, artifactPath: path.basename(comparison.artifactPath!) })),
    scopeObservations, interactionObservations,
    evidence: evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })), artifacts,
  }
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2))
  const run: VerificationRun = {
    id: runId, candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint: record.runtimeFingerprint,
    verificationContractHash: verificationContractHash(session.verificationContract), startedAt, completedAt,
    checks, assertions, evidence, baselineComparisons, scopeObservations, interactionObservations, status: 'incomplete',
  }
  return attestBrowserExecution(run, recordPath)
}

async function applyAndCommit(candidate: CandidateRecord, operation: EditOperation, sessionInput: Awaited<ReturnType<typeof createOverrideCandidate>>['session'], page: import('@playwright/test').Page, expectedHome: string[], expectedAutumn: string[], cycle: string): Promise<string> {
  const run = await verifyPreview(page, candidate, sessionInput, expectedHome, expectedAutumn, cycle)
  let session = registerVerification(sessionInput, run)
  session = approve(session, { candidateId: candidate.id, verificationRunId: run.id, by: 'playwright-lifecycle-test', at: new Date().toISOString() })
  session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))
  expect(session.applied?.appliedPatchHash).toBe(candidate.patchHash)
  await stopCandidatePreview(candidate.id).catch(() => undefined)
  previews.delete(candidate.id)
  removeCandidate(candidate)
  candidates.splice(candidates.findIndex(item => item.id === candidate.id), 1)
  git('add', '-A')
  git('commit', '-qm', `apply ${cycle}: ${operation.overrideAction ?? operation.after}`)
  return git('rev-parse', 'HEAD')
}

test.afterAll(async () => {
  for (const candidateId of previews) await stopCandidatePreview(candidateId).catch(() => undefined)
  for (const candidate of [...candidates].reverse()) removeCandidate(candidate)
  if (fs.existsSync(sandbox)) fs.rmSync(sandbox, { recursive: true, force: true })
})

test('page override identities and source transforms remain maintainable across applied Git baselines', async ({ page }) => {
  test.setTimeout(900_000)
  if (!dockerAvailable) {
    if (process.env.CI) throw new Error('Docker-backed continuous override lifecycle is mandatory in CI')
    test.skip(true, 'Docker is unavailable in this local environment')
  }
  createFixture()
  const cycleEvidence = { commits: [] as string[], candidateIds: [] as string[], stableTargetId: '', secondTargetId: '', sourceDigests: [] as string[] }

  let graph = analyzeProject(projectRoot)
  cycleEvidence.sourceDigests.push(graph.revision.sourceDigest)
  const firstTarget = target(graph, 'Home')
  let first = await createOverrideCandidate(graph, firstTarget, 'Home only', 'override-one')
  cycleEvidence.candidateIds.push(first.candidate.id)
  cycleEvidence.stableTargetId = Object.keys(JSON.parse(fs.readFileSync(path.join(first.candidate.candidateRoot!, '.ripple', 'overrides.json'), 'utf8')).targets)[0]
  expect(cycleEvidence.stableTargetId).toMatch(/^override:[\da-f-]{36}$/i)
  cycleEvidence.commits.push(await applyAndCommit(first.candidate, first.operation, first.session, page, ['Home only', 'Products'], ['Home', 'Products'], 'override-one'))

  graph = analyzeProject(projectRoot)
  cycleEvidence.sourceDigests.push(graph.revision.sourceDigest)
  let persistedFirst = target(graph, 'Home')
  expect(persistedFirst.id).toBe(cycleEvidence.stableTargetId)
  expect(persistedFirst.pageOverrides?.['page:home']).toBe('Home only')
  first = await createOverrideCandidate(graph, persistedFirst, 'Home maintained', 'override-update')
  cycleEvidence.candidateIds.push(first.candidate.id)
  let navigation = fs.readFileSync(path.join(first.candidate.candidateRoot!, 'src', 'components', 'Navigation.jsx'), 'utf8')
  let app = fs.readFileSync(path.join(first.candidate.candidateRoot!, 'src', 'App.jsx'), 'utf8')
  expect(navigation.match(/targetRef="override:/g)).toHaveLength(1)
  expect(navigation.match(/from "\.\.\/\.\.\/\.ripple\/overrides-runtime\.js"/g)).toHaveLength(1)
  expect(app.match(/<RipplePageForState\b/g)).toHaveLength(1)
  cycleEvidence.commits.push(await applyAndCommit(first.candidate, first.operation, first.session, page, ['Home maintained', 'Products'], ['Home', 'Products'], 'override-update'))

  graph = analyzeProject(projectRoot)
  persistedFirst = target(graph, 'Home')
  expect(persistedFirst.id).toBe(cycleEvidence.stableTargetId)
  const secondTarget = target(graph, 'Products')
  first = await createOverrideCandidate(graph, secondTarget, 'Catalog', 'override-two')
  cycleEvidence.candidateIds.push(first.candidate.id)
  const secondRegistry = JSON.parse(fs.readFileSync(path.join(first.candidate.candidateRoot!, '.ripple', 'overrides.json'), 'utf8')) as { targets: Record<string, unknown>; pages: Record<string, Record<string, string>> }
  cycleEvidence.secondTargetId = Object.keys(secondRegistry.targets).find(id => id !== cycleEvidence.stableTargetId) ?? ''
  expect(cycleEvidence.secondTargetId).toMatch(/^override:[\da-f-]{36}$/i)
  navigation = fs.readFileSync(path.join(first.candidate.candidateRoot!, 'src', 'components', 'Navigation.jsx'), 'utf8')
  app = fs.readFileSync(path.join(first.candidate.candidateRoot!, 'src', 'App.jsx'), 'utf8')
  expect(navigation.match(/targetRef="override:/g)).toHaveLength(2)
  expect(navigation.match(/from "\.\.\/\.\.\/\.ripple\/overrides-runtime\.js"/g)).toHaveLength(1)
  expect(app.match(/<RipplePageForState\b/g)).toHaveLength(1)
  cycleEvidence.commits.push(await applyAndCommit(first.candidate, first.operation, first.session, page, ['Home maintained', 'Catalog'], ['Home', 'Products'], 'override-two'))

  graph = analyzeProject(projectRoot)
  persistedFirst = target(graph, 'Home')
  expect(persistedFirst.id).toBe(cycleEvidence.stableTargetId)
  const removeFirst = await createOverrideCandidate(graph, persistedFirst, persistedFirst.value!, 'override-remove-one', 'remove')
  cycleEvidence.candidateIds.push(removeFirst.candidate.id)
  const removalRegistry = JSON.parse(fs.readFileSync(path.join(removeFirst.candidate.candidateRoot!, '.ripple', 'overrides.json'), 'utf8')) as { targets: Record<string, unknown>; pages: Record<string, Record<string, string>> }
  expect(removalRegistry.targets[cycleEvidence.stableTargetId]).toBeUndefined()
  expect(removalRegistry.targets[cycleEvidence.secondTargetId]).toBeTruthy()
  expect(removalRegistry.pages['page:home'][cycleEvidence.stableTargetId]).toBeUndefined()
  expect(removalRegistry.pages['page:home'][cycleEvidence.secondTargetId]).toBe('Catalog')
  navigation = fs.readFileSync(path.join(removeFirst.candidate.candidateRoot!, 'src', 'components', 'Navigation.jsx'), 'utf8')
  app = fs.readFileSync(path.join(removeFirst.candidate.candidateRoot!, 'src', 'App.jsx'), 'utf8')
  expect(navigation.match(/<RippleText\b/g)).toHaveLength(1)
  expect(navigation.match(/from "\.\.\/\.\.\/\.ripple\/overrides-runtime\.js"/g)).toHaveLength(1)
  expect(app.match(/<RipplePageForState\b/g)).toHaveLength(1)
  const fourthCommit = await applyAndCommit(removeFirst.candidate, removeFirst.operation, removeFirst.session, page, ['Home', 'Catalog'], ['Home', 'Products'], 'override-remove-one')
  cycleEvidence.commits.push(fourthCommit)

  graph = analyzeProject(projectRoot)
  cycleEvidence.sourceDigests.push(graph.revision.sourceDigest)
  expect(graph.unresolved.filter(item => item.includes('override'))).toEqual([])
  expect(target(graph, 'Products').id).toBe(cycleEvidence.secondTargetId)
  expect(target(graph, 'Home').id).toBe(`literal:src/components/Navigation.jsx#${target(graph, 'Home').location?.start}`)
  expect(target(graph, 'Products').pageOverrides?.['page:home']).toBe('Catalog')

  const removeSecond = await createOverrideCandidate(graph, target(graph, 'Products'), target(graph, 'Products').value!, 'override-remove-two', 'remove')
  cycleEvidence.candidateIds.push(removeSecond.candidate.id)
  navigation = fs.readFileSync(path.join(removeSecond.candidate.candidateRoot!, 'src', 'components', 'Navigation.jsx'), 'utf8')
  app = fs.readFileSync(path.join(removeSecond.candidate.candidateRoot!, 'src', 'App.jsx'), 'utf8')
  expect(navigation).not.toContain('RippleText')
  expect(navigation).not.toContain('overrides-runtime')
  expect(app).not.toContain('RipplePageForState')
  expect(app).not.toContain('overrides-runtime')
  expect(fs.existsSync(path.join(removeSecond.candidate.candidateRoot!, '.ripple', 'overrides.json'))).toBeFalsy()
  expect(fs.existsSync(path.join(removeSecond.candidate.candidateRoot!, '.ripple', 'overrides-runtime.js'))).toBeFalsy()
  cycleEvidence.commits.push(await applyAndCommit(removeSecond.candidate, removeSecond.operation, removeSecond.session, page, ['Home', 'Products'], ['Home', 'Products'], 'override-remove-two'))

  graph = analyzeProject(projectRoot)
  cycleEvidence.sourceDigests.push(graph.revision.sourceDigest)
  expect(graph.revision.sourceDigest, 'removing the final override restores the exact original tracked source tree').toBe(cycleEvidence.sourceDigests[0])
  expect(graph.unresolved.filter(item => item.includes('override'))).toEqual([])
  expect(target(graph, 'Home').id).toMatch(/^literal:src\/components\/Navigation\.jsx#\d+$/)
  expect(target(graph, 'Products').id).toMatch(/^literal:src\/components\/Navigation\.jsx#\d+$/)
  expect(fs.existsSync(path.join(projectRoot, '.ripple', 'overrides.json'))).toBeFalsy()
  expect(fs.existsSync(path.join(projectRoot, '.ripple', 'overrides-runtime.js'))).toBeFalsy()
  expect(git('worktree', 'list', '--porcelain').split(/\r?\n/).filter(line => line.startsWith('worktree '))).toHaveLength(1)
  expect(git('status', '--porcelain')).toBe('')

  const output = path.join(sandbox, 'final-build')
  await build({ configFile: false, root: projectRoot, base: './', plugins: [react()], build: { outDir: output, emptyOutDir: true } })
  expect(fs.existsSync(path.join(output, 'index.html'))).toBeTruthy()
  fs.writeFileSync(path.join(evidenceRoot, 'page-override-lifecycle.json'), JSON.stringify({
    schemaVersion: 1, completed: true, formalVerification: 'not-run-for-final-build-candidate',
    fixture: 'generated React/Vite project, not the Bolt repository', cycleEvidence,
    assertions: ['stable target IDs persisted through three applied baselines', 'existing page override was updated in place', 'a second override reused the source import and route provider', 'removing the first override removed only its marker and registry rule', 'three-viewport Playwright checks passed for each applied candidate', 'final candidate Vite build passed', 'source worktree is clean and prior applied revisions remain in Git history'],
  }, null, 2))
  expect(git('log', '-6', '--format=%s').split(/\r?\n/)).toHaveLength(6)
})
