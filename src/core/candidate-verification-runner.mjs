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
const baselineComparisons = []
const scopeObservations = []
const interactionObservations = []
const targetResults = []
const mappedResults = []
const nonTargetResults = []
const browserErrors = []
let overflowObserved = false
let loadedViewports = 0

async function snapshotOutsideTargets(page, bindings, baseline) {
  const specs = bindings.map(binding => ({
    operationId: binding.operationId,
    sourceRefs: baseline ? binding.baselineSourceRefs : binding.sourceRefs,
    text: baseline ? binding.beforeText : binding.expectedText,
  }))
  return page.evaluate(specs => {
    const root = document.querySelector('#root')
    if (!root) return { ok: false, reason: 'The rendered application root is missing.' }
    const clone = root.cloneNode(true)
    const allElements = [clone, ...Array.from(clone.querySelectorAll('*'))].filter(node => node instanceof Element)
    const maskedOperationIds = []
    for (const spec of specs) {
      if (spec.sourceRefs.length !== 1 || !spec.text.trim()) return { ok: false, reason: `Source binding for ${spec.operationId} is not unique.` }
      const targets = allElements.filter(element => element.getAttribute('data-ripple-source') === spec.sourceRefs[0])
      if (!targets.length) return { ok: false, reason: `Source target for ${spec.operationId} is not rendered.` }
      let matchedInstances = 0
      for (const target of targets) {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
        const matches = []
        while (walker.nextNode()) if ((walker.currentNode.textContent ?? '').trim() === spec.text.trim()) matches.push(walker.currentNode)
        if (matches.length) matchedInstances += 1
        for (const node of matches) node.textContent = `__RIPPLE_TARGET_${spec.operationId}__`
      }
      if (matchedInstances !== targets.length) return { ok: false, reason: `Not every rendered instance of ${spec.operationId} contains the expected target text.` }
      maskedOperationIds.push(spec.operationId)
    }
    const clonedElements = [clone, ...Array.from(clone.querySelectorAll('*'))].filter(node => node instanceof Element)
    for (const element of clonedElements) for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-ripple-')) element.removeAttribute(attribute.name)
    }
    for (const input of Array.from(clone.querySelectorAll('input,textarea,select'))) {
      if (input instanceof HTMLInputElement) input.setAttribute('value', input.value)
      else if (input instanceof HTMLTextAreaElement) input.textContent = input.value
      else if (input instanceof HTMLSelectElement) input.setAttribute('data-ripple-selected-index', String(input.selectedIndex))
    }
    return { ok: true, snapshot: clone.outerHTML, maskedOperationIds }
  }, specs)
}

async function visitContractPage(page, host, spec) {
  await page.goto(`http://${host}:5173${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => !!document.querySelector('#root')?.textContent?.trim(), undefined, { timeout: 15_000 })
  if (spec.navigateBy) await page.getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true }).click()
  return page.getByText(spec.markerText, { exact: true }).first().isVisible().catch(() => false)
}

async function mappedValues(page, sourceRef) {
  return page.locator('[data-ripple-source]').evaluateAll((elements, ref) => elements
    .filter(element => element.getAttribute('data-ripple-source') === ref)
    .map(element => (element.textContent ?? '').trim()), sourceRef)
}

async function visitWithErrors(spec, host, viewport) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  try {
    const markerVisible = await visitContractPage(page, host, spec)
    return { page, markerVisible }
  } catch (error) {
    browserErrors.push(error instanceof Error ? error.message : String(error))
    return { page, markerVisible: false }
  }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of viewportPlan) {
    const checkId = `${input.runId}-${viewport.name}`
    const page = await browser.newPage({ viewport })
    const baselinePage = await browser.newPage({ viewport })
    const localErrors = []
    page.on('pageerror', error => localErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') localErrors.push(message.text()) })
    baselinePage.on('pageerror', error => localErrors.push(`Baseline: ${error.message}`))
    baselinePage.on('console', message => { if (message.type() === 'error') localErrors.push(`Baseline: ${message.text()}`) })
    let response
    let baselineResponse
    let loaded = false
    let baselineLoaded = false
    let noOverflow = false
    let runtimeState = 'navigation-failed'
    let elementRefs = []
    let screenshotPath
    let screenshotHash
    let failure
    const pageUrl = `http://${input.previewHost}:5173/`
    try {
      response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      baselineResponse = await baselinePage.goto(`http://${input.baselineHost}:5173/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
      await baselinePage.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
      await page.waitForFunction(() => {
        const root = document.querySelector('#root')
        return !!root && !!root.textContent?.trim()
      }, undefined, { timeout: 15_000 })
      await baselinePage.waitForFunction(() => {
        const root = document.querySelector('#root')
        return !!root && !!root.textContent?.trim()
      }, undefined, { timeout: 15_000 })
      loaded = response?.ok() === true
      baselineLoaded = baselineResponse?.ok() === true
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
      if (loaded && baselineLoaded) {
        const [baselineSnapshot, candidateSnapshot] = await Promise.all([
          snapshotOutsideTargets(baselinePage, input.targetBindings, true),
          snapshotOutsideTargets(page, input.targetBindings, false),
        ])
        if (baselineSnapshot.ok && candidateSnapshot.ok) {
          const baselineBytes = Buffer.byteLength(baselineSnapshot.snapshot)
          const candidateBytes = Buffer.byteLength(candidateSnapshot.snapshot)
          if (baselineBytes > 2 * 1024 * 1024 || candidateBytes > 2 * 1024 * 1024) {
            baselineComparisons.push({ route: '/', viewport: { width: viewport.width, height: viewport.height }, maskedOperationIds: [], matched: false, reason: 'Canonical DOM comparison exceeded the 2 MiB evidence limit.' })
            nonTargetResults.push(null)
          } else {
            const baselineDigest = sha256(Buffer.from(baselineSnapshot.snapshot))
            const candidateDigest = sha256(Buffer.from(candidateSnapshot.snapshot))
            const matched = baselineDigest === candidateDigest
            const comparisonPath = `${checkId}-baseline.json`
            const comparisonBytes = Buffer.from(JSON.stringify({
              schemaVersion: 1, route: '/', viewport: { width: viewport.width, height: viewport.height },
              baselineSnapshot: baselineSnapshot.snapshot, candidateSnapshot: candidateSnapshot.snapshot,
              maskedOperationIds: baselineSnapshot.maskedOperationIds,
            }, null, 2))
            if (comparisonBytes.length > 4 * 1024 * 1024) {
              baselineComparisons.push({ route: '/', viewport: { width: viewport.width, height: viewport.height }, maskedOperationIds: [], matched: false, reason: 'Serialized DOM comparison exceeded the 4 MiB evidence limit.' })
              nonTargetResults.push(null)
            } else {
              fs.writeFileSync(path.join('/evidence', comparisonPath), comparisonBytes, { flag: 'wx' })
              baselineComparisons.push({
                route: '/', viewport: { width: viewport.width, height: viewport.height }, baselineDigest, candidateDigest,
                maskedOperationIds: baselineSnapshot.maskedOperationIds, matched,
                artifactPath: comparisonPath, artifactHash: sha256(comparisonBytes),
              })
              nonTargetResults.push(matched)
            }
          }
        } else {
          baselineComparisons.push({
            route: '/', viewport: { width: viewport.width, height: viewport.height }, maskedOperationIds: [], matched: false,
            reason: !baselineSnapshot.ok ? baselineSnapshot.reason : candidateSnapshot.reason,
          })
          nonTargetResults.push(null)
        }
      } else nonTargetResults.push(null)
      await page.evaluate(() => document.fonts.ready.then(() => true))
      screenshotPath = `${checkId}.png`
      const absoluteScreenshot = path.join('/evidence', screenshotPath)
      await page.screenshot({ path: absoluteScreenshot, fullPage: true, animations: 'disabled' })
      screenshotHash = sha256(fs.readFileSync(absoluteScreenshot))
      artifacts.push({ checkId, path: screenshotPath, sha256: screenshotHash })
      if (!noOverflow) runtimeState = 'horizontal-overflow'

      for (const spec of input.verificationContract?.pages ?? []) {
        const [baselineProbe, candidateProbe] = await Promise.all([
          visitWithErrors(spec, input.baselineHost, viewport),
          visitWithErrors(spec, input.previewHost, viewport),
        ])
        const operations = []
        for (const binding of input.targetBindings) {
          const [baselineValues, candidateValues] = await Promise.all([
            binding.baselineSourceRefs.length === 1 ? mappedValues(baselineProbe.page, binding.baselineSourceRefs[0]) : [],
            binding.sourceRefs.length === 1 ? mappedValues(candidateProbe.page, binding.sourceRefs[0]) : [],
          ])
          operations.push({ operationId: binding.operationId, baselineValues, candidateValues })
        }
        scopeObservations.push({
          pageRef: spec.pageRef, route: spec.path, viewport: { width: viewport.width, height: viewport.height },
          markerText: spec.markerText, baselineMarkerVisible: baselineProbe.markerVisible, candidateMarkerVisible: candidateProbe.markerVisible, operations,
        })
        await Promise.all([baselineProbe.page.close(), candidateProbe.page.close()])
      }

      for (let interactionIndex = 0; interactionIndex < (input.verificationContract?.interactions ?? []).length; interactionIndex += 1) {
        const interaction = input.verificationContract.interactions[interactionIndex]
        const spec = input.verificationContract.pages.find(pageSpec => pageSpec.pageRef === interaction.pageRef)
        if (!spec) continue
        const [baselineProbe, candidateProbe] = await Promise.all([
          visitWithErrors(spec, input.baselineHost, viewport),
          visitWithErrors(spec, input.previewHost, viewport),
        ])
        const activate = async page => {
          try {
            await page.getByRole(interaction.role, { name: interaction.name, exact: true }).click()
            return await page.getByText(interaction.expectedText, { exact: true }).first().isVisible()
          } catch (error) {
            browserErrors.push(error instanceof Error ? error.message : String(error))
            return false
          }
        }
        const [baselinePassed, candidatePassed] = await Promise.all([activate(baselineProbe.page), activate(candidateProbe.page)])
        interactionObservations.push({
          interactionIndex, pageRef: interaction.pageRef, route: spec.path,
          viewport: { width: viewport.width, height: viewport.height }, role: interaction.role,
          name: interaction.name, expectedText: interaction.expectedText, baselinePassed, candidatePassed,
        })
        await Promise.all([baselineProbe.page.close(), candidateProbe.page.close()])
      }
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
      await baselinePage.close()
    }
  }
} finally {
  await browser.close()
}

const all = (values, predicate) => values.length > 0 && values.every(predicate)
const any = (values, predicate) => values.some(predicate)
const contractPages = input.verificationContract?.pages ?? []
const contractInteractions = input.verificationContract?.interactions ?? []
const pageRefs = contractPages.map(page => page.pageRef).sort()
const supportedScopeContract = contractPages.length > 0 && JSON.stringify(pageRefs) === JSON.stringify([...input.routeRefs].sort()) &&
  input.operations.length > 0 && input.operations.every(operation => operation.kind === 'TEXT' && !operation.overrideAction &&
    (input.scopeTargetPageRefs[operation.id] ?? []).length === contractPages.length && contractPages.every(page => input.scopeTargetPageRefs[operation.id].includes(page.pageRef))) &&
  input.targetBindings.length === input.operations.length && input.targetBindings.every(binding => binding.sourceRefs.length === 1 && binding.baselineSourceRefs.length === 1)
const scopePassed = supportedScopeContract && scopeObservations.length === contractPages.length * viewportPlan.length && scopeObservations.every(observation => {
  if (!observation.baselineMarkerVisible || !observation.candidateMarkerVisible) return false
  const pageShouldChange = input.scope.strategy === 'page-override'
    ? input.scope.localPageRef === observation.pageRef
    : input.scope.includedRefs.includes(observation.pageRef)
  return observation.operations.length === input.operations.length && input.operations.every(operation => {
    const values = observation.operations.find(item => item.operationId === operation.id)
    const expectedCandidate = pageShouldChange ? operation.after : operation.before
    return !!values && values.baselineValues.length > 0 && values.candidateValues.length > 0 &&
      values.baselineValues.every(value => value.includes(operation.before)) && values.candidateValues.every(value => value.includes(expectedCandidate))
  })
})
const scopeFailed = supportedScopeContract && scopeObservations.some(observation =>
  observation.baselineMarkerVisible && observation.candidateMarkerVisible && observation.operations.some(item =>
    item.baselineValues.length > 0 && item.candidateValues.length > 0 && input.operations.some(operation => {
      if (operation.id !== item.operationId) return false
      const pageShouldChange = input.scope.strategy === 'page-override'
        ? input.scope.localPageRef === observation.pageRef
        : input.scope.includedRefs.includes(observation.pageRef)
      return !item.baselineValues.every(value => value.includes(operation.before)) || !item.candidateValues.every(value => value.includes(pageShouldChange ? operation.after : operation.before))
    })))
const interactionsSupported = contractInteractions.length > 0 && interactionObservations.length === contractInteractions.length * viewportPlan.length
const interactionsPassed = interactionsSupported && interactionObservations.every(item => item.baselinePassed && item.candidatePassed)
const interactionsFailed = interactionObservations.some(item => !item.baselinePassed || !item.candidatePassed)
const assertions = [
  {
    id: 'target-change',
    result: input.targetBindings.length === 0 || loadedViewports !== viewportPlan.length ? 'unknown' : all(targetResults, Boolean) ? 'pass' : any(mappedResults, Boolean) ? 'risk' : 'unknown',
    detail: input.targetBindings.length === 0 ? 'No edited source target has a unique source-to-rendered-element mapping.' : loadedViewports !== viewportPlan.length ? 'Not all planned viewports rendered, so target text was not fully checked.' : all(targetResults, Boolean) ? 'Every edited value appeared in its uniquely mapped rendered source element at all tested viewports.' : any(mappedResults, Boolean) ? 'A uniquely mapped target did not render its requested text in every tested viewport.' : 'The modified source target could not be uniquely associated with rendered elements.',
  },
  {
    id: 'non-target-preserved',
    result: nonTargetResults.length === viewportPlan.length && nonTargetResults.every(value => value === true) ? 'pass' : nonTargetResults.some(value => value === false) ? 'risk' : 'unknown',
    detail: nonTargetResults.length === viewportPlan.length && nonTargetResults.every(value => value === true)
      ? `The trusted original project and candidate DOM matched outside the uniquely mapped text targets on / at ${baselineComparisons.length} viewport(s).`
      : nonTargetResults.some(value => value === false)
        ? 'The original project and candidate rendered different non-target DOM content on / at one or more tested viewports.'
        : 'The baseline comparison could not uniquely mask every edited text target or both projects did not render on every viewport.',
  },
  { id: 'scope-propagation', result: scopePassed ? 'pass' : scopeFailed ? 'risk' : 'unknown', detail: scopePassed ? `Declared page markers and every changed shared TEXT target matched the selected Scope across ${scopeObservations.length} original/candidate route-viewport observations.` : scopeFailed ? 'A declared page marker or target value did not match the original baseline and selected Scope.' : 'A complete supported route contract and unique shared TEXT source bindings were not supplied; Scope propagation remains unknown.' },
  { id: 'interaction', result: interactionsPassed ? 'pass' : interactionsFailed ? 'risk' : 'unknown', detail: interactionsPassed ? `The declared accessible interactions reached their expected visible state in both original and candidate browsers at all ${viewportPlan.length} viewports.` : interactionsFailed ? 'At least one declared accessible interaction failed in the original or candidate project.' : 'No complete supported button/link interaction contract was supplied; interaction remains unknown.' },
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
  verificationContractHash: input.verificationContractHash,
  checks,
  baselineComparisons,
  scopeObservations,
  interactionObservations,
  assertions,
  evidence,
  artifacts,
}
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ runId: input.runId, status: overflowObserved || browserErrors.length ? 'risks' : 'incomplete', checks: checks.length, artifacts: artifacts.length }))
