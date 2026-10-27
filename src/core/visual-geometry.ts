// DOM geometry for visual-difference evidence: validation of real DOM samples,
// CSS-pixel → screenshot device-pixel mapping, cross-version element matching
// and explicit geometric layout rules.
//
// Element identity comes only from the runtime annotations Ripple injects
// (data-ripple-source / data-ripple-instance / data-ripple-identity-certainty).
// Nothing here infers a source from rendered text or position; an element
// without a usable identity stays unmatched.
import type { RuntimeElementObservation } from './model'
import { locationDigest, type CssPoint, type CssSize, type VisualCaptureDescriptor, type VisualSide } from './visual-capture'
import type { PixelRect } from './visual-diff'

export const DOM_GEOMETRY_SCHEMA = 'ripple-dom-geometry/v1'

export interface CssRect { x: number; y: number; width: number; height: number }
export type IdentityCertainty = RuntimeElementObservation['certainty']

export interface DomElementGeometry {
  /** Unique within its sample. */
  id: string
  /** Nearest annotated ancestor within the same sample, or null. */
  parentId: string | null
  sourceRef: string | null
  runtimeInstanceId: string | null
  identityCertainty: IdentityCertainty | null
  /** Border box in CSS px, in the sample's coordinate space. */
  rect: CssRect
  /** Area left visible by every clipping ancestor (overflow hidden, clip, auto or scroll) that applies to this box; null when unclipped or unknown. */
  clipRect: CssRect | null
  /** Area left by overflow hidden/clip ancestors only (content outside is cut off, not scrollable); an axis that only scrolls spans ±1e6 CSS px; null when none or unknown. */
  hiddenClipRect: CssRect | null
  visible: boolean | null
  /**
   * Collection-time identity reasons carried over from the runtime annotation
   * (C+D `RuntimeIdentityReason` vocabulary). Null until the sampler wires
   * them in. Any C+D blocking reason makes the element ineligible for
   * instance-candidate pairing.
   */
  identityReasons: string[] | null
}

export interface DomGeometrySample {
  schema: typeof DOM_GEOMETRY_SCHEMA
  side: VisualSide
  route: string
  /** Digest of the query + fragment the page was at (sampler field `locationSuffix`, which is not kept); null when not sampled. */
  locationSuffixSha256: string | null
  viewport: CssSize
  devicePixelRatio: number
  interactionState: string
  /** document: rects include the window scroll offset; viewport: getBoundingClientRect() as-is. */
  coordinateSpace: 'document' | 'viewport'
  /** Window scroll offset in CSS px when sampled. */
  scroll: CssPoint
  /** documentElement scrollWidth/scrollHeight in CSS px, when sampled. */
  documentSize: CssSize | null
  /** SHA-256 of the screenshot taken together with this sample; binds the two. */
  screenshotSha256: string | null
  /**
   * SHA-256 of the served source file this sample's annotations were collected
   * from (C+D `sourceVersion` semantics). Only meaningful for single-file
   * pages; multi-file pages keep null here and carry their truth in
   * `sourceFileVersions`. Pairing treats null as "version evidence
   * unavailable", never as a match.
   */
  sourceVersion: string | null
  /**
   * C+D registry-derived served-version per referenced source file
   * (project-relative path -> SHA-256). Null until the sampler wires it in;
   * an absent file entry means that file's version was unregistered or
   * ambiguous — never a match.
   */
  sourceFileVersions: Record<string, string> | null
  /** C+D RuntimePageContext ({pathname, search, hash}) of the sampled page; null when not sampled. */
  pageContext: { pathname: string; search: string; hash: string } | null
  elements: DomElementGeometry[]
}

export interface GeometryLimits { maxElements: number }
export const DEFAULT_GEOMETRY_LIMITS: Readonly<GeometryLimits> = Object.freeze({ maxElements: 2000 })

const CERTAINTIES: readonly IdentityCertainty[] = ['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped']
const STABLE: ReadonlySet<IdentityCertainty> = new Set<IdentityCertainty>(['stable-keyed-instance', 'stable-react-instance'])
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown, bound = 1e7): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= bound

function cssRect(value: unknown): CssRect | null {
  if (!record(value) || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height) || value.width < 0 || value.height < 0) return null
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}
const optionalText = (value: unknown, max: number): string | null | undefined =>
  value === null || value === undefined ? null : typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined

export type GeometryParseResult = { ok: true; sample: DomGeometrySample } | { ok: false; detail: string }

/** Validates an untrusted DOM geometry sample. Any structural problem rejects the whole sample. */
export function parseDomGeometrySample(value: unknown, side: VisualSide, limits: GeometryLimits = DEFAULT_GEOMETRY_LIMITS): GeometryParseResult {
  const fail = (detail: string): GeometryParseResult => ({ ok: false, detail })
  if (!record(value)) return fail('Geometry sample must be an object.')
  if (value.schema !== DOM_GEOMETRY_SCHEMA) return fail(`Geometry sample schema must be ${DOM_GEOMETRY_SCHEMA}.`)
  if (value.side !== side) return fail(`Geometry sample declares side ${String(value.side)} but was supplied for ${side}.`)
  if (typeof value.route !== 'string' || !value.route.startsWith('/') || value.route.length > 2048) return fail('Geometry sample route must be a same-origin path.')
  const route = value.route.split(/[?#]/, 1)[0]
  const rawSuffix = value.locationSuffix !== undefined && value.locationSuffix !== null ? value.locationSuffix : route !== value.route ? value.route.slice(route.length) : null
  if (rawSuffix !== null && (typeof rawSuffix !== 'string' || rawSuffix.length > 4096 || (rawSuffix !== '' && !/^[?#]/.test(rawSuffix)))) return fail('Geometry sample locationSuffix is invalid.')
  const locationSuffixSha256 = rawSuffix === null ? null : locationDigest(rawSuffix)
  if (!record(value.viewport) || !Number.isInteger(value.viewport.width) || !Number.isInteger(value.viewport.height) || (value.viewport.width as number) <= 0 || (value.viewport.height as number) <= 0) return fail('Geometry sample viewport is invalid.')
  if (!finite(value.devicePixelRatio, 8) || value.devicePixelRatio <= 0) return fail('Geometry sample devicePixelRatio is invalid.')
  if (typeof value.interactionState !== 'string' || !value.interactionState || value.interactionState.length > 300) return fail('Geometry sample interactionState is invalid.')
  if (value.coordinateSpace !== 'document' && value.coordinateSpace !== 'viewport') return fail('Geometry sample coordinateSpace must be document or viewport.')
  if (!record(value.scroll) || !finite(value.scroll.x) || !finite(value.scroll.y)) return fail('Geometry sample scroll offset is invalid.')
  let documentSize: CssSize | null = null
  if (value.documentSize !== undefined && value.documentSize !== null) {
    if (!record(value.documentSize) || !finite(value.documentSize.width) || !finite(value.documentSize.height) || value.documentSize.width < 0 || value.documentSize.height < 0) return fail('Geometry sample documentSize is invalid.')
    documentSize = { width: value.documentSize.width, height: value.documentSize.height }
  }
  const screenshotSha256 = value.screenshotSha256 === undefined || value.screenshotSha256 === null ? null
    : typeof value.screenshotSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.screenshotSha256) ? value.screenshotSha256 : undefined
  if (screenshotSha256 === undefined) return fail('Geometry sample screenshotSha256 is invalid.')
  const sourceVersion = value.sourceVersion === undefined || value.sourceVersion === null ? null
    : typeof value.sourceVersion === 'string' && /^[a-f0-9]{64}$/.test(value.sourceVersion) ? value.sourceVersion : undefined
  if (sourceVersion === undefined) return fail('Geometry sample sourceVersion is invalid.')
  let sourceFileVersions: Record<string, string> | null = null
  if (value.sourceFileVersions !== undefined && value.sourceFileVersions !== null) {
    if (!record(value.sourceFileVersions)) return fail('Geometry sample sourceFileVersions is invalid.')
    const entries = Object.entries(value.sourceFileVersions)
    if (entries.length > 64 || entries.some(([file, digest]) => typeof file !== 'string' || !/^[\w./-]{1,512}$/.test(file) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) {
      return fail('Geometry sample sourceFileVersions is invalid.')
    }
    sourceFileVersions = Object.fromEntries(entries.map(([file, digest]) => [file, digest as string]))
  }
  let pageContext: DomGeometrySample['pageContext'] = null
  if (value.pageContext !== undefined && value.pageContext !== null) {
    if (!record(value.pageContext) || typeof value.pageContext.pathname !== 'string' || !value.pageContext.pathname.startsWith('/') || value.pageContext.pathname.length > 2048 ||
      typeof value.pageContext.search !== 'string' || value.pageContext.search.length > 4096 ||
      typeof value.pageContext.hash !== 'string' || value.pageContext.hash.length > 4096 ||
      (value.pageContext.search !== '' && !value.pageContext.search.startsWith('?')) ||
      (value.pageContext.hash !== '' && !value.pageContext.hash.startsWith('#'))) {
      return fail('Geometry sample pageContext is invalid.')
    }
    pageContext = { pathname: value.pageContext.pathname, search: value.pageContext.search, hash: value.pageContext.hash }
  }
  if (!Array.isArray(value.elements)) return fail('Geometry sample elements must be an array.')
  if (value.elements.length > limits.maxElements) return fail(`Geometry sample has ${value.elements.length} elements; the limit is ${limits.maxElements}.`)
  const elements: DomElementGeometry[] = []
  const ids = new Set<string>()
  for (const [index, raw] of value.elements.entries()) {
    if (!record(raw)) return fail(`Element ${index} is not an object.`)
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 200 || ids.has(raw.id)) return fail(`Element ${index} has a missing, oversized or duplicate id.`)
    const parentId = optionalText(raw.parentId, 200)
    const sourceRef = optionalText(raw.sourceRef, 512)
    const runtimeInstanceId = optionalText(raw.runtimeInstanceId, 1024)
    if (parentId === undefined || sourceRef === undefined || runtimeInstanceId === undefined) return fail(`Element ${raw.id} has an invalid parentId, sourceRef or runtimeInstanceId.`)
    const identityCertainty = raw.identityCertainty === undefined || raw.identityCertainty === null ? null
      : CERTAINTIES.includes(raw.identityCertainty as IdentityCertainty) ? raw.identityCertainty as IdentityCertainty : undefined
    if (identityCertainty === undefined) return fail(`Element ${raw.id} has an unknown identityCertainty.`)
    const rect = cssRect(raw.rect)
    if (!rect) return fail(`Element ${raw.id} has an invalid rect.`)
    const clipRect = raw.clipRect === undefined || raw.clipRect === null ? null : cssRect(raw.clipRect)
    if (raw.clipRect !== undefined && raw.clipRect !== null && !clipRect) return fail(`Element ${raw.id} has an invalid clipRect.`)
    const hiddenClipRect = raw.hiddenClipRect === undefined || raw.hiddenClipRect === null ? null : cssRect(raw.hiddenClipRect)
    if (raw.hiddenClipRect !== undefined && raw.hiddenClipRect !== null && !hiddenClipRect) return fail(`Element ${raw.id} has an invalid hiddenClipRect.`)
    if (raw.visible !== undefined && raw.visible !== null && typeof raw.visible !== 'boolean') return fail(`Element ${raw.id} has an invalid visible flag.`)
    let identityReasons: string[] | null = null
    if (raw.identityReasons !== undefined && raw.identityReasons !== null) {
      if (!Array.isArray(raw.identityReasons) || raw.identityReasons.length > 8 || raw.identityReasons.some(reason => typeof reason !== 'string' || !reason || reason.length > 64)) {
        return fail(`Element ${raw.id} has invalid identityReasons.`)
      }
      identityReasons = [...raw.identityReasons] as string[]
    }
    ids.add(raw.id)
    elements.push({ id: raw.id, parentId, sourceRef, runtimeInstanceId, identityCertainty, rect, clipRect, hiddenClipRect, visible: typeof raw.visible === 'boolean' ? raw.visible : null, identityReasons })
  }
  const parents = new Map(elements.map(element => [element.id, element.parentId]))
  for (const element of elements) {
    if (element.parentId !== null && !parents.has(element.parentId)) return fail(`Element ${element.id} refers to a parent that is not in the sample.`)
    let steps = 0
    for (let cursor = element.parentId; cursor !== null; cursor = parents.get(cursor) ?? null) {
      if (cursor === element.id || ++steps > elements.length) return fail(`Element ${element.id} is part of a parent cycle.`)
    }
  }
  return {
    ok: true,
    sample: {
      schema: DOM_GEOMETRY_SCHEMA, side, route, locationSuffixSha256,
      viewport: { width: value.viewport.width as number, height: value.viewport.height as number },
      devicePixelRatio: value.devicePixelRatio, interactionState: value.interactionState, coordinateSpace: value.coordinateSpace,
      scroll: { x: value.scroll.x as number, y: value.scroll.y as number }, documentSize, screenshotSha256, sourceVersion, sourceFileVersions, pageContext, elements,
    },
  }
}

/** How a sample's CSS coordinates map onto its screenshot. */
export interface ScreenshotMapping {
  devicePixelRatio: number
  /** Added to sample coordinates to obtain screenshot CSS coordinates. */
  offset: CssPoint
  image: { width: number; height: number }
}

export type GeometryBinding = { ok: true; mapping: ScreenshotMapping; screenshotBound: boolean } | { ok: false; detail: string }

/**
 * Accepts a sample only for the screenshot it describes: same route, viewport,
 * DPR and interaction state as the capture, the same screenshot bytes when the
 * sample records them, and a capture extent/scroll that makes the coordinate
 * transform determinable.
 */
export function bindGeometryToCapture(sample: DomGeometrySample, capture: VisualCaptureDescriptor, screenshot: { sha256: string; width: number; height: number }): GeometryBinding {
  const fail = (detail: string): GeometryBinding => ({ ok: false, detail })
  if (capture.route === null || sample.route !== capture.route) return fail('Geometry sample route differs from (or cannot be checked against) the screenshot route.')
  const noSuffix = locationDigest('')
  if (sample.locationSuffixSha256 === null ? capture.routeSuffixSha256 !== noSuffix : sample.locationSuffixSha256 !== capture.routeSuffixSha256) {
    return fail('Geometry sample was taken at a different query string or fragment than the screenshot route (or did not record it).')
  }
  if (!capture.viewport || sample.viewport.width !== capture.viewport.width || sample.viewport.height !== capture.viewport.height) return fail('Geometry sample viewport differs from the screenshot viewport.')
  if (capture.devicePixelRatio === null || sample.devicePixelRatio !== capture.devicePixelRatio) return fail('Geometry sample device pixel ratio differs from the screenshot.')
  if (capture.interactionState === null || sample.interactionState !== capture.interactionState) return fail('Geometry sample interaction state differs from the screenshot.')
  if (sample.screenshotSha256 !== null && sample.screenshotSha256 !== screenshot.sha256) return fail('Geometry sample was taken with a different screenshot (SHA-256 mismatch).')
  if (capture.capture.fullPage === null) return fail('The screenshot extent (full page or viewport) is unknown, so CSS coordinates cannot be mapped.')
  let offset: CssPoint
  if (capture.capture.fullPage && sample.documentSize) {
    // A full-page screenshot spans max(viewport, document) × DPR. Checking it
    // catches a sample/descriptor that both misstate the device pixel ratio.
    const slack = Math.max(1, Math.ceil(sample.devicePixelRatio))
    const width = Math.max(sample.viewport.width, sample.documentSize.width) * sample.devicePixelRatio
    const height = Math.max(sample.viewport.height, sample.documentSize.height) * sample.devicePixelRatio
    if (Math.abs(screenshot.width - width) > slack || Math.abs(screenshot.height - height) > slack) {
      return fail(`Screenshot is ${screenshot.width}×${screenshot.height} px but the sampled document implies about ${Math.round(width)}×${Math.round(height)} at DPR ${sample.devicePixelRatio}.`)
    }
  }
  if (capture.capture.fullPage) {
    offset = sample.coordinateSpace === 'document' ? { x: 0, y: 0 } : { x: sample.scroll.x, y: sample.scroll.y }
  } else {
    const scroll = capture.capture.scroll
    if (!scroll) return fail('A viewport-only screenshot needs its scroll offset to map DOM coordinates.')
    if (sample.coordinateSpace === 'viewport') {
      if (sample.scroll.x !== scroll.x || sample.scroll.y !== scroll.y) return fail('Geometry sample was taken at a different scroll position than the viewport screenshot.')
      offset = { x: 0, y: 0 }
    } else offset = { x: -scroll.x, y: -scroll.y }
  }
  return { ok: true, mapping: { devicePixelRatio: sample.devicePixelRatio, offset, image: { width: screenshot.width, height: screenshot.height } }, screenshotBound: sample.screenshotSha256 !== null }
}

const EPSILON = 1e-6

/**
 * Converts a CSS rect to the smallest device-pixel rectangle covering it
 * (floor of the start edge, ceil of the end edge), optionally grown by
 * `marginPx`, clipped to the image. null when nothing is on screen.
 */
export function toScreenshotRect(rect: CssRect, mapping: ScreenshotMapping, marginPx = 0): PixelRect | null {
  const dpr = mapping.devicePixelRatio
  const x0 = Math.max(0, Math.floor((rect.x + mapping.offset.x) * dpr + EPSILON) - marginPx)
  const y0 = Math.max(0, Math.floor((rect.y + mapping.offset.y) * dpr + EPSILON) - marginPx)
  const x1 = Math.min(mapping.image.width, Math.ceil((rect.x + rect.width + mapping.offset.x) * dpr - EPSILON) + marginPx)
  const y1 = Math.min(mapping.image.height, Math.ceil((rect.y + rect.height + mapping.offset.y) * dpr - EPSILON) + marginPx)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
}

/** Rect in document CSS coordinates regardless of the sample's coordinate space. */
export function documentRect(sample: DomGeometrySample, rect: CssRect): CssRect {
  return sample.coordinateSpace === 'document' ? rect : { x: rect.x + sample.scroll.x, y: rect.y + sample.scroll.y, width: rect.width, height: rect.height }
}

export const intersection = (a: CssRect, b: CssRect): CssRect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

// ---------------------------------------------------------------------------
// Cross-version matching

export interface ElementIdentityKey { sourceRef: string; runtimeInstanceId: string }

export interface MatchedElement extends ElementIdentityKey {
  /** The weaker of the two sides' certainties. */
  identityCertainty: IdentityCertainty
  /** Both sides report a stable (keyed or React) instance identity. */
  stable: boolean
  baseline: DomElementGeometry
  candidate: DomElementGeometry
}

export interface ElementMatching {
  matched: MatchedElement[]
  baselineOnly: ElementIdentityKey[]
  candidateOnly: ElementIdentityKey[]
  /** Identity occurs more than once on a side, so it identifies nothing. */
  ambiguous: ElementIdentityKey[]
  /** Elements without sourceRef/runtimeInstanceId or with unknown/unmapped certainty. */
  unidentified: { baseline: number; candidate: number }
}

const keyOf = (element: DomElementGeometry) =>
  element.sourceRef && element.runtimeInstanceId && element.identityCertainty && element.identityCertainty !== 'unknown' && element.identityCertainty !== 'unmapped'
    ? `${element.sourceRef}\u0000${element.runtimeInstanceId}` : null
const splitKey = (key: string): ElementIdentityKey => { const [sourceRef, runtimeInstanceId] = key.split('\u0000'); return { sourceRef, runtimeInstanceId } }

export function matchElements(baseline: DomGeometrySample, candidate: DomGeometrySample): ElementMatching {
  const index = (sample: DomGeometrySample) => {
    const byKey = new Map<string, DomElementGeometry[]>()
    let unidentified = 0
    for (const element of sample.elements) {
      const key = keyOf(element)
      if (!key) { unidentified++; continue }
      byKey.set(key, [...(byKey.get(key) ?? []), element])
    }
    return { byKey, unidentified }
  }
  const b = index(baseline), c = index(candidate)
  const matched: MatchedElement[] = []
  const baselineOnly: ElementIdentityKey[] = [], candidateOnly: ElementIdentityKey[] = [], ambiguous: ElementIdentityKey[] = []
  const rank = (certainty: IdentityCertainty) => CERTAINTIES.indexOf(certainty)
  for (const key of [...new Set([...b.byKey.keys(), ...c.byKey.keys()])].sort()) {
    const left = b.byKey.get(key) ?? [], right = c.byKey.get(key) ?? []
    if (left.length > 1 || right.length > 1) { ambiguous.push(splitKey(key)); continue }
    if (!right.length) { baselineOnly.push(splitKey(key)); continue }
    if (!left.length) { candidateOnly.push(splitKey(key)); continue }
    const certainty = rank(left[0].identityCertainty!) >= rank(right[0].identityCertainty!) ? left[0].identityCertainty! : right[0].identityCertainty!
    matched.push({ ...splitKey(key), identityCertainty: certainty, stable: STABLE.has(left[0].identityCertainty!) && STABLE.has(right[0].identityCertainty!), baseline: left[0], candidate: right[0] })
  }
  return { matched, baselineOnly, candidateOnly, ambiguous, unidentified: { baseline: b.unidentified, candidate: c.unidentified } }
}

// ---------------------------------------------------------------------------
// Displacement and explicit layout rules

export interface ElementDisplacement extends ElementIdentityKey {
  identityCertainty: IdentityCertainty
  /** Document CSS px. */
  baselineRect: CssRect
  candidateRect: CssRect
  delta: { x: number; y: number; width: number; height: number }
}

const round = (value: number) => Math.round(value * 1000) / 1000
const roundRect = (rect: CssRect): CssRect => ({ x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) })

// ---------------------------------------------------------------------------
// Dual-side (baseline/candidate) precise cross-version pairing
//
// C+D's contract: a sourceRef is `jsx:<file>#<offset>`; the offset shifts when
// the candidate edits move the JSX node, so an exact sourceRef match across
// versions is the exception, not the rule. `runtimeInstanceId`
// (`<pathname>:<owner>`, owner = jsx boundary path or React useId) is stable
// across source edits ONLY when the annotation certifies a stable instance.
//
// Pairing uses exclusively deterministic facts — exact sourceRef equality,
// the source file parsed out of the sourceRef, runtimeInstanceId equality and
// the annotated certainty. Rendered text, DOM position and asset URLs are
// never consulted for provenance (same rule as matchElements).

/** `jsx:<file>#<offset>` → `<file>`; anything else has no provable source file. */
export const sourceFileFromSourceRef = (sourceRef: string | null): string | null => {
  if (sourceRef === null) return null
  const match = /^jsx:(.+)#\d+$/.exec(sourceRef)
  return match ? match[1] : null
}

export type CrossVersionProof = 'instance-candidate' | 'same-sourceRef-observed' | 'unproven'

/**
 * Inputs that C+D's strict instance proof (PR #28 `resolveRuntimeElement`)
 * requires but this pairing cannot evaluate. `strictInstanceProofAvailable`
 * stays false while any of these is listed; consumers must not present the
 * pairing as instance-level proof.
 */
export type CrossVersionMissingEvidence = 'source-version' | 'page-context' | 'collection-reasons' | 'graph-membership'

export interface CrossVersionPairingScope {
  /**
   * What this pairing IS: candidate pairing supported by the runtime
   * annotation only. It is explicitly NOT the C+D full identity assessment
   * (sourceVersion / pageContext / collection reasons / graph membership).
   */
  level: 'annotation-pairing'
  /** True only when missingEvidence is empty AND a C+D-grade assessment ran. */
  strictInstanceProofAvailable: boolean
  missingEvidence: CrossVersionMissingEvidence[]
}

export interface CrossVersionPair {
  baseline: DomElementGeometry
  candidate: DomElementGeometry
  proof: CrossVersionProof
  /** Deterministic downgrade facts; empty only for an instance-candidate pair. */
  reasons: string[]
  sourceRef: { baseline: string | null; candidate: string | null }
  runtimeInstanceId: string | null
}

export interface CrossVersionPairing {
  /** What kind of pairing this is and which strict-proof inputs are missing. */
  scope: CrossVersionPairingScope
  /**
   * Same stable runtime instance id on both sides, each exactly once, both
   * certainties stable, same source file, same page context and no version
   * clash. A CROSS-VERSION CANDIDATE only — the annotation supports the
   * pairing; it is not a C+D instance identity proof.
   */
  instanceCandidate: CrossVersionPair[]
  /**
   * Identical sourceRef string observed on both sides, without instance
   * evidence. String equality only: after an offset shift the same
   * `jsx:<file>#<offset>` can name a DIFFERENT JSX node, so this never
   * claims "same source element proven".
   */
  sameSourceRefObserved: CrossVersionPair[]
  /** Paired by an ambiguous rule or downgraded; never stronger than the facts. */
  unproven: CrossVersionPair[]
  baselineOnly: DomElementGeometry[]
  candidateOnly: DomElementGeometry[]
}

/** C+D blocking reasons: an element carrying any of these has no usable unique instance identity. */
const BLOCKING_IDENTITY_REASONS: readonly string[] = [
  'invalid-certainty', 'unmapped-owner', 'instance-unavailable', 'duplicate-runtime-instance', 'route-namespace-stale', 'react-keys-unavailable',
]

const UNSTABLE_REASON: Record<IdentityCertainty, string | null> = {
  'stable-keyed-instance': null,
  'stable-react-instance': null,
  'position-dependent': 'position-dependent-identity',
  'unknown': 'identity-not-stable',
  'unmapped': 'unmapped-owner',
}

/**
 * Optional host/C+D inputs for cross-version pairing.
 *
 * `expectedSourceVersions` carries, per side, the served-version digest each
 * side's own revision expects for a source file (C+D `sourceFileDigest`
 * against the baseline tree and the candidate tree). When provided, version
 * evidence is validated PER SIDE: a side whose collected version for its
 * element's file differs from its OWN expected digest is a real
 * `source-version-mismatch` (hard contradiction), while a legal cross-version
 * difference (H1 != H2 with both sides each valid) is NOT a clash. When
 * absent, the legacy conservative rule applies: any declared difference is
 * recorded as a downgrade reason, never as "invalid".
 */
export interface CrossVersionPairingOptions {
  expectedSourceVersions?: { baseline?: Record<string, string>; candidate?: Record<string, string> } | null
}

/**
 * Pairs baseline and candidate elements across the two source versions.
 *
 * Proof ladder (never skipped, never guessed):
 * - `instance-candidate`: both sides carry the same `runtimeInstanceId`, each
 *   exactly once per side, both certainties stable, both sourceRefs parse to
 *   the same source file, both samples share route/location suffix, the
 *   declared sourceVersions do not clash, and neither element carries a C+D
 *   blocking identity reason. This is the strongest level the runtime
 *   annotation alone can support; it remains a CANDIDATE until C+D-grade
 *   version/page-context/reason evidence is wired in (see pairing.scope).
 * - `same-sourceRef-observed`: exact `sourceRef` string equality (same file
 *   AND offset) without the instance evidence above. Offset drift means the
 *   string can label a different JSX node in the other version, so the level
 *   is observation, not provenance.
 * - `unproven`: everything else that still pairs (duplicated instance ids,
 *   unstable certainty, different source file, page-context or version clash)
 *   — recorded with its reasons.
 * - Elements that pair with nothing are reported per side, not dropped.
 *
 * Elements without a runtime instance id pair by exact sourceRef equality
 * ONLY when each side has exactly one such element; with several, array order
 * is never used to infer a correspondence (that would be position inference).
 */
export function pairCrossVersionElements(baseline: DomGeometrySample, candidate: DomGeometrySample, options?: CrossVersionPairingOptions): CrossVersionPairing {
  const usable = (element: DomElementGeometry) => element.sourceRef !== null && element.identityCertainty !== null && element.identityCertainty !== 'unmapped'
  const byInstance = (sample: DomGeometrySample) => {
    const groups = new Map<string, DomElementGeometry[]>()
    for (const element of sample.elements) {
      if (!usable(element) || !element.runtimeInstanceId) continue
      groups.set(element.runtimeInstanceId, [...(groups.get(element.runtimeInstanceId) ?? []), element])
    }
    return groups
  }
  // Sample-level deterministic facts. Route + location suffix are the
  // page-context subset E actually collects; a mismatch proves the two
  // samples describe different pages. sourceVersion is the served-file
  // sha256: both sides declaring it MUST agree, and a missing declaration is
  // "version evidence unavailable", never a match.
  const samePageContext = baseline.route === candidate.route && baseline.locationSuffixSha256 === candidate.locationSuffixSha256
  const expected = options?.expectedSourceVersions ?? null
  /** Collected served-version for `file` on one side: the per-file map wins; the legacy single-file field only applies to single-file samples. */
  const collectedVersion = (sample: DomGeometrySample, file: string | null): string | null => {
    if (file === null) return null
    if (sample.sourceFileVersions) return sample.sourceFileVersions[file] ?? null
    const files = [...new Set(sample.elements.map(element => sourceFileFromSourceRef(element.sourceRef)).filter((item): item is string => item !== null))]
    return files.length === 1 && files[0] === file ? sample.sourceVersion : null
  }
  /**
   * True when the side's OWN expected digest for `file` is known, the side
   * collected a version for it, and the two differ — a hard contradiction
   * between the collected identity evidence and that side's revision. Checked
   * per side and per source file, independent of the other side and of
   * sourceRef string equality (an offset drift keeps the file, not the
   * offset). Never inferred: without an expected digest there is no verdict.
   */
  const sideVersionInvalid = (sample: DomGeometrySample, side: 'baseline' | 'candidate', file: string | null): boolean => {
    const sideExpected = expected?.[side]
    if (!sideExpected || file === null) return false
    const want = sideExpected[file]
    if (!want) return false
    const got = collectedVersion(sample, file)
    return got !== null && got !== want
  }
  /** True when the side's version for `file` cannot be verified (no expected digest, or nothing collected): "unverified", never a match and never "invalid". */
  const sideVersionUnverified = (sample: DomGeometrySample, side: 'baseline' | 'candidate', file: string | null): boolean => {
    const sideExpected = expected?.[side]
    if (!sideExpected || file === null) return true
    const want = sideExpected[file]
    const got = collectedVersion(sample, file)
    return !want || got === null
  }
  /** Files referenced by usable elements of one side. */
  const referencedFiles = (sample: DomGeometrySample): string[] => [...new Set(sample.elements.filter(usable).map(element => sourceFileFromSourceRef(element.sourceRef)).filter((item): item is string => item !== null))].sort()
  // Without expected digests the legacy conservative rule stays in force: any
  // declared difference downgrades the pair (a recorded fact, not an
  // "invalid" verdict). With expected digests a mere H1 != H2 is legal.
  const versionClash = !expected && baseline.sourceVersion !== null && candidate.sourceVersion !== null && baseline.sourceVersion !== candidate.sourceVersion
  const missingEvidence: CrossVersionMissingEvidence[] = []
  if (!expected) {
    if (baseline.sourceVersion === null || candidate.sourceVersion === null) missingEvidence.push('source-version')
  } else {
    const verified = (sample: DomGeometrySample, side: 'baseline' | 'candidate') =>
      referencedFiles(sample).every(file => !sideVersionUnverified(sample, side, file) && !sideVersionInvalid(sample, side, file))
    if (!verified(baseline, 'baseline') || !verified(candidate, 'candidate')) missingEvidence.push('source-version')
  }
  // Route/suffix are collected, but C+D's full RuntimePageContext (pathname
  // namespace, route identity) is not — the strict proof input stays missing.
  // collection-reasons / graph-membership likewise have no C+D-grade pipeline
  // wired into the sampler yet.
  missingEvidence.push('page-context', 'collection-reasons', 'graph-membership')
  const consumedBaseline = new Set<string>(), consumedCandidate = new Set<string>()
  const instanceCandidate: CrossVersionPair[] = [], sameSourceRefObserved: CrossVersionPair[] = [], unproven: CrossVersionPair[] = []
  const pair = (b: DomElementGeometry, c: DomElementGeometry, proof: CrossVersionProof, reasons: string[]): CrossVersionPair => ({
    baseline: b, candidate: c, proof, reasons,
    sourceRef: { baseline: b.sourceRef, candidate: c.sourceRef },
    runtimeInstanceId: b.runtimeInstanceId && b.runtimeInstanceId === c.runtimeInstanceId ? b.runtimeInstanceId : null,
  })
  /** Facts that block or downgrade any pairing involving these two elements. */
  const sharedBlockers = (b: DomElementGeometry, c: DomElementGeometry): string[] => {
    const reasons: string[] = []
    if (!samePageContext && !reasons.includes('different-page-context')) reasons.push('different-page-context')
    if (versionClash && !reasons.includes('source-version-mismatch')) reasons.push('source-version-mismatch')
    // Per-side version invalidation: each side's collected version must match
    // its OWN revision's expected digest. Offset drift keeps the source file,
    // so this check must not depend on the two sourceRef strings being equal.
    if (!reasons.includes('source-version-mismatch') &&
      (sideVersionInvalid(baseline, 'baseline', sourceFileFromSourceRef(b.sourceRef)) ||
        sideVersionInvalid(candidate, 'candidate', sourceFileFromSourceRef(c.sourceRef)))) {
      reasons.push('source-version-mismatch')
    }
    const blocking = [...(b.identityReasons ?? []), ...(c.identityReasons ?? [])].filter(reason => BLOCKING_IDENTITY_REASONS.includes(reason))
    if (blocking.length && !reasons.includes('blocking-identity-reason')) reasons.push('blocking-identity-reason')
    return reasons
  }

  const bGroups = byInstance(baseline), cGroups = byInstance(candidate)
  for (const id of [...new Set([...bGroups.keys(), ...cGroups.keys()])].sort()) {
    const left = bGroups.get(id) ?? [], right = cGroups.get(id) ?? []
    // A duplicated instance id identifies nothing; keep every combination out
    // of the proof ladder and record the downgrade once.
    if (left.length > 1 || right.length > 1) {
      for (const b of left) for (const c of right) {
        consumedBaseline.add(b.id); consumedCandidate.add(c.id)
        unproven.push(pair(b, c, 'unproven', ['duplicate-runtime-instance']))
      }
      continue
    }
    if (!left.length || !right.length) continue
    const b = left[0], c = right[0]
    consumedBaseline.add(b.id); consumedCandidate.add(c.id)
    const bFile = sourceFileFromSourceRef(b.sourceRef), cFile = sourceFileFromSourceRef(c.sourceRef)
    const reasons = sharedBlockers(b, c)
    if (!STABLE.has(b.identityCertainty!) || !STABLE.has(c.identityCertainty!)) {
      const reason = UNSTABLE_REASON[b.identityCertainty!] ?? UNSTABLE_REASON[c.identityCertainty!]!
      if (reason && !reasons.includes(reason)) reasons.push(reason)
      const other = UNSTABLE_REASON[c.identityCertainty!]
      if (other && !reasons.includes(other)) reasons.push(other)
    }
    if (bFile === null || cFile === null) reasons.push('source-not-in-graph')
    else if (bFile !== cFile) reasons.push('different-source-file')
    // A page-context or version CLASH actively contradicts the observation, so
    // it lands at unproven even when the sourceRef strings are identical.
    // Other downgrades with identical strings stay at observation level.
    const contradicted = reasons.includes('different-page-context') || reasons.includes('source-version-mismatch')
    if (!reasons.length) {
      instanceCandidate.push(pair(b, c, 'instance-candidate', []))
    } else if (b.sourceRef === c.sourceRef && !contradicted) {
      // Same file AND offset is an observation, but it cannot upgrade an
      // unstable or duplicated identity to instance level.
      sameSourceRefObserved.push(pair(b, c, 'same-sourceRef-observed', reasons))
    } else {
      unproven.push(pair(b, c, 'unproven', reasons))
    }
  }

  // Remaining elements without a runtime instance id: only exact sourceRef
  // equality pairs them, only at observation level, and only when each side
  // has exactly one such element — with several, array order must not be used
  // to infer a per-element correspondence.
  const exactOnly = (sample: DomGeometrySample, consumed: Set<string>) => {
    const byRef = new Map<string, DomElementGeometry[]>()
    for (const element of sample.elements) {
      if (!usable(element) || consumed.has(element.id)) continue
      if (element.runtimeInstanceId) continue
      byRef.set(element.sourceRef!, [...(byRef.get(element.sourceRef!) ?? []), element])
    }
    return byRef
  }
  const bRefGroups = exactOnly(baseline, consumedBaseline), cRefGroups = exactOnly(candidate, consumedCandidate)
  for (const ref of [...new Set([...bRefGroups.keys(), ...cRefGroups.keys()])].sort()) {
    const left = bRefGroups.get(ref) ?? [], right = cRefGroups.get(ref) ?? []
    if (left.length !== 1 || right.length !== 1) continue
    const b = left[0], c = right[0]
    consumedBaseline.add(b.id); consumedCandidate.add(c.id)
    const reasons = sharedBlockers(b, c)
    const contradicted = reasons.includes('different-page-context') || reasons.includes('source-version-mismatch')
    if (contradicted) unproven.push(pair(b, c, 'unproven', reasons))
    else sameSourceRefObserved.push(pair(b, c, 'same-sourceRef-observed', reasons))
  }

  const rest = (sample: DomGeometrySample, consumed: Set<string>) => sample.elements.filter(element => usable(element) && !consumed.has(element.id))
  // DOM geometry has no VerificationRun or host Assessment binding. Strict
  // proof is exposed separately by runtime-identity-pairing.ts, which consumes
  // the formal run receipts. A caller-supplied object cannot upgrade this view.
  const strictInstanceProofAvailable = false
  return {
    scope: { level: 'annotation-pairing', strictInstanceProofAvailable, missingEvidence },
    instanceCandidate, sameSourceRefObserved, unproven,
    baselineOnly: rest(baseline, consumedBaseline),
    candidateOnly: rest(candidate, consumedCandidate),
  }
}


export function elementDisplacements(baseline: DomGeometrySample, candidate: DomGeometrySample, matching: ElementMatching, toleranceCssPx: number): ElementDisplacement[] {
  const result: ElementDisplacement[] = []
  for (const element of matching.matched) {
    const before = documentRect(baseline, element.baseline.rect), after = documentRect(candidate, element.candidate.rect)
    const delta = { x: round(after.x - before.x), y: round(after.y - before.y), width: round(after.width - before.width), height: round(after.height - before.height) }
    if ([delta.x, delta.y, delta.width, delta.height].some(value => Math.abs(value) > toleranceCssPx)) {
      result.push({ sourceRef: element.sourceRef, runtimeInstanceId: element.runtimeInstanceId, identityCertainty: element.identityCertainty, baselineRect: roundRect(before), candidateRect: roundRect(after), delta })
    }
  }
  return result
}

export type GeometryRuleId = 'new-overlap' | 'new-viewport-overflow' | 'new-clip-overflow' | 'new-document-horizontal-overflow'

export interface GeometryRiskFinding {
  rule: GeometryRuleId
  detail: string
  elements: Array<ElementIdentityKey & { baselineRect: CssRect | null; candidateRect: CssRect | null }>
  /** Overlap area, overflow distance or document width, depending on the rule (CSS px / CSS px²). */
  measure: { baseline: number; candidate: number }
}

export const GEOMETRY_RULES: Readonly<Record<GeometryRuleId, string>> = Object.freeze({
  'new-overlap': 'Two stably identified, visible, non-nested elements whose visible (unclipped) boxes did not overlap in the baseline overlap by more than the tolerance in both axes in the candidate (possible occlusion).',
  'new-viewport-overflow': 'A stably identified, visible element whose clipped box stayed within the viewport width in the baseline extends beyond it by more than the tolerance in the candidate.',
  'new-clip-overflow': 'A stably identified, visible element that fit inside its overflow:hidden/clip ancestors in the baseline exceeds them by more than the tolerance in the candidate (content is cut off; scroll containers are excluded).',
  'new-document-horizontal-overflow': 'The document scroll width stayed within the viewport width in the baseline and exceeds it by more than the tolerance in the candidate.',
})

function ancestorsOf(sample: DomGeometrySample): (id: string) => Set<string> {
  const parents = new Map(sample.elements.map(element => [element.id, element.parentId]))
  const cache = new Map<string, Set<string>>()
  return (id: string) => {
    let found = cache.get(id)
    if (found) return found
    found = new Set<string>()
    for (let cursor = parents.get(id) ?? null; cursor !== null; cursor = parents.get(cursor) ?? null) found.add(cursor)
    cache.set(id, found)
    return found
  }
}

const shown = (element: DomElementGeometry) => element.visible !== false && element.rect.width > 0 && element.rect.height > 0
/** The part of an element's box its clipping ancestors leave visible, in document coordinates. */
function visibleBox(sample: DomGeometrySample, element: DomElementGeometry): CssRect | null {
  const rect = documentRect(sample, element.rect)
  return element.clipRect ? intersection(rect, documentRect(sample, element.clipRect)) : rect
}
const overflowBeyond = (inner: CssRect, outer: CssRect) => Math.max(0, outer.x - inner.x, outer.y - inner.y, inner.x + inner.width - (outer.x + outer.width), inner.y + inner.height - (outer.y + outer.height))

/**
 * Applies the explicit rules in GEOMETRY_RULES. Each rule compares the same
 * stably identified element(s) across versions, so a layout that was already
 * overlapping, clipped or overflowing in the baseline is not reported as new.
 */
export function detectGeometryRisks(baseline: DomGeometrySample, candidate: DomGeometrySample, matching: ElementMatching, toleranceCssPx: number, maxFindings: number): { findings: GeometryRiskFinding[]; truncated: boolean } {
  const findings: GeometryRiskFinding[] = []
  let truncated = false
  const push = (finding: GeometryRiskFinding) => { if (findings.length < maxFindings) findings.push(finding); else truncated = true }
  const tol = toleranceCssPx
  const stable = matching.matched.filter(element => element.stable && shown(element.baseline) && shown(element.candidate))
  const bAnc = ancestorsOf(baseline), cAnc = ancestorsOf(candidate)
  const entry = (element: MatchedElement) => ({ sourceRef: element.sourceRef, runtimeInstanceId: element.runtimeInstanceId, baselineRect: roundRect(documentRect(baseline, element.baseline.rect)), candidateRect: roundRect(documentRect(candidate, element.candidate.rect)) })

  if (baseline.documentSize && candidate.documentSize) {
    const limit = candidate.viewport.width + tol
    if (baseline.documentSize.width <= baseline.viewport.width + tol && candidate.documentSize.width > limit) {
      push({ rule: 'new-document-horizontal-overflow', detail: GEOMETRY_RULES['new-document-horizontal-overflow'], elements: [], measure: { baseline: round(baseline.documentSize.width), candidate: round(candidate.documentSize.width) } })
    }
  }
  for (let i = 0; i < stable.length; i++) {
    const a = stable[i]
    for (let j = i + 1; j < stable.length; j++) {
      const b = stable[j]
      if (bAnc(a.baseline.id).has(b.baseline.id) || bAnc(b.baseline.id).has(a.baseline.id) || cAnc(a.candidate.id).has(b.candidate.id) || cAnc(b.candidate.id).has(a.candidate.id)) continue
      // Visible parts only: content scrolled or clipped away cannot occlude anything.
      const aAfter = visibleBox(candidate, a.candidate), bAfter = visibleBox(candidate, b.candidate)
      const after = aAfter && bAfter ? intersection(aAfter, bAfter) : null
      if (!after || after.width <= tol || after.height <= tol) continue
      const aBefore = visibleBox(baseline, a.baseline), bBefore = visibleBox(baseline, b.baseline)
      const before = aBefore && bBefore ? intersection(aBefore, bBefore) : null
      if (before && before.width > tol && before.height > tol) continue
      push({ rule: 'new-overlap', detail: GEOMETRY_RULES['new-overlap'], elements: [entry(a), entry(b)], measure: { baseline: before ? round(before.width * before.height) : 0, candidate: round(after.width * after.height) } })
    }
  }
  for (const element of stable) {
    const viewportOverflow = (sample: DomGeometrySample, geometry: DomElementGeometry) => {
      const box = visibleBox(sample, geometry)
      return box ? Math.max(0, -box.x, box.x + box.width - sample.viewport.width) : 0
    }
    const before = viewportOverflow(baseline, element.baseline), after = viewportOverflow(candidate, element.candidate)
    if (before <= tol && after > tol) push({ rule: 'new-viewport-overflow', detail: GEOMETRY_RULES['new-viewport-overflow'], elements: [entry(element)], measure: { baseline: round(before), candidate: round(after) } })
    // Only overflow hidden/clip cuts content off; a scroll container just scrolls it.
    if (element.baseline.hiddenClipRect && element.candidate.hiddenClipRect) {
      const clipBefore = overflowBeyond(documentRect(baseline, element.baseline.rect), documentRect(baseline, element.baseline.hiddenClipRect))
      const clipAfter = overflowBeyond(documentRect(candidate, element.candidate.rect), documentRect(candidate, element.candidate.hiddenClipRect))
      if (clipBefore <= tol && clipAfter > tol) push({ rule: 'new-clip-overflow', detail: GEOMETRY_RULES['new-clip-overflow'], elements: [entry(element)], measure: { baseline: round(clipBefore), candidate: round(clipAfter) } })
    }
  }
  return { findings, truncated }
}
