// Real React/Vite visual-evidence trial.
//
//   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/visual-evidence-vite-trial.mjs
//
// Builds the fixture in test/fixtures/vite-react-visual twice with real Vite
// (React 19, esbuild automatic JSX — no framework plugin needed), serves each
// build at its own origin through real Chromium, captures baseline/candidate
// with the SAME capture path the verification container uses
// (visual-capture-executor.mjs), analyses on the host, and writes
// baseline/candidate/diff PNGs + evidence JSON per scenario under
// acceptance-artifacts/vite-real-trial/ (F workbench-ready, SHA-256 recorded).
//
// Visual results stay supplementary: an observation is never PASS and a risk
// is a review hint, never an approval.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { build } from 'vite'
import { analyzeVisualDifference, serializeVisualEvidence } from '../src/core/visual-evidence.ts'
import { captureVisualSide } from '../src/core/visual-capture-executor.mjs'

const FIXTURE = path.join('test', 'fixtures', 'vite-react-visual')
const OUT_ROOT = path.join('acceptance-artifacts', 'vite-real-trial')
const BASE_ORIGIN = 'http://vite-base.test'
const CAND_ORIGIN = 'http://vite-cand.test'
const sha = value => createHash('sha256').update(value).digest('hex')

const IDENTITY = {
  candidateId: 'candidate-vite-trial-1', projectId: 'project-vite-trial-1',
  patchHash: sha('ripple-vite-trial:patch'), baseSourceDigest: sha('ripple-vite-trial:base-source'),
  candidateTreeDigest: sha('ripple-vite-trial:candidate-tree'), runtimeFingerprint: 'vite-trial-runtime/chromium',
  scopeDecisionId: 'scope-vite-trial-1', scopeVersion: 1,
}

async function buildVariant(name, tokens) {
  const root = path.join(os.tmpdir(), `ripple-vite-fixture-${name}-${Date.now()}`)
  fs.cpSync(FIXTURE, root, { recursive: true })
  const appPath = path.join(root, 'src', 'App.jsx')
  let source = fs.readFileSync(appPath, 'utf8')
  for (const [token, value] of Object.entries(tokens)) source = source.split(token).join(value)
  fs.writeFileSync(appPath, source)
  // The fixture is built from a temp copy, so bare 'react' imports cannot
  // resolve upward; alias them at the repository's locked copies (the same
  // versions the runner container mounts).
  const nodeModules = path.join(process.cwd(), 'node_modules')
  await build({
    root, configFile: false, logLevel: 'silent',
    esbuild: { jsx: 'automatic' },
    resolve: { alias: [
      { find: 'react', replacement: path.join(nodeModules, 'react') },
      { find: 'react-dom', replacement: path.join(nodeModules, 'react-dom') },
    ] },
    build: { outDir: 'dist', minify: false, emptyOutDir: true },
  })
  const dist = path.join(root, 'dist')
  const files = new Map()
  for (const file of fs.readdirSync(path.join(dist, 'assets'))) {
    files.set(`/assets/${file}`, fs.readFileSync(path.join(dist, 'assets', file)))
  }
  files.set('/', fs.readFileSync(path.join(dist, 'index.html')))
  return { root, files }
}

function serve(page, origin, variant) {
  return page.route(`${origin}/**`, route => {
    const url = new URL(route.request().url())
    const body = variant.files.get(url.pathname)
    if (!body) return route.fulfill({ status: 404, body: 'not found' })
    const type = url.pathname.endsWith('.html') || url.pathname === '/'
      ? 'text/html; charset=utf-8'
      : url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream'
    return route.fulfill({ status: 200, contentType: type, body })
  })
}

async function capture(browser, origin, variant, side) {
  const context = await browser.newContext({ viewport: { width: 420, height: 320 }, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    await serve(page, origin, variant)
    await page.goto(origin + '/')
    await page.waitForSelector('#root', { state: 'attached', timeout: 10_000 })
    return await captureVisualSide(page, {
      side, route: '/', interactionState: 'rendered',
      sourceDigest: side === 'baseline' ? IDENTITY.baseSourceDigest : IDENTITY.candidateTreeDigest,
      runtimeFingerprint: IDENTITY.runtimeFingerprint, browser: { name: 'chromium', version: browser.version() },
    })
  } finally {
    await context.close()
  }
}

const scenarios = [
  {
    name: 'text-change-inside-target',
    expect: 'unknown',
    base: { __RIPPLE_TRIAL_TITLE__: 'Autumn collection', __RIPPLE_TRIAL_CTA_TOP__: '210' },
    candidate: { __RIPPLE_TITLE__: undefined, __RIPPLE_TRIAL_TITLE__: 'Winter collection', __RIPPLE_TRIAL_CTA_TOP__: '210' },
    targets: ['src/App.jsx#h1'],
    why: 'A real Vite/React text edit: pixels change only inside the declared target; observation, never PASS.',
  },
  {
    name: 'button-overlap-geometry-risk',
    expect: 'risk',
    base: { __RIPPLE_TRIAL_TITLE__: 'Autumn collection', __RIPPLE_TRIAL_CTA_TOP__: '210' },
    candidate: { __RIPPLE_TRIAL_TITLE__: 'Autumn collection', __RIPPLE_TRIAL_CTA_TOP__: '30' },
    targets: ['src/components/Cta.jsx#button'],
    why: 'The candidate moves the CTA over the headline; identity-consistent new-overlap geometry rule fires → risk (review, not approval).',
  },
]

async function main() {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true })
  fs.mkdirSync(OUT_ROOT, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
  const report = { schema: 'ripple-visual-vite-trial/v1', generatedAt: new Date().toISOString(), browser: null, note: 'Real Vite build + real Chromium capture through the verification capture path; visual evidence is supplementary and never decides PASS.', scenarios: [] }
  try {
    report.browser = { name: 'chromium', version: browser.version() }
    let mismatches = 0
    for (const scenario of scenarios) {
      const baseVariant = await buildVariant(`${scenario.name}-base`, scenario.base)
      const candidateVariant = await buildVariant(`${scenario.name}-cand`, scenario.candidate)
      try {
        const baseline = await capture(browser, BASE_ORIGIN, baseVariant, 'baseline')
        const candidate = await capture(browser, CAND_ORIGIN, candidateVariant, 'candidate')
        const outcome = analyzeVisualDifference({
          checkId: `vite-${scenario.name}`, subject: IDENTITY, expected: IDENTITY,
          targets: { sourceRefs: scenario.targets },
          baseline, candidate, diffArtifactPath: `${scenario.name}/diff.png`,
        })
        const dir = path.join(OUT_ROOT, scenario.name)
        fs.mkdirSync(dir, { recursive: true })
        const write = (file, bytes) => { fs.writeFileSync(path.join(dir, file), bytes); return { file, sha256: sha(bytes) } }
        const artifacts = {
          baseline: write('baseline.png', baseline.screenshot),
          candidate: write('candidate.png', candidate.screenshot),
        }
        if (outcome.diffPng) artifacts.diff = write('diff.png', outcome.diffPng)
        const evidence = serializeVisualEvidence(outcome.evidence)
        fs.writeFileSync(path.join(dir, 'evidence.json'), evidence.text)
        artifacts.evidence = { file: 'evidence.json', sha256: evidence.sha256 }
        const entry = {
          name: scenario.name, expected: scenario.expect, result: outcome.evidence.result,
          matchedExpectation: outcome.evidence.result === scenario.expect,
          resultReason: outcome.evidence.resultReason, why: scenario.why,
          identityStatus: outcome.evidence.identity.status,
          comparable: outcome.evidence.comparability.comparable,
          changedPixels: outcome.evidence.observation?.changedPixels ?? null,
          regionCount: outcome.evidence.observation?.regionCount ?? null,
          findingCodes: outcome.evidence.findings.map(finding => finding.code),
          limitations: outcome.evidence.comparability.limitations.map(limitation => limitation.code),
          artifacts,
        }
        if (!entry.matchedExpectation) mismatches += 1
        report.scenarios.push(entry)
        console.log(`${entry.matchedExpectation ? 'ok  ' : 'DIFF'} ${scenario.name}: expected=${scenario.expect} got=${entry.result}`)
      } finally {
        fs.rmSync(baseVariant.root, { recursive: true, force: true })
        fs.rmSync(candidateVariant.root, { recursive: true, force: true })
      }
    }
    report.allMatchedExpectation = mismatches === 0
    fs.writeFileSync(path.join(OUT_ROOT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nreport: ${path.join(OUT_ROOT, 'report.json')}`)
    if (mismatches > 0) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
