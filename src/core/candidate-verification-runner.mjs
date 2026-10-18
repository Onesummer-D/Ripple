import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from '/ripple/node_modules/playwright/index.mjs'

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const outputPath = '/evidence/execution.json'
const viewportPlan = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]
const requiredAssertions = [
  'target-change', 'non-target-preserved', 'scope-propagation', 'interaction',
  'responsive-layout', 'source-mapping', 'browser-errors',
]
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const checks = []
const evidence = []
const artifacts = []
const targetResults = []
const mappedResults = []
const browserErrors = []
let overflowObserved = false
let loadedViewports = 0

const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of viewportPlan) {
    const checkId = `${input.runId}-${viewport.name}`
    const page = await browser.newPage({ viewport })
    const localErrors = []
    page.on('pageerror', error => localErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') localErrors.push(message.text()) })
    let response
    let loaded = false
    let noOverflow = false
    let runtimeState = 'navigation-failed'
    let elementRefs = []
    let screenshotPath
    let screenshotHash
    let failure
    const pageUrl = `http://${input.previewHost}:5173/`
    try {
      response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
      await page.waitForFunction(() => {
        const root = document.querySelector('#root')
        return !!root && !!root.textContent?.trim()
      }, undefined, { timeout: 15_000 })
      loaded = response?.ok() === true
      runtimeState = loaded ? 'rendered' : `http-${response?.status() ?? 'no-response'}`
      if (loaded) loadedViewports += 1
      noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      overflowObserved ||= !noOverflow
      const observed = await page.locator('[data-ripple-source]').evaluateAll(elements => elements.map(element => ({
        sourceRef: element.getAttribute('data-ripple-source') ?? '',
        instanceId: element.getAttribute('data-ripple-instance') ?? '',
        text: (element.textContent ?? '').trim(),
      })))
      elementRefs = [...new Set(observed.map(element => element.sourceRef).filter(Boolean))]
      const expectedRefs = new Set(input.targetBindings.flatMap(binding => binding.sourceRefs))
      const matches = observed.filter(element => expectedRefs.has(element.sourceRef))
      mappedResults.push(input.targetBindings.length > 0 && input.targetBindings.every(binding =>
        binding.sourceRefs.length === 1 && matches.some(element => element.sourceRef === binding.sourceRefs[0] && !!element.instanceId)))
      targetResults.push(input.targetBindings.length > 0 && input.targetBindings.every(binding =>
        binding.sourceRefs.length === 1 && matches.some(element => element.sourceRef === binding.sourceRefs[0] && element.text.includes(binding.expectedText))))
      await page.evaluate(() => document.fonts.ready.then(() => true))
      screenshotPath = `${checkId}.png`
      const absoluteScreenshot = path.join('/evidence', screenshotPath)
      await page.screenshot({ path: absoluteScreenshot, fullPage: true, animations: 'disabled' })
      screenshotHash = sha256(fs.readFileSync(absoluteScreenshot))
      artifacts.push({ checkId, path: screenshotPath, sha256: screenshotHash })
      if (!noOverflow) runtimeState = 'horizontal-overflow'
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      localErrors.push(failure)
      loaded = false
    } finally {
      browserErrors.push(...localErrors)
      const result = !loaded ? 'failed-to-run' : noOverflow ? 'pass' : 'risk'
      const capturedAt = new Date().toISOString()
      checks.push({
        id: checkId, route: '/', viewport: { width: viewport.width, height: viewport.height },
        state: runtimeState, passed: result === 'pass',
      })
      evidence.push({
        id: `evidence-${checkId}`, checkId, result, capturedAt, pageUrl, viewport: { width: viewport.width, height: viewport.height },
        runtimeState, elementRefs, ...(screenshotPath ? { artifactPath: screenshotPath, artifactHash: screenshotHash } : {}),
        ...(failure ? { reason: failure } : {}),
      })
      await page.close()
    }
  }
} finally {
  await browser.close()
}

const all = (values, predicate) => values.length > 0 && values.every(predicate)
const any = (values, predicate) => values.some(predicate)
const assertions = [
  {
    id: 'target-change',
    result: input.targetBindings.length === 0 || loadedViewports !== viewportPlan.length ? 'unknown' : all(targetResults, Boolean) ? 'pass' : any(mappedResults, Boolean) ? 'risk' : 'unknown',
    detail: input.targetBindings.length === 0 ? 'No edited source target has a unique source-to-rendered-element mapping.' : loadedViewports !== viewportPlan.length ? 'Not all planned viewports rendered, so target text was not fully checked.' : all(targetResults, Boolean) ? 'Every edited value appeared in its uniquely mapped rendered source element at all tested viewports.' : any(mappedResults, Boolean) ? 'A uniquely mapped target did not render its requested text in every tested viewport.' : 'The modified source target could not be uniquely associated with rendered elements.',
  },
  { id: 'non-target-preserved', result: 'unknown', detail: 'A separately executed baseline browser comparison is not part of this runner yet.' },
  { id: 'scope-propagation', result: 'unknown', detail: 'Route-state traversal and per-page baseline assertions are not defined for this project.' },
  { id: 'interaction', result: 'unknown', detail: 'No project-specific interaction contract was supplied; arbitrary controls were not activated.' },
  { id: 'responsive-layout', result: overflowObserved ? 'risk' : loadedViewports === viewportPlan.length ? 'pass' : 'unknown', detail: overflowObserved ? 'At least one tested viewport had horizontal document overflow.' : loadedViewports === viewportPlan.length ? 'Candidate rendered without horizontal document overflow at desktop, tablet and mobile widths.' : 'Not all planned viewports rendered, so responsive behavior is incomplete.' },
  {
    id: 'source-mapping',
    result: input.targetBindings.length === 0 || loadedViewports !== viewportPlan.length ? 'unknown' : all(mappedResults, Boolean) ? 'pass' : 'unknown',
    detail: input.targetBindings.length === 0 ? 'No unique source binding was available for the changed targets.' : loadedViewports !== viewportPlan.length ? 'Not all planned viewports rendered, so source mapping is incomplete.' : all(mappedResults, Boolean) ? 'Each changed target source reference matched a rendered annotated element with a runtime instance identity.' : 'At least one changed source target could not be mapped to a rendered annotated element with a runtime instance identity.',
  },
  { id: 'browser-errors', result: browserErrors.length ? 'risk' : loadedViewports === viewportPlan.length ? 'pass' : 'unknown', detail: browserErrors.length ? `${browserErrors.length} browser or page error(s) were observed.` : loadedViewports === viewportPlan.length ? 'No uncaught page or console errors were observed at the tested viewports.' : 'Not all planned viewports rendered, so browser error coverage is incomplete.' },
]

if (assertions.length !== requiredAssertions.length || assertions.some(assertion => !requiredAssertions.includes(assertion.id))) {
  throw new Error('Verification assertion contract is incomplete')
}

const manifest = {
  schemaVersion: 1,
  executor: 'playwright',
  completed: true,
  runId: input.runId,
  candidateId: input.candidateId,
  scopeDecisionId: input.scopeDecisionId,
  scopeVersion: input.scopeVersion,
  baseSourceDigest: input.baseSourceDigest,
  patchHash: input.patchHash,
  candidateTreeDigest: input.candidateTreeDigest,
  runtimeFingerprint: input.runtimeFingerprint,
  checks,
  assertions,
  evidence,
  artifacts,
}
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ runId: input.runId, status: overflowObserved || browserErrors.length ? 'risks' : 'incomplete', checks: checks.length, artifacts: artifacts.length }))
