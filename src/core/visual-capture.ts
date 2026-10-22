// Comparison inputs for visual-difference evidence: what each screenshot's
// producer declares about it, which candidate the comparison claims to be
// about, and the rules that decide whether two screenshots may be compared.
//
// Every descriptor field is nullable. null means "not observed": it is never
// replaced by a default (DPR 1, the planned viewport, "rendered", ...), because
// a default would silently turn an assumption into an observation.
import { createHash } from 'node:crypto'
import type { CandidatePatch, ProjectRevision } from './model'

export type VisualSide = 'baseline' | 'candidate'
export interface CssSize { width: number; height: number }
export interface CssPoint { x: number; y: number }

export interface VisualCaptureDescriptor {
  side: VisualSide
  /** Same-origin path the page was loaded at; query and fragment are removed. */
  route: string | null
  /** Absolute page URL without credentials, query or fragment. */
  pageUrl: string | null
  /** True when credentials, a query string or a fragment were removed from route/pageUrl. */
  locationRedacted: boolean
  /**
   * SHA-256 of the query + fragment removed from `route` ("" when there was
   * none; null when the route is unknown). Hash routers and query-addressed
   * pages differ only there, so it takes part in comparability without
   * recording the (possibly sensitive) value itself.
   */
  routeSuffixSha256: string | null
  /** SHA-256 of pathname + query + fragment of `pageUrl` before redaction (origin excluded); null when unknown. */
  pageUrlLocationSha256: string | null
  /** CSS-pixel viewport the page was laid out in. */
  viewport: CssSize | null
  devicePixelRatio: number | null
  browser: { name: string; version: string } | null
  runtimeFingerprint: string | null
  /** e.g. "rendered", "after:button:Open menu". Compared verbatim. */
  interactionState: string | null
  /** Baseline: project source digest. Candidate: candidate tree digest. */
  sourceDigest: string | null
  capture: {
    /** The producer finished writing the screenshot. */
    completed: boolean | null
    /** The producer's own stability verdict (e.g. consecutive frames equal). */
    stable: boolean | null
    fullPage: boolean | null
    animationsDisabled: boolean | null
    fontsReady: boolean | null
    capturedAt: string | null
    /** Window scroll offset in CSS px when the screenshot was taken. */
    scroll: CssPoint | null
  }
  screenshot: {
    /** SHA-256 the producer recorded for the screenshot file. */
    declaredSha256: string | null
    /** Evidence-relative path, informational only. */
    artifactPath: string | null
  }
}

export interface DescriptorIssue { field: string; problem: 'missing' | 'invalid' }

export interface VisualComparisonSubject {
  candidateId: string | null
  /** Project the captures claim to belong to; compared against expected.projectId when either side declares it. */
  projectId: string | null
  patchHash: string | null
  baseSourceDigest: string | null
  candidateTreeDigest: string | null
  runtimeFingerprint: string | null
  scopeDecisionId: string | null
  scopeVersion: number | null
  runId: string | null
}

/** The identity of the candidate a caller wants evidence for (its current CandidatePatch). */
export interface ExpectedCandidateIdentity {
  candidateId: string
  /** Project revision id the candidate belongs to; optional for callers on legacy contracts. */
  projectId?: string
  patchHash: string
  baseSourceDigest: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  scopeDecisionId: string
  scopeVersion: number
}

export function expectedIdentityFor(candidate: CandidatePatch, revision: ProjectRevision): ExpectedCandidateIdentity {
  return {
    candidateId: candidate.id,
    projectId: revision.projectId,
    patchHash: candidate.patchHash,
    baseSourceDigest: candidate.baseSourceDigest,
    candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint: revision.runtimeFingerprint,
    scopeDecisionId: candidate.scopeDecisionId,
    scopeVersion: candidate.scopeVersion,
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const HEX64 = /^[a-f0-9]{64}$/

class Reader {
  readonly issues: DescriptorIssue[] = []
  private readonly prefix: string
  constructor(prefix: string) { this.prefix = prefix }
  private note(field: string, value: unknown) {
    this.issues.push({ field: `${this.prefix}${field}`, problem: value === undefined || value === null ? 'missing' : 'invalid' })
    return null
  }
  text(source: Record<string, unknown>, field: string, max: number, path = field): string | null {
    const value = source[field]
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : this.note(path, value)
  }
  flag(source: Record<string, unknown>, field: string, path = field): boolean | null {
    const value = source[field]
    return typeof value === 'boolean' ? value : this.note(path, value)
  }
  invalid(path: string, value: unknown) { return this.note(path, value) }
}

export const locationDigest = (value: string) => createHash('sha256').update(`ripple-location:${value}`).digest('hex')

/** Splits a same-origin path into its recorded path and a digest of the removed query/fragment. */
export function sanitizeRoute(value: string): { route: string; suffixSha256: string; redacted: boolean } | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 2048) return null
  const route = value.split(/[?#]/, 1)[0]
  return { route, suffixSha256: locationDigest(value.slice(route.length)), redacted: route !== value }
}

function sanitizeUrl(value: string): { url: string; locationSha256: string; redacted: boolean } | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const locationSha256 = locationDigest(`${url.pathname}${url.search}${url.hash}`)
  const redacted = !!(url.username || url.password || url.search || url.hash)
  url.username = ''; url.password = ''; url.search = ''; url.hash = ''
  return { url: url.toString(), locationSha256, redacted }
}

const positiveInteger = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max

/** Parses an untrusted capture descriptor. Absent or malformed fields become null and are listed in `issues`. */
export function normalizeVisualCaptureDescriptor(value: unknown, side: VisualSide): { descriptor: VisualCaptureDescriptor; issues: DescriptorIssue[]; declaredSide: unknown } {
  const source = record(value) ? value : {}
  const read = new Reader(`${side}.`)
  let locationRedacted = false

  const rawRoute = read.text(source, 'route', 2048)
  let route: string | null = null
  let routeSuffixSha256: string | null = null
  if (rawRoute !== null) {
    const sanitized = sanitizeRoute(rawRoute)
    if (sanitized) { route = sanitized.route; routeSuffixSha256 = sanitized.suffixSha256; locationRedacted ||= sanitized.redacted } else read.invalid('route', rawRoute)
  }
  const rawUrl = read.text(source, 'pageUrl', 4096)
  let pageUrl: string | null = null
  let pageUrlLocationSha256: string | null = null
  if (rawUrl !== null) {
    const sanitized = sanitizeUrl(rawUrl)
    if (sanitized) { pageUrl = sanitized.url; pageUrlLocationSha256 = sanitized.locationSha256; locationRedacted ||= sanitized.redacted } else read.invalid('pageUrl', rawUrl)
  }

  let viewport: CssSize | null = null
  if (record(source.viewport) && positiveInteger(source.viewport.width, 16384) && positiveInteger(source.viewport.height, 16384)) {
    viewport = { width: source.viewport.width as number, height: source.viewport.height as number }
  } else read.invalid('viewport', source.viewport)

  const dpr = source.devicePixelRatio
  const devicePixelRatio = typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0 && dpr <= 8 ? dpr : read.invalid('devicePixelRatio', dpr)

  let browser: VisualCaptureDescriptor['browser'] = null
  if (record(source.browser)) {
    const name = read.text(source.browser, 'name', 100, 'browser.name')
    const version = read.text(source.browser, 'version', 100, 'browser.version')
    browser = name !== null && version !== null ? { name, version } : null
  } else read.invalid('browser', source.browser)

  const runtimeFingerprint = read.text(source, 'runtimeFingerprint', 512)
  const interactionState = read.text(source, 'interactionState', 300)
  const sourceDigest = read.text(source, 'sourceDigest', 256)

  const capture = record(source.capture) ? source.capture : {}
  const capturedAtRaw = capture.capturedAt
  const capturedAt = typeof capturedAtRaw === 'string' && capturedAtRaw.length <= 64 && Number.isFinite(Date.parse(capturedAtRaw)) ? capturedAtRaw : read.invalid('capture.capturedAt', capturedAtRaw)
  let scroll: CssPoint | null = null
  if (record(capture.scroll) && typeof capture.scroll.x === 'number' && Number.isFinite(capture.scroll.x) && typeof capture.scroll.y === 'number' && Number.isFinite(capture.scroll.y)) {
    scroll = { x: capture.scroll.x, y: capture.scroll.y }
  } else read.invalid('capture.scroll', capture.scroll)

  const screenshot = record(source.screenshot) ? source.screenshot : {}
  const declaredRaw = screenshot.declaredSha256
  const declaredSha256 = typeof declaredRaw === 'string' && HEX64.test(declaredRaw) ? declaredRaw : read.invalid('screenshot.declaredSha256', declaredRaw)
  const pathRaw = screenshot.artifactPath
  const artifactPath = typeof pathRaw === 'string' && pathRaw.length > 0 && pathRaw.length <= 512 && !pathRaw.startsWith('/') && !/^[A-Za-z]:/.test(pathRaw) && !pathRaw.includes('\\') && !pathRaw.split('/').includes('..')
    ? pathRaw : pathRaw === undefined ? null : read.invalid('screenshot.artifactPath', pathRaw)

  const descriptor: VisualCaptureDescriptor = {
    side, route, pageUrl, locationRedacted, routeSuffixSha256, pageUrlLocationSha256, viewport, devicePixelRatio, browser, runtimeFingerprint, interactionState, sourceDigest,
    capture: {
      completed: read.flag(capture, 'completed', 'capture.completed'),
      stable: read.flag(capture, 'stable', 'capture.stable'),
      fullPage: read.flag(capture, 'fullPage', 'capture.fullPage'),
      animationsDisabled: read.flag(capture, 'animationsDisabled', 'capture.animationsDisabled'),
      fontsReady: read.flag(capture, 'fontsReady', 'capture.fontsReady'),
      capturedAt,
      scroll,
    },
    screenshot: { declaredSha256, artifactPath },
  }
  return { descriptor, issues: read.issues, declaredSide: source.side }
}

export function normalizeVisualSubject(value: unknown): VisualComparisonSubject {
  const source = record(value) ? value : {}
  const text = (field: string) => typeof source[field] === 'string' && (source[field] as string).length > 0 && (source[field] as string).length <= 512 ? source[field] as string : null
  return {
    candidateId: text('candidateId'),
    projectId: text('projectId'),
    patchHash: text('patchHash'),
    baseSourceDigest: text('baseSourceDigest'),
    candidateTreeDigest: text('candidateTreeDigest'),
    runtimeFingerprint: text('runtimeFingerprint'),
    scopeDecisionId: text('scopeDecisionId'),
    scopeVersion: Number.isInteger(source.scopeVersion) && (source.scopeVersion as number) >= 0 ? source.scopeVersion as number : null,
    runId: text('runId'),
  }
}

// ---------------------------------------------------------------------------
// Identity: does this evidence belong to the candidate the caller asked about?

export type IdentityCheckStatus = 'match' | 'mismatch' | 'unknown'
export interface IdentityCheck {
  field: string
  observed: string | number | null
  expected: string | number | null
  status: IdentityCheckStatus
}
export interface IdentityAssessment {
  /** consistent: every binding matched; stale: something belongs to another candidate/source/runtime; unverified: a binding could not be checked. */
  status: 'consistent' | 'stale' | 'unverified'
  expectedProvided: boolean
  checks: IdentityCheck[]
}

function check(field: string, observed: string | number | null, expected: string | number | null): IdentityCheck {
  return { field, observed, expected, status: observed === null || expected === null ? 'unknown' : observed === expected ? 'match' : 'mismatch' }
}

export function assessIdentity(subject: VisualComparisonSubject, expected: ExpectedCandidateIdentity | null, baseline: VisualCaptureDescriptor, candidate: VisualCaptureDescriptor): IdentityAssessment {
  const reference = expected ?? subject
  const checks: IdentityCheck[] = []
  if (expected) {
    checks.push(
      check('subject.candidateId', subject.candidateId, expected.candidateId),
      // Only bind projectId when at least one side declares it; legacy inputs
      // carry no projectId and must not silently downgrade to 'unverified'.
      ...(subject.projectId !== null || expected.projectId !== undefined
        ? [check('subject.projectId', subject.projectId, expected.projectId ?? null)]
        : []),
      check('subject.patchHash', subject.patchHash, expected.patchHash),
      check('subject.baseSourceDigest', subject.baseSourceDigest, expected.baseSourceDigest),
      check('subject.candidateTreeDigest', subject.candidateTreeDigest, expected.candidateTreeDigest),
      check('subject.runtimeFingerprint', subject.runtimeFingerprint, expected.runtimeFingerprint),
      check('subject.scopeDecisionId', subject.scopeDecisionId, expected.scopeDecisionId),
      check('subject.scopeVersion', subject.scopeVersion, expected.scopeVersion),
    )
  }
  checks.push(
    check('baseline.sourceDigest', baseline.sourceDigest, reference.baseSourceDigest),
    check('candidate.sourceDigest', candidate.sourceDigest, reference.candidateTreeDigest),
    check('baseline.runtimeFingerprint', baseline.runtimeFingerprint, reference.runtimeFingerprint),
    check('candidate.runtimeFingerprint', candidate.runtimeFingerprint, reference.runtimeFingerprint),
  )
  const status = checks.some(item => item.status === 'mismatch') ? 'stale'
    : !expected || checks.some(item => item.status === 'unknown') ? 'unverified' : 'consistent'
  return { status, expectedProvided: !!expected, checks }
}

// ---------------------------------------------------------------------------
// Comparability: may these two screenshots be compared pixel for pixel?

export type ComparabilityCode =
  | 'descriptor-side-mismatch'
  | 'route-unknown' | 'route-mismatch'
  | 'viewport-unknown' | 'viewport-mismatch'
  | 'device-pixel-ratio-unknown' | 'device-pixel-ratio-mismatch'
  | 'interaction-state-unknown' | 'interaction-state-mismatch'
  | 'browser-mismatch'
  | 'capture-incomplete' | 'capture-completion-unknown' | 'capture-unstable'
  | 'capture-extent-mismatch'
  | 'scroll-mismatch'
  | 'image-size-mismatch' | 'image-viewport-inconsistent'

export type LimitationCode =
  | 'browser-unknown'
  | 'capture-stability-unknown'
  | 'capture-extent-unknown'
  | 'viewport-only-capture'
  | 'animations-not-disabled' | 'animations-state-unknown'
  | 'fonts-not-ready' | 'fonts-state-unknown'
  | 'screenshot-hash-undeclared' | 'risk-provenance-incomplete'
  | 'transparent-pixels'
  | 'candidate-identity-unverified'
  | 'geometry-unavailable' | 'geometry-rejected' | 'geometry-partial' | 'geometry-screenshot-unbound' | 'target-not-declared' | 'target-not-mapped'

export interface Finding<C extends string> { code: C; detail: string; baseline?: unknown; candidate?: unknown }

export interface ImageSize { width: number; height: number }

const sameSize = (a: CssSize | null, b: CssSize | null) => !!a && !!b && a.width === b.width && a.height === b.height

/** Device-pixel extent a screenshot must have for its declared viewport, DPR and capture extent (±1 px for fractional DPR). */
export function imageConsistentWithViewport(image: ImageSize, viewport: CssSize, devicePixelRatio: number, fullPage: boolean): boolean {
  const expectedWidth = viewport.width * devicePixelRatio
  const expectedHeight = viewport.height * devicePixelRatio
  if (fullPage) return image.width >= Math.floor(expectedWidth) - 1 && image.height >= Math.floor(expectedHeight) - 1
  return Math.abs(image.width - expectedWidth) <= 1 && Math.abs(image.height - expectedHeight) <= 1
}

export function assessComparability(
  baseline: VisualCaptureDescriptor, candidate: VisualCaptureDescriptor,
  declaredSides: { baseline: unknown; candidate: unknown },
  images: { baseline: ImageSize | null; candidate: ImageSize | null },
): { comparable: boolean; reasons: Finding<ComparabilityCode>[]; limitations: Finding<LimitationCode>[] } {
  const reasons: Finding<ComparabilityCode>[] = []
  const limitations: Finding<LimitationCode>[] = []
  const pair = (code: ComparabilityCode, detail: string, b: unknown, c: unknown) => reasons.push({ code, detail, baseline: b, candidate: c })

  if ((declaredSides.baseline !== undefined && declaredSides.baseline !== 'baseline') || (declaredSides.candidate !== undefined && declaredSides.candidate !== 'candidate')) {
    pair('descriptor-side-mismatch', 'A capture descriptor declares the other side of the comparison.', declaredSides.baseline ?? null, declaredSides.candidate ?? null)
  }
  if (baseline.route === null || candidate.route === null) pair('route-unknown', 'The route of at least one screenshot was not recorded.', baseline.route, candidate.route)
  else if (baseline.route !== candidate.route) pair('route-mismatch', 'The screenshots show different routes.', baseline.route, candidate.route)
  else if (baseline.routeSuffixSha256 !== candidate.routeSuffixSha256) pair('route-mismatch', 'The routes differ in their query string or fragment (e.g. hash-router paths); only digests are recorded.', baseline.routeSuffixSha256, candidate.routeSuffixSha256)
  else if (baseline.pageUrlLocationSha256 !== null && candidate.pageUrlLocationSha256 !== null && baseline.pageUrlLocationSha256 !== candidate.pageUrlLocationSha256) {
    pair('route-mismatch', 'The page URLs differ in path, query string or fragment; only digests are recorded.', baseline.pageUrlLocationSha256, candidate.pageUrlLocationSha256)
  }
  if (!baseline.viewport || !candidate.viewport) pair('viewport-unknown', 'The CSS viewport of at least one screenshot was not recorded.', baseline.viewport, candidate.viewport)
  else if (!sameSize(baseline.viewport, candidate.viewport)) pair('viewport-mismatch', 'The screenshots were laid out in different viewports.', baseline.viewport, candidate.viewport)
  if (baseline.devicePixelRatio === null || candidate.devicePixelRatio === null) pair('device-pixel-ratio-unknown', 'The device pixel ratio of at least one screenshot was not recorded.', baseline.devicePixelRatio, candidate.devicePixelRatio)
  else if (baseline.devicePixelRatio !== candidate.devicePixelRatio) pair('device-pixel-ratio-mismatch', 'The screenshots were rendered at different device pixel ratios.', baseline.devicePixelRatio, candidate.devicePixelRatio)
  if (baseline.interactionState === null || candidate.interactionState === null) pair('interaction-state-unknown', 'The interaction state of at least one screenshot was not recorded.', baseline.interactionState, candidate.interactionState)
  else if (baseline.interactionState !== candidate.interactionState) pair('interaction-state-mismatch', 'The screenshots were taken in different interaction states.', baseline.interactionState, candidate.interactionState)
  if (baseline.browser && candidate.browser && (baseline.browser.name !== candidate.browser.name || baseline.browser.version !== candidate.browser.version)) {
    pair('browser-mismatch', 'The screenshots were rendered by different browsers or browser versions.', baseline.browser, candidate.browser)
  } else if (!baseline.browser || !candidate.browser) {
    limitations.push({ code: 'browser-unknown', detail: 'The browser of at least one screenshot was not recorded; rendering-engine differences cannot be excluded.', baseline: baseline.browser, candidate: candidate.browser })
  }
  for (const descriptor of [baseline, candidate]) {
    if (descriptor.capture.completed === false) pair('capture-incomplete', `The ${descriptor.side} screenshot was not completed by its producer.`, baseline.capture.completed, candidate.capture.completed)
    else if (descriptor.capture.completed === null) pair('capture-completion-unknown', `The ${descriptor.side} screenshot has no completion marker.`, baseline.capture.completed, candidate.capture.completed)
    if (descriptor.capture.stable === false) pair('capture-unstable', `The ${descriptor.side} producer reported the page as visually unstable when captured.`, baseline.capture.stable, candidate.capture.stable)
  }
  if (baseline.capture.stable === null || candidate.capture.stable === null) {
    limitations.push({ code: 'capture-stability-unknown', detail: 'Stability was not recorded for at least one screenshot; animation or late loading may contribute to the difference.', baseline: baseline.capture.stable, candidate: candidate.capture.stable })
  }
  const extentKnown = baseline.capture.fullPage !== null && candidate.capture.fullPage !== null
  if (extentKnown && baseline.capture.fullPage !== candidate.capture.fullPage) pair('capture-extent-mismatch', 'One screenshot is full-page and the other is viewport-only.', baseline.capture.fullPage, candidate.capture.fullPage)
  else if (!extentKnown) limitations.push({ code: 'capture-extent-unknown', detail: 'Whether the screenshots cover the full page or only the viewport was not recorded; DOM geometry cannot be mapped and unchecked page areas are unknown.', baseline: baseline.capture.fullPage, candidate: candidate.capture.fullPage })
  else if (baseline.capture.fullPage === false) limitations.push({ code: 'viewport-only-capture', detail: 'Only the visible viewport was captured; content outside it was not compared.' })
  // For viewport-only captures the scroll offset selects which document region
  // is shown; different offsets make a pixel-for-pixel comparison meaningless
  // even when viewport, DPR and state match. (Full-page captures cover the
  // whole document, so their scroll positions do not affect comparability.)
  if (extentKnown && baseline.capture.fullPage === false && candidate.capture.fullPage === false &&
    baseline.capture.scroll && candidate.capture.scroll &&
    (baseline.capture.scroll.x !== candidate.capture.scroll.x || baseline.capture.scroll.y !== candidate.capture.scroll.y)) {
    pair('scroll-mismatch', 'Viewport-only captures were taken at different scroll positions, so they show different document regions.', baseline.capture.scroll, candidate.capture.scroll)
  }
  for (const [flag, falseCode, nullCode, label] of [
    ['animationsDisabled', 'animations-not-disabled', 'animations-state-unknown', 'Animations'],
    ['fontsReady', 'fonts-not-ready', 'fonts-state-unknown', 'Font loading'],
  ] as const) {
    const values = [baseline.capture[flag], candidate.capture[flag]]
    if (values.includes(false)) limitations.push({ code: falseCode, detail: `${label} was not settled for at least one screenshot.`, baseline: values[0], candidate: values[1] })
    else if (values.includes(null)) limitations.push({ code: nullCode, detail: `${label} state was not recorded for at least one screenshot.`, baseline: values[0], candidate: values[1] })
  }
  if (baseline.screenshot.declaredSha256 === null || candidate.screenshot.declaredSha256 === null) {
    limitations.push({ code: 'screenshot-hash-undeclared', detail: 'At least one screenshot has no producer-recorded SHA-256, so its bytes cannot be tied to an execution record.' })
  }

  const { baseline: bImage, candidate: cImage } = images
  if (bImage && cImage) {
    if (bImage.width !== cImage.width || bImage.height !== cImage.height) {
      pair('image-size-mismatch', 'The screenshots have different pixel dimensions (for full-page captures this usually means the page extent changed); pixels cannot be compared one to one.', bImage, cImage)
    }
    for (const [descriptor, image] of [[baseline, bImage], [candidate, cImage]] as const) {
      if (descriptor.viewport && descriptor.devicePixelRatio !== null && descriptor.capture.fullPage !== null &&
        !imageConsistentWithViewport(image, descriptor.viewport, descriptor.devicePixelRatio, descriptor.capture.fullPage)) {
        pair('image-viewport-inconsistent', `The ${descriptor.side} screenshot size does not match its declared viewport × device pixel ratio.`, baseline.side === descriptor.side ? image : null, candidate.side === descriptor.side ? image : null)
      }
    }
  }
  return { comparable: reasons.length === 0, reasons, limitations }
}
