import { expect, test, type Page } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import type { SourceGraph } from '../src/core/model'
import { analyzeProject, createRuntimeSourceMap, resolveRuntimeElement, sourceFileDigest } from '../src/core/project'
import { assessRuntimeIdentity, collectRuntimeIdentitySnapshot, compareRuntimeSnapshots, selectableRuntimeObservations, type RuntimeIdentityRecord, type RuntimeIdentitySnapshot } from '../src/core/runtime-identity'
import { sourceAnnotationPlugin } from '../src/core/source-annotation'

const fixtureRoot = path.join(process.cwd(), 'e2e', 'source-identity-fixture')
let server: ViteDevServer
let baseUrl: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fixtureRoot,
    logLevel: 'silent',
    plugins: [sourceAnnotationPlugin(fixtureRoot), react()],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Vite fixture listener did not bind a TCP address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => { await server?.close() })

test('keeps keyed identities stable and marks unkeyed component and raw list positions as dependent', async ({ page }) => {
  await page.goto(baseUrl)
  const instanceFor = async (id: string) => page.getByTestId(`card-${id}`).getAttribute('data-ripple-instance')
  const alphaBefore = await instanceFor('a')
  const betaBefore = await instanceFor('b')
  const alphaSource = await page.getByTestId('card-a').getAttribute('data-ripple-source')
  const betaSource = await page.getByTestId('card-b').getAttribute('data-ripple-source')
  expect(alphaBefore).toBeTruthy()
  expect(betaBefore).toBeTruthy()
  expect(alphaBefore).not.toBe(betaBefore)
  expect(alphaSource).toBe(betaSource)
  expect(await page.getByTestId('static-instance').getAttribute('data-ripple-identity-certainty')).toBe('stable-react-instance')
  expect(await page.getByTestId('card-a').getAttribute('data-ripple-identity-certainty')).toBe('stable-keyed-instance')

  const rawAlpha = page.getByTestId('raw-Raw Alpha')
  const rawBeta = page.getByTestId('raw-Raw Beta')
  const rawAlphaAtPosition = await rawAlpha.getAttribute('data-ripple-instance')
  const rawBetaAtPosition = await rawBeta.getAttribute('data-ripple-instance')
  expect(rawAlphaAtPosition).toBeTruthy()
  expect(rawBetaAtPosition).toBeTruthy()
  expect(rawAlphaAtPosition).not.toBe(rawBetaAtPosition)
  expect(await rawAlpha.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  expect(await rawBeta.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  expect(await rawAlpha.getAttribute('data-ripple-source')).toBe(await rawBeta.getAttribute('data-ripple-source'))
  await page.getByRole('button', { name: 'Reorder raw list' }).click()
  expect(await page.getByTestId('raw-Raw Beta').getAttribute('data-ripple-instance')).toBe(rawAlphaAtPosition)
  expect(await page.getByTestId('raw-Raw Alpha').getAttribute('data-ripple-instance')).toBe(rawBetaAtPosition)

  const componentAlpha = page.getByTestId('unkeyed-Component Alpha')
  const componentBeta = page.getByTestId('unkeyed-Component Beta')
  const componentAlphaAtPosition = await componentAlpha.getAttribute('data-ripple-instance')
  const componentBetaAtPosition = await componentBeta.getAttribute('data-ripple-instance')
  expect(componentAlphaAtPosition).toBeTruthy()
  expect(componentBetaAtPosition).toBeTruthy()
  expect(componentAlphaAtPosition).not.toBe(componentBetaAtPosition)
  expect(await componentAlpha.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  expect(await componentBeta.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  await page.getByRole('button', { name: 'Reorder unkeyed components' }).click()
  expect(await page.getByTestId('unkeyed-Component Beta').getAttribute('data-ripple-instance')).toBe(componentAlphaAtPosition)
  expect(await page.getByTestId('unkeyed-Component Alpha').getAttribute('data-ripple-instance')).toBe(componentBetaAtPosition)

  await page.getByRole('button', { name: 'Reorder', exact: true }).click()
  await expect(page.locator('article').first()).toHaveAttribute('data-testid', 'card-b')
  expect(await instanceFor('a')).toBe(alphaBefore)
  expect(await instanceFor('b')).toBe(betaBefore)

  await page.getByRole('button', { name: 'Toggle' }).click()
  await expect(page.locator('article')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle' }).click()
  expect(await instanceFor('a')).toBe(alphaBefore)
  expect(await instanceFor('b')).toBe(betaBefore)

  await page.getByRole('button', { name: 'Switch page' }).click()
  const featuredAlpha = await instanceFor('a')
  expect(featuredAlpha).toBeTruthy()
  expect(featuredAlpha).not.toBe(alphaBefore)
})

// ---------------------------------------------------------------------------
// Runtime instance identity (task D). The fixture page renders under StrictMode.
// Snapshots are assessed against a real SourceGraph built from a Git copy of the
// fixture, so sourceRefs, source versions and page context are checked end to end.
// ---------------------------------------------------------------------------
const fixtureFiles = ['index.html', 'main.jsx', 'runtime.html', 'runtime.jsx', 'repeat.js', 'roots.html', 'roots.jsx', 'getters.html', 'getters.jsx', 'cross.html', 'CrossApp.tsx', 'Row.tsx', 'Cell.tsx', 'cells.tsx', 'Badge.tsx', 'memo.html', 'memo.jsx']
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=fixture@ripple.local', '-c', 'user.name=Ripple fixture', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
const snapshot = (page: Page): Promise<RuntimeIdentitySnapshot> => page.evaluate(collectRuntimeIdentitySnapshot, { label: 'data-testid' })
const all = (snap: RuntimeIdentitySnapshot, label: string) => snap.records.filter(record => record.label === label)
const one = (snap: RuntimeIdentitySnapshot, label: string): RuntimeIdentityRecord => {
  const matches = all(snap, label)
  expect(matches, `exactly one rendered element labelled ${label}`).toHaveLength(1)
  return matches[0]
}
const withoutRoute = (id: string | undefined, pathname: string) => {
  expect(id?.startsWith(`${pathname}:`), `${id} is namespaced by ${pathname}`).toBe(true)
  return id!.slice(pathname.length)
}

test.describe('runtime instance identity', () => {
  let projectRoot: string
  let graph: SourceGraph
  const digest = (file: string) => sourceFileDigest(projectRoot, file)
  const openRuntime = async (page: Page) => {
    await page.goto(`${baseUrl}/runtime.html`)
    await expect(page.getByTestId('static-title')).toBeVisible()
  }
  const pinnedRenders = (page: Page) => page.evaluate(() => (window as unknown as { __pinnedRenders: number }).__pinnedRenders)

  test.beforeAll(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-runtime-identity-'))
    for (const file of fixtureFiles) fs.copyFileSync(path.join(fixtureRoot, file), path.join(projectRoot, file))
    git(projectRoot, 'init', '-q')
    git(projectRoot, 'add', '-A')
    git(projectRoot, 'commit', '-qm', 'fixture')
    graph = analyzeProject(projectRoot)
  })
  test.afterAll(() => { if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true }) })

  test('keyed list reorder keeps business identity, DOM node and a provable instance', async ({ page }) => {
    await openRuntime(page)
    const before = await snapshot(page)
    const keyed = ['p1', 'p2', 'p3'].map(id => one(before, `keyed-${id}`))
    expect(new Set(keyed.map(record => record.runtimeInstanceId)).size).toBe(3)
    expect(new Set(keyed.map(record => record.sourceRef)).size).toBe(1)
    for (const record of keyed) {
      expect(record.certainty).toBe('stable-keyed-instance')
      expect(record.reasons).toEqual([])
      expect(record.sourceVersion).toBe(digest('runtime.jsx'))
      expect(record.sameSourceCount).toBeGreaterThanOrEqual(3)
    }
    await page.getByRole('button', { name: 'Reverse products' }).click()
    await expect(page.getByTestId('keyed').locator('article').first()).toHaveAttribute('data-testid', 'keyed-p3')
    const after = await snapshot(page)
    const changes = compareRuntimeSnapshots(before, after)
    for (const record of keyed) {
      const moved = one(after, record.label!)
      expect(moved.runtimeInstanceId).toBe(record.runtimeInstanceId)
      expect(changes.find(change => change.runtimeInstanceId === record.runtimeInstanceId)?.status).toBe('same-node')
    }
    const assessment = assessRuntimeIdentity(graph, after, one(after, 'keyed-p1'), { fileDigest: digest, expectedPage: { pathname: '/runtime.html' } })
    expect(assessment).toMatchObject({ locatable: true, instanceIdentityProven: true, reasons: [] })
    expect(assessment.sameSourceCount).toBeGreaterThan(1)
    const map = createRuntimeSourceMap(graph, selectableRuntimeObservations(after))
    const target = one(after, 'keyed-p1')
    expect(resolveRuntimeElement(graph, { sourceRef: target.sourceRef, runtimeInstanceId: target.runtimeInstanceId! }, map, { fileDigest: digest, page: after.page }).element.id).toBe(target.sourceRef)
  })

  test('unkeyed reorder keeps position identity, which never becomes business identity', async ({ page }) => {
    await openRuntime(page)
    const before = await snapshot(page)
    const first = one(before, 'raw-L1')
    expect(first.certainty).toBe('position-dependent')
    await page.getByRole('button', { name: 'Reverse labels' }).click()
    await expect(page.getByTestId('raw').locator('li').first()).toHaveAttribute('data-testid', 'raw-L3')
    const after = await snapshot(page)
    expect(one(after, 'raw-L3').runtimeInstanceId).toBe(first.runtimeInstanceId)
    expect(one(after, 'raw-L1').runtimeInstanceId).not.toBe(first.runtimeInstanceId)
    const assessment = assessRuntimeIdentity(graph, after, one(after, 'raw-L3'), { fileDigest: digest })
    expect(assessment.instanceIdentityProven).toBe(false)
    expect(assessment.reasons).toContain('identity-not-stable')
    const map = createRuntimeSourceMap(graph, selectableRuntimeObservations(after))
    const target = one(after, 'raw-L3')
    expect(() => resolveRuntimeElement(graph, { sourceRef: target.sourceRef, runtimeInstanceId: target.runtimeInstanceId! }, map)).toThrow(/身份不稳定/)
  })

  test('index keys and unprovable key expressions are never stable-keyed', async ({ page }) => {
    await openRuntime(page)
    const before = await snapshot(page)
    for (const label of ['index-card-p1', 'index-li-p1']) expect(one(before, label).certainty).toBe('position-dependent')
    for (const label of ['random-p1', 'helper-p1', 'position-p1']) expect(one(before, label).certainty).toBe('unknown')
    const indexCard = one(before, 'index-card-p1').runtimeInstanceId
    const indexItem = one(before, 'index-li-p1').runtimeInstanceId
    await page.getByRole('button', { name: 'Reverse products' }).click()
    await expect(page.getByTestId('index-keys').locator('article').first()).toHaveAttribute('data-testid', 'index-card-p3')
    const after = await snapshot(page)
    expect(one(after, 'index-card-p3').runtimeInstanceId).toBe(indexCard)
    expect(one(after, 'index-li-p3').runtimeInstanceId).toBe(indexItem)
  })

  test('conditional unmount and remount keeps keyed business identity but reports a new React lifecycle', async ({ page }) => {
    await openRuntime(page)
    const before = await snapshot(page)
    await page.getByRole('button', { name: 'Toggle keyed' }).click()
    await expect(page.getByTestId('keyed')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle keyed' }).click()
    await expect(page.getByTestId('keyed')).toHaveCount(1)
    const after = await snapshot(page)
    const changes = compareRuntimeSnapshots(before, after)
    for (const id of ['p1', 'p2', 'p3']) {
      const previous = one(before, `keyed-${id}`)
      expect(one(after, `keyed-${id}`).runtimeInstanceId).toBe(previous.runtimeInstanceId)
      expect(changes.find(change => change.runtimeInstanceId === previous.runtimeInstanceId)?.status).toBe('remounted')
    }
    expect(changes.find(change => change.runtimeInstanceId === one(before, 'static-title').runtimeInstanceId)?.status).toBe('same-node')
  })

  test('a shared component on two routes is attributed by route and stale namespaces fail closed', async ({ page }) => {
    await openRuntime(page)
    await page.getByRole('button', { name: 'Go catalog' }).click()
    await expect(page.getByTestId('catalog-page')).toBeVisible()
    const rendersAtCatalog = await pinnedRenders(page)
    const catalog = await snapshot(page)
    await page.getByRole('button', { name: 'Go featured' }).click()
    await expect(page.getByTestId('featured-page')).toBeVisible()
    const featured = await snapshot(page)
    expect(catalog.page.pathname).toBe('/catalog')
    expect(featured.page.pathname).toBe('/featured')

    const catalogCard = one(catalog, 'route-card-p1')
    const featuredCard = one(featured, 'route-card-p1')
    expect(featuredCard.sourceRef).toBe(catalogCard.sourceRef)
    expect(featuredCard.runtimeInstanceId).not.toBe(catalogCard.runtimeInstanceId)
    expect(withoutRoute(featuredCard.runtimeInstanceId, '/featured')).not.toBe(withoutRoute(catalogCard.runtimeInstanceId, '/catalog'))
    // Same call site on both routes: only the route namespace tells the instances apart.
    expect(withoutRoute(one(featured, 'banner-shell').runtimeInstanceId, '/featured')).toBe(withoutRoute(one(catalog, 'banner-shell').runtimeInstanceId, '/catalog'))

    const wrongPage = assessRuntimeIdentity(graph, featured, featuredCard, { fileDigest: digest, expectedPage: { pathname: '/catalog' } })
    expect(wrongPage.instanceIdentityProven).toBe(false)
    expect(wrongPage.reasons).toContain('page-context-mismatch')
    expect(assessRuntimeIdentity(graph, featured, featuredCard, { fileDigest: digest, expectedPage: { pathname: '/featured' } }).instanceIdentityProven).toBe(true)
    const map = createRuntimeSourceMap(graph, selectableRuntimeObservations(featured))
    expect(() => resolveRuntimeElement(graph, { sourceRef: featuredCard.sourceRef, runtimeInstanceId: featuredCard.runtimeInstanceId! }, map, { page: catalog.page })).toThrow(/页面上下文/)

    // React.memo kept the pinned component from re-rendering (annotation must not
    // change render timing), so its id still carries an earlier route namespace.
    expect(await pinnedRenders(page)).toBe(rendersAtCatalog)
    const pinned = one(featured, 'pinned')
    expect(pinned.declaredCertainty).toBe('stable-react-instance')
    expect(pinned.certainty).toBe('unknown')
    expect(pinned.reasons).toContain('route-namespace-stale')
    expect(selectableRuntimeObservations(featured).some(observation => observation.runtimeInstanceId === pinned.runtimeInstanceId)).toBe(false)
  })

  test('state updates keep identities and do not re-render memoized components', async ({ page }) => {
    await openRuntime(page)
    const rendersBefore = await pinnedRenders(page)
    const before = await snapshot(page)
    await page.getByRole('button', { name: 'Bump' }).click()
    await expect(page.getByTestId('count')).toHaveText('1')
    await page.getByRole('button', { name: 'Rename p1' }).click()
    await expect(page.getByTestId('keyed-title-p1')).toHaveText('Pot!')
    const after = await snapshot(page)
    expect(await pinnedRenders(page)).toBe(rendersBefore)
    for (const label of ['static-title', 'count', 'keyed-p1', 'keyed-title-p1', 'raw-L1', 'banner-shell', 'pinned']) {
      expect(one(after, label).runtimeInstanceId).toBe(one(before, label).runtimeInstanceId)
      expect(one(after, label).domNode).toBe(one(before, label).domNode)
    }
    expect(all(after, 'not-bumped')).toHaveLength(0)
    expect(one(after, 'bumped').certainty).toBe('stable-react-instance')
  })

  test('static and dynamic JSX in one component get independent certainties', async ({ page }) => {
    await openRuntime(page)
    const snap = await snapshot(page)
    const expected: Record<string, string> = {
      'static-title': 'stable-react-instance',
      count: 'stable-react-instance',
      'not-bumped': 'stable-react-instance',
      'banner-shell': 'stable-react-instance',
      'catalog-page': 'stable-react-instance',
      'keyed-p2': 'stable-keyed-instance',
      'keyed-title-p2': 'stable-keyed-instance',
      'route-card-p2': 'stable-keyed-instance',
      'raw-L2': 'position-dependent',
      'index-card-p2': 'position-dependent',
      'helper-p2': 'unknown',
      'module-note': 'unmapped',
    }
    for (const [label, certainty] of Object.entries(expected)) expect(one(snap, label).certainty, label).toBe(certainty)
    // Adjacent siblings and a concise arrow component each keep their own boundary.
    const adjacent = ['banner-left', 'banner-right', 'banner-concise'].map(label => one(snap, label))
    for (const record of adjacent) expect(record.certainty, record.label).toBe('stable-react-instance')
    expect(new Set(adjacent.map(record => record.runtimeInstanceId)).size).toBe(3)
    const stableIds = snap.records.filter(record => record.certainty.startsWith('stable')).map(record => record.runtimeInstanceId)
    expect(new Set(stableIds).size).toBe(stableIds.length)
  })

  test('annotation leaves children- and prop-inspecting components unchanged', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await openRuntime(page)
    await expect(page.getByTestId('route-list')).toHaveText('/a,/b')
    await expect(page.getByTestId('tab-list').locator('li')).toHaveText(['One', 'Two'])
    await expect(page.getByTestId('icon-size')).toHaveText('small')
    expect(errors).toEqual([])
    const snap = await snapshot(page)
    // The cloned icon was rendered by IconButton, not by the JSX that created it.
    expect(one(snap, 'icon-size').certainty).toBe('unknown')
    expect(one(snap, 'route-list').certainty).toBe('stable-react-instance')
  })

  test('functions called as plain functions get no hooks, so list growth cannot break the app', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await openRuntime(page)
    await page.getByRole('button', { name: 'Add product' }).click()
    await expect(page.getByTestId('plain-rows').locator('dt')).toHaveCount(4)
    expect(errors).toEqual([])
    const snap = await snapshot(page)
    expect(one(snap, 'plain-p4')).toMatchObject({ certainty: 'unmapped' })
    expect(one(snap, 'keyed-p4').certainty).toBe('stable-keyed-instance')
  })

  test('keyed component state survives reorder in flatMap arrays, mixed roots and Children.map', async ({ page }) => {
    await openRuntime(page)
    for (const id of ['flat-p1', 'mixed-p1', 'framed-p1']) {
      await page.getByTestId(`counter-${id}`).click()
      await page.getByTestId(`counter-${id}`).click()
      await expect(page.getByTestId(`counter-${id}`)).toHaveText(`${id}:2`)
    }
    const before = await snapshot(page)
    await page.getByRole('button', { name: 'Reverse products' }).click()
    await expect(page.getByTestId('keyed').locator('article').first()).toHaveAttribute('data-testid', 'keyed-p3')
    for (const id of ['flat-p1', 'mixed-p1', 'framed-p1']) await expect(page.getByTestId(`counter-${id}`)).toHaveText(`${id}:2`)
    const after = await snapshot(page)
    expect(one(after, 'counter-flat-p1')).toMatchObject({ certainty: 'stable-keyed-instance', runtimeInstanceId: one(before, 'counter-flat-p1').runtimeInstanceId })
    // One unkeyed root makes the whole callback position-based for Ripple (conservative).
    expect(one(after, 'counter-mixed-p1').certainty).toBe('position-dependent')
    // Framed renders its children itself, so the counters it receives get no boundary.
    expect(one(after, 'counter-framed-p1').certainty).toBe('unknown')
  })

  test('same-type nesting and JSX detached from the keyed row never borrow another identity', async ({ page }) => {
    await openRuntime(page)
    const snap = await snapshot(page)
    const outer = one(snap, 'panel-outer')
    const inner = one(snap, 'panel-inner')
    expect(outer.certainty).toBe('stable-react-instance')
    expect(inner.certainty).toBe('unknown')
    expect(inner.runtimeInstanceId).not.toBe(outer.runtimeInstanceId)
    expect(one(snap, 'row-host-p1').certainty).toBe('stable-keyed-instance')
    expect(one(snap, 'detached-p1').certainty).toBe('unknown')
  })

  test('root renders keep inspecting roots working and never claim a repeated root', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${baseUrl}/roots.html`)
    await expect(page.getByTestId('root-routes')).toHaveText('/a,/b')
    await expect(page.getByTestId('widget-w2')).toBeVisible()
    expect(errors).toEqual([])
    const snap = await snapshot(page)
    expect(one(snap, 'shell').certainty).toBe('stable-react-instance')
    expect(one(snap, 'root-routes').certainty).toBe('stable-react-instance')
    const widgets = ['w1', 'w2'].map(id => one(snap, `widget-${id}`))
    for (const widget of widgets) expect(widget.certainty).toBe('unknown')
    expect(widgets[0].runtimeInstanceId).not.toBe(widgets[1].runtimeInstanceId)
  })

  test('key expressions run exactly as often as without annotation (getters, Proxy, toString, toPrimitive)', async ({ page, browser }) => {
    // The same fixture served without the annotation plugin is the reference.
    const plain = await createServer({ configFile: false, root: fixtureRoot, logLevel: 'silent', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
    await plain.listen()
    const plainAddress = plain.httpServer!.address()
    if (!plainAddress || typeof plainAddress === 'string') throw new Error('plain fixture listener did not bind')
    const exercise = async (target: Page, url: string) => {
      const errors: string[] = []
      target.on('pageerror', error => errors.push(error.message))
      target.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()) })
      await target.goto(url)
      await expect(target.getByTestId('card-x')).toHaveText('x:0')
      await target.getByTestId('card-x').click()
      await target.getByRole('button', { name: 'Bump' }).click()
      await target.getByRole('button', { name: 'Reverse' }).click()
      await target.getByRole('button', { name: 'Bump' }).click()
      await expect(target.getByTestId('card-x')).toHaveText('x:1')
      return { reads: await target.evaluate(() => (window as unknown as { __keyReads: Record<string, number> }).__keyReads), text: await target.locator('main').innerText(), errors }
    }
    try {
      const plainPage = await browser.newPage()
      const reference = await exercise(plainPage, `http://127.0.0.1:${plainAddress.port}/getters.html`)
      await plainPage.close()
      const annotated = await exercise(page, `${baseUrl}/getters.html`)
      expect(Object.values(reference.reads).every(value => value > 0)).toBe(true)
      expect(annotated.reads).toEqual(reference.reads)
      expect(annotated.text).toBe(reference.text)
      expect(annotated.errors).toEqual(reference.errors)
      const snap = await snapshot(page)
      // Primitive keys are captured once and still identify their rows.
      expect(one(snap, 'getter-a')).toMatchObject({ certainty: 'stable-keyed-instance', listKey: 'a' })
      expect(one(snap, 'getter-a').runtimeInstanceId).toMatch(/:a$/)
      // A non-primitive key is never coerced by Ripple; the collector reports the string React
      // itself derived (one toString call, counted above in both runs).
      expect(all(snap, 'token-key').map(record => record.listKey).sort()).toEqual(['token-a', 'token-b'])
      expect(one(snap, 'card-x').certainty).toBe('stable-keyed-instance')
    } finally { await plain.close() }
  })

  test('functions another file calls as plain callbacks get no hooks (cross-file escape)', async ({ page, browser }) => {
    const plain = await createServer({ configFile: false, root: fixtureRoot, logLevel: 'silent', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
    await plain.listen()
    const plainAddress = plain.httpServer!.address()
    if (!plainAddress || typeof plainAddress === 'string') throw new Error('plain fixture listener did not bind')
    const exercise = async (target: Page, url: string) => {
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      target.on('pageerror', error => pageErrors.push(error.message))
      target.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().replace(/\s+at .*/gs, '')) })
      await target.goto(url)
      await expect(target.getByTestId('cross-badge')).toHaveText('1 rows')
      for (let index = 0; index < 3; index += 1) await target.getByRole('button', { name: 'Add row' }).click()
      await expect(target.getByTestId('cross-badge')).toHaveText('4 rows')
      return { pageErrors, consoleErrors, rows: await target.locator('[data-testid^="cross-row-"]').count(), cells: await target.locator('[data-testid^="cross-cell-"]').count() }
    }
    try {
      const plainPage = await browser.newPage()
      const reference = await exercise(plainPage, `http://127.0.0.1:${plainAddress.port}/cross.html`)
      await plainPage.close()
      const annotated = await exercise(page, `${baseUrl}/cross.html`)
      expect(reference).toMatchObject({ pageErrors: [], rows: 4, cells: 4 })
      expect(annotated).toEqual(reference)
      expect(annotated.consoleErrors.join('\n')).not.toMatch(/Rendered (more|fewer) hooks|change in the order of Hooks/)
      const snap = await snapshot(page)
      expect(one(snap, 'cross-row-a').certainty).toBe('unmapped')
      expect(one(snap, 'cross-cell-a').certainty).toBe('unmapped')
      expect(one(snap, 'cross-badge').certainty).toBe('stable-react-instance')
    } finally { await plain.close() }
  })

  test('keys containing "/" never collide in collected ids', async ({ page }) => {
    await openRuntime(page)
    const snap = await snapshot(page)
    const first = one(snap, 'slash-a/b|c')
    const second = one(snap, 'slash-a|b/c')
    for (const record of [first, second]) {
      expect(record.certainty).toBe('stable-keyed-instance')
      expect(record.reasons).toEqual([])
    }
    expect(first.runtimeInstanceId).not.toBe(second.runtimeInstanceId)
    expect(first.runtimeInstanceId).toMatch(/:a%2Fb\/c$/)
    expect(second.runtimeInstanceId).toMatch(/:a\/b%2Fc$/)
    expect([first.listKey, second.listKey]).toEqual(['c', 'b/c'])
  })

  test('Object.keys/entries keys are business keys only for a provable object', async ({ page }) => {
    await openRuntime(page)
    const snap = await snapshot(page)
    // Arrays: the "key" is a position.
    expect(one(snap, 'keys-array-0').certainty).toBe('position-dependent')
    expect(one(snap, 'entries-array-clay').certainty).toBe('position-dependent')
    // A const object literal: real keys.
    expect(one(snap, 'keys-object-clay').certainty).toBe('stable-keyed-instance')
    expect(one(snap, 'entries-object-glaze').certainty).toBe('stable-keyed-instance')
    // State whose shape cannot be proven statically (here: an array in useState): unknown.
    expect(one(snap, 'keys-unknown-0').certainty).toBe('unknown')
  })

  test('a file re-evaluated with another source version cannot vouch for existing DOM', async ({ page }) => {
    await openRuntime(page)
    const before = await snapshot(page)
    const target = one(before, 'keyed-p1')
    expect(target.sourceVersion).toBe(digest('runtime.jsx'))
    // A revision that keeps every JSX offset (comment appended): only the digest differs.
    const changedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-runtime-identity-hmr-'))
    try {
      for (const file of fixtureFiles) fs.copyFileSync(path.join(fixtureRoot, file), path.join(changedRoot, file))
      fs.appendFileSync(path.join(changedRoot, 'runtime.jsx'), '\n// revised\n')
      git(changedRoot, 'init', '-q')
      git(changedRoot, 'add', '-A')
      git(changedRoot, 'commit', '-qm', 'revised fixture')
      const changedGraph = analyzeProject(changedRoot)
      const changedDigest = (file: string) => sourceFileDigest(changedRoot, file)
      expect(changedGraph.nodes.some(node => node.id === target.sourceRef)).toBe(true)
      // Simulate the revised module being evaluated in the same page (what HMR would do)
      // while the DOM rendered by the previous module stays mounted.
      await page.evaluate(([file, version]) => {
        const registry = (globalThis as unknown as Record<symbol, { register(file: string, digest: string): void }>)[Symbol.for('ripple.runtime-identity')]
        registry.register(file, version)
      }, ['runtime.jsx', changedDigest('runtime.jsx')] as const)
      const after = await snapshot(page)
      const stale = one(after, 'keyed-p1')
      expect(stale.sourceVersion).toBeUndefined()
      expect(stale.reasons).toContain('source-version-ambiguous')
      const assessment = assessRuntimeIdentity(changedGraph, after, stale, { fileDigest: changedDigest })
      expect(assessment.instanceIdentityProven).toBe(false)
      expect(assessment.reasons).toContain('source-version-ambiguous')
      expect(() => createRuntimeSourceMap(changedGraph, [{ sourceRef: stale.sourceRef, runtimeInstanceId: stale.runtimeInstanceId!, certainty: stale.certainty, pageContext: after.page, reasons: stale.reasons }])).toThrow(/降级/)
      expect(selectableRuntimeObservations(after).some(observation => observation.sourceRef === stale.sourceRef)).toBe(false)
    } finally { fs.rmSync(changedRoot, { recursive: true, force: true }) }
  })

  test('annotation causes no extra attribute writes and keeps deep-equal memo bail-outs', async ({ page, browser }) => {
    const plain = await createServer({ configFile: false, root: fixtureRoot, logLevel: 'silent', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
    await plain.listen()
    const plainAddress = plain.httpServer!.address()
    if (!plainAddress || typeof plainAddress === 'string') throw new Error('plain fixture listener did not bind')
    const exercise = async (target: Page, url: string) => {
      await target.goto(url)
      await expect(target.getByTestId('stable-frame')).toBeVisible()
      await target.evaluate(() => {
        const state = window as unknown as { __attributeWrites: number }
        state.__attributeWrites = 0
        new MutationObserver(records => { state.__attributeWrites += records.filter(record => record.type === 'attributes' && record.attributeName?.startsWith('data-ripple')).length })
          .observe(document.body, { attributes: true, subtree: true })
      })
      const rendersBefore = await target.evaluate(() => (window as unknown as { __frameRenders: number }).__frameRenders)
      for (let index = 0; index < 3; index += 1) await target.getByRole('button', { name: 'Tick' }).click()
      await expect(target.getByTestId('ticks')).toHaveText('3')
      return target.evaluate(before => ({
        writes: (window as unknown as { __attributeWrites: number }).__attributeWrites,
        frameRenders: (window as unknown as { __frameRenders: number }).__frameRenders - before,
      }), rendersBefore)
    }
    try {
      const plainPage = await browser.newPage()
      const reference = await exercise(plainPage, `http://127.0.0.1:${plainAddress.port}/memo.html`)
      await plainPage.close()
      const annotated = await exercise(page, `${baseUrl}/memo.html`)
      expect(reference).toEqual({ writes: 0, frameRenders: 0 })
      expect(annotated).toEqual(reference)
      const snap = await snapshot(page)
      expect(one(snap, 'memo-row-a')).toMatchObject({ certainty: 'stable-keyed-instance', listKey: 'a' })
    } finally { await plain.close() }
  })

  test('identities without a provable parent or instance chain fail closed', async ({ page }) => {
    await openRuntime(page)
    const snap = await snapshot(page)
    // `.map(renderRow)`: every row shares one id, which is never stable and flagged as duplicate.
    const row = one(snap, 'row-p1')
    expect(row).toMatchObject({ declaredCertainty: 'unknown', certainty: 'unknown' })
    expect(row.runtimeInstanceId).toBe(one(snap, 'row-p2').runtimeInstanceId)
    expect(row.reasons).toContain('duplicate-runtime-instance')
    expect(one(snap, 'loop-p1').certainty).toBe('unknown')
    // Leaf escapes as a prop value (`component={Leaf}`) and is rendered by plain library
    // code, so it gets no hooks at all and its elements are unmapped.
    const leaves = [0, 1, 2].map(index => one(snap, `leaf-${index}`))
    for (const leaf of leaves) {
      expect(leaf.certainty).toBe('unmapped')
      expect(leaf.runtimeInstanceId).toBeUndefined()
    }
    // Children of another component get no boundary; rendered twice, each React instance
    // keeps its own (unstable) id and is never claimed as stable.
    const twice = all(snap, 'banner-twice')
    expect(twice).toHaveLength(2)
    for (const record of twice) expect(record.certainty).toBe('unknown')
    expect(new Set(twice.map(record => record.runtimeInstanceId)).size).toBe(2)
    // One host element rendered twice claims a stable identity statically; the collector
    // sees two DOM nodes with the same id and downgrades both.
    // A stored element referenced twice is never stable, and its two renders share one id.
    const duplicated = all(snap, 'dup-badge')
    expect(duplicated).toHaveLength(2)
    for (const record of duplicated) {
      expect(record.declaredCertainty).toBe('unknown')
      expect(record.reasons).toContain('duplicate-runtime-instance')
    }
    // A host child that its parent component renders twice claims stable statically; the
    // collector sees two DOM nodes with one id and downgrades both.
    const twiceHost = all(snap, 'twice-host')
    expect(twiceHost).toHaveLength(2)
    for (const record of twiceHost) {
      expect(record.declaredCertainty).toBe('stable-react-instance')
      expect(record.certainty).toBe('unknown')
      expect(record.reasons).toContain('duplicate-runtime-instance')
    }
    // JSX stored in the component body and placed inside a keyed row can move between rows.
    expect(one(snap, 'option-p1').certainty).toBe('stable-keyed-instance')
    expect(one(snap, 'check').certainty).toBe('unknown')
    // Uniqueness is checked against the whole document even for a scoped snapshot.
    const scoped = await page.evaluate(collectRuntimeIdentitySnapshot, { root: '[data-testid="dup-a"]', label: 'data-testid' })
    expect(one(scoped, 'dup-badge').reasons).toContain('duplicate-runtime-instance')
    expect(one(snap, 'shadowed').certainty).toBe('unknown')
    const note = one(snap, 'module-note')
    expect(note).toMatchObject({ declaredCertainty: 'unmapped', certainty: 'unmapped' })
    expect(note.runtimeInstanceId).toBeUndefined()

    const failClosed = [row, one(snap, 'loop-p1'), ...leaves, ...twice, ...duplicated, ...twiceHost, one(snap, 'check'), one(snap, 'shadowed'), note]
    for (const record of failClosed) expect(assessRuntimeIdentity(graph, snap, record, { fileDigest: digest }).instanceIdentityProven, record.label).toBe(false)
    const selectable = selectableRuntimeObservations(snap)
    const selectableIds = new Set(selectable.map(observation => observation.runtimeInstanceId))
    for (const record of failClosed) if (record.runtimeInstanceId) expect(selectableIds.has(record.runtimeInstanceId), record.label).toBe(false)
    // Every element that survives collection maps to a JSX node of the real SourceGraph.
    expect(() => createRuntimeSourceMap(graph, selectable)).not.toThrow()
    expect(selectable.length).toBeGreaterThan(10)
  })

  test('a source change invalidates identities rendered from the previous source', async ({ page }) => {
    await openRuntime(page)
    const snap = await snapshot(page)
    const target = one(snap, 'keyed-p1')
    const map = createRuntimeSourceMap(graph, selectableRuntimeObservations(snap))
    expect(resolveRuntimeElement(graph, { sourceRef: target.sourceRef, runtimeInstanceId: target.runtimeInstanceId! }, map, { fileDigest: digest }).element.id).toBe(target.sourceRef)

    const changedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-runtime-identity-changed-'))
    try {
      for (const file of fixtureFiles) fs.copyFileSync(path.join(fixtureRoot, file), path.join(changedRoot, file))
      fs.writeFileSync(path.join(changedRoot, 'runtime.jsx'), `// shifted\n${fs.readFileSync(path.join(fixtureRoot, 'runtime.jsx'), 'utf8')}`)
      git(changedRoot, 'init', '-q')
      git(changedRoot, 'add', '-A')
      git(changedRoot, 'commit', '-qm', 'changed fixture')
      const changedGraph = analyzeProject(changedRoot)
      const changedDigest = (file: string) => sourceFileDigest(changedRoot, file)
      const assessment = assessRuntimeIdentity(changedGraph, snap, target, { fileDigest: changedDigest })
      expect(assessment.locatable).toBe(false)
      expect(assessment.instanceIdentityProven).toBe(false)
      expect(assessment.reasons).toContain('source-version-mismatch')
      const staleObservations = selectableRuntimeObservations(snap).filter(observation => changedGraph.nodes.some(node => node.id === observation.sourceRef))
      const staleMap = createRuntimeSourceMap(changedGraph, staleObservations)
      const staleTarget = staleObservations.find(observation => observation.certainty.startsWith('stable'))!
      expect(() => resolveRuntimeElement(changedGraph, staleTarget, staleMap, { fileDigest: changedDigest })).toThrow(/源码版本/)
      expect(() => resolveRuntimeElement(graph, { sourceRef: target.sourceRef, runtimeInstanceId: target.runtimeInstanceId! }, { ...map, sourceDigest: changedGraph.revision.sourceDigest })).toThrow(/不再对应/)
    } finally { fs.rmSync(changedRoot, { recursive: true, force: true }) }
  })
})
