// @vitest-environment node
// Behavioural regression tests for the isolated verification runner's page
// lifecycle (Bolt Run #11). They drive executeVerification against a real
// Chromium and a small SPA shaped like the Bolt contract: four views on "/"
// reached through navigation buttons, one interaction, and an annotated shared
// footer brand. The SPA persists its active tab in localStorage.
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { attestBrowserExecution } from './verification-receipt'
import { buildFailedToRunDiagnostic } from './verification-runner'
import type { VerificationRun } from './model'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { executeVerification, RunnerAborted, runnerDeadline } from './verification-execution.mjs'

const CANDIDATE_HOST = '127.0.0.2'
const BASELINE_HOST = '127.0.0.3'
const BRAND_REF = 'src/components/Footer.tsx#brand'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
]
const PAGES = [
  { pageRef: 'page:home', path: '/', markerText: 'Home page' },
  { pageRef: 'page:autumn', path: '/', markerText: 'Autumn page', navigateBy: { role: 'button', name: 'Autumn' } },
  { pageRef: 'page:products', path: '/', markerText: 'Products page', navigateBy: { role: 'button', name: 'Products' } },
  { pageRef: 'page:story', path: '/', markerText: 'Story page', navigateBy: { role: 'button', name: 'Story' } },
]
const HOME_INTERACTION = { pageRef: 'page:home', role: 'button', name: 'Browse items', expectedText: 'Catalog opened' }
// Document loads per viewport on each side: the main page (which also hosts
// the read-only root probe), three navigated scope pages and the interaction.
const LOADS_PER_VIEWPORT = 5

const servers: http.Server[] = []
let browser: Browser
const spaOptions = { consoleErrorsPerLoad: 0, cart: false, introGate: false, images: [] as string[] }

// With `cart`, the SPA keeps a cart count in IndexedDB, writes it to
// localStorage on pagehide, and serves a cart view on the hash route #/cart.
// The candidate's "Quick add" button is broken. Any of those three channels
// would carry an earlier interaction's cart into a later probe if pages were
// not isolated, turning the broken button into a false PASS.
function spa(brand: string): string {
  const candidate = brand === 'New brand'
  return `<!doctype html><html><head><meta charset="utf-8"><title>spa</title></head><body><div id="root"></div><script>
  const markers = { home: 'Home page', autumn: 'Autumn page', products: 'Products page', story: 'Story page', cart: 'Cart page' }
  const root = document.getElementById('root')
  for (const src of ${JSON.stringify(spaOptions.images)}) { const image = new Image(); image.src = src; document.body.append(image) }
  for (let i = 0; i < ${spaOptions.consoleErrorsPerLoad}; i += 1) console.error('widget failed to hydrate ' + (i % 3) + ' https://cdn.example.test/w.js?sig=SECRET' + i)
  const cartEnabled = ${spaOptions.cart}
  let cart = Number(localStorage.getItem('cart') || 0)
  let db
  function saveCart() { if (db) db.transaction('cart', 'readwrite').objectStore('cart').put(cart, 'count') }
  function render(tab) {
    localStorage.setItem('tab', tab)
    const cartView = cartEnabled ? '<button id="add">Add to cart</button><button id="quick">Quick add</button>' + (cart ? '<p>Cart (' + cart + ')</p>' : '') : ''
    root.innerHTML = '<nav><button data-tab="autumn">Autumn</button><button data-tab="products">Products</button><button data-tab="story">Story</button></nav>' +
      '<main><h1>' + markers[tab] + '</h1>' + (tab === 'home' ? '<button id="browse">Browse items</button><div id="out"></div>' : '') + (tab === 'home' || tab === 'cart' ? cartView : '') + '</main>' +
      '<footer><span data-ripple-source="${BRAND_REF}" data-ripple-instance="footer-brand">${brand}</span></footer>'
    for (const button of root.querySelectorAll('nav button')) button.onclick = () => render(button.dataset.tab)
    const browse = document.getElementById('browse')
    // With introGate, the candidate's button only works once a 20 s entrance
    // transition has ended (a regression); the baseline's works at once.
    if (browse) browse.onclick = () => { if (${spaOptions.introGate && candidate} && !introDone) return; document.getElementById('out').textContent = 'Catalog opened' }
    const add = document.getElementById('add')
    if (add) add.onclick = () => { cart += 1; saveCart(); render(tab) }
    const quick = document.getElementById('quick')
    if (quick && !${candidate}) quick.onclick = () => { cart += 1; saveCart(); render(tab) }
  }
  const currentTab = () => location.hash === '#/cart' ? 'cart' : (localStorage.getItem('tab') || 'home')
  if (cartEnabled) {
    addEventListener('pagehide', () => localStorage.setItem('cart', String(cart)))
    addEventListener('hashchange', () => render(currentTab()))
    const request = indexedDB.open('shop', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('cart')
    request.onsuccess = () => {
      db = request.result
      const read = db.transaction('cart').objectStore('cart').get('count')
      read.onsuccess = () => { if (read.result) { cart = Math.max(cart, read.result); render(currentTab()) } }
    }
  }
  render(currentTab())
  var introDone = false
  if (${spaOptions.introGate}) {
    const intro = document.createElement('div')
    intro.style.cssText = 'height:4px;background:#888;opacity:0;transition:opacity 20s linear'
    intro.addEventListener('transitionend', () => { introDone = true })
    document.body.prepend(intro)
    requestAnimationFrame(() => requestAnimationFrame(() => { intro.style.opacity = '1' }))
  }
  </script></body></html>`
}

async function listen(host: string, brand: string): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(spa(brand))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(5173, host, resolve) })
  servers.push(server)
}

beforeAll(async () => {
  await listen(CANDIDATE_HOST, 'New brand')
  await listen(BASELINE_HOST, 'Old brand')
  browser = await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
})

function verificationInput(runId: string, contract: { pages: Array<Record<string, unknown>>; interactions: Array<Record<string, unknown>> } = { pages: PAGES, interactions: [HOME_INTERACTION] }, resourceSnapshots: unknown[] = []) {
  const expectations = Object.fromEntries(contract.pages.map(page => [page.pageRef, { baselineText: 'Old brand', candidateText: 'New brand' }]))
  return {
    runId, candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 1,
    baseSourceDigest: 'base', patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime',
    verificationContractHash: 'contract',
    viewports: VIEWPORTS, previewHost: CANDIDATE_HOST, baselineHost: BASELINE_HOST,
    targetBindings: [{
      operationId: 'op-brand', beforeText: 'Old brand', expectedText: 'New brand',
      baselineSourceRefs: [BRAND_REF], sourceRefs: [BRAND_REF], pageExpectations: expectations,
    }],
    baselineComparisonPageRef: 'page:home',
    routeRefs: contract.pages.map(page => page.pageRef),
    operations: [{ id: 'op-brand', kind: 'TEXT' }],
    scopeTargetPageRefs: { 'op-brand': contract.pages.map(page => page.pageRef) },
    verificationContract: contract,
    resourceSnapshots, unavailableResources: [],
  }
}

type Side = 'candidate' | 'baseline'
type PageInfo = { side: Side; viewportWidth: number; ordinal: number }
type Hooks = {
  newPage?: (call: PageInfo) => void | Promise<void>
  page?: (page: Page, info: PageInfo) => Partial<Record<keyof Page, unknown>>
}

// Wraps the real browser so every page the runner opens is tracked, and lets a
// test replace individual page methods to inject faults. Pages are always
// requested as pairs, candidate first.
function instrumentedBrowser(hooks: Hooks = {}) {
  const open = new Set<Page>()
  const openBefore: Array<{ viewportWidth: number; open: number }> = []
  const ordinals = new Map<string, number>()
  let newPageCalls = 0
  const wrapped = {
    isConnected: () => browser.isConnected(),
    async newPage(options: { viewport: { width: number; height: number } }) {
      newPageCalls += 1
      const side: Side = newPageCalls % 2 === 1 ? 'candidate' : 'baseline'
      const key = `${options.viewport.width}:${side}`
      const info = { side, viewportWidth: options.viewport.width, ordinal: (ordinals.get(key) ?? 0) + 1 }
      ordinals.set(key, info.ordinal)
      openBefore.push({ viewportWidth: info.viewportWidth, open: open.size })
      await hooks.newPage?.(info)
      const page = await browser.newPage(options)
      open.add(page)
      page.once('close', () => open.delete(page))
      const overrides = hooks.page?.(page, info) ?? {}
      return new Proxy(page, {
        get(target, property: string | symbol) {
          if (typeof property === 'string' && property in overrides) return overrides[property as keyof Page]
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
  return { browser: wrapped, open, openBefore, newPageCalls: () => newPageCalls }
}

// A Playwright call that never answers until its page is closed, as a call into
// a renderer that is busy or that could not start does.
function hangUntilClosed(page: Page): Promise<never> {
  return new Promise((_resolve, reject) => page.once('close', () => reject(new Error('Target page, context or browser has been closed'))))
}

type RunOutcome = {
  result?: Record<string, any>; error?: any; events: Array<Record<string, any>>; evidenceRoot: string
  open: Set<Page>; openBefore: Array<{ viewportWidth: number; open: number }>; newPageCalls: () => number
}
async function run(runId: string, hooks: Hooks = {}, options: Record<string, unknown> = {}, contract?: Parameters<typeof verificationInput>[1], snapshots?: { evidenceRoot: string; resourceSnapshots: unknown[] }): Promise<RunOutcome> {
  const evidenceRoot = snapshots?.evidenceRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-verify-'))
  const events: Array<Record<string, any>> = []
  const instrumented = instrumentedBrowser(hooks)
  const outcome = await executeVerification({
    input: verificationInput(runId, contract, snapshots?.resourceSnapshots), browser: instrumented.browser, evidenceRoot,
    progress: (entry: Record<string, unknown>) => events.push({ ...entry }), ...options,
  }).then((result: Record<string, any>) => ({ result }), (error: unknown) => ({ error }))
  return { ...outcome, events, evidenceRoot, ...instrumented }
}

const assertion = (manifest: Record<string, any>, id: string) => manifest.assertions.find((item: { id: string }) => item.id === id).result
const evidenceFor = (manifest: Record<string, any>, name: string) => manifest.evidence.find((item: { checkId: string }) => item.checkId.endsWith(`-${name}`))
const lifecycle = (events: Array<Record<string, any>>, name: string) => events.find(event => event.event === 'viewport-lifecycle' && String(event.checkId).endsWith(`-${name}`))!
const firstErrorOf = (events: Array<Record<string, any>>, name: string) => events.find(event => event.event === 'first-error' && String(event.checkId).endsWith(`-${name}`))

function expectBoundedAndCleanPages(outcome: RunOutcome) {
  // Never more than one candidate/baseline pair alive; nothing from an earlier
  // viewport is open when the next starts; nothing is open at the end.
  expect(outcome.openBefore.every(item => item.open <= 1)).toBe(true)
  for (const width of VIEWPORTS.map(viewport => viewport.width)) {
    expect(outcome.openBefore.find(item => item.viewportWidth === width)?.open ?? 0).toBe(0)
  }
  expect(outcome.open.size).toBe(0)
  // Only a viewport that failed can have work still settling when it closes;
  // that work stays tagged with its own checkId and the late flag.
  const failed = new Set(outcome.events.filter(event => event.event === 'check-complete' && event.result === 'failed-to-run').map(event => event.checkId))
  for (const viewport of VIEWPORTS) {
    const summary = lifecycle(outcome.events, viewport.name)
    if (!summary) continue
    expect(summary).toMatchObject({ pagesLeaked: 0, unsettled: 0, closeFailures: 0 })
    expect(summary.pagesClosed).toBe(summary.pagesOpened)
    const closedAt = outcome.events.indexOf(summary)
    for (const event of outcome.events.slice(closedAt + 1).filter(item => item.checkId === summary.checkId && item.event !== 'check-complete')) {
      expect(event.late).toBe(true)
      expect(failed.has(summary.checkId)).toBe(true)
    }
  }
  expect(outcome.events.filter(event => event.late && !failed.has(event.checkId))).toEqual([])
}

describe('runner deadline', () => {
  it('derives the runner deadline from the host kill time minus the reserve', () => {
    expect(runnerDeadline({ executionDeadlineAt: 1_000_000 })).toBe(980_000)
    expect(runnerDeadline({ executionDeadlineAt: 1_000_000 }, 5_000)).toBe(995_000)
    expect(runnerDeadline({})).toBe(Infinity)
    expect(runnerDeadline({ executionDeadlineAt: 'soon' })).toBe(Infinity)
  })
})

// The candidate and baseline servers bind loopback aliases 127.0.0.2/.3, which
// Linux and Windows route by default and macOS does not.
describe.skipIf(process.platform === 'darwin')('isolated verification runner lifecycle', () => {
  it('verifies four viewports, both sides of every scope page and the interaction with at most one page pair alive', async () => {
    const outcome = await run('run-pass')
    expect(outcome.error).toBeUndefined()
    const { manifest } = outcome.result!
    for (const id of ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']) {
      expect([id, assertion(manifest, id)]).toEqual([id, 'pass'])
    }
    expect(manifest.completed).toBe(true)
    expect(manifest.scopeObservations).toHaveLength(PAGES.length * VIEWPORTS.length)
    expect(manifest.interactionObservations).toHaveLength(VIEWPORTS.length)
    expect(manifest.scopeObservations.every((item: Record<string, unknown>) => item.baselineRouteIdentity === 'verified' && item.candidateRouteIdentity === 'verified')).toBe(true)
    // One fresh pair each for the main checks (plus the read-only root probe),
    // the three navigated scope pages and the interaction.
    expect(outcome.newPageCalls()).toBe(VIEWPORTS.length * LOADS_PER_VIEWPORT * 2)
    const interactionTasks = outcome.events.filter(event => event.event === 'task' && String(event.task).startsWith('interaction:0:') && event.state === 'completed')
    expect(interactionTasks).toHaveLength(VIEWPORTS.length * 2)
    expectBoundedAndCleanPages(outcome)
    expect(browser.contexts()).toHaveLength(0)
  }, 90_000)

  it('isolates every probe: IndexedDB, pagehide writes and hash routes cannot turn a broken interaction into a PASS', async () => {
    spaOptions.cart = true
    try {
      const cartPage = { pageRef: 'page:cart', path: '/#/cart', markerText: 'Cart page' }
      const outcome = await run('run-isolation', {}, {}, {
        pages: [...PAGES, cartPage],
        interactions: [
          { pageRef: 'page:home', role: 'button', name: 'Add to cart', expectedText: 'Cart (1)' },
          { pageRef: 'page:home', role: 'button', name: 'Quick add', expectedText: 'Cart (1)' },
          { pageRef: 'page:cart', role: 'button', name: 'Quick add', expectedText: 'Cart (1)' },
        ],
      })
      const { manifest } = outcome.result!
      const observations = manifest.interactionObservations as Array<{ interactionIndex: number; baselinePassed: boolean; candidatePassed: boolean; candidateRouteIdentity: string }>
      expect(observations).toHaveLength(3 * VIEWPORTS.length)
      expect(observations.every(item => item.candidateRouteIdentity === 'verified')).toBe(true)
      expect(observations.filter(item => item.interactionIndex === 0).every(item => item.baselinePassed && item.candidatePassed)).toBe(true)
      // The candidate's broken button fails on every viewport, on "/" and on
      // the hash route, while the baseline's working button passes.
      expect(observations.filter(item => item.interactionIndex > 0).every(item => item.baselinePassed && !item.candidatePassed)).toBe(true)
      expect(assertion(manifest, 'interaction')).toBe('risk')
      expectBoundedAndCleanPages(outcome)
    } finally {
      spaOptions.cart = false
    }
  }, 120_000)

  it('never runs an interaction on the screenshotted main pair, where finished animations could hide a regression', async () => {
    spaOptions.introGate = true
    try {
      const outcome = await run('run-intro-gate')
      const { manifest } = outcome.result!
      const observations = manifest.interactionObservations as Array<{ baselinePassed: boolean; candidatePassed: boolean }>
      expect(observations).toHaveLength(VIEWPORTS.length)
      // On a freshly loaded page the candidate's control is still gated.
      expect(observations.every(item => item.baselinePassed && !item.candidatePassed)).toBe(true)
      expect(assertion(manifest, 'interaction')).toBe('risk')
      expectBoundedAndCleanPages(outcome)
    } finally {
      spaOptions.introGate = false
    }
  }, 90_000)

  it('keeps the other side running when one probe task throws, then fails only that viewport', async () => {
    const outcome = await run('run-task-throws', {
      page: (page, { side, viewportWidth }) => {
        if (viewportWidth !== 1440) return {}
        let onStory = false
        return {
          getByRole: (role: string, options: { name: string }) => {
            if (options.name === 'Story') onStory = true
            return page.getByRole(role as 'button', options)
          },
          // The baseline side is slow on the story probe, so it is still
          // running when the candidate side throws.
          locator: (selector: string) => {
            if (side === 'candidate' && onStory && selector === '[data-ripple-source]') throw new TypeError('evaluateAll: Execution context was destroyed')
            if (side === 'baseline' && onStory && selector === '[data-ripple-source]') {
              const real = page.locator(selector)
              return { evaluateAll: async (...args: unknown[]) => { await new Promise(resolve => setTimeout(resolve, 600)); return (real.evaluateAll as (...a: unknown[]) => unknown)(...args) } }
            }
            return page.locator(selector)
          },
        }
      },
    })
    const { manifest } = outcome.result!
    expect(evidenceFor(manifest, 'desktop').result).toBe('failed-to-run')
    expect(evidenceFor(manifest, 'desktop').reason).toContain('Execution context was destroyed')
    for (const name of ['tablet', 'mobile-375', 'mobile-390']) expect(evidenceFor(manifest, name).result).toBe('pass')
    const taskEvents = outcome.events.filter(event => event.event === 'task' && String(event.task).startsWith('scope-probe:page:story'))
    const candidateFailed = taskEvents.findIndex(event => event.task === 'scope-probe:page:story:candidate' && event.state === 'failed')
    const baselineCompleted = taskEvents.findIndex(event => event.task === 'scope-probe:page:story:baseline' && event.state === 'completed')
    expect(candidateFailed).toBeGreaterThanOrEqual(0)
    // The sibling was awaited to completion after the failure, not abandoned.
    expect(baselineCompleted).toBeGreaterThan(candidateFailed)
    expect(firstErrorOf(outcome.events, 'desktop')).toMatchObject({ type: 'TypeError', phase: 'scope-values', pageRef: 'page:story', side: 'candidate' })
    // One failure is one browser error, not one per layer that saw it.
    const desktop = outcome.events.find(event => event.event === 'check-complete' && String(event.checkId).endsWith('-desktop'))!
    expect(desktop.viewportBrowserErrors).toEqual({ 'scope-probe-task-failed': 1 })
    // Results observed before the failure are not merged into the run.
    expect(manifest.scopeObservations.filter((item: { viewport: { width: number } }) => item.viewport.width === 1440)).toEqual([])
    expect(assertion(manifest, 'scope-propagation')).not.toBe('pass')
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('fails a viewport whose browser.newPage() rejects and closes the page that did open', async () => {
    const outcome = await run('run-newpage', {
      newPage: ({ viewportWidth, side, ordinal }) => {
        if (viewportWidth === 768 && side === 'baseline' && ordinal === 1) throw new Error('Protocol error (Target.createTarget): Failed to open a new tab')
      },
    })
    const { manifest } = outcome.result!
    expect(evidenceFor(manifest, 'tablet').result).toBe('failed-to-run')
    expect(evidenceFor(manifest, 'tablet').reason).toContain('Failed to open a new tab')
    expect(evidenceFor(manifest, 'desktop').result).toBe('pass')
    expect(evidenceFor(manifest, 'mobile-390').result).toBe('pass')
    expect(firstErrorOf(outcome.events, 'tablet')).toMatchObject({ phase: 'open-page', side: 'baseline' })
    expect(lifecycle(outcome.events, 'tablet')).toMatchObject({ pagesOpened: 1, pagesClosed: 1, pagesLeaked: 0 })
    expect(assertion(manifest, 'scope-propagation')).toBe('unknown')
    expect(assertion(manifest, 'interaction')).toBe('unknown')
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('fails only the affected viewport when a probe page is slow to open, without aborting the run', async () => {
    const outcome = await run('run-slow-open', {
      newPage: async ({ viewportWidth, side, ordinal }) => {
        if (viewportWidth === 768 && side === 'candidate' && ordinal === 2) await new Promise(resolve => setTimeout(resolve, 1_500))
      },
    }, { openTimeoutMs: 1_000 })
    expect(outcome.error).toBeUndefined()
    const { manifest } = outcome.result!
    expect(evidenceFor(manifest, 'tablet').result).toBe('failed-to-run')
    expect(evidenceFor(manifest, 'tablet').reason).toContain('open candidate page did not settle within 1000ms')
    for (const name of ['desktop', 'mobile-375', 'mobile-390']) expect(evidenceFor(manifest, name).result).toBe('pass')
    expect(outcome.events.find(event => event.event === 'task' && event.task === 'viewport' && String(event.checkId).endsWith('-tablet'))).toBeTruthy()
    expect(outcome.events.filter(event => event.event === 'task' && event.task === 'viewport' && event.state === 'timed-out')).toEqual([])
    expect(firstErrorOf(outcome.events, 'tablet')).toMatchObject({ phase: 'open-page', side: 'candidate', type: 'DeadlineError' })
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('keeps a candidate that never renders as a non-approvable record, not a runner failure', async () => {
    const outcome = await run('run-broken-candidate', {
      page: (_page, { side }) => side === 'candidate'
        ? { waitForFunction: async () => { throw new Error('page.waitForFunction: Timeout 15000ms exceeded.') } }
        : {},
    })
    expect(outcome.error).toBeUndefined()
    const { manifest } = outcome.result!
    for (const viewport of VIEWPORTS) expect(evidenceFor(manifest, viewport.name)).toMatchObject({ result: 'failed-to-run', reason: expect.stringContaining('Timeout 15000ms') })
    expect(firstErrorOf(outcome.events, 'desktop')).toMatchObject({ phase: 'candidate-root', side: 'candidate' })
    expect(manifest.assertions.some((item: { result: string }) => item.result === 'pass')).toBe(false)
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('fails a viewport whose resource route cannot be installed', async () => {
    const outcome = await run('run-route', {
      page: (_page, { viewportWidth }) => viewportWidth === 375 ? { route: async () => { throw new Error('page.route: Target closed') } } : {},
    })
    const { manifest } = outcome.result!
    expect(evidenceFor(manifest, 'mobile-375').result).toBe('failed-to-run')
    expect(firstErrorOf(outcome.events, 'mobile-375')).toMatchObject({ phase: 'prepare-page', message: 'page.route: Target closed' })
    expect(assertion(manifest, 'responsive-layout')).toBe('unknown')
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('times out a hung marker probe, cancels it by closing its pages, and continues cleanly', async () => {
    const outcome = await run('run-hang', {
      page: (page, { side, viewportWidth }) => {
        if (viewportWidth !== 768 || side !== 'candidate') return {}
        let onProducts = false
        return {
          getByRole: (role: string, options: { name: string }) => {
            onProducts = options.name === 'Products'
            return page.getByRole(role as 'button', options)
          },
          getByText: (text: string, options: object) => onProducts && text === 'Products page'
            ? { count: () => hangUntilClosed(page), first: () => page.getByText(text, options).first() }
            : page.getByText(text, options),
        }
      },
    }, { probeDeadlineMs: 2_000 })
    const { manifest } = outcome.result!
    expect(evidenceFor(manifest, 'tablet').result).toBe('failed-to-run')
    expect(evidenceFor(manifest, 'tablet').reason).toContain('did not settle within 2000ms')
    expect(outcome.events.find(event => event.event === 'task' && event.task === 'scope-probe:page:products:candidate' && event.state === 'timed-out')).toBeTruthy()
    expect(firstErrorOf(outcome.events, 'tablet')!.inFlight).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'scope-marker', pageRef: 'page:products', side: 'candidate' })]))
    for (const name of ['desktop', 'mobile-375', 'mobile-390']) expect(evidenceFor(manifest, name).result).toBe('pass')
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('records a navigation failure or a missing declared control as an unverified route, quickly and never as a pass', async () => {
    const outcome = await run('run-nav', {
      page: (_page, { side, viewportWidth, ordinal }) => viewportWidth === 390 && side === 'baseline' && ordinal === 3
        ? { goto: async () => { throw new Error('page.goto: net::ERR_ABORTED at http://127.0.0.3:5173/?session=abc') } }
        : {},
    }, { actionTimeoutMs: 1_000 }, {
      pages: PAGES.map(page => page.pageRef === 'page:story' ? { ...page, navigateBy: { role: 'button', name: 'Our story' } } : page),
      interactions: [HOME_INTERACTION],
    })
    const { manifest } = outcome.result!
    const observation = (pageRef: string, width: number) => manifest.scopeObservations.find((item: { viewport: { width: number }; pageRef: string }) => item.viewport.width === width && item.pageRef === pageRef)
    // The third baseline page at 390 is the products probe.
    expect(observation('page:products', 390)).toMatchObject({ baselineRouteIdentity: 'missing', candidateRouteIdentity: 'verified' })
    // The declared "Our story" control does not exist on any viewport.
    for (const viewport of VIEWPORTS) expect(observation('page:story', viewport.width)).toMatchObject({ baselineRouteIdentity: 'missing', candidateRouteIdentity: 'missing' })
    for (const viewport of VIEWPORTS) expect(evidenceFor(manifest, viewport.name).result).toBe('pass')
    expect(assertion(manifest, 'scope-propagation')).toBe('unknown')
    expect(assertion(manifest, 'browser-errors')).toBe('risk')
    expect(firstErrorOf(outcome.events, 'mobile-390')).toMatchObject({ phase: 'scope-navigate', pageRef: 'page:products', side: 'baseline' })
    expect(JSON.stringify(outcome.events)).not.toContain('session=abc')
    expectBoundedAndCleanPages(outcome)
  }, 90_000)

  it('counts a browser error storm exactly while keeping samples bounded and redacted', async () => {
    spaOptions.consoleErrorsPerLoad = 150
    try {
      const outcome = await run('run-storm')
      const { manifest } = outcome.result!
      // Two sides, four loads each, four viewports.
      const expected = 150 * 2 * LOADS_PER_VIEWPORT * VIEWPORTS.length
      expect(manifest.browserErrorDetails.total).toBe(expected)
      expect(manifest.browserErrorDetails.byCategory).toEqual({ 'console-error': expected })
      expect(manifest.browserErrorDetails.samples.length).toBeLessThanOrEqual(25)
      expect(manifest.browserErrorDetails.truncated).toBe(true)
      expect(manifest.browserErrorDetails.samples.join('\n')).not.toMatch(/sig=|SECRET/)
      const tablet = outcome.events.find(event => event.event === 'check-complete' && String(event.checkId).endsWith('-tablet'))!
      expect(tablet.viewportBrowserErrors).toEqual({ 'console-error': 150 * 2 * LOADS_PER_VIEWPORT })
      expect(assertion(manifest, 'browser-errors')).toBe('risk')
      expectBoundedAndCleanPages(outcome)
    } finally {
      spaOptions.consoleErrorsPerLoad = 0
    }
  }, 90_000)

  it('serves only verified snapshot bytes and blocks a tampered snapshot on every request', async () => {
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-verify-'))
    fs.mkdirSync(path.join(evidenceRoot, 'resources'))
    const { createHash } = await import('node:crypto')
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082', 'hex')
    const digest = createHash('sha256').update(png).digest('hex')
    fs.writeFileSync(path.join(evidenceRoot, 'resources', digest), png)
    fs.writeFileSync(path.join(evidenceRoot, 'resources', 'tampered'), Buffer.concat([png, Buffer.from('x')]))
    const resourceSnapshots = [
      { url: 'https://images.example.test/ok.png', contentType: 'image/png', sha256: digest, artifactPath: `resources/${digest}`, sizeBytes: png.length, source: 'authorized-url' },
      { url: 'https://images.example.test/bad.png', contentType: 'image/png', sha256: digest, artifactPath: 'resources/tampered', sizeBytes: png.length, source: 'authorized-url' },
    ]
    spaOptions.images = resourceSnapshots.map(item => item.url)
    try {
      const outcome = await run('run-snapshots', {}, {}, undefined, { evidenceRoot, resourceSnapshots })
      const { manifest } = outcome.result!
      expect(manifest.loadedExternalResourceUrls).toEqual(['https://images.example.test/ok.png'])
      expect(manifest.blockedExternalResourceUrls).toEqual(['https://images.example.test/bad.png'])
      // Blocked on every load of both sides, never served.
      expect(manifest.browserErrorDetails.byCategory['blocked-integrity']).toBe(2 * LOADS_PER_VIEWPORT * VIEWPORTS.length)
      expect(assertion(manifest, 'browser-errors')).toBe('risk')
      expectBoundedAndCleanPages(outcome)
    } finally {
      spaOptions.images = []
    }
  }, 90_000)

  it('reports a runner failure, not a candidate record, when no viewport can run', async () => {
    const outcome = await run('run-no-pages', {
      newPage: () => { throw new Error('Protocol error (Target.createTarget): Target crashed') },
    })
    expect(outcome.error).toBeInstanceOf(RunnerAborted)
    expect(outcome.error.diagnostic).toMatchObject({ completed: false, status: 'failed-to-run' })
    expect(outcome.error.diagnostic.viewports).toHaveLength(VIEWPORTS.length)
    expect(outcome.error.diagnostic.viewports[0].firstError).toMatchObject({ phase: 'open-page', message: expect.stringContaining('Target crashed') })
    expect(outcome.open.size).toBe(0)
  }, 90_000)

  it('stops before the budget with a diagnostic that cannot be turned into an approvable receipt', async () => {
    const outcome = await run('run-budget', {
      page: (page, { viewportWidth }) => viewportWidth === 768 ? { screenshot: () => hangUntilClosed(page) } : {},
    }, { deadlineAt: Date.now() + 20_000 })
    expect(outcome.error).toBeInstanceOf(RunnerAborted)
    const diagnostic = outcome.error.diagnostic
    expect(diagnostic).toMatchObject({ completed: false, status: 'failed-to-run', notStarted: ['mobile-375', 'mobile-390'] })
    expect(diagnostic.viewports.map((item: { result: string }) => item.result)).toEqual(['pass', 'failed-to-run'])
    // The deadline fired at the viewport level; the diagnostic names the phase
    // that was still in flight.
    expect(diagnostic.viewports[1].firstError).toMatchObject({ phase: 'viewport', type: 'DeadlineError' })
    expect(diagnostic.viewports[1].firstError.inFlight).toEqual([expect.objectContaining({ phase: 'screenshot' })])
    expect(fs.existsSync(path.join(outcome.evidenceRoot, 'execution.json'))).toBe(false)
    expect(outcome.open.size).toBe(0)

    // The host merges the runner diagnostic but never marks it complete.
    const failed = buildFailedToRunDiagnostic({
      runId: 'run-budget', candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 1, baseSourceDigest: 'base',
      patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime', reason: 'budget',
    }, outcome.events, '2026-10-21T00:00:00.000Z', { ...diagnostic, completed: true })
    expect(failed).toMatchObject({ completed: false, status: 'failed-to-run' })
    expect((failed.firstErrors as unknown[]).length).toBeGreaterThan(0)
    const registeredRun = {
      id: 'run-budget', candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 1, baseSourceDigest: 'base',
      patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime', verificationContractHash: 'contract',
    } as unknown as VerificationRun
    const recordPath = path.join(outcome.evidenceRoot, 'failed-to-run.json')
    fs.writeFileSync(recordPath, JSON.stringify(failed))
    expect(() => attestBrowserExecution(registeredRun, recordPath)).toThrow(/does not match this candidate run/)
    // Even shaped as a v4 record with matching identity, completed:false is
    // rejected.
    const shaped = path.join(outcome.evidenceRoot, 'shaped.json')
    fs.writeFileSync(shaped, JSON.stringify({ ...failed, schemaVersion: 4, executor: 'playwright', runId: 'run-budget', verificationContractHash: 'contract', completed: false }))
    expect(() => attestBrowserExecution(registeredRun, shaped)).toThrow(/does not match this candidate run/)
  }, 90_000)
})
