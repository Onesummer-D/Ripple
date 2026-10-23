// Real Chromium screenshots and DOM geometry through the visual-difference
// pipeline. The pages are synthetic (solid boxes, no text, so no font
// dependence); this verifies capture-to-evidence plumbing and DPR mapping, not
// any real project and not the four-viewport VerificationRunner.
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { analyzeVisualDifference, type VisualComparisonRequest } from './visual-evidence'
import { parseDomGeometrySample } from './visual-geometry'
import { buildDomGeometrySampler, sampleDomGeometryInPage } from './visual-geometry-sampler.mjs'
import { collectRuntimeIdentitySnapshot } from './runtime-identity'

const ORIGIN = 'http://visual-evidence.test'
const page = (titleHeight: number) => `<!doctype html><html><head><style>
  html, body { margin: 0; background: #fff; }
  .box { position: absolute; }
</style></head><body>
  <main data-ripple-source="jsx:src/App.tsx#1" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:360px;height:240px">
    <a data-ripple-source="jsx:src/Hero.tsx#2" data-ripple-instance="App/cta" data-ripple-identity-certainty="stable-react-instance" class="box" style="left:16px;top:60px;width:80px;height:30px;background:#2563eb"></a>
    <h1 data-ripple-source="jsx:src/Hero.tsx#3" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance" class="box" style="margin:0;left:16px;top:16px;width:100px;height:${titleHeight}px;background:#111827"></h1>
    <div style="position:absolute;left:200px;top:16px;width:120px;height:40px;overflow:hidden">
      <p data-ripple-source="jsx:src/Card.tsx#4" data-ripple-instance="App/card/p" data-ripple-identity-certainty="stable-keyed-instance" style="margin:0;width:120px;height:20px;background:#94a3b8"></p>
    </div>
    <div style="position:absolute;left:200px;top:120px;width:120px;height:60px;overflow-x:hidden">
      <span data-ripple-source="jsx:src/Card.tsx#5" data-ripple-instance="App/card/scroll" data-ripple-identity-certainty="stable-keyed-instance" style="display:block;width:100px;height:20px"></span>
    </div>
    <div style="height:200px"></div>
    <div style="width:40px;height:20px;overflow:hidden">
      <b data-ripple-source="jsx:src/Card.tsx#6" data-ripple-instance="App/card/escape" data-ripple-identity-certainty="stable-keyed-instance" style="position:absolute;left:300px;top:0;width:10px;height:10px"></b>
    </div>
  </main>
</body></html>`

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
})
afterAll(async () => { await browser?.close() })

async function capture(side: 'baseline' | 'candidate', html: string, deviceScaleFactor: number, state = 'rendered') {
  const context = await browser.newContext({ viewport: { width: 360, height: 240 }, deviceScaleFactor })
  try {
    const tab = await context.newPage()
    await tab.route(`${ORIGIN}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
    await tab.goto(`${ORIGIN}/?token=never-recorded`)
    const geometry = await tab.evaluate(sampleDomGeometryInPage, { side, interactionState: state })
    const screenshot = new Uint8Array(await tab.screenshot({ fullPage: true, animations: 'disabled' }))
    const sha256 = createHash('sha256').update(screenshot).digest('hex')
    const observed = await tab.evaluate(() => ({ dpr: window.devicePixelRatio, url: location.href, path: `${location.pathname}${location.search}${location.hash}` }))
    const viewport = tab.viewportSize()
    return {
      descriptor: {
        side, route: observed.path, pageUrl: observed.url, viewport, devicePixelRatio: observed.dpr,
        browser: { name: 'chromium', version: browser.version() }, runtimeFingerprint: 'browser-test-runtime', interactionState: state,
        sourceDigest: side === 'baseline' ? 'base-digest' : 'tree-digest',
        capture: { completed: true, stable: true, fullPage: true, animationsDisabled: true, fontsReady: true, capturedAt: new Date().toISOString(), scroll: { x: 0, y: 0 } },
        screenshot: { declaredSha256: sha256 },
      },
      screenshot,
      geometry: { ...geometry, screenshotSha256: sha256 },
    }
  } finally {
    await context.close()
  }
}

const identity = { candidateId: 'c1', patchHash: 'p1', baseSourceDigest: 'base-digest', candidateTreeDigest: 'tree-digest', runtimeFingerprint: 'browser-test-runtime', scopeDecisionId: 's1', scopeVersion: 1 }
const request = (baseline: Awaited<ReturnType<typeof capture>>, candidate: Awaited<ReturnType<typeof capture>>): VisualComparisonRequest => ({
  checkId: 'browser-smoke', subject: identity, expected: identity, targets: { sourceRefs: ['jsx:src/Hero.tsx#3'] }, baseline, candidate,
})

describe('visual difference evidence from real Chromium captures', () => {
  it('returns one element beyond the limit so oversized pages are rejected, not silently truncated', async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 240 } })
    try {
      const tab = await context.newPage()
      await tab.setContent(page(20))
      const sample = await tab.evaluate(sampleDomGeometryInPage, { side: 'candidate' as const, interactionState: 'rendered', maxElements: 2 })
      expect(sample.elements).toHaveLength(3) // maxElements + 1 of the 6 annotated elements
      expect(parseDomGeometrySample({ ...sample, route: '/' }, 'candidate', { maxElements: 2 })).toMatchObject({ ok: false })
    } finally {
      await context.close()
    }
  })

  it('maps DPR-2 DOM geometry onto the screenshot and flags the new overlap', async () => {
    const baseline = await capture('baseline', page(20), 2)
    const candidate = await capture('candidate', page(70), 2)
    expect(candidate.geometry).toMatchObject({ route: '/', devicePixelRatio: 2, viewport: { width: 360, height: 240 }, coordinateSpace: 'document' })
    // The card paragraph carries the padding box of its overflow:hidden ancestor.
    expect(candidate.geometry.elements.find(item => item.sourceRef === 'jsx:src/Card.tsx#4')).toMatchObject({ parentId: 'e0', clipRect: { x: 200, y: 16, width: 120, height: 40 }, hiddenClipRect: { x: 200, y: 16, width: 120, height: 40 }, visible: true })
    // overflow-x:hidden cuts horizontally only; vertically the box just scrolls.
    expect(candidate.geometry.elements.find(item => item.sourceRef === 'jsx:src/Card.tsx#5')).toMatchObject({ clipRect: { x: 200, y: 120, width: 120, height: 60 }, hiddenClipRect: { x: 200, width: 120, y: -1e6, height: 2e6 } })
    // An absolutely positioned child escapes a static overflow:hidden parent.
    expect(candidate.geometry.elements.find(item => item.sourceRef === 'jsx:src/Card.tsx#6')).toMatchObject({ clipRect: null, hiddenClipRect: null })
    const { evidence } = analyzeVisualDifference(request(baseline, candidate))
    expect(evidence.comparability.comparable).toBe(true)
    expect(evidence.inputs.candidate.descriptor).toMatchObject({ devicePixelRatio: 2, route: '/', locationRedacted: true, pageUrl: `${ORIGIN}/` })
    expect(evidence.inputs.candidate.screenshot).toMatchObject({ width: 720, height: 480, hashMatchesDeclared: true })
    expect(evidence.geometry).toMatchObject({ status: 'mapped', target: { status: 'mapped' }, changedPixelsOutsideTarget: 0 })
    // The title grows from 20 to 70 CSS px: CSS y 36–86, device y 72–172.
    expect(evidence.observation!.regions).toEqual([expect.objectContaining({ bbox: { x: 32, y: 72, width: 200, height: 100 }, classification: 'target', changedPixels: 200 * 100 })])
    expect(evidence.geometry.risks.map(risk => [risk.rule, ...risk.elements.map(item => item.sourceRef)])).toEqual([['new-overlap', 'jsx:src/Hero.tsx#2', 'jsx:src/Hero.tsx#3']])
    expect(evidence.result).toBe('risk')
    expect(evidence.geometry.matching).toMatchObject({ matched: 6, stableMatched: 6, unidentified: { baseline: 0, candidate: 0 } })
  })

  it('reports identical renders as unchanged without promoting them to PASS', async () => {
    const { evidence } = analyzeVisualDifference(request(await capture('baseline', page(20), 1), await capture('candidate', page(20), 1)))
    expect(evidence.observation).toMatchObject({ outcome: 'unchanged', changedPixels: 0 })
    expect(evidence.result).toBe('unknown')
  })

  it('refuses captures taken at different device pixel ratios or interaction states', async () => {
    const dpr = analyzeVisualDifference(request(await capture('baseline', page(20), 1), await capture('candidate', page(20), 2))).evidence
    expect(dpr.comparability.reasons.map(reason => reason.code)).toEqual(['device-pixel-ratio-mismatch', 'image-size-mismatch'])
    const state = analyzeVisualDifference(request(await capture('baseline', page(20), 1), await capture('candidate', page(20), 1, 'after:button:Open'))).evidence
    expect(state.comparability.reasons.map(reason => reason.code)).toEqual(['interaction-state-mismatch'])
  })

  describe('C+D identity wiring (registry + embedded collector)', () => {
    const APP_V = 'a'.repeat(64)
    const HERO_V = 'e'.repeat(64)
    const CARD_V = 'c'.repeat(64)
    // addInitScript serializes the function: closures do NOT survive. All data
    // must travel in the single arg tuple.
    const registryInit = ([key, versions, ambiguous]: [string, Record<string, string>, string[]]) => {
      const sourceVersions = new Map(Object.entries(versions))
      const sourceVersionHistory = new Map(Object.entries(versions).map(([file, digest]) => [file, new Set(ambiguous.includes(file) ? [digest, 'f'.repeat(64)] : [digest])]))
      Object.defineProperty(globalThis, Symbol.for(key), { value: { protocol: 'ripple-runtime-identity/v1', sourceVersions, sourceVersionHistory }, configurable: true })
    }
    const registryArg = (versions: Record<string, string>, ambiguous: string[] = []): [string, Record<string, string>, string[]] => ['ripple.runtime-identity', versions, ambiguous]

    async function captureWithRegistry(html: string, versions: Record<string, string>, ambiguous: string[] = []) {
      const context = await browser.newContext({ viewport: { width: 360, height: 240 } })
      try {
        const tab = await context.newPage()
        await tab.addInitScript(registryInit, registryArg(versions, ambiguous))
        await tab.route(`${ORIGIN}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
        await tab.goto(`${ORIGIN}/`)
        const sampler = buildDomGeometrySampler(collectRuntimeIdentitySnapshot.toString())
        const sample = await tab.evaluate(sampler, { side: 'candidate' as const, interactionState: 'rendered' })
        const parsed = parseDomGeometrySample(sample, 'candidate')
        return { sample, parsed }
      } finally {
        await context.close()
      }
    }

    it('reads per-file served versions from the C+D registry and C+D reasons from the embedded collector', async () => {
      const { sample, parsed } = await captureWithRegistry(page(20), { 'src/App.tsx': APP_V, 'src/Hero.tsx': HERO_V, 'src/Card.tsx': CARD_V })
      expect(parsed.ok).toBe(true)
      expect(sample.sourceFileVersions).toEqual({ 'src/App.tsx': APP_V, 'src/Hero.tsx': HERO_V, 'src/Card.tsx': CARD_V })
      // Multi-file page: the legacy single-file field must stay null.
      expect(sample.sourceVersion).toBeNull()
      expect(sample.pageContext).toEqual({ pathname: '/', search: '', hash: '' })
      // C+D collector-derived reasons are present per element (empty array =
      // collector found no downgrade reason, still C+D's own verdict).
      expect(sample.elements).toHaveLength(6)
      for (const element of sample.elements) {
        expect(Array.isArray(element.identityReasons), `element ${element.id} must carry C+D collection reasons`).toBe(true)
        expect(element.identityReasons!.every(reason => reason !== 'duplicate-runtime-instance')).toBe(true)
      }
    })

    it('flags duplicate runtime instance ids with the C+D blocking reason', async () => {
      const duplicate = page(20).replace('data-ripple-instance="App/h1"', 'data-ripple-instance="App/cta"')
      const { sample, parsed } = await captureWithRegistry(duplicate, { 'src/App.tsx': APP_V, 'src/Hero.tsx': HERO_V, 'src/Card.tsx': CARD_V })
      expect(parsed.ok).toBe(true)
      const cta = sample.elements.find(element => element.sourceRef === 'jsx:src/Hero.tsx#2')!
      const h1 = sample.elements.find(element => element.sourceRef === 'jsx:src/Hero.tsx#3')!
      expect(cta.identityReasons).toContain('duplicate-runtime-instance')
      expect(h1.identityReasons).toContain('duplicate-runtime-instance')
    })

    it('omits ambiguous-version files instead of attributing them to either digest', async () => {
      const { sample } = await captureWithRegistry(page(20), { 'src/App.tsx': APP_V, 'src/Hero.tsx': HERO_V, 'src/Card.tsx': CARD_V }, ['src/Hero.tsx'])
      expect(sample.sourceFileVersions).toEqual({ 'src/App.tsx': APP_V, 'src/Card.tsx': CARD_V })
      // 页面实际引用多个文件：歧义文件被省略后 legacy 单字段必须保持 null，
      // 即使解析后的映射恰好只剩一个条目。
      expect(sample.sourceVersion).toBeNull()
    })

    it('P1 负例: 两个来源文件只有一个有效版本时 sourceVersion 必须为 null', async () => {
      // 页面实际引用 App.tsx 与 Hero.tsx；Hero.tsx 未注册（版本缺失），
      // 解析映射只剩 App.tsx 一个条目。单文件判定必须依据页面实际引用
      // 集合，而不是解析后映射的条目数。
      const twoFiles = `<!doctype html><html><body>
        <main data-ripple-source="jsx:src/App.tsx#1" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:200px;height:100px">
          <h1 data-ripple-source="jsx:src/Hero.tsx#2" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance" style="margin:0;width:100px;height:20px">T</h1>
        </main>
      </body></html>`
      const { sample, parsed } = await captureWithRegistry(twoFiles, { 'src/App.tsx': APP_V })
      expect(parsed.ok).toBe(true)
      expect(sample.sourceFileVersions).toEqual({ 'src/App.tsx': APP_V })
      expect(sample.sourceVersion).toBeNull()
    })

    it('P1 正例: 真实单文件页且版本有效时才填 legacy sourceVersion', async () => {
      const oneFile = `<!doctype html><html><body>
        <main data-ripple-source="jsx:src/App.tsx#1" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:200px;height:100px">
          <h1 data-ripple-source="jsx:src/App.tsx#2" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance" style="margin:0;width:100px;height:20px">T</h1>
        </main>
      </body></html>`
      const { sample } = await captureWithRegistry(oneFile, { 'src/App.tsx': APP_V })
      expect(sample.sourceFileVersions).toEqual({ 'src/App.tsx': APP_V })
      expect(sample.sourceVersion).toBe(APP_V)
    })

    it('degrades to null identity reasons without a collector source but still reads the registry', async () => {
      const context = await browser.newContext({ viewport: { width: 360, height: 240 } })
      try {
        const tab = await context.newPage()
        await tab.addInitScript(registryInit, registryArg({ 'src/App.tsx': APP_V, 'src/Hero.tsx': HERO_V, 'src/Card.tsx': CARD_V }))
        await tab.route(`${ORIGIN}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: page(20) }))
        await tab.goto(`${ORIGIN}/`)
        const sample = await tab.evaluate(sampleDomGeometryInPage, { side: 'candidate' as const, interactionState: 'rendered' })
        expect(sample.sourceFileVersions).toEqual({ 'src/App.tsx': APP_V, 'src/Hero.tsx': HERO_V, 'src/Card.tsx': CARD_V })
        expect(sample.elements.every(element => element.identityReasons === null || element.identityReasons === undefined)).toBe(true)
      } finally {
        await context.close()
      }
    })
  })
})
