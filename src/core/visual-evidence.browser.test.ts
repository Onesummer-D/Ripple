// Real Chromium screenshots and DOM geometry through the visual-difference
// pipeline. The pages are synthetic (solid boxes, no text, so no font
// dependence); this verifies capture-to-evidence plumbing and DPR mapping, not
// any real project and not the four-viewport VerificationRunner.
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { analyzeVisualDifference, type VisualComparisonRequest } from './visual-evidence'
import { parseDomGeometrySample } from './visual-geometry'
import { sampleDomGeometryInPage } from './visual-geometry-sampler.mjs'

const ORIGIN = 'http://visual-evidence.test'
const page = (titleHeight: number) => `<!doctype html><html><head><style>
  html, body { margin: 0; background: #fff; }
  .box { position: absolute; }
</style></head><body>
  <main data-ripple-source="src/App.tsx#main" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:360px;height:240px">
    <a data-ripple-source="src/Hero.tsx#cta" data-ripple-instance="App/cta" data-ripple-identity-certainty="stable-react-instance" class="box" style="left:16px;top:60px;width:80px;height:30px;background:#2563eb"></a>
    <h1 data-ripple-source="src/Hero.tsx#h1" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance" class="box" style="margin:0;left:16px;top:16px;width:100px;height:${titleHeight}px;background:#111827"></h1>
    <div style="position:absolute;left:200px;top:16px;width:120px;height:40px;overflow:hidden">
      <p data-ripple-source="src/Card.tsx#p" data-ripple-instance="App/card/p" data-ripple-identity-certainty="stable-keyed-instance" style="margin:0;width:120px;height:20px;background:#94a3b8"></p>
    </div>
    <div style="position:absolute;left:200px;top:120px;width:120px;height:60px;overflow-x:hidden">
      <span data-ripple-source="src/Card.tsx#scroll" data-ripple-instance="App/card/scroll" data-ripple-identity-certainty="stable-keyed-instance" style="display:block;width:100px;height:20px"></span>
    </div>
    <div style="height:200px"></div>
    <div style="width:40px;height:20px;overflow:hidden">
      <b data-ripple-source="src/Card.tsx#escape" data-ripple-instance="App/card/escape" data-ripple-identity-certainty="stable-keyed-instance" style="position:absolute;left:300px;top:0;width:10px;height:10px"></b>
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
  checkId: 'browser-smoke', subject: identity, expected: identity, targets: { sourceRefs: ['src/Hero.tsx#h1'] }, baseline, candidate,
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
    expect(candidate.geometry.elements.find(item => item.sourceRef === 'src/Card.tsx#p')).toMatchObject({ parentId: 'e0', clipRect: { x: 200, y: 16, width: 120, height: 40 }, hiddenClipRect: { x: 200, y: 16, width: 120, height: 40 }, visible: true })
    // overflow-x:hidden cuts horizontally only; vertically the box just scrolls.
    expect(candidate.geometry.elements.find(item => item.sourceRef === 'src/Card.tsx#scroll')).toMatchObject({ clipRect: { x: 200, y: 120, width: 120, height: 60 }, hiddenClipRect: { x: 200, width: 120, y: -1e6, height: 2e6 } })
    // An absolutely positioned child escapes a static overflow:hidden parent.
    expect(candidate.geometry.elements.find(item => item.sourceRef === 'src/Card.tsx#escape')).toMatchObject({ clipRect: null, hiddenClipRect: null })
    const { evidence } = analyzeVisualDifference(request(baseline, candidate))
    expect(evidence.comparability.comparable).toBe(true)
    expect(evidence.inputs.candidate.descriptor).toMatchObject({ devicePixelRatio: 2, route: '/', locationRedacted: true, pageUrl: `${ORIGIN}/` })
    expect(evidence.inputs.candidate.screenshot).toMatchObject({ width: 720, height: 480, hashMatchesDeclared: true })
    expect(evidence.geometry).toMatchObject({ status: 'mapped', target: { status: 'mapped' }, changedPixelsOutsideTarget: 0 })
    // The title grows from 20 to 70 CSS px: CSS y 36–86, device y 72–172.
    expect(evidence.observation!.regions).toEqual([expect.objectContaining({ bbox: { x: 32, y: 72, width: 200, height: 100 }, classification: 'target', changedPixels: 200 * 100 })])
    expect(evidence.geometry.risks.map(risk => [risk.rule, ...risk.elements.map(item => item.sourceRef)])).toEqual([['new-overlap', 'src/Hero.tsx#cta', 'src/Hero.tsx#h1']])
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
})
