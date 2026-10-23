// Independent real-Chromium trial run for the visual-evidence path.
//
//   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/visual-evidence-real-trial.mjs
//
// Captures real baseline/candidate screenshots of synthetic pages with real
// Chromium (Playwright), samples real DOM geometry, runs them through
// analyzeVisualDifference, and writes a read-only report plus artifact
// references under acceptance-artifacts/real-trial/ for the F workbench.
//
// This is a trial: it never touches VerificationRunner, receipts or gates,
// and it never decides PASS. Conservative semantics are exercised on purpose:
// every scenario records what the evidence MAY claim and nothing more.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { analyzeVisualDifference, serializeVisualEvidence } from '../src/core/visual-evidence.ts'
import { sampleDomGeometryInPage } from '../src/core/visual-geometry-sampler.mjs'

const ORIGIN = 'http://visual-trial.test'
const OUT_ROOT = path.join('acceptance-artifacts', 'real-trial')
const sha = value => createHash('sha256').update(value).digest('hex')

const PROJECT_ID = 'project-real-trial-1'
const BASE_SOURCE_DIGEST = sha('ripple-real-trial:base-source')
const CANDIDATE_TREE_DIGEST = sha('ripple-real-trial:candidate-tree')
const PATCH_HASH = sha('ripple-real-trial:patch')
const RUNTIME_FINGERPRINT = 'real-trial-runtime/chromium'
const IDENTITY = {
  candidateId: 'candidate-real-trial-1', projectId: PROJECT_ID, patchHash: PATCH_HASH,
  baseSourceDigest: BASE_SOURCE_DIGEST, candidateTreeDigest: CANDIDATE_TREE_DIGEST,
  runtimeFingerprint: RUNTIME_FINGERPRINT, scopeDecisionId: 'scope-real-trial-1', scopeVersion: 1,
}
const VIEWPORT = { width: 420, height: 320 }

// --- synthetic pages (solid colours + real text; no external assets) ---------

const pageShell = body => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #ffffff; font-family: system-ui, sans-serif; }
  .annotated { position: absolute; }
</style></head><body>${body}</body></html>`

const homePage = ({ title = 'Autumn collection', ctaTop = 210, mediaPaint = 'landscape' } = {}) => pageShell(`
  <main data-ripple-source="src/pages/Home.tsx#main" data-ripple-instance="App/Home" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:420px;height:420px">
    <h1 data-ripple-source="src/pages/Home.tsx#h1" data-ripple-instance="App/Home/h1" data-ripple-identity-certainty="stable-react-instance" class="annotated" style="margin:0;left:20px;top:20px;width:260px;height:44px;font-size:32px;line-height:44px;color:#111827">${title}</h1>
    <div data-ripple-source="src/components/Media.tsx#frame" data-ripple-instance="App/Home/media" data-ripple-identity-certainty="stable-keyed-instance" class="annotated" style="left:20px;top:90px;width:240px;height:110px;overflow:hidden">
      <div data-ripple-source="src/components/Media.tsx#img" data-ripple-instance="App/Home/media/img" data-ripple-identity-certainty="stable-keyed-instance" style="width:100%;height:100%;background:${mediaPaint === 'landscape'
        ? 'linear-gradient(90deg,#2563eb 0%,#60a5fa 50%,#93c5fd 100%)'
        : 'linear-gradient(180deg,#2563eb 0%,#1e40af 55%,#111827 100%)'}"></div>
    </div>
    <a data-ripple-source="src/components/Cta.tsx#button" data-ripple-instance="App/Home/cta" data-ripple-identity-certainty="stable-react-instance" class="annotated" style="left:20px;top:${ctaTop}px;width:120px;height:36px;background:#f97316;color:#ffffff;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:14px">Shop now</a>
  </main>`)

const productsPage = ({ footer = '#0f766e' } = {}) => pageShell(`
  <main data-ripple-source="src/pages/Products.tsx#main" data-ripple-instance="App/Products" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:420px;height:420px">
    <h1 data-ripple-source="src/pages/Products.tsx#h1" data-ripple-instance="App/Products/h1" data-ripple-identity-certainty="stable-react-instance" class="annotated" style="margin:0;left:20px;top:20px;width:300px;height:44px;font-size:32px;line-height:44px;color:#111827">All products</h1>
    <footer data-ripple-source="src/components/Footer.tsx#bar" data-ripple-instance="App/Products/footer" data-ripple-identity-certainty="stable-react-instance" class="annotated" style="left:0;top:360px;width:420px;height:60px;background:${footer}"></footer>
  </main>`)

// Candidate DOM reuses one runtime instance id for two different elements and
// marks the title as position-dependent: matching must stay ambiguous instead
// of trusting the annotations.
const untrustedIdentityPage = () => pageShell(`
  <main data-ripple-source="src/pages/Home.tsx#main" data-ripple-instance="App/Home" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:420px;height:420px">
    <h1 data-ripple-source="src/pages/Home.tsx#h1" data-ripple-instance="App/Home/h1" data-ripple-identity-certainty="position-dependent" class="annotated" style="margin:0;left:20px;top:20px;width:260px;height:44px;font-size:32px;line-height:44px;color:#111827">Autumn collection</h1>
    <div data-ripple-source="src/components/Media.tsx#frame" data-ripple-instance="App/Home/h1" data-ripple-identity-certainty="stable-keyed-instance" class="annotated" style="left:20px;top:90px;width:240px;height:110px;background:#dbeafe"></div>
  </main>`)

const fontPendingPage = () => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'TrialFace'; src: url('/slow-font.woff2') format('woff2'); font-display: block; }
  html, body { margin: 0; background: #fff; }
</style></head><body>
  <main data-ripple-source="src/pages/Home.tsx#main" data-ripple-instance="App/Home" data-ripple-identity-certainty="stable-react-instance" style="position:relative;width:420px;height:420px">
    <h1 data-ripple-source="src/pages/Home.tsx#h1" data-ripple-instance="App/Home/h1" data-ripple-identity-certainty="stable-react-instance" style="position:absolute;margin:0;left:20px;top:20px;font-family:'TrialFace',system-ui;font-size:36px;line-height:44px;color:#111827">Fonty headline</h1>
  </main>
</body></html>`

// --- capture -----------------------------------------------------------------

let browser
const contexts = []

async function capture(side, route, html, options = {}) {
  const {
    state = 'rendered', fontsReady = true, sourceDigest = side === 'baseline' ? BASE_SOURCE_DIGEST : CANDIDATE_TREE_DIGEST,
    screenshot = 'full', awaitFonts = true, slowFont = false, pageUrlQuery = '',
  } = options
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  contexts.push(context)
  const tab = await context.newPage()
  if (slowFont) {
    await tab.route(`${ORIGIN}/slow-font.woff2`, async route => {
      await new Promise(resolve => setTimeout(resolve, 3000))
      await route.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('not-a-real-font') })
    })
  }
  await tab.route(`${ORIGIN}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
  await tab.goto(`${ORIGIN}${route}${pageUrlQuery}`)
  const observedFontsReady = await tab.evaluate(async shouldAwait => {
    if (!document.fonts || document.fonts.status === 'loaded') return true
    if (!shouldAwait) return false
    await document.fonts.ready
    return document.fonts.status === 'loaded'
  }, awaitFonts).catch(() => null)
  const geometry = await tab.evaluate(sampleDomGeometryInPage, { side, interactionState: state })
  // Stability is MEASURED, never asserted: two consecutive full-page captures
  // must be byte-identical (animations disabled) for the capture to count as
  // stable; this feeds the trusted-risk provenance requirement.
  let bytes = null
  let stable = null
  if (screenshot === 'full' || screenshot === 'corrupt') {
    const first = new Uint8Array(await tab.screenshot({ fullPage: true, animations: 'disabled' }))
    const second = new Uint8Array(await tab.screenshot({ fullPage: true, animations: 'disabled' }))
    stable = sha(first) === sha(second)
    bytes = screenshot === 'corrupt' ? second.slice(0, 64) : second
  }
  const declaredSha256 = bytes ? sha(bytes) : null
  const observed = await tab.evaluate(() => ({ dpr: window.devicePixelRatio, url: location.href, path: `${location.pathname}${location.search}${location.hash}` }))
  return {
    descriptor: {
      side, route: observed.path, pageUrl: observed.url, viewport: tab.viewportSize(), devicePixelRatio: observed.dpr,
      browser: { name: 'chromium', version: browser.version() }, runtimeFingerprint: RUNTIME_FINGERPRINT, interactionState: state,
      sourceDigest,
      capture: { completed: bytes !== null, stable, fullPage: true, animationsDisabled: true, fontsReady: observedFontsReady ?? fontsReady, capturedAt: new Date().toISOString(), scroll: { x: 0, y: 0 } },
      screenshot: { declaredSha256 },
    },
    screenshot: bytes,
    geometry: { ...geometry, screenshotSha256: declaredSha256 },
  }
}

// --- scenarios ---------------------------------------------------------------

const scenarios = [
  {
    name: 'text-change-inside-target',
    expect: 'unknown',
    why: 'A pure text edit changes pixels only inside the declared target; without a geometry rule this is observation, never PASS.',
    targets: ['src/pages/Home.tsx#h1'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', homePage({ title: 'Winter collection' })),
    ],
  },
  {
    name: 'shared-element-change-on-another-route',
    expect: 'unknown',
    why: 'The shared footer is edited; on /products the change lands outside the declared Home target and must be reported as non-target review, not ignored.',
    targets: ['src/pages/Home.tsx#h1'],
    run: async () => [
      await capture('baseline', '/products', productsPage()),
      await capture('candidate', '/products', productsPage({ footer: '#b45309' })),
    ],
  },
  {
    name: 'media-landscape-to-portrait-crop',
    expect: 'unknown',
    why: 'Replacing landscape media with portrait media re-paints the fixed, overflow-hidden frame; the crop region changes while boxes stay stable.',
    targets: ['src/components/Media.tsx#img'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', homePage({ mediaPaint: 'portrait' })),
    ],
  },
  {
    name: 'button-overlap-geometry-risk',
    expect: 'risk',
    why: 'The candidate moves the CTA button over the headline; the new-overlap geometry rule fires on identity-consistent evidence, so the result is risk.',
    targets: ['src/components/Cta.tsx#button'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', homePage({ ctaTop: 30 })),
    ],
  },
  {
    name: 'candidate-from-wrong-version',
    expect: 'stale',
    why: 'The candidate screenshot was produced from an older tree whose digest no longer matches the candidate; evidence is stale and never compared.',
    targets: ['src/components/Cta.tsx#button'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', homePage({ ctaTop: 30 }), { sourceDigest: sha('ripple-real-trial:older-tree') }),
    ],
  },
  {
    name: 'font-loading-state-differs',
    expect: 'unknown',
    why: 'The candidate was captured while the web font was still pending; fonts-not-ready caps confidence even though pixels may be compared.',
    targets: ['src/pages/Home.tsx#h1'],
    run: async () => [
      await capture('baseline', '/', fontPendingPage(), { slowFont: true, awaitFonts: true }),
      await capture('candidate', '/', fontPendingPage(), { slowFont: true, awaitFonts: false }),
    ],
  },
  {
    name: 'missing-screenshot',
    expect: 'not-run',
    why: 'The producer never delivered the candidate screenshot; the comparison cannot run and must say not-run, never pass-by-absence.',
    targets: ['src/pages/Home.tsx#h1'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', homePage(), { screenshot: 'none' }),
    ],
  },
  {
    name: 'corrupt-screenshot',
    expect: 'failed-to-run',
    why: 'The candidate PNG bytes are truncated; decoding fails closed as failed-to-run instead of guessing.',
    targets: ['src/pages/Home.tsx#h1'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', homePage({ title: 'Winter collection' }), { screenshot: 'corrupt' }),
    ],
  },
  {
    name: 'untrusted-dom-identity',
    expect: 'unknown',
    why: 'The candidate reuses one runtime instance id for two elements and marks the title position-dependent; matching stays ambiguous and change stays unattributed.',
    targets: ['src/pages/Home.tsx#h1'],
    run: async () => [
      await capture('baseline', '/', homePage()),
      await capture('candidate', '/', untrustedIdentityPage()),
    ],
  },
]

// --- runner ------------------------------------------------------------------

function writeScenarioArtifacts(dir, scenarioName, baseline, candidate, outcome) {
  const artifacts = {}
  const write = (label, bytes) => {
    if (!bytes) return null
    const name = `${scenarioName}-${label}.png`
    fs.writeFileSync(path.join(dir, name), bytes)
    artifacts[label] = { file: name, sha256: sha(bytes) }
    return name
  }
  write('baseline', baseline?.screenshot)
  write('candidate', candidate?.screenshot)
  const diffName = write('diff', outcome.diffPng)
  const evidence = serializeVisualEvidence(outcome.evidence)
  fs.writeFileSync(path.join(dir, `${scenarioName}-evidence.json`), evidence.text)
  artifacts.evidence = { file: `${scenarioName}-evidence.json`, sha256: evidence.sha256 }
  if (diffName) artifacts.diff = artifacts.diff ?? { file: diffName, sha256: sha(outcome.diffPng) }
  return artifacts
}

async function main() {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true })
  fs.mkdirSync(OUT_ROOT, { recursive: true })
  browser = await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
  const report = {
    schema: 'ripple-visual-real-trial/v1',
    generatedAt: new Date().toISOString(),
    browser: null,
    note: 'Real Chromium captures of synthetic pages; visual evidence is supplementary only and never decides PASS.',
    scenarios: [],
  }
  try {
    report.browser = { name: 'chromium', version: browser.version() }
    let mismatches = 0
    for (const scenario of scenarios) {
      const dir = path.join(OUT_ROOT, scenario.name)
      fs.mkdirSync(dir, { recursive: true })
      const [baseline, candidate] = await scenario.run()
      const outcome = analyzeVisualDifference({
        checkId: `trial-${scenario.name}`, subject: IDENTITY, expected: IDENTITY,
        targets: { sourceRefs: scenario.targets },
        baseline, candidate, diffArtifactPath: `${scenario.name}/${scenario.name}-diff.png`,
      })
      const artifacts = writeScenarioArtifacts(dir, scenario.name, baseline, candidate, outcome)
      const evidence = outcome.evidence
      const entry = {
        name: scenario.name, expected: scenario.expect, result: evidence.result,
        matchedExpectation: evidence.result === scenario.expect,
        resultReason: evidence.resultReason, why: scenario.why,
        comparable: evidence.comparability.comparable,
        findingCodes: evidence.findings.map(finding => finding.code),
        comparabilityReasons: evidence.comparability.reasons.map(reason => reason.code),
        limitations: evidence.comparability.limitations.map(limitation => limitation.code),
        identityStatus: evidence.identity.status,
        changedPixels: evidence.observation?.changedPixels ?? null,
        regionCount: evidence.observation?.regionCount ?? null,
        geometryStatus: evidence.geometry.status,
        artifacts,
      }
      if (!entry.matchedExpectation) mismatches += 1
      report.scenarios.push(entry)
      console.log(`${entry.matchedExpectation ? 'ok  ' : 'DIFF'} ${scenario.name}: expected=${entry.expected} got=${entry.result} (${evidence.resultReason})`)
    }
    report.allMatchedExpectation = mismatches === 0
    fs.writeFileSync(path.join(OUT_ROOT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nreport: ${path.join(OUT_ROOT, 'report.json')}`)
    if (mismatches > 0) process.exitCode = 1
  } finally {
    for (const context of contexts) await context.close().catch(() => {})
    await browser?.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
