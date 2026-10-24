// Browser verification for one candidate run. Runs inside the isolated
// Playwright container (candidate-verification-runner.mjs is the entry) and is
// driven directly by the test suite with a real or fault-injected browser.
//
// Page model: at most one candidate/baseline page pair is alive at a time.
// The viewport's first pair runs the main checks and probes the root page in
// place; it is closed before any other probe starts. Every other scope page and
// every interaction gets its own fresh pair (fresh browser context each, so no
// cookie, storage, IndexedDB, service worker or in-memory state carries over),
// probed baseline and candidate in parallel and closed when the probe ends.
// Run #11 instead opened all probe pairs of a viewport at once (up to eight
// pages). Inside the container's --pids-limit 128, where every Chromium thread
// counts, renderers then failed to start ("browser.newPage: Target crashed")
// and the pages that did open were orphaned into the next viewport.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createBrowserErrorAccumulator } from './browser-error-accumulator.mjs'
import { captureVisualSide, missingVisualCapture, planVisualCaptures, VISUAL_CAPTURE_MIN_BUDGET_MS, VISUAL_CAPTURE_STATE, visualViewportDir, writeVisualSideArtifacts } from './visual-capture-executor.mjs'
// @ts-expect-error Plain ESM without a TS build target.
import { VERIFICATION_FONT_HEADER } from './preview-csp.mjs'
import { createViewportScope, readCgroupUsage } from './verification-lifecycle.mjs'

export const REQUIRED_ASSERTIONS = [
  'target-change', 'non-target-preserved', 'scope-propagation', 'interaction',
  'responsive-layout', 'source-mapping', 'browser-errors',
]
export const PROBE_DEADLINE_MS = 45_000
// Declared controls (navigation buttons, interaction targets) that do not
// exist should surface quickly as an unverified route, not consume a probe's
// whole deadline.
export const ACTION_TIMEOUT_MS = 10_000
export const PAGE_OPEN_TIMEOUT_MS = 15_000
// One visual capture (open pair, navigate, two screenshots + geometry per side)
// gets at most this long; the phase is skipped entirely when the runner budget
// cannot cover VISUAL_CAPTURE_MIN_BUDGET_MS.
const CAPTURE_PHASE_DEADLINE_MS = 30_000
// Time kept back from the host's kill time to close pages (<=5 s), drain
// cancelled work (<=5 s), write the diagnostic and close the browser (<=3 s).
export const BUDGET_RESERVE_MS = 20_000

// The host passes the absolute time at which it kills the container; host and
// container read the same kernel clock on Linux (a Docker Desktop VM can drift
// slightly, which the reserve absorbs).
export function runnerDeadline(input, reserveMs = BUDGET_RESERVE_MS) {
  return Number.isFinite(input?.executionDeadlineAt) ? input.executionDeadlineAt - reserveMs : Infinity
}

// Failures that say the browser could not give this viewport a page, as
// opposed to the candidate failing to load or render in one. A close-page
// cleanup failure counts too: pages that stay alive mean the browser is sick,
// not that the candidate misbehaved.
const INFRASTRUCTURE_PHASES = new Set(['open-page', 'prepare-page', 'close-page'])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// Thrown when the runner cannot produce a trustworthy execution record: its
// own budget expired, the browser disconnected, or no viewport could run.
// Carries a completed:false diagnostic; it is never an execution record and
// cannot be attested.
export class RunnerAborted extends Error {
  constructor(diagnostic) {
    super(diagnostic.reason)
    this.name = 'RunnerAborted'
    this.diagnostic = diagnostic
  }
}

// The probe failure that caused it has already been recorded.
class ViewportAborted extends Error {
  constructor(message) {
    super(message)
    this.name = 'ViewportAborted'
    this.alreadyRecorded = true
  }
}

// Contract paths are author-supplied; keep the route shape in diagnostics but
// not query strings or fragment parameters.
const diagnosticRoute = value => String(value ?? '').split('?')[0].replace(/[&=].*$/, '')

export async function executeVerification({
  input, browser, evidenceRoot, progress = () => {}, deadlineAt = Infinity, now = Date.now,
  probeDeadlineMs = PROBE_DEADLINE_MS, actionTimeoutMs = ACTION_TIMEOUT_MS, openTimeoutMs = PAGE_OPEN_TIMEOUT_MS, cgroupRoot,
}) {
  const viewportPlan = input.viewports
  const contractPages = input.verificationContract?.pages ?? []
  const contractInteractions = input.verificationContract?.interactions ?? []
  const checks = []
  const evidence = []
  const artifacts = []
  const baselineComparisons = []
  const scopeObservations = []
  const interactionObservations = []
  const targetResults = []
  const mappedResults = []
  const nonTargetResults = []
  const viewportDiagnostics = []
  // Exact totals and categories without retaining every repeated event; Run
  // #10 produced ~30k browser errors before its budget expired.
  const browserErrors = createBrowserErrorAccumulator({ sampleLimit: 25, messageLimit: 500 })
  const resourceSnapshots = input.resourceSnapshots ?? []
  const resourceByUrl = new Map(resourceSnapshots.map(snapshot => [snapshot.url, snapshot]))
  const localOrigins = new Set([input.previewHost, input.baselineHost].map(host => `http://${host}:5173`))
  // Snapshot bytes are read and verified once per run, then served from memory:
  // what is served is exactly what was verified, and the event loop is not
  // blocked re-hashing ~12 MB on every page load. null marks a failed check.
  const verifiedSnapshotBytes = new Map()
  const snapshotBytes = snapshot => {
    if (!verifiedSnapshotBytes.has(snapshot.url)) {
      const filePath = path.resolve(evidenceRoot, snapshot.artifactPath)
      let bytes = null
      if (filePath.startsWith(path.join(evidenceRoot, 'resources') + path.sep)) {
        try {
          const candidate = fs.readFileSync(filePath)
          if (sha256(candidate) === snapshot.sha256) bytes = candidate
        } catch { /* unreadable snapshot fails the integrity check below */ }
      }
      verifiedSnapshotBytes.set(snapshot.url, bytes)
    }
    return verifiedSnapshotBytes.get(snapshot.url)
  }
  const loadedExternalResourceUrls = new Set()
  const blockedExternalResourceUrls = new Set()
  let overflowObserved = false
  let loadedViewports = 0

  progress({ event: 'runner-start', resourceSnapshots: resourceSnapshots.length, unavailableResources: (input.unavailableResources ?? []).length, viewports: viewportPlan.length })

  // Errors are counted globally (for the manifest) and per viewport (for the
  // failure diagnostic); both use the bounded accumulator.
  const recorderFor = viewportErrors => (category, message, context = {}) => {
    browserErrors.add(category, message, context)
    viewportErrors.add(category, message, context)
  }

  async function preparePage(page, scope, record) {
    // Documents opened by the isolated runner carry the font-dependency
    // header: the preview server then serves the verification shape of the
    // CSP (snapshot-authorized fonts.gstatic.com allowed, see preview-csp.mjs).
    // Interactive workbench previews never set it and keep the strict policy.
    await page.setExtraHTTPHeaders({ [VERIFICATION_FONT_HEADER]: 'verified-font-dependencies' })
    await page.route('**/*', async route => {
      const requestedUrl = route.request().url()
      let parsed
      try { parsed = new URL(requestedUrl) } catch { await route.abort(); return }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return route.continue()
      if (localOrigins.has(parsed.origin)) return route.continue()
      if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
        blockedExternalResourceUrls.add(requestedUrl)
        record('blocked-method', 'Non-static external resource method was blocked: ' + route.request().method(), { url: requestedUrl, phase: scope.checkId })
        await route.abort()
        return
      }
      const snapshot = resourceByUrl.get(requestedUrl)
      if (snapshot) {
        const body = snapshotBytes(snapshot)
        if (!body) {
          blockedExternalResourceUrls.add(requestedUrl)
          record('blocked-integrity', 'Resource snapshot integrity check failed', { url: requestedUrl, phase: scope.checkId })
          await route.abort()
          return
        }
        loadedExternalResourceUrls.add(requestedUrl)
        await route.fulfill({ status: 200, contentType: snapshot.contentType, body })
        return
      }
      blockedExternalResourceUrls.add(requestedUrl)
      record('blocked-not-in-snapshot', 'External resource request was not in the approved snapshot', { url: requestedUrl, phase: scope.checkId })
      await route.abort()
    })
    // Listeners capture their own viewport scope: an event raised after the
    // viewport ended is still attributed to the viewport that owned the page.
    page.on('pageerror', error => record('pageerror', error.message, { url: page.url(), phase: scope.checkId }))
    page.on('console', message => { if (message.type() === 'error') record('console-error', message.text(), { url: page.url(), phase: scope.checkId }) })
  }

  // Opens one fresh page with resource routing and error listeners installed.
  // A page whose preparation fails is closed at once.
  async function openPreparedPage(scope, record, side) {
    const page = await scope.openPage(browser, side)
    try {
      await scope.timed('prepare-page', () => preparePage(page, scope, record), { side })
      return page
    } catch (error) {
      await scope.release(page)
      throw error
    }
  }

  // Opens a candidate/baseline pair. If either side fails to open, the other is
  // closed before the error propagates, so no page outlives the attempt.
  async function openPair(scope, record) {
    const [candidate, baseline] = await Promise.allSettled([openPreparedPage(scope, record, 'candidate'), openPreparedPage(scope, record, 'baseline')])
    const failed = [candidate, baseline].find(result => result.status === 'rejected')
    if (failed) {
      await Promise.all([candidate, baseline].filter(result => result.status === 'fulfilled').map(result => scope.release(result.value)))
      throw failed.reason
    }
    return [
      { name: 'baseline', page: baseline.value, host: input.baselineHost },
      { name: 'candidate', page: candidate.value, host: input.previewHost },
    ]
  }

  // Runs both sides' independent steps in parallel and waits for both to
  // settle before reporting the first failure, so nothing is left running.
  async function bothSides(candidateStep, baselineStep) {
    const [candidate, baseline] = await Promise.allSettled([candidateStep(), baselineStep()])
    const failed = [candidate, baseline].find(result => result.status === 'rejected')
    if (failed) throw failed.reason
    return [candidate.value, baseline.value]
  }

  async function waitForRoot(page) {
    await page.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
    await page.waitForFunction(() => !!document.querySelector('#root')?.textContent?.trim(), undefined, { timeout: 15_000 })
  }

  // True only for Playwright strict-mode ambiguity ("resolved to N elements"),
  // which is the one failure mode where a narrower semantic context can
  // legitimately rescue the click. Timeouts and missing controls propagate.
  const isStrictModeAmbiguity = error => error instanceof Error && /strict mode violation/.test(error.message) && /resolved to \d+ elements?/.test(error.message)

  // Clicks the contract's declared navigation control. When the name alone is
  // ambiguous (Run #12: a hero CTA repeated a nav button's text), the only
  // permitted resolution is a stable semantic context — the navigation
  // landmark — and only when exactly one visible candidate remains there.
  // Pages carrying two visible same-named controls inside navigation
  // landmarks (e.g. desktop and mobile navs both live) stay UNKNOWN; the
  // runner never picks a match by position (.first()/.nth(0)) because that
  // would click an arbitrary element and could pass for the wrong route. The
  // disambiguation is recorded only after the landmark-scoped click actually
  // succeeded, with the viewport's checkId, side and match counts.
  //
  // Run #13 mobile contract: on narrow viewports the declared control can be
  // unreachable until a declared collapsible menu is opened. The pinned Bolt
  // project hides the desktop nav with display:none (excluded from the
  // accessibility tree) while the collapsed overlay menu stays in the tree
  // with opacity-0/pointer-events:none, so clicking it burns the full action
  // timeout before failing. When the contract declares a menuControl that is
  // present in the accessibility tree on this viewport, the menu leg owns the
  // click: it opens the menu only when exactly one instance is visible and
  // clicks the declared target only when exactly one visible candidate
  // remains afterwards. A present-but-ambiguous declared menu (duplicate
  // toggles, or toggles that exist but are not clickable here) is refused
  // outright — never silently bypassed by falling back to a directly
  // clickable nav target, which would launder the ambiguity into a PASS.
  // Viewports where the toggle is absent from the tree entirely (desktop,
  // tablet with the pinned Bolt markup) keep the original direct click and
  // the Run #12 landmark rescue unchanged.
  async function clickDeclaredControl(page, scope, side, spec) {
    if (spec.menuControl) {
      const toggles = page.getByRole(spec.menuControl.role, { name: spec.menuControl.name, exact: true })
      if (await toggles.count() > 0) return openDeclaredMenuAndClick(page, scope, side, spec)
    }
    const target = page.getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true })
    try {
      await target.click({ timeout: actionTimeoutMs })
      return false
    } catch (error) {
      if (!isStrictModeAmbiguity(error)) throw error
    }
    const landmarkScoped = page.getByRole('navigation').getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true })
    const matches = await landmarkScoped.count()
    const visible = []
    for (let index = 0; index < matches; index += 1) {
      const candidate = landmarkScoped.nth(index)
      if (await candidate.isVisible()) visible.push(candidate)
    }
    if (visible.length !== 1) {
      throw new Error(`declared navigation control '${spec.navigateBy.name}' is ambiguous: ${matches} matches inside navigation landmarks, ${visible.length} visible; refusing to pick one arbitrarily`)
    }
    await visible[0].click({ timeout: actionTimeoutMs })
    scope.note({
      event: 'navigation-disambiguated', pageRef: spec.pageRef, side: side.name, route: diagnosticRoute(spec.path),
      landmarkMatches: matches, visibleMatches: visible.length, viewport: scope.viewport,
    })
    return true
  }

  // Mobile-menu leg of the declared navigation contract (see
  // clickDeclaredControl). Every refusal is an explicit reason, never a
  // positional pick.
  //
  // Run #14: opening the menu is only half the contract — the target must be
  // proven to belong to the menu THIS CLICK opened. Real pages keep footer
  // nav and in-body CTAs with the same accessible names (the pinned Bolt
  // project has both), so a page-wide role+name search after the open finds
  // 2-3 visible matches and cannot decide. Two provable bindings, in priority
  // order; both must attribute the activation to the click itself:
  //   1. aria proof: when the toggle carries aria-expanded/aria-controls, the
  //      page's own declaration owns the decision — the target must be the
  //      single actionable match inside the resolved, now-visible region, AND
  //      the open must be attributable to this click: aria-expanded must have
  //      been absent/'false' before it, or the region/target must demonstrably
  //      have been invisible/inert before it. A toggle already sitting at
  //      aria-expanded='true' with an already-actionable region button proves
  //      nothing about the click — it may be inert (review P1-1).
  //   2. activation-transition proof (Bolt shape, no aria wiring): probe
  //      which target matches exist and are ACTIONABLE before the open
  //      (visible, sized, no pointer-events:none ancestor — isVisible() is
  //      not enough, opacity-0/pointer-events:none overlays report visible),
  //      then require exactly one match that is the SAME NODE as a pre-open
  //      match and transitioned non-actionable -> actionable. Matches
  //      actionable before AND after (footer, CTAs) are page chrome; a node
  //      that did not exist before the click is a dynamically inserted
  //      element, not menu evidence (review P1-2); a no-op toggle produces
  //      zero transitions. Anything else is an explicit UNKNOWN.
  async function openDeclaredMenuAndClick(page, scope, side, spec) {
    const toggles = page.getByRole(spec.menuControl.role, { name: spec.menuControl.name, exact: true })
    const toggleCount = await toggles.count()
    const visibleToggles = []
    for (let index = 0; index < toggleCount; index += 1) {
      const toggle = toggles.nth(index)
      if (await toggle.isVisible()) visibleToggles.push(toggle)
    }
    if (visibleToggles.length !== 1) {
      throw new Error(`declared menu control '${spec.menuControl.name}' is ${visibleToggles.length === 0 ? 'missing or hidden' : 'ambiguous'}: ${toggleCount} matches, ${visibleToggles.length} visible; refusing to open a menu by position`)
    }
    const target = page.getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true })
    const before = await targetProbe(target)
    const toggle = visibleToggles[0]
    const ariaBefore = await readToggleAria(toggle)
    const regionBefore = ariaBefore.controls ? await probeAriaRegion(page, spec, ariaBefore.controls) : null
    await toggle.click({ timeout: actionTimeoutMs })
    const proven = await proveActivatedMenuTarget(page, spec, toggle, target, before, ariaBefore, regionBefore)
    await proven.handle.click({ timeout: actionTimeoutMs })
    scope.note({
      event: 'navigation-menu-disambiguated', pageRef: spec.pageRef, side: side.name, route: diagnosticRoute(spec.path),
      menuControl: spec.menuControl.name, proof: proven.kind, regionId: proven.regionId ?? null,
      preOpenActionable: before.filter(entry => entry.actionable).length, postOpenActionable: proven.postOpenActionable,
      visibleMatches: 1, viewport: scope.viewport,
    })
    return true
  }

  // Probes every match of a locator, keeping each element handle paired with
  // its actionability. ElementHandles stay valid across evaluate calls, so
  // identity between the pre-open and post-open probes is a plain node
  // comparison. Handles whose node was replaced by a re-render compare
  // unequal; the callers treat that as failing closed, never as evidence.
  async function targetProbe(locator) {
    const probed = []
    for (const handle of await locator.elementHandles()) {
      probed.push({ handle, actionable: await isActionable(handle) })
    }
    return probed
  }

  async function isActionable(handle) {
    return handle.evaluate(element => {
      if (!(element instanceof HTMLElement)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      for (let node = element; node && node instanceof HTMLElement; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false
      }
      return true
    }).catch(() => false)
  }

  async function readToggleAria(toggle) {
    return toggle.evaluate(element => ({
      expanded: element.getAttribute('aria-expanded'),
      controls: element.getAttribute('aria-controls'),
    })).catch(() => ({ expanded: null, controls: null }))
  }

  async function findSameNode(probed, handle) {
    for (const entry of probed) {
      if (await handle.evaluate((element, other) => element === other, entry.handle).catch(() => false)) return entry
    }
    return null
  }

  async function probeAriaRegion(page, spec, controls) {
    const safeId = controls.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const region = page.locator(`[id="${safeId}"]`)
    if (await region.count() !== 1) return { resolvable: false, visible: false, probed: [] }
    return {
      resolvable: true,
      visible: await region.first().isVisible().catch(() => false),
      probed: await targetProbe(region.getByRole(spec.navigateBy.role, { name: spec.navigateBy.name, exact: true })),
    }
  }

  async function proveActivatedMenuTarget(page, spec, toggle, target, before, ariaBefore, regionBefore) {
    const aria = await readToggleAria(toggle)
    if (aria.expanded !== null || aria.controls !== null) {
      if (aria.expanded !== 'true' || !aria.controls) {
        throw new Error(`declared menu control '${spec.menuControl.name}' carries incomplete aria wiring (aria-expanded='${aria.expanded}', aria-controls='${aria.controls}') after the open; refusing to guess the menu region`)
      }
      const regionAfter = await probeAriaRegion(page, spec, aria.controls)
      if (!regionAfter.resolvable || !regionAfter.visible) {
        throw new Error(`aria-controls='${aria.controls}' does not resolve to exactly one visible region after opening declared menu '${spec.menuControl.name}'; refusing page-wide target search`)
      }
      const actionable = regionAfter.probed.filter(entry => entry.actionable)
      if (actionable.length !== 1) {
        throw new Error(`aria-controls region '${aria.controls}' holds ${actionable.length} actionable '${spec.navigateBy.name}' controls (expected exactly 1); refusing to pick one arbitrarily`)
      }
      if (ariaBefore.expanded === 'true') {
        // The wiring claimed the menu was ALREADY open before our click; the
        // click must still demonstrably change the target's reachability,
        // otherwise the toggle may be inert and the region button was always
        // clickable (review P1-1).
        const prior = await findSameNode(regionBefore?.probed ?? [], actionable[0].handle)
        const becameProvable = !regionBefore?.visible || (prior ? !prior.actionable : false)
        if (!becameProvable) {
          throw new Error(`declared menu control '${spec.menuControl.name}' already had aria-expanded='true' before the click and aria-controls region '${aria.controls}' already held an actionable '${spec.navigateBy.name}' control; the open is not attributable to this click; refusing`)
        }
      }
      return { handle: actionable[0].handle, kind: 'aria-controls', regionId: aria.controls, postOpenActionable: actionable.length }
    }
    const after = await targetProbe(target)
    const afterActionable = after.filter(entry => entry.actionable)
    const beforeActionable = before.filter(entry => entry.actionable)
    const activated = []
    for (const entry of afterActionable) {
      // The SAME NODE must have existed before the click and transitioned
      // non-actionable -> actionable. Nodes that did not exist before are
      // dynamically inserted content, not menu evidence (review P1-2).
      const prior = await findSameNode(before, entry.handle)
      if (prior && !prior.actionable) activated.push(entry)
    }
    if (activated.length !== 1 || afterActionable.length <= beforeActionable.length) {
      throw new Error(`opening declared menu '${spec.menuControl.name}' did not prove a unique activated target: ${activated.length} '${spec.navigateBy.name}' control(s) transitioned to actionable (${beforeActionable.length} actionable before, ${afterActionable.length} after); refusing to pick by position`)
    }
    return { handle: activated[0].handle, kind: 'activation-transition', regionId: null, postOpenActionable: afterActionable.length }
  }

  // Binds a text match to the source module that rendered it, via the
  // data-ripple-source annotation written by sourceAnnotationPlugin
  // ('jsx:src/pages/HomePage.tsx#31' -> 'src/pages/HomePage.tsx'). Unannotated
  // matches report null.
  async function sourceFileOf(locator) {
    return locator.evaluate(element => {
      const annotated = element.closest('[data-ripple-source]')
      const ref = annotated?.getAttribute('data-ripple-source') ?? null
      if (!ref) return null
      return ref.replace(/^jsx:/, '').split('#')[0]
    }).catch(() => null)
  }

  // Run #13 wrong-route contract. Negation evidence must be bound to a real
  // page identity, not to incidental copy: promotional banners, navigation
  // and recommendation cards mention other pages' marker text all the time
  // (the pinned Bolt HomePage carries the autumn page's exact marker in an
  // event banner). Evidence grading for a visible other-page marker match
  // outside chrome contexts (nav/footer landmarks, links — those never prove
  // anything and are skipped):
  //   - both sides annotated, SAME module → the page quoting itself: no
  //     evidence (a home page legitimately renders its own promo copy);
  //   - both sides annotated, DIFFERENT module → conflicting evidence, NOT a
  //     verdict: module ownership is not route ownership (a home page may
  //     import a shared EventBanner component). The route downgrades to
  //     'ambiguous' (UNKNOWN) with a route-identity-conflict diagnostic, never
  //     'wrong-route' on a file name alone;
  //   - either side unannotated → the legacy conservative negation
  //     ('wrong-route'), preserving the pre-Run-13 fail-closed semantics for
  //     unproven route states.
  // Residual, documented: one module rendering BOTH the page's own marker and
  // another page's marker is indistinguishable from self-quoting at this
  // abstraction, so it stays verified; only route-level ownership information
  // (which the contract does not carry) could separate a shared shell from a
  // double-mounted page.
  async function wrongRouteEvidence(page, otherMarkerText, ownSourceFile) {
    const matches = page.getByText(otherMarkerText, { exact: true })
    const count = await matches.count()
    let conflict = null
    for (let index = 0; index < count; index += 1) {
      const match = matches.nth(index)
      if (!(await match.isVisible().catch(() => false))) continue
      const probe = await match.evaluate(element => {
        const inChromeContext = !!element.closest('nav, footer, [role="navigation"], [role="contentinfo"], a')
        const annotated = element.closest('[data-ripple-source]')
        const ref = annotated?.getAttribute('data-ripple-source') ?? null
        return { inChromeContext, sourceFile: ref ? ref.replace(/^jsx:/, '').split('#')[0] : null }
      }).catch(() => null)
      if (!probe || probe.inChromeContext) continue
      if (ownSourceFile && probe.sourceFile) {
        if (probe.sourceFile !== ownSourceFile) conflict = conflict ?? { otherMarker: otherMarkerText, otherSourceFile: probe.sourceFile }
        continue
      }
      return { kind: 'unbound' }
    }
    return conflict
  }

  async function visitContractPage(scope, side, spec, reuseCurrent) {
    const extra = { pageRef: spec.pageRef, side: side.name, route: diagnosticRoute(spec.path) }
    const { page } = side
    let navigationDisambiguated = false
    if (!reuseCurrent) {
      await scope.timed('scope-navigate', () => page.goto(`http://${side.host}:5173${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }), extra)
      await scope.timed('scope-root', () => waitForRoot(page), extra)
      if (spec.navigateBy) navigationDisambiguated = await scope.timed('scope-navigation-action', () => clickDeclaredControl(page, scope, side, spec), extra)
    }
    const marker = await scope.timed('scope-marker', async () => {
      const marker = page.getByText(spec.markerText, { exact: true })
      const markerMatchCount = await marker.count()
      const markerVisible = markerMatchCount > 0 && await marker.first().isVisible().catch(() => false)
      const declaredMatches = contractPages.filter(item => item.markerText === spec.markerText).length
      let routeIdentity = declaredMatches !== 1 || markerMatchCount > 1 ? 'ambiguous' : markerMatchCount === 0 ? 'missing' : 'verified'
      if (routeIdentity === 'verified') {
        const ownSourceFile = await sourceFileOf(marker.first())
        let conflict = null
        for (const otherMarker of new Set(contractPages.filter(item => item.pageRef !== spec.pageRef).map(item => item.markerText))) {
          const evidence = await wrongRouteEvidence(page, otherMarker, ownSourceFile)
          if (!evidence) continue
          if (evidence.kind === 'unbound') {
            routeIdentity = 'wrong-route'
            break
          }
          conflict = conflict ?? evidence
        }
        if (routeIdentity === 'verified' && conflict) {
          routeIdentity = 'ambiguous'
          scope.note({
            event: 'route-identity-conflict', pageRef: spec.pageRef, side: side.name, route: diagnosticRoute(spec.path),
            ownSourceFile, otherMarker: conflict.otherMarker, otherSourceFile: conflict.otherSourceFile, viewport: scope.viewport,
          })
        }
      }
      return { markerVisible, markerMatchCount, routeIdentity }
    }, extra)
    return { ...marker, navigationDisambiguated }
  }

  // A failed visit is an observation (route identity unverified => UNKNOWN),
  // not an infrastructure failure; it is still recorded as a browser error and
  // as the viewport's first error when it is the first exception seen.
  async function observeVisit(scope, side, spec, reuseCurrent) {
    try {
      return await visitContractPage(scope, side, spec, reuseCurrent)
    } catch (error) {
      scope.fail(error, { category: 'page-visit-failed', url: side.page.url(), pageRef: spec.pageRef, side: side.name, route: diagnosticRoute(spec.path) })
      return { markerVisible: false, markerMatchCount: 0, routeIdentity: 'missing', navigationDisambiguated: false }
    }
  }

  async function mappedValues(page, sourceRef) {
    return page.locator('[data-ripple-source]').evaluateAll((elements, ref) => elements
      .filter(element => element.getAttribute('data-ripple-source') === ref)
      .map(element => (element.textContent ?? '').trim()), sourceRef)
  }

  async function snapshotOutsideTargets(page, bindings, baseline, pageRef) {
    const specs = bindings.map(binding => ({
      operationId: binding.operationId,
      sourceRefs: baseline ? binding.baselineSourceRefs : binding.sourceRefs,
      text: binding.pageExpectations[pageRef]?.[baseline ? 'baselineText' : 'candidateText'] ?? '',
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

  // Runs one probe on both sides in parallel. Both tasks always settle before
  // this returns; a failed or timed-out side aborts the viewport afterwards.
  async function probeBothSides(scope, sides, label, extra, probe) {
    const outcomes = await scope.timed(label, () => Promise.all(sides.map(side => scope.task(`${label}:${extra.interactionIndex ?? extra.pageRef}:${side.name}`,
      () => probe(side), { deadlineMs: probeDeadlineMs, category: `${label}-task-failed`, phase: label, side: side.name, pageRef: extra.pageRef }))), extra)
    const failed = outcomes.find(outcome => outcome.status !== 'completed')
    if (failed) throw new ViewportAborted(`${label} ${failed.status}: ${failed.error.message}`)
    return outcomes.map(outcome => outcome.value)
  }

  // Runs one probe on a fresh pair and closes the pair before returning.
  async function probeOnFreshPair(scope, record, label, extra, probe) {
    const sides = await scope.timed('open-pair', () => openPair(scope, record), extra)
    try {
      return await probeBothSides(scope, sides, label, extra, probe)
    } finally {
      await Promise.all(sides.map(side => scope.release(side.page)))
    }
  }

  // Everything one viewport observes is collected here and merged into the
  // run only if the viewport completes. A timed-out viewport cannot write
  // late results into the run.
  async function verifyViewport(scope, viewport, record, result) {
    const mainSides = await scope.timed('open-pair', () => openPair(scope, record))
    const baselinePage = mainSides[0].page
    const page = mainSides[1].page
    const pageUrl = `http://${input.previewHost}:5173/`
    // The two projects load independently; Run #11 spent 5.1 s + 6.5 s doing
    // these navigations one after the other.
    const [response, baselineResponse] = await bothSides(
      () => scope.timed('candidate-nav', () => page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }), { side: 'candidate', route: '/' }),
      () => scope.timed('baseline-nav', () => baselinePage.goto(`http://${input.baselineHost}:5173/`, { waitUntil: 'domcontentloaded', timeout: 30_000 }), { side: 'baseline', route: '/' }),
    )
    await bothSides(
      () => scope.timed('candidate-root', () => waitForRoot(page), { side: 'candidate', route: '/' }),
      () => scope.timed('baseline-root', () => waitForRoot(baselinePage), { side: 'baseline', route: '/' }),
    )
    result.loaded = response?.ok() === true
    result.baselineLoaded = baselineResponse?.ok() === true
    result.runtimeState = result.loaded ? 'rendered' : `http-${response?.status() ?? 'no-response'}`
    result.noOverflow = await scope.timed('overflow', () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const observed = await scope.timed('source-elements', () => page.locator('[data-ripple-source]').evaluateAll(elements => elements.map(element => ({
      sourceRef: element.getAttribute('data-ripple-source') ?? '',
      instanceId: element.getAttribute('data-ripple-instance') ?? '',
      text: (element.textContent ?? '').trim(),
    }))))
    result.elementRefs = [...new Set(observed.map(element => element.sourceRef).filter(Boolean))]
    const expectedRefs = new Set(input.targetBindings.flatMap(binding => binding.sourceRefs))
    const matches = observed.filter(element => expectedRefs.has(element.sourceRef))
    result.mapped = input.targetBindings.length > 0 && input.targetBindings.every(binding =>
      binding.sourceRefs.length === 1 && matches.some(element => element.sourceRef === binding.sourceRefs[0] && !!element.instanceId))
    result.target = input.targetBindings.length > 0 && input.targetBindings.every(binding =>
      binding.sourceRefs.length === 1 && matches.some(element => element.sourceRef === binding.sourceRefs[0] && element.text.includes(binding.expectedText)))
    result.nonTarget = null
    if (result.loaded && result.baselineLoaded) {
      const [baselineSnapshot, candidateSnapshot] = await scope.timed('dom-compare', () => Promise.all([
        snapshotOutsideTargets(baselinePage, input.targetBindings, true, input.baselineComparisonPageRef),
        snapshotOutsideTargets(page, input.targetBindings, false, input.baselineComparisonPageRef),
      ]))
      const route = '/'
      const viewportSize = { width: viewport.width, height: viewport.height }
      if (baselineSnapshot.ok && candidateSnapshot.ok) {
        const baselineBytes = Buffer.byteLength(baselineSnapshot.snapshot)
        const candidateBytes = Buffer.byteLength(candidateSnapshot.snapshot)
        if (baselineBytes > 2 * 1024 * 1024 || candidateBytes > 2 * 1024 * 1024) {
          result.baselineComparison = { route, viewport: viewportSize, maskedOperationIds: [], matched: false, reason: 'Canonical DOM comparison exceeded the 2 MiB evidence limit.' }
        } else {
          const baselineDigest = sha256(Buffer.from(baselineSnapshot.snapshot))
          const candidateDigest = sha256(Buffer.from(candidateSnapshot.snapshot))
          const matched = baselineDigest === candidateDigest
          const comparisonPath = `${scope.checkId}-baseline.json`
          const comparisonBytes = Buffer.from(JSON.stringify({
            schemaVersion: 1, route, viewport: viewportSize,
            baselineSnapshot: baselineSnapshot.snapshot, candidateSnapshot: candidateSnapshot.snapshot,
            maskedOperationIds: baselineSnapshot.maskedOperationIds,
          }, null, 2))
          if (comparisonBytes.length > 4 * 1024 * 1024) {
            result.baselineComparison = { route, viewport: viewportSize, maskedOperationIds: [], matched: false, reason: 'Serialized DOM comparison exceeded the 4 MiB evidence limit.' }
          } else {
            fs.writeFileSync(path.join(evidenceRoot, comparisonPath), comparisonBytes, { flag: 'wx' })
            result.baselineComparison = {
              route, viewport: viewportSize, baselineDigest, candidateDigest,
              maskedOperationIds: baselineSnapshot.maskedOperationIds, matched,
              artifactPath: comparisonPath, artifactHash: sha256(comparisonBytes),
            }
            result.nonTarget = matched
          }
        }
      } else {
        result.baselineComparison = { route, viewport: viewportSize, maskedOperationIds: [], matched: false, reason: !baselineSnapshot.ok ? baselineSnapshot.reason : candidateSnapshot.reason }
      }
    }
    await scope.timed('fonts-ready', () => page.evaluate(() => document.fonts.ready.then(() => true)))
    const screenshotPath = `${scope.checkId}.png`
    const absoluteScreenshot = path.join(evidenceRoot, screenshotPath)
    await scope.timed('screenshot', () => page.screenshot({ path: absoluteScreenshot, fullPage: true, animations: 'disabled' }))
    result.screenshot = { path: screenshotPath, sha256: sha256(fs.readFileSync(absoluteScreenshot)) }
    if (!result.noOverflow) result.runtimeState = 'horizontal-overflow'

    // The root page is probed first, in place on the main pair, with reads
    // only (marker counts and visibility, mapped values); the main pair is
    // then closed. Every other scope page and every interaction gets a fresh
    // pair. Interactions never run on the main pair: its screenshot
    // (animations: 'disabled') finishes CSS transitions and animations, so a
    // control gated on an entrance animation would work there but not on a
    // freshly loaded page.
    const rootSpec = contractPages.find(spec => spec.path === '/' && !spec.navigateBy)
    if (!rootSpec) await Promise.all(mainSides.map(side => scope.release(side.page)))
    const orderedSpecs = rootSpec ? [rootSpec, ...contractPages.filter(spec => spec !== rootSpec)] : contractPages
    const runInteraction = async (side, interaction, spec, interactionIndex) => {
      const visit = await observeVisit(scope, side, spec, false)
      if (visit.routeIdentity !== 'verified') return { ...visit, passed: false }
      try {
        const passed = await scope.timed('interaction-activate', async () => {
          await side.page.getByRole(interaction.role, { name: interaction.name, exact: true }).click({ timeout: actionTimeoutMs })
          const outcome = side.page.getByText(interaction.expectedText, { exact: true })
          return await outcome.count() === 1 && await outcome.first().isVisible()
        }, { interactionIndex, pageRef: spec.pageRef, side: side.name })
        return { ...visit, passed }
      } catch (error) {
        scope.fail(error, { category: 'interaction-failed', url: side.page.url(), pageRef: spec.pageRef, side: side.name, route: diagnosticRoute(spec.path) })
        return { ...visit, passed: false }
      }
    }
    const probeScopePage = async side => {
      const spec = side.spec
      const visit = await observeVisit(scope, side, spec, spec === rootSpec)
      const values = []
      for (const binding of input.targetBindings) {
        const refs = side.name === 'baseline' ? binding.baselineSourceRefs : binding.sourceRefs
        values.push(refs.length === 1 ? await scope.timed('scope-values', () => mappedValues(side.page, refs[0]), { pageRef: spec.pageRef, side: side.name }) : [])
      }
      return { ...visit, values }
    }
    for (const spec of orderedSpecs) {
      const extra = { pageRef: spec.pageRef }
      const withSpec = side => probeScopePage({ ...side, spec })
      let probes
      if (spec === rootSpec) {
        try {
          probes = await probeBothSides(scope, mainSides, 'scope-probe', extra, withSpec)
        } finally {
          await Promise.all(mainSides.map(side => scope.release(side.page)))
        }
      } else {
        probes = await probeOnFreshPair(scope, record, 'scope-probe', extra, withSpec)
      }
      const [baselineProbe, candidateProbe] = probes
      result.scopeObservations.push({
        pageRef: spec.pageRef, route: spec.path, viewport: { width: viewport.width, height: viewport.height },
        markerText: spec.markerText, baselineMarkerVisible: baselineProbe.markerVisible, candidateMarkerVisible: candidateProbe.markerVisible,
        baselineMarkerMatchCount: baselineProbe.markerMatchCount, candidateMarkerMatchCount: candidateProbe.markerMatchCount,
        baselineRouteIdentity: baselineProbe.routeIdentity, candidateRouteIdentity: candidateProbe.routeIdentity,
        baselineNavigationDisambiguated: baselineProbe.navigationDisambiguated === true, candidateNavigationDisambiguated: candidateProbe.navigationDisambiguated === true,
        operations: input.targetBindings.map((binding, index) => {
          const expectation = binding.pageExpectations[spec.pageRef]
          return {
            operationId: binding.operationId, expectedBaselineText: expectation?.baselineText ?? '', expectedCandidateText: expectation?.candidateText ?? '',
            baselineValues: baselineProbe.values[index], candidateValues: candidateProbe.values[index],
          }
        }),
      })
    }

    for (let interactionIndex = 0; interactionIndex < contractInteractions.length; interactionIndex += 1) {
      const interaction = contractInteractions[interactionIndex]
      const spec = contractPages.find(pageSpec => pageSpec.pageRef === interaction.pageRef)
      if (!spec) continue
      const [baselineProbe, candidateProbe] = await probeOnFreshPair(scope, record, 'interaction', { interactionIndex, pageRef: spec.pageRef }, side => runInteraction(side, interaction, spec, interactionIndex))
      result.interactionObservations.push({
        interactionIndex, pageRef: interaction.pageRef, route: spec.path,
        viewport: { width: viewport.width, height: viewport.height }, role: interaction.role,
        name: interaction.name, expectedText: interaction.expectedText,
        baselineRouteIdentity: baselineProbe.routeIdentity, candidateRouteIdentity: candidateProbe.routeIdentity,
        baselinePassed: baselineProbe.passed, candidatePassed: candidateProbe.passed,
      })
    }
    return result
  }

  for (const viewport of viewportPlan) {
    const checkId = `${input.runId}-${viewport.name}`
    const checkStart = now()
    const viewportErrors = createBrowserErrorAccumulator({ sampleLimit: 5, messageLimit: 300 })
    const record = recorderFor(viewportErrors)
    const scope = createViewportScope({ checkId, viewport, progress, recordError: record, openTimeoutMs, now })
    // Owned by this loop iteration; read once below and never merged unless
    // the viewport task completed.
    const partial = { loaded: false, baselineLoaded: false, noOverflow: false, runtimeState: 'navigation-failed', elementRefs: [], scopeObservations: [], interactionObservations: [] }
    const remaining = deadlineAt - now()
    const outcome = remaining > 0
      ? await scope.task('viewport', () => verifyViewport(scope, viewport, record, partial), { deadlineMs: remaining, category: 'viewport-failed', phase: 'viewport' })
      : { status: 'timed-out', error: scope.fail(new Error('runner budget exhausted before this viewport started'), { category: 'viewport-not-started', phase: 'viewport' }) }
    // Copied before close: cancelled work may still settle afterwards.
    const runtimeState = partial.runtimeState
    const lifecycle = await scope.close({ extra: { cgroup: readCgroupUsage(cgroupRoot) } })
    let value = outcome.status === 'completed' ? outcome.value : undefined
    // Cleanup is fail-closed: a page this viewport could not close stays alive
    // in the shared browser (the Run #11 cascade precondition) and may still
    // run script against the relay, so the viewport cannot keep the results it
    // produced; they are discarded, the viewport reports failed-to-run, and
    // the runner aborts below without starting the next viewport.
    // Cleanup must also PROVABLY finish: work the scope started counts as
    // settled only once its promise settles. Calls a page close reliably
    // cancels reject and therefore settle within the drain, so a promise that
    // is still pending after the grace period has no cancellation proof: it
    // may still create a page (a late newPage), still run, or still mutate
    // run state. An unsettled count above zero is a cleanup that did not
    // finish, not a diagnostic footnote, and aborts the run exactly like a
    // leaked page. The lifecycle summary is immutable once returned, so a
    // late failure arriving afterwards (a late page whose close rejects)
    // cannot retroactively be counted; the unsettled count at return time is
    // what keeps that window fail-closed.
    let cleanupFailure
    if (lifecycle.pagesLeaked > 0 || lifecycle.closeFailures > 0 || lifecycle.unsettled > 0) {
      cleanupFailure = scope.fail(new Error(`viewport cleanup did not finish: ${lifecycle.closeFailures} page close attempt(s) failed; ${lifecycle.pagesLeaked} page(s) still alive; ${lifecycle.unsettled} started task(s) still unsettled after the cleanup grace period`), { category: 'viewport-cleanup-failed', phase: 'close-page' }, { terminal: true })
      value = undefined
    }
    const result = !value?.loaded ? 'failed-to-run' : value.noOverflow ? 'pass' : 'risk'
    // The error that ended the viewport, not an earlier observation error; a
    // completed task whose cleanup leaked pages ends with the cleanup failure.
    const failure = value ? undefined : (cleanupFailure?.message ?? outcome.error?.message)
    if (value) {
      if (value.loaded) loadedViewports += 1
      overflowObserved ||= !value.noOverflow
      mappedResults.push(value.mapped)
      targetResults.push(value.target)
      nonTargetResults.push(value.nonTarget)
      if (value.baselineComparison) baselineComparisons.push(value.baselineComparison)
      artifacts.push({ checkId, path: value.screenshot.path, sha256: value.screenshot.sha256 })
      scopeObservations.push(...value.scopeObservations)
      interactionObservations.push(...value.interactionObservations)
    }
    checks.push({ id: checkId, route: '/', viewport: { width: viewport.width, height: viewport.height }, state: runtimeState, passed: result === 'pass' })
    evidence.push({
      id: `evidence-${checkId}`, checkId, result, capturedAt: new Date(now()).toISOString(), pageUrl: `http://${input.previewHost}:5173/`,
      viewport: { width: viewport.width, height: viewport.height }, runtimeState, elementRefs: value?.elementRefs ?? [],
      ...(value ? { artifactPath: value.screenshot.path, artifactHash: value.screenshot.sha256 } : {}),
      ...(failure ? { reason: failure } : {}),
    })
    const diagnostic = {
      checkId, viewport: viewport.name, result, outcome: outcome.status, durationMs: now() - checkStart,
      ...(cleanupFailure ? { endedBy: cleanupFailure } : outcome.error ? { endedBy: outcome.error } : {}),
      ...(scope.firstError ? { firstError: scope.firstError } : {}),
      browserErrors: viewportErrors.snapshot(), lifecycle,
    }
    viewportDiagnostics.push(diagnostic)
    progress({
      event: 'check-complete', checkId, durationMs: diagnostic.durationMs, result,
      loadedExternalResources: loadedExternalResourceUrls.size, blockedExternalResources: blockedExternalResourceUrls.size,
      browserErrors: browserErrors.snapshot().total, viewportBrowserErrors: diagnostic.browserErrors.byCategory,
      ...(scope.firstError ? { firstError: scope.firstError } : {}),
    })
    // The viewport deadline is the remaining runner budget, so a viewport
    // timeout means the budget is spent. A disconnected browser cannot run
    // the remaining viewports either. Neither can a viewport whose cleanup
    // did not provably finish: its pages may still be alive, or its started
    // work may still create pages or mutate state in the shared browser, so
    // starting the next viewport on top of it would repeat the Run #11
    // cascade. The invariant is: no viewport starts while any earlier
    // viewport's cleanup is not provably closed (pages counted, closes
    // counted, and nothing still unsettled).
    const browserGone = typeof browser.isConnected === 'function' && !browser.isConnected()
    if (cleanupFailure || outcome.status === 'timed-out' || browserGone) {
      throw new RunnerAborted({
        schemaVersion: 1, executor: 'playwright', completed: false, status: 'failed-to-run', runId: input.runId,
        reason: cleanupFailure ? `Viewport cleanup could not finish during ${checkId} (${lifecycle.unsettled} unsettled, ${lifecycle.closeFailures} close failure(s), ${lifecycle.pagesLeaked} page(s) leaked); no execution record was produced.`
          : browserGone ? `The browser disconnected during ${checkId}; no execution record was produced.`
            : `Runner budget expired during ${checkId}; no execution record was produced.`,
        viewports: viewportDiagnostics, notStarted: viewportPlan.slice(viewportPlan.indexOf(viewport) + 1).map(item => item.name),
        browserErrorDetails: browserErrors.snapshot(),
      })
    }
  }
  // If the browser could not give any viewport a usable page — or every
  // viewport's pages failed to close, the Run #11 cascade precondition — the
  // record would describe the runner, not the candidate; report a runner
  // failure instead. A candidate that loads but never renders stays a
  // (non-approvable) record.
  const infrastructureEnded = item => INFRASTRUCTURE_PHASES.has(item.endedBy?.phase) &&
    (item.outcome !== 'completed' || item.result === 'failed-to-run')
  if (viewportDiagnostics.length > 0 && viewportDiagnostics.every(infrastructureEnded)) {
    throw new RunnerAborted({
      schemaVersion: 1, executor: 'playwright', completed: false, status: 'failed-to-run', runId: input.runId,
      reason: 'The browser could not complete page work for any viewport; no execution record was produced.',
      viewports: viewportDiagnostics, notStarted: [], browserErrorDetails: browserErrors.snapshot(),
    })
  }

  // Visual-evidence capture (supplementary only). Fresh pair per planned check,
  // capture-only: analysis runs on the host after attestation. Never fails the
  // run — a capture that could not be made is recorded missing and surfaces
  // downstream as a not-run visual evidence, never as PASS-by-absence.
  const visualCaptures = []
  const runtimeIdentityCaptures = []
  const runtimeIdentityCaptureEntry = capture => ({
    schema: 'ripple-runtime-identity-capture/v1',
    checkId: capture.checkId,
    route: capture.route,
    viewport: capture.viewport,
    state: capture.state,
    baseline: capture.baseline.runtimeIdentity,
    candidate: capture.candidate.runtimeIdentity,
  })
  {
    const visualPlan = planVisualCaptures(input)
    for (const item of visualPlan) {
      if (!(deadlineAt - now() > VISUAL_CAPTURE_MIN_BUDGET_MS)) {
        const missing = missingVisualCapture(item, 'runner budget exhausted before visual capture')
        visualCaptures.push(missing)
        runtimeIdentityCaptures.push(runtimeIdentityCaptureEntry(missing))
        continue
      }
      const viewportErrors = createBrowserErrorAccumulator({ sampleLimit: 5, messageLimit: 300 })
      const record = recorderFor(viewportErrors)
      // Scope checkId is namespaced ('-visual') so capture progress/lifecycle
      // events are never mistaken for the verified viewport's own late events;
      // the manifest entry keeps the real checkId for F-side pairing.
      const scope = createViewportScope({ checkId: `${item.checkId}-visual`, viewport: { name: item.viewport.name, width: item.viewport.width, height: item.viewport.height }, progress, recordError: record, openTimeoutMs, now })
      const dir = visualViewportDir(item.viewport.name)
      const captureOne = async () => {
        const sides = await openPair(scope, record)
        try {
          const browserInfo = { name: 'chromium', version: typeof browser.version === 'function' ? browser.version() : null }
          await bothSides(
            async () => { await sides.find(side => side.name === 'candidate').page.goto(`http://${input.previewHost}:5173${item.route}`, { timeout: openTimeoutMs }); await waitForRoot(sides.find(side => side.name === 'candidate').page) },
            async () => { await sides.find(side => side.name === 'baseline').page.goto(`http://${input.baselineHost}:5173${item.route}`, { timeout: openTimeoutMs }); await waitForRoot(sides.find(side => side.name === 'baseline').page) },
          )
          const [candidate, baseline] = await bothSides(
            () => captureVisualSide(sides.find(side => side.name === 'candidate').page, {
              side: 'candidate', route: item.route, interactionState: VISUAL_CAPTURE_STATE,
              sourceDigest: input.candidateTreeDigest, runtimeFingerprint: input.runtimeFingerprint, browser: browserInfo,
              collectorSource: input.visualSamplerIdentity?.collectorSource,
            }),
            () => captureVisualSide(sides.find(side => side.name === 'baseline').page, {
              side: 'baseline', route: item.route, interactionState: VISUAL_CAPTURE_STATE,
              sourceDigest: input.baseSourceDigest, runtimeFingerprint: input.runtimeFingerprint, browser: browserInfo,
              collectorSource: input.visualSamplerIdentity?.collectorSource,
            }),
          )
          const baselineEntry = writeVisualSideArtifacts(evidenceRoot, dir, 'baseline', baseline)
          const candidateEntry = writeVisualSideArtifacts(evidenceRoot, dir, 'candidate', candidate)
          return {
            checkId: item.checkId, route: item.route,
            viewport: { width: item.viewport.width, height: item.viewport.height }, state: VISUAL_CAPTURE_STATE,
            baseline: baselineEntry,
            candidate: candidateEntry,
          }
        } finally {
          await Promise.all(sides.map(side => scope.release(side.page).catch(() => undefined)))
        }
      }
      const captureStarted = now()
      const outcome = await scope.task('visual-capture', captureOne, { deadlineMs: Math.min(deadlineAt - now(), CAPTURE_PHASE_DEADLINE_MS), category: 'visual-capture-failed', phase: 'visual-capture' })
      const lifecycle = await scope.close({})
      const captured = outcome.status === 'completed' ? outcome.value : undefined
      if (!captured || lifecycle.pagesLeaked > 0 || lifecycle.closeFailures > 0 || lifecycle.unsettled > 0) {
        const missing = missingVisualCapture(item, captured ? 'visual capture cleanup did not provably finish' : (outcome.error?.message ?? 'visual capture failed'))
        visualCaptures.push(missing)
        runtimeIdentityCaptures.push(runtimeIdentityCaptureEntry(missing))
      } else {
        visualCaptures.push(captured)
        runtimeIdentityCaptures.push(runtimeIdentityCaptureEntry(captured))
      }
      progress({ event: 'visual-capture', checkId: `${item.checkId}-visual`, result: captured ? 'captured' : 'missing', durationMs: now() - captureStarted })
    }
  }

  const all = (values, predicate) => values.length > 0 && values.every(predicate)
  const any = (values, predicate) => values.some(predicate)
  const pageRefs = contractPages.map(page => page.pageRef).sort()
  const supportedScopeContract = contractPages.length > 0 && JSON.stringify(pageRefs) === JSON.stringify([...input.routeRefs].sort()) &&
    input.operations.length > 0 && input.operations.every(operation => operation.kind === 'TEXT' && !operation.overrideAction &&
      (input.scopeTargetPageRefs[operation.id] ?? []).length === contractPages.length && contractPages.every(page => input.scopeTargetPageRefs[operation.id].includes(page.pageRef))) &&
    input.targetBindings.length === input.operations.length && input.targetBindings.every(binding => binding.sourceRefs.length === 1 && binding.baselineSourceRefs.length === 1 && contractPages.every(page => !!binding.pageExpectations[page.pageRef]?.baselineText && !!binding.pageExpectations[page.pageRef]?.candidateText))
  const scopePassed = supportedScopeContract && scopeObservations.length === contractPages.length * viewportPlan.length && scopeObservations.every(observation => {
    if (!observation.baselineMarkerVisible || !observation.candidateMarkerVisible ||
      observation.baselineMarkerMatchCount !== 1 || observation.candidateMarkerMatchCount !== 1 ||
      observation.baselineRouteIdentity !== 'verified' || observation.candidateRouteIdentity !== 'verified') return false
    return observation.operations.length === input.operations.length && input.operations.every(operation => {
      const values = observation.operations.find(item => item.operationId === operation.id)
      const expectation = input.targetBindings.find(binding => binding.operationId === operation.id)?.pageExpectations[observation.pageRef]
      return !!values && values.baselineValues.length > 0 && values.candidateValues.length > 0 &&
        !!expectation && values.expectedBaselineText === expectation.baselineText && values.expectedCandidateText === expectation.candidateText &&
        values.baselineValues.every(value => value.includes(expectation.baselineText)) && values.candidateValues.every(value => value.includes(expectation.candidateText))
    })
  })
  const scopeFailed = supportedScopeContract && scopeObservations.some(observation =>
    observation.baselineMarkerVisible && observation.candidateMarkerVisible &&
    observation.baselineRouteIdentity === 'verified' && observation.candidateRouteIdentity === 'verified' && observation.operations.some(item =>
      item.baselineValues.length > 0 && item.candidateValues.length > 0 && input.operations.some(operation => {
        if (operation.id !== item.operationId) return false
        const expectation = input.targetBindings.find(binding => binding.operationId === operation.id)?.pageExpectations[observation.pageRef]
        return !expectation || item.expectedBaselineText !== expectation.baselineText || item.expectedCandidateText !== expectation.candidateText || !item.baselineValues.every(value => value.includes(expectation.baselineText)) || !item.candidateValues.every(value => value.includes(expectation.candidateText))
      })))
  const interactionsComplete = contractInteractions.length > 0 && interactionObservations.length === contractInteractions.length * viewportPlan.length
  const interactionsRoutesVerified = interactionsComplete && interactionObservations.every(item =>
    item.baselineRouteIdentity === 'verified' && item.candidateRouteIdentity === 'verified')
  const interactionsPassed = interactionsRoutesVerified && interactionObservations.every(item => item.baselinePassed && item.candidatePassed)
  const interactionsFailed = interactionsRoutesVerified && interactionObservations.some(item => !item.baselinePassed || !item.candidatePassed)
  const scopeRouteIdentityUnknown = scopeObservations.some(observation =>
    observation.baselineRouteIdentity !== 'verified' || observation.candidateRouteIdentity !== 'verified')
  const interactionRouteIdentityUnknown = interactionsComplete && interactionObservations.some(item =>
    item.baselineRouteIdentity !== 'verified' || item.candidateRouteIdentity !== 'verified')
  const errorTotal = browserErrors.snapshot().total
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
    { id: 'scope-propagation', result: scopePassed ? 'pass' : scopeFailed ? 'risk' : 'unknown', detail: scopePassed ? `Declared page markers and every changed shared TEXT target matched the selected Scope across ${scopeObservations.length} original/candidate route-viewport observations.` : scopeFailed ? 'A declared page marker or target value did not match the original baseline and selected Scope.' : scopeRouteIdentityUnknown ? 'At least one route marker was missing, ambiguous, or did not identify the requested page in the original/candidate DOM; Scope propagation remains unknown.' : 'A complete supported route contract and unique shared TEXT source bindings were not supplied; Scope propagation remains unknown.' },
    { id: 'interaction', result: interactionsPassed ? 'pass' : interactionsFailed ? 'risk' : 'unknown', detail: interactionsPassed ? `The declared accessible interactions reached their expected visible state in both original and candidate browsers at all ${viewportPlan.length} viewports.` : interactionsFailed ? 'At least one declared accessible interaction failed in the original or candidate project.' : interactionRouteIdentityUnknown ? 'The route marker did not uniquely verify the requested page for every declared interaction in the original/candidate DOM; interaction remains unknown.' : 'No complete supported button/link interaction contract was supplied; interaction remains unknown.' },
    { id: 'responsive-layout', result: overflowObserved ? 'risk' : loadedViewports === viewportPlan.length ? 'pass' : 'unknown', detail: overflowObserved ? 'At least one tested viewport had horizontal document overflow.' : loadedViewports === viewportPlan.length ? 'Candidate rendered without horizontal document overflow at desktop, tablet and mobile widths.' : 'Not all planned viewports rendered, so responsive behavior is incomplete.' },
    {
      id: 'source-mapping',
      result: input.targetBindings.length === 0 || loadedViewports !== viewportPlan.length ? 'unknown' : all(mappedResults, Boolean) ? 'pass' : 'unknown',
      detail: input.targetBindings.length === 0 ? 'No unique source binding was available for the changed targets.' : loadedViewports !== viewportPlan.length ? 'Not all planned viewports rendered, so source mapping is incomplete.' : all(mappedResults, Boolean) ? 'Each changed target source reference matched a rendered annotated element with a runtime instance identity.' : 'At least one changed source target could not be mapped to a rendered annotated element with a runtime instance identity.',
    },
    { id: 'browser-errors', result: errorTotal || (input.unavailableResources ?? []).length ? 'risk' : loadedViewports === viewportPlan.length ? 'pass' : 'unknown', detail: errorTotal ? `${errorTotal} browser or page error(s) were observed.` : (input.unavailableResources ?? []).length ? `${(input.unavailableResources ?? []).length} authorized resource(s) could not be snapshotted; the degraded render cannot claim a clean browser run.` : loadedViewports === viewportPlan.length ? 'No uncaught page or console errors were observed at the tested viewports.' : 'Not all planned viewports rendered, so browser error coverage is incomplete.' },
  ]
  if (assertions.length !== REQUIRED_ASSERTIONS.length || assertions.some(assertion => !REQUIRED_ASSERTIONS.includes(assertion.id))) {
    throw new Error('Verification assertion contract is incomplete')
  }

  return {
    manifest: {
      schemaVersion: 4,
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
      viewports: viewportPlan,
      checks,
      baselineComparisons,
      scopeObservations,
      interactionObservations,
      assertions,
      evidence,
      artifacts,
      visualCaptures,
      runtimeIdentityCaptures,
      resourceSnapshots,
      unavailableResources: input.unavailableResources ?? [],
      loadedExternalResourceUrls: [...loadedExternalResourceUrls].sort(),
      blockedExternalResourceUrls: [...blockedExternalResourceUrls].sort(),
      browserErrorDetails: browserErrors.snapshot(),
    },
    viewportDiagnostics,
    status: overflowObserved || errorTotal ? 'risks' : 'incomplete',
  }
}
