// Visual-evidence capture for the isolated verification container (capture ONLY).
//
// Plain ESM: the container's Node has no TypeScript transform, so this module
// never imports the E analysis modules. It opens a fresh candidate/baseline
// pair per planned check, takes two consecutive full-page screenshots per side
// (stability is measured, not asserted), samples DOM geometry with the shared
// in-page sampler, writes bounded artifacts under <evidenceRoot>/visual/ and
// records descriptors + hashes in the execution manifest. The HOST analyses the
// captures after the attested run and owns every conclusion; a capture failure
// here is recorded as a missing capture and must never fail the verification.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildDomGeometrySampler } from './visual-geometry-sampler.mjs'

export const VISUAL_CAPTURE_STATE = 'rendered'
export const VISUAL_CAPTURE_DIR = 'visual'
// Refuse to start a capture when less than this remains of the runner budget:
// a capture needs two page opens, navigation and two screenshots per side.
export const VISUAL_CAPTURE_MIN_BUDGET_MS = 8_000
const CAPTURE_TIMEOUT_MS = 15_000
const GEOMETRY_FILE_LIMIT_BYTES = 16 * 1024 * 1024

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Directory-safe viewport name: the host re-validates this shape. */
export function visualViewportDir(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
}

/**
 * One visual capture per planned viewport on the root route, bound to the
 * existing check id so F can pair evidence with the check. Returns [] when the
 * contract has no root page or the plan is empty.
 */
export function planVisualCaptures(input) {
  const viewports = Array.isArray(input?.viewports) ? input.viewports : []
  const pages = input?.verificationContract?.pages ?? []
  if (!pages.some(page => page && page.path === '/')) return []
  return viewports
    .filter(viewport => viewport && Number.isInteger(viewport.width) && Number.isInteger(viewport.height) && viewport.width > 0 && viewport.height > 0)
    .map(viewport => ({ checkId: `${input.runId}-${viewport.name}`, route: '/', viewport: { name: viewport.name, width: viewport.width, height: viewport.height } }))
}

/**
 * Captures one side of a comparison. Two consecutive full-page screenshots
 * must be byte-identical (animations disabled) for the capture to count as
 * stable; the second screenshot is delivered. Returns null bytes when the
 * producer chose not to deliver a screenshot ('none'), e.g. a negative test.
 */
export async function captureVisualSide(page, options) {
  const {
    side, route, interactionState = VISUAL_CAPTURE_STATE, sourceDigest, runtimeFingerprint, browser,
    screenshot = 'full', awaitFonts = true, collectorSource,
  } = options
  const fontsReady = await page.evaluate(async shouldAwait => {
    if (!document.fonts || document.fonts.status === 'loaded') return true
    if (!shouldAwait) return false
    await document.fonts.ready
    return document.fonts.status === 'loaded'
  }, awaitFonts).catch(() => null)
  // The sampler with C+D's collectRuntimeIdentitySnapshot embedded comes from
  // the host via input.json; without it the sampler degrades to null identity
  // reasons (still reads the version registry).
  const sampler = buildDomGeometrySampler(collectorSource)
  const geometry = await page.evaluate(sampler, { side, interactionState })
  let bytes = null
  let stable = null
  if (screenshot === 'full') {
    const first = new Uint8Array(await page.screenshot({ fullPage: true, animations: 'disabled', timeout: CAPTURE_TIMEOUT_MS }))
    const second = new Uint8Array(await page.screenshot({ fullPage: true, animations: 'disabled', timeout: CAPTURE_TIMEOUT_MS }))
    stable = sha256(first) === sha256(second)
    bytes = second
  }
  const observed = await page.evaluate(() => ({ dpr: window.devicePixelRatio, url: location.href, path: `${location.pathname}${location.search}${location.hash}`, scrollX: window.scrollX, scrollY: window.scrollY })).catch(() => null)
  const declaredSha256 = bytes ? sha256(bytes) : null
  const descriptor = {
    side, route: observed?.path ?? route, pageUrl: observed?.url ?? null,
    viewport: page.viewportSize(), devicePixelRatio: observed?.dpr ?? null,
    browser: browser ?? null, runtimeFingerprint: runtimeFingerprint ?? null, interactionState,
    sourceDigest: sourceDigest ?? null,
    capture: {
      completed: bytes !== null, stable, fullPage: true, animationsDisabled: true,
      fontsReady: fontsReady ?? null, capturedAt: new Date().toISOString(),
      scroll: observed ? { x: observed.scrollX, y: observed.scrollY } : null,
    },
    screenshot: { declaredSha256, artifactPath: null },
  }
  return { descriptor, screenshot: bytes, geometry: geometry ? { ...geometry, screenshotSha256: declaredSha256 } : null }
}

/**
 * Writes one side's artifacts and returns the manifest entry fragment. File
 * names are fixed and the directory is validated by the host, so the
 * evidenceRoot-relative paths recorded here are the paths the host reads.
 */
export function writeVisualSideArtifacts(evidenceRoot, dir, sideName, captured) {
  const base = path.join(evidenceRoot, VISUAL_CAPTURE_DIR, dir)
  fs.mkdirSync(base, { recursive: true })
  const entry = { descriptor: captured.descriptor, screenshot: null, geometry: null }
  if (captured.screenshot) {
    const fileName = `${sideName}.png`
    fs.writeFileSync(path.join(base, fileName), captured.screenshot)
    entry.screenshot = { path: `${VISUAL_CAPTURE_DIR}/${dir}/${fileName}`, sha256: sha256(captured.screenshot) }
    entry.descriptor.screenshot.artifactPath = entry.screenshot.path
  }
  if (captured.geometry) {
    const fileName = `${sideName}-geometry.json`
    const text = `${JSON.stringify(captured.geometry)}\n`
    const bytes = Buffer.from(text, 'utf8')
    if (bytes.length > GEOMETRY_FILE_LIMIT_BYTES) throw new Error(`DOM geometry sample is ${bytes.length} bytes; the limit is ${GEOMETRY_FILE_LIMIT_BYTES}.`)
    fs.writeFileSync(path.join(base, fileName), bytes)
    entry.geometry = { path: `${VISUAL_CAPTURE_DIR}/${dir}/${fileName}`, sha256: sha256(bytes) }
  }
  return entry
}

/** A manifest entry for a capture that could not be made; the host maps it to not-run. */
export function missingVisualCapture(planItem, reason) {
  const side = { descriptor: null, screenshot: null, geometry: null, failure: reason }
  return { checkId: planItem.checkId, route: planItem.route, viewport: { width: planItem.viewport.width, height: planItem.viewport.height }, state: VISUAL_CAPTURE_STATE, baseline: { ...side }, candidate: { ...side } }
}
