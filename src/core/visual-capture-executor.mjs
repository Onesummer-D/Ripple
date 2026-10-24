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
export const RUNTIME_IDENTITY_CAPTURE_DIR = 'identity'
// Refuse to start a capture when less than this remains of the runner budget:
// a capture needs two page opens, navigation and two screenshots per side.
export const VISUAL_CAPTURE_MIN_BUDGET_MS = 8_000
const CAPTURE_TIMEOUT_MS = 15_000
const GEOMETRY_FILE_LIMIT_BYTES = 16 * 1024 * 1024
const RUNTIME_IDENTITY_FILE_LIMIT_BYTES = 16 * 1024 * 1024
const RUNTIME_IDENTITY_PROTOCOL = 'ripple-runtime-identity/v1'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Directory-safe viewport name: the host re-validates this shape. */
export function visualViewportDir(name) {
  const raw = String(name ?? '')
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'viewport'
  // Keep distinct trusted plan names distinct even when their safe slugs
  // collide or differ only after the path-length limit.
  const suffix = sha256(Buffer.from(raw, 'utf8')).slice(0, 8)
  return `${slug.slice(0, 23)}-${suffix}`
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
  const runtimeIdentitySnapshot = geometry?.runtimeIdentitySnapshot ?? null
  let runtimeIdentityCollection = geometry?.runtimeIdentityCollection ?? 'unavailable'
  let runtimeIdentityError = typeof geometry?.runtimeIdentityError === 'string' ? geometry.runtimeIdentityError : null
  if (sampler.__rippleCollectorStatus === 'missing') {
    runtimeIdentityCollection = 'unavailable'
    runtimeIdentityError = 'collector source missing'
  } else if (sampler.__rippleCollectorStatus === 'serialization-error') {
    runtimeIdentityCollection = 'failed'
    runtimeIdentityError = 'collector source failed to serialize'
  }
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
  return {
    descriptor,
    screenshot: bytes,
    geometry: geometry ? { ...geometry, screenshotSha256: declaredSha256 } : null,
    runtimeIdentitySnapshot,
    runtimeIdentityCollection,
    runtimeIdentityError,
  }
}

function sanitizeDetail(value, fallback = 'runtime identity snapshot was not collected') {
  const detail = String(value || fallback)
    .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
    .replace(/https?:\/\/[^\s]+/gi, '<url>')
    .replace(/\b(token|password|secret|api[_-]?key)=([^\s]+)/gi, '$1=<redacted>')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
  return detail.slice(0, 300) || fallback
}

function runtimeIdentityFailure(captured, fallback = 'runtime identity snapshot was not collected') {
  const collection = captured?.runtimeIdentityCollection
  return {
    archive: 'failed',
    reason: collection === 'failed' ? 'collector-error' : 'snapshot-unavailable',
    detail: sanitizeDetail(captured?.runtimeIdentityError, fallback),
  }
}

function safeIdentityBase(evidenceRoot, dir) {
  if (!/^[a-z0-9-]{1,32}$/.test(String(dir ?? ''))) throw new Error('Runtime identity artifact directory is invalid.')
  const root = path.resolve(evidenceRoot)
  const identityRoot = path.join(root, RUNTIME_IDENTITY_CAPTURE_DIR)
  const base = path.join(identityRoot, dir)
  const relative = path.relative(root, base)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Runtime identity artifact directory escapes the evidence root.')
  }
  for (const directory of [identityRoot, base]) {
    fs.mkdirSync(directory, { recursive: true })
    const stat = fs.lstatSync(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Runtime identity artifact directory must be a regular directory.')
  }
  return base
}

function isRuntimeIdentitySnapshot(snapshot) {
  return !!snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    snapshot.protocol === RUNTIME_IDENTITY_PROTOCOL &&
    snapshot.page && typeof snapshot.page === 'object' && !Array.isArray(snapshot.page) &&
    typeof snapshot.page.pathname === 'string' && typeof snapshot.page.search === 'string' &&
    typeof snapshot.page.hash === 'string' && Array.isArray(snapshot.records)
}

function stableSerialize(value, seen = new Set()) {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Runtime identity snapshot contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new Error('Runtime identity snapshot contains an unsupported value.')
  if (seen.has(value)) throw new Error('Runtime identity snapshot contains a circular reference.')
  seen.add(value)
  let result
  if (Array.isArray(value)) result = `[${value.map(item => stableSerialize(item, seen)).join(',')}]`
  else result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`).join(',')}}`
  seen.delete(value)
  return result
}

/**
 * Archives the exact collector result used by the geometry sample. The
 * returned shape is deliberately small and immutable: the host re-reads the
 * JSON, checks the path/hash and performs the formal assessment later.
 */
export function writeRuntimeIdentityArtifact(evidenceRoot, dir, sideName, captured) {
  const snapshot = captured?.runtimeIdentitySnapshot
  if (!isRuntimeIdentitySnapshot(snapshot)) return runtimeIdentityFailure(captured, 'runtime identity snapshot schema is invalid')
  if (!/^(baseline|candidate)$/.test(String(sideName ?? ''))) return { archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity artifact side is invalid.' }
  let bytes
  try { bytes = Buffer.from(`${stableSerialize(snapshot)}\n`, 'utf8') }
  catch (error) { return { archive: 'failed', reason: 'snapshot-unavailable', detail: sanitizeDetail(error?.message ?? error) } }
  if (bytes.length > RUNTIME_IDENTITY_FILE_LIMIT_BYTES) {
    return { archive: 'failed', reason: 'snapshot-unavailable', detail: `runtime identity snapshot exceeds ${RUNTIME_IDENTITY_FILE_LIMIT_BYTES} bytes` }
  }
  try {
    const base = safeIdentityBase(evidenceRoot, dir)
    const fileName = `${sideName}-identity.json`
    const absolute = path.join(base, fileName)
    let stat = null
    try { stat = fs.lstatSync(absolute) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error('Runtime identity artifact path is not a regular file.')
    fs.writeFileSync(absolute, bytes, { flag: 'wx' })
    const hash = sha256(bytes)
    return {
      archive: 'stored',
      snapshotSha256: hash,
      artifact: { snapshot: { path: `${RUNTIME_IDENTITY_CAPTURE_DIR}/${dir}/${fileName}`, sha256: hash } },
    }
  } catch (error) {
    return { archive: 'failed', reason: 'snapshot-unavailable', detail: sanitizeDetail(error?.message ?? error) }
  }
}

/**
 * Writes one side's artifacts and returns the manifest entry fragment. File
 * names are fixed and the directory is validated by the host, so the
 * evidenceRoot-relative paths recorded here are the paths the host reads.
 */
export function writeVisualSideArtifacts(evidenceRoot, dir, sideName, captured) {
  const base = path.join(evidenceRoot, VISUAL_CAPTURE_DIR, dir)
  fs.mkdirSync(base, { recursive: true })
  const entry = {
    descriptor: captured.descriptor,
    screenshot: null,
    geometry: null,
    runtimeIdentity: writeRuntimeIdentityArtifact(evidenceRoot, dir, sideName, captured),
  }
  if (captured.screenshot) {
    const fileName = `${sideName}.png`
    fs.writeFileSync(path.join(base, fileName), captured.screenshot)
    entry.screenshot = { path: `${VISUAL_CAPTURE_DIR}/${dir}/${fileName}`, sha256: sha256(captured.screenshot) }
    entry.descriptor.screenshot.artifactPath = entry.screenshot.path
  }
  if (captured.geometry) {
    const fileName = `${sideName}-geometry.json`
    // Keep the original collector result in the dedicated identity artifact;
    // the geometry file only carries the fields needed by visual analysis.
    const { runtimeIdentitySnapshot: _snapshot, runtimeIdentityCollection: _collection, runtimeIdentityError: _error, ...visualGeometry } = captured.geometry
    const text = `${JSON.stringify(visualGeometry)}\n`
    const bytes = Buffer.from(text, 'utf8')
    if (bytes.length > GEOMETRY_FILE_LIMIT_BYTES) throw new Error(`DOM geometry sample is ${bytes.length} bytes; the limit is ${GEOMETRY_FILE_LIMIT_BYTES}.`)
    fs.writeFileSync(path.join(base, fileName), bytes)
    entry.geometry = { path: `${VISUAL_CAPTURE_DIR}/${dir}/${fileName}`, sha256: sha256(bytes) }
  }
  return entry
}

/** A manifest entry for a capture that could not be made; the host maps it to not-run. */
export function missingVisualCapture(planItem, reason) {
  const runtimeIdentity = { archive: 'failed', reason: 'snapshot-unavailable', detail: sanitizeDetail(reason, 'visual capture failed') }
  const side = { descriptor: null, screenshot: null, geometry: null, runtimeIdentity, failure: reason }
  return { checkId: planItem.checkId, route: planItem.route, viewport: { width: planItem.viewport.width, height: planItem.viewport.height }, state: VISUAL_CAPTURE_STATE, baseline: { ...side }, candidate: { ...side } }
}
