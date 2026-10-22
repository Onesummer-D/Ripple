// Visual-difference evidence between a baseline and a candidate screenshot.
//
// This module reports what changed, where, and how sure it can be; it does not
// decide whether a candidate passes. Its result is never 'pass':
//   stale          the inputs belong to another candidate / source / runtime
//   failed-to-run  a screenshot is corrupt, oversized, unreadable or differs from its recorded hash
//   not-run        a screenshot does not exist
//   unknown        not comparable, or compared without a proven layout risk
//   risk           compared, identity-consistent, and an explicit geometry rule fired
// A visual change on its own is not a risk, and "no visual change" is not a
// pass: intent and Scope coverage come from the browser assertions of the
// formal VerificationRun.
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { EvidenceResult, VerificationAssertion, VerificationCheck, VerificationEvidence } from './model'
import {
  assessComparability, assessIdentity, normalizeVisualCaptureDescriptor, normalizeVisualSubject, sanitizeRoute,
  type ComparabilityCode, type DescriptorIssue, type ExpectedCandidateIdentity, type Finding, type IdentityAssessment,
  type LimitationCode, type VisualCaptureDescriptor, type VisualComparisonSubject, type VisualSide,
} from './visual-capture'
import { DIFF_IMAGE_LEGEND, diffPixels, MASK_CHANGED, renderDiffImage, assertVisualWorkBudget, VisualResourceLimitError, type PixelDiff, type PixelRect, type Rgb } from './visual-diff'
import {
  bindGeometryToCapture, DEFAULT_GEOMETRY_LIMITS, detectGeometryRisks, elementDisplacements, GEOMETRY_RULES, matchElements, parseDomGeometrySample, toScreenshotRect,
  type CssRect, type DomGeometrySample, type ElementDisplacement, type ElementIdentityKey, type GeometryLimits, type GeometryRiskFinding, type IdentityCertainty, type ScreenshotMapping,
} from './visual-geometry'
import { DEFAULT_PNG_LIMITS, encodePng, inspectPng, pixelDigest, readPng, sha256Hex, type DecodedPng, type PngLimits } from './visual-png'

export const VISUAL_EVIDENCE_SCHEMA = 'ripple-visual-difference/v1'
export type VisualEvidenceResult = Exclude<EvidenceResult, 'pass'>

export interface VisualDiffParameters {
  /** pixelmatch OKLab HyAB threshold (0–1). */
  threshold: number
  /** Count anti-aliasing as change. Default false: reported separately. */
  includeAA: boolean
  /** Region merge grid in CSS px; multiplied by DPR and rounded up. */
  mergeDistanceCssPx: number
  /** Tolerance around target boxes for glyph overhang / edge anti-aliasing, CSS px. */
  targetMarginCssPx: number
  /** Movement / overlap / overflow below this many CSS px is ignored by geometry rules. */
  geometryToleranceCssPx: number
  maxRegions: number
  maxElementsPerRegion: number
  /** Bound for every other list in the evidence (displacements, unmatched refs, risks). */
  maxListedItems: number
  png: PngLimits
  geometry: GeometryLimits
}

export const DEFAULT_VISUAL_DIFF_PARAMETERS: Readonly<VisualDiffParameters> = Object.freeze({
  threshold: 0.03,
  includeAA: false,
  mergeDistanceCssPx: 8,
  targetMarginCssPx: 2,
  geometryToleranceCssPx: 1,
  maxRegions: 100,
  maxElementsPerRegion: 5,
  maxListedItems: 100,
  png: DEFAULT_PNG_LIMITS,
  geometry: DEFAULT_GEOMETRY_LIMITS,
})

export type ScreenshotInput = Uint8Array | null | undefined | { unreadable: 'not-regular-file' | 'too-large' | 'read-failed'; detail: string }

export interface VisualCaptureInput {
  /** Producer-declared capture metadata (VisualCaptureDescriptor shape); validated here. */
  descriptor: unknown
  /** Screenshot bytes; null/undefined when no screenshot exists. */
  screenshot?: ScreenshotInput
  /** Optional DOM geometry sample (ripple-dom-geometry/v1) taken with this screenshot. */
  geometry?: unknown
}

export interface VisualComparisonRequest {
  /** VerificationCheck id this comparison belongs to, if any. */
  checkId?: string | null
  /** The candidate identity the producer of these captures claims (VisualComparisonSubject shape). */
  subject: unknown
  /** The candidate the caller wants evidence for; omit only when no candidate exists yet. */
  expected?: ExpectedCandidateIdentity | null
  baseline: VisualCaptureInput
  candidate: VisualCaptureInput
  /** data-ripple-source refs of the edited targets (the executor's target bindings). */
  targets?: { sourceRefs: string[] } | null
  parameters?: Partial<Omit<VisualDiffParameters, 'png' | 'geometry'>> & { png?: Partial<PngLimits>; geometry?: Partial<GeometryLimits> }
  analyzedAt?: string
  /** Evidence-relative path the caller will write the diff PNG to. */
  diffArtifactPath?: string | null
}

export interface ScreenshotRecord {
  status: 'present' | 'missing' | 'invalid'
  sha256: string | null
  declaredSha256: string | null
  hashMatchesDeclared: boolean | null
  pixelSha256: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  bitDepth: number | null
  colorType: number | null
  opaque: boolean | null
  failure: { code: string; detail: string } | null
}

export interface CaptureRecord {
  descriptor: VisualCaptureDescriptor
  descriptorIssues: DescriptorIssue[]
  screenshot: ScreenshotRecord
}

export type RegionClassification = 'target' | 'non-target' | 'mixed' | 'unattributed'

export interface RegionElement {
  side: VisualSide
  sourceRef: string | null
  runtimeInstanceId: string | null
  identityCertainty: IdentityCertainty | null
  role: 'target' | 'non-target'
  /** The element's box on the screenshot (device px, half-open). */
  screenshotRect: PixelRect
  /** Device-pixel area of the region box covered by the element box. */
  overlapPixels: number
}

export interface VisualRegion {
  id: string
  /** Screenshot device pixels, half-open. */
  bbox: PixelRect
  /** Same box in screenshot CSS px (bbox / DPR). */
  cssBox: CssRect
  changedPixels: number
  /** Changed pixels inside the target mask; null when the target is not mapped. */
  insideTargetPixels: number | null
  classification: RegionClassification
  /** mapped: some element box intersects it; unmapped: none does; unknown: no usable geometry. */
  attribution: 'mapped' | 'unmapped' | 'unknown'
  elements: RegionElement[]
}

export interface VisualObservation {
  outcome: 'changed' | 'unchanged'
  image: { width: number; height: number }
  totalPixels: number
  changedPixels: number
  changedRatio: number
  antialiasedPixels: number
  changedBounds: PixelRect | null
  regionCount: number
  regionsTruncated: boolean
  regions: VisualRegion[]
  diffImage: {
    artifactPath: string | null
    sha256: string
    pixelSha256: string
    sizeBytes: number
    width: number
    height: number
    legend: { background: string; changed: Rgb; antialiased: Rgb; outlines: Record<RegionClassification, Rgb> }
  } | null
}

export interface SideGeometryReport {
  status: 'accepted' | 'missing' | 'rejected'
  detail: string | null
  elementCount: number
  screenshotBound: boolean
}

export interface GeometryReport {
  status: 'mapped' | 'partial' | 'unavailable' | 'rejected' | 'not-evaluated'
  baseline: SideGeometryReport
  candidate: SideGeometryReport
  target: {
    status: 'not-declared' | 'mapped' | 'partial' | 'unmatched' | 'unavailable'
    declaredRefs: string[]
    mappedRefs: { baseline: string[]; candidate: string[] }
    missingRefs: string[]
  }
  changedPixelsInsideTarget: number | null
  changedPixelsOutsideTarget: number | null
  matching: {
    matched: number
    stableMatched: number
    baselineOnly: ElementIdentityKey[]
    candidateOnly: ElementIdentityKey[]
    ambiguous: ElementIdentityKey[]
    unidentified: { baseline: number; candidate: number }
    truncated: boolean
  } | null
  documentSize: { baseline: { width: number; height: number } | null; candidate: { width: number; height: number } | null }
  displacements: ElementDisplacement[]
  displacementsTruncated: boolean
  risks: GeometryRiskFinding[]
  risksTruncated: boolean
}

export type VisualFindingCode =
  | 'no-visual-change' | 'change-inside-target' | 'change-outside-target' | 'target-visually-unchanged'
  | 'change-unattributed' | 'change-without-dom-geometry' | 'document-size-changed' | 'geometry-risk'

export interface VisualFinding {
  code: VisualFindingCode
  /** info: recorded fact; review: needs a human or a formal assertion to interpret; risk: an explicit geometry rule fired. */
  severity: 'info' | 'review' | 'risk'
  detail: string
  regionIds?: string[]
  changedPixels?: number
  rule?: GeometryRiskFinding['rule']
}

export interface VisualDifferenceEvidence {
  schema: typeof VISUAL_EVIDENCE_SCHEMA
  id: string
  checkId: string | null
  analyzedAt: string
  result: VisualEvidenceResult
  resultReason: string
  subject: VisualComparisonSubject
  identity: IdentityAssessment
  inputs: { baseline: CaptureRecord; candidate: CaptureRecord }
  comparability: { comparable: boolean; reasons: Finding<ComparabilityCode | 'screenshot-missing' | 'screenshot-invalid' | 'screenshot-hash-mismatch' | 'identity-stale' | 'analysis-resource-limit'>[]; limitations: Finding<LimitationCode>[] }
  observation: VisualObservation | null
  geometry: GeometryReport
  findings: VisualFinding[]
  coverage: {
    route: string | null
    viewport: { width: number; height: number } | null
    devicePixelRatio: number | null
    interactionState: string | null
    captureExtent: 'full-page' | 'viewport' | 'unknown'
    compared: boolean
    notChecked: string[]
  }
  parameters: {
    algorithm: { name: 'pixelmatch'; version: string; colorMetric: 'OKLab HyAB' }
    decoder: { name: 'pngjs'; version: string }
    threshold: number
    includeAA: boolean
    mergeDistanceCssPx: number
    mergeDistancePx: number | null
    targetMarginCssPx: number
    targetMarginPx: number | null
    geometryToleranceCssPx: number
    maxRegions: number
    maxElementsPerRegion: number
    maxListedItems: number
    png: PngLimits
    geometry: GeometryLimits
    geometryRules: Readonly<Record<string, string>>
  }
  environment: { runtime: 'node'; nodeVersion: string; platform: string; arch: string; zlib: string | null }
}

export interface VisualComparisonOutcome {
  evidence: VisualDifferenceEvidence
  /** Encoded diff PNG when one was rendered; write it to `diffArtifactPath`. */
  diffPng: Uint8Array | null
}

const OUTLINE_COLORS: Record<RegionClassification, Rgb> = {
  target: [37, 99, 235],
  'non-target': [234, 88, 12],
  mixed: [147, 51, 234],
  unattributed: [17, 24, 39],
}

const requireFromHere = createRequire(import.meta.url)
function packageVersion(name: string): string {
  try { return String((requireFromHere(`${name}/package.json`) as { version?: unknown }).version ?? 'unknown') } catch { return 'unknown' }
}
const LIBRARY_VERSIONS = { pixelmatch: packageVersion('pixelmatch'), pngjs: packageVersion('pngjs') }

/** Reject paths that can escape an evidence root or be interpreted differently on Windows. */
export function validateDiffArtifactPath(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\:\x00-\x1f\x7f]/.test(value) ||
      value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..') ||
      /^[a-zA-Z]:/.test(value)) throw new RangeError('diffArtifactPath must be a safe, nonempty evidence-relative POSIX path')
  return value
}

/** Descriptor normalisation that cannot throw: an unreadable descriptor is treated as entirely unobserved. */
function safeDescriptor(value: unknown, side: VisualSide): ReturnType<typeof normalizeVisualCaptureDescriptor> {
  try { return normalizeVisualCaptureDescriptor(value, side) }
  catch {
    const empty = normalizeVisualCaptureDescriptor({}, side)
    return { ...empty, issues: [{ field: `${side}.descriptor`, problem: 'invalid' }, ...empty.issues] }
  }
}

function normalizeExpected(value: unknown): ExpectedCandidateIdentity | null {
  if (value === null || value === undefined) return null
  const source = value as Record<string, unknown>
  const text = (field: string) => {
    const item = source[field]
    if (typeof item !== 'string' || !item || item.length > 512) throw new RangeError(`expected.${field} must be a non-empty string`)
    return item
  }
  if (!Number.isInteger(source.scopeVersion)) throw new RangeError('expected.scopeVersion must be an integer')
  return {
    candidateId: text('candidateId'), patchHash: text('patchHash'), baseSourceDigest: text('baseSourceDigest'), candidateTreeDigest: text('candidateTreeDigest'),
    runtimeFingerprint: text('runtimeFingerprint'), scopeDecisionId: text('scopeDecisionId'), scopeVersion: source.scopeVersion as number,
  }
}

/** Digest of a geometry input as validated (never of the raw value, which may be huge, cyclic or contain BigInt). */
function geometryDigest(raw: unknown, side: VisualSide, limits: GeometryLimits): string | null {
  if (raw === undefined || raw === null) return null
  try {
    const parsed = parseDomGeometrySample(raw, side, limits)
    return sha256Hex(parsed.ok ? JSON.stringify(parsed.sample) : `rejected:${parsed.detail}`)
  } catch (error) {
    return sha256Hex(`unreadable:${String((error as Error)?.message ?? error).slice(0, 200)}`)
  }
}

function resolveParameters(input: VisualComparisonRequest['parameters']): VisualDiffParameters {
  const merged: VisualDiffParameters = {
    ...DEFAULT_VISUAL_DIFF_PARAMETERS, ...input,
    png: { ...DEFAULT_PNG_LIMITS, ...input?.png },
    geometry: { ...DEFAULT_GEOMETRY_LIMITS, ...input?.geometry },
  }
  const checks: Array<[boolean, string]> = [
    [Number.isFinite(merged.threshold) && merged.threshold >= 0 && merged.threshold <= 1, 'threshold must be within 0..1'],
    [typeof merged.includeAA === 'boolean', 'includeAA must be boolean'],
    [Number.isFinite(merged.mergeDistanceCssPx) && merged.mergeDistanceCssPx >= 1 && merged.mergeDistanceCssPx <= 64, 'mergeDistanceCssPx must be within 1..64'],
    [Number.isFinite(merged.targetMarginCssPx) && merged.targetMarginCssPx >= 0 && merged.targetMarginCssPx <= 64, 'targetMarginCssPx must be within 0..64'],
    [Number.isFinite(merged.geometryToleranceCssPx) && merged.geometryToleranceCssPx >= 0 && merged.geometryToleranceCssPx <= 64, 'geometryToleranceCssPx must be within 0..64'],
    [Number.isInteger(merged.maxRegions) && merged.maxRegions >= 1 && merged.maxRegions <= 10_000, 'maxRegions must be within 1..10000'],
    [Number.isInteger(merged.maxElementsPerRegion) && merged.maxElementsPerRegion >= 0 && merged.maxElementsPerRegion <= 100, 'maxElementsPerRegion must be within 0..100'],
    [Number.isInteger(merged.maxListedItems) && merged.maxListedItems >= 1 && merged.maxListedItems <= 10_000, 'maxListedItems must be within 1..10000'],
    // Caller-supplied limits may only tighten the built-in safety bounds.
    [Object.entries(merged.png).every(([key, value]) => Number.isInteger(value) && value > 0 && value <= DEFAULT_PNG_LIMITS[key as keyof PngLimits]), 'PNG limits may only be tightened'],
    [Number.isInteger(merged.geometry.maxElements) && merged.geometry.maxElements > 0 && merged.geometry.maxElements <= DEFAULT_GEOMETRY_LIMITS.maxElements, 'geometry limits may only be tightened'],
  ]
  const failed = checks.find(([ok]) => !ok)
  if (failed) throw new RangeError(`Invalid visual diff parameter: ${failed[1]}`)
  return merged
}

function screenshotRecord(descriptor: VisualCaptureDescriptor, input: ScreenshotInput, limits: PngLimits, mergeDistanceCssPx: number): { record: ScreenshotRecord; png: DecodedPng | null } {
  const declaredSha256 = descriptor.screenshot.declaredSha256
  const empty = { sha256: null, declaredSha256, hashMatchesDeclared: null, pixelSha256: null, sizeBytes: null, width: null, height: null, bitDepth: null, colorType: null, opaque: null }
  if (input === null || input === undefined) return { record: { status: 'missing', ...empty, failure: null }, png: null }
  // isView rather than instanceof: byte arrays can come from another realm (jsdom, vm, worker).
  if (!ArrayBuffer.isView(input) || input.BYTES_PER_ELEMENT !== 1) {
    const unreadable = input as { unreadable?: unknown; detail?: unknown }
    const code = typeof unreadable.unreadable === 'string' && ['not-regular-file', 'too-large', 'read-failed'].includes(unreadable.unreadable) ? unreadable.unreadable : 'input-invalid'
    return { record: { status: 'invalid', ...empty, failure: { code: `screenshot-${code}`, detail: typeof unreadable.detail === 'string' ? unreadable.detail.slice(0, 300) : 'Screenshot input is not a byte array.' } }, png: null }
  }
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  // Inspect both dimensions and merge-grid size before allocating decoded RGBA.
  // This is an analysis budget, separate from the PNG intake safety ceiling.
  const header = inspectPng(bytes, limits)
  if (header.ok) {
    try {
      const mergeDistancePx = Math.ceil(mergeDistanceCssPx * (descriptor.devicePixelRatio ?? 1))
      // Individually permitted CSS distance and DPR may exceed the downstream
      // 256-device-pixel grid limit when combined. Treat this as a bounded
      // analysis failure, not an uncaught RangeError from diffPixels().
      if (mergeDistancePx > 256) {
        throw new VisualResourceLimitError(
          `mergeDistanceCssPx × devicePixelRatio produces ${mergeDistancePx} device pixels (maximum 256).`,
        )
      }
      assertVisualWorkBudget(header.header.width, header.header.height, mergeDistancePx)
    } catch (error) {
      if (!(error instanceof VisualResourceLimitError)) throw error
      const sha256 = bytes.length <= limits.maxFileBytes ? sha256Hex(bytes) : null
      return { record: { status: 'invalid', ...empty, sha256, sizeBytes: bytes.length,
        hashMatchesDeclared: declaredSha256 && sha256 ? declaredSha256 === sha256 : null,
        failure: { code: 'visual-analysis-resource-limit', detail: error.message } }, png: null }
    }
  }
  const read = readPng(bytes, limits)

  if (!read.ok) {
    return {
      record: { status: 'invalid', ...empty, sha256: read.sha256, sizeBytes: read.sizeBytes, hashMatchesDeclared: declaredSha256 && read.sha256 ? declaredSha256 === read.sha256 : null, failure: { code: read.code, detail: read.detail } },
      png: null,
    }
  }
  const png = read.png
  return {
    record: {
      status: 'present', sha256: png.sha256, declaredSha256, hashMatchesDeclared: declaredSha256 ? declaredSha256 === png.sha256 : null,
      pixelSha256: png.pixelSha256, sizeBytes: png.sizeBytes, width: png.width, height: png.height,
      bitDepth: png.header.bitDepth, colorType: png.header.colorType, opaque: png.opaque, failure: null,
    },
    png,
  }
}

interface AcceptedGeometry { sample: DomGeometrySample; mapping: ScreenshotMapping; screenshotBound: boolean }

function sideGeometry(raw: unknown, side: VisualSide, descriptor: VisualCaptureDescriptor, png: DecodedPng, limits: GeometryLimits): { report: SideGeometryReport; accepted: AcceptedGeometry | null } {
  if (raw === undefined || raw === null) return { report: { status: 'missing', detail: null, elementCount: 0, screenshotBound: false }, accepted: null }
  let parsed: ReturnType<typeof parseDomGeometrySample>
  try { parsed = parseDomGeometrySample(raw, side, limits) } catch (error) { parsed = { ok: false, detail: `Geometry sample could not be read: ${String((error as Error)?.message ?? error).slice(0, 200)}` } }
  if (!parsed.ok) return { report: { status: 'rejected', detail: parsed.detail, elementCount: 0, screenshotBound: false }, accepted: null }
  const bound = bindGeometryToCapture(parsed.sample, descriptor, png)
  if (!bound.ok) return { report: { status: 'rejected', detail: bound.detail, elementCount: parsed.sample.elements.length, screenshotBound: false }, accepted: null }
  return {
    report: { status: 'accepted', detail: bound.screenshotBound ? null : 'Sample does not record the screenshot SHA-256; it is bound by route, viewport, DPR and state only.', elementCount: parsed.sample.elements.length, screenshotBound: bound.screenshotBound },
    accepted: { sample: parsed.sample, mapping: bound.mapping, screenshotBound: bound.screenshotBound },
  }
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6
const cap = <T>(items: T[], limit: number) => ({ items: items.slice(0, limit), truncated: items.length > limit })

function emptyGeometry(status: GeometryReport['status'], declaredRefs: string[]): GeometryReport {
  const side: SideGeometryReport = { status: 'missing', detail: null, elementCount: 0, screenshotBound: false }
  return {
    status, baseline: side, candidate: { ...side },
    target: { status: declaredRefs.length ? 'unavailable' : 'not-declared', declaredRefs, mappedRefs: { baseline: [], candidate: [] }, missingRefs: declaredRefs.length ? [...declaredRefs] : [] },
    changedPixelsInsideTarget: null, changedPixelsOutsideTarget: null, matching: null,
    documentSize: { baseline: null, candidate: null }, displacements: [], displacementsTruncated: false, risks: [], risksTruncated: false,
  }
}

/** Compares two screenshots and produces bounded, hash-bound visual-difference evidence. */
export function analyzeVisualDifference(request: VisualComparisonRequest): VisualComparisonOutcome {
  const parameters = resolveParameters(request.parameters)
  const diffArtifactPath = validateDiffArtifactPath(request.diffArtifactPath)
  const analyzedAt = request.analyzedAt ?? new Date().toISOString()
  const subject = normalizeVisualSubject(request.subject)
  const expected = normalizeExpected(request.expected)
  const b = safeDescriptor(request.baseline?.descriptor, 'baseline')
  const c = safeDescriptor(request.candidate?.descriptor, 'candidate')
  const bShot = screenshotRecord(b.descriptor, request.baseline?.screenshot, parameters.png, parameters.mergeDistanceCssPx)
  const cShot = screenshotRecord(c.descriptor, request.candidate?.screenshot, parameters.png, parameters.mergeDistanceCssPx)
  const rawRefs: unknown = request.targets?.sourceRefs
  const declaredRefs = [...new Set((Array.isArray(rawRefs) ? rawRefs : []).filter((ref): ref is string => typeof ref === 'string' && ref.length > 0 && ref.length <= 512))].sort().slice(0, parameters.maxListedItems)
  const identity = assessIdentity(subject, expected, b.descriptor, c.descriptor)
  const comparability = assessComparability(b.descriptor, c.descriptor, { baseline: b.declaredSide, candidate: c.declaredSide },
    { baseline: bShot.png ? { width: bShot.png.width, height: bShot.png.height } : null, candidate: cShot.png ? { width: cShot.png.width, height: cShot.png.height } : null })
  const reasons: VisualDifferenceEvidence['comparability']['reasons'] = [...comparability.reasons]
  const limitations = [...comparability.limitations]

  const shots = [bShot, cShot]
  const missing = shots.filter(shot => shot.record.status === 'missing')
  const invalid = shots.filter(shot => shot.record.status === 'invalid')
  const hashMismatch = shots.filter(shot => shot.record.hashMatchesDeclared === false)
  for (const [side, shot] of [['candidate', cShot], ['baseline', bShot]] as const) {
    const at = (value: unknown) => side === 'baseline' ? { baseline: value } : { candidate: value }
    if (shot.record.status === 'missing') reasons.unshift({ code: 'screenshot-missing', detail: `No ${side} screenshot was supplied.` })
    if (shot.record.status === 'invalid') reasons.unshift({ code: 'screenshot-invalid', detail: `The ${side} screenshot was rejected: ${shot.record.failure?.detail}`, ...at(shot.record.failure?.code) })
    if (shot.record.hashMatchesDeclared === false) reasons.unshift({ code: 'screenshot-hash-mismatch', detail: `The ${side} screenshot bytes do not match the SHA-256 its producer recorded.`, ...at({ declared: shot.record.declaredSha256, actual: shot.record.sha256 }) })
  }
  if (identity.status === 'stale') {
    reasons.unshift({ code: 'identity-stale', detail: 'The captures or their claimed subject belong to a different candidate, source digest or runtime than expected.', candidate: identity.checks.filter(item => item.status === 'mismatch').map(item => item.field) })
  } else if (identity.status === 'unverified') {
    limitations.push({ code: 'candidate-identity-unverified', detail: identity.expectedProvided ? 'At least one candidate/source/runtime binding was not recorded, so the evidence cannot be fully tied to the expected candidate.' : 'No expected candidate identity was supplied; the evidence is not bound to a current candidate.' })
  }
  let comparable = reasons.length === 0 && !!bShot.png && !!cShot.png
  let analysisResourceFailure = false

  let observation: VisualObservation | null = null
  let geometry = emptyGeometry(comparable ? 'unavailable' : 'not-evaluated', declaredRefs)
  const findings: VisualFinding[] = []
  let diffPng: Uint8Array | null = null
  let mergeDistancePx: number | null = null
  let targetMarginPx: number | null = null

  if (comparable) {
    try {
    const baselinePng = bShot.png!, candidatePng = cShot.png!
    const dpr = c.descriptor.devicePixelRatio!
    mergeDistancePx = Math.max(1, Math.ceil(parameters.mergeDistanceCssPx * dpr))
    targetMarginPx = Math.ceil(parameters.targetMarginCssPx * dpr)
    const diff = diffPixels(baselinePng.data, candidatePng.data, candidatePng.width, candidatePng.height, { threshold: parameters.threshold, includeAA: parameters.includeAA, mergeDistancePx })
    const reportedIndexes = selectReportedRegions(diff, parameters.maxRegions)
    const analysed = analyseGeometry(request, b.descriptor, c.descriptor, baselinePng, candidatePng, diff, reportedIndexes, declaredRefs, parameters, targetMarginPx)
    geometry = analysed.report
    if (geometry.status === 'unavailable') limitations.push({ code: 'geometry-unavailable', detail: 'No DOM geometry sample was supplied; changed regions cannot be related to elements or targets.' })
    if (!baselinePng.opaque || !candidatePng.opaque) limitations.push({ code: 'transparent-pixels', detail: 'A screenshot has non-opaque pixels; pixelmatch compares them blended over a checkerboard.', baseline: baselinePng.opaque, candidate: candidatePng.opaque })
    if (geometry.status === 'partial') limitations.push({ code: 'geometry-partial', detail: 'Only one side has usable DOM geometry: target classification and attribution use that side alone, and cross-version rules (overlap, overflow, displacement) are not evaluated.', baseline: geometry.baseline.status, candidate: geometry.candidate.status })
    if ((geometry.baseline.status === 'accepted' && !geometry.baseline.screenshotBound) || (geometry.candidate.status === 'accepted' && !geometry.candidate.screenshotBound)) {
      limitations.push({ code: 'geometry-screenshot-unbound', detail: 'A DOM geometry sample does not record its screenshot SHA-256; it is bound by route, viewport, DPR and state only.' })
    }
    if (geometry.baseline.status === 'rejected' || geometry.candidate.status === 'rejected') {
      limitations.push({ code: 'geometry-rejected', detail: 'A DOM geometry sample was rejected and not used.', baseline: geometry.baseline.detail, candidate: geometry.candidate.detail })
    }
    if (geometry.target.status === 'not-declared') limitations.push({ code: 'target-not-declared', detail: 'No edited target refs were supplied; changes cannot be classified as target or non-target.' })
    else if (geometry.target.status !== 'mapped') limitations.push({ code: 'target-not-mapped', detail: 'Not every declared target ref was found in usable DOM geometry on every sampled side; target/non-target classification is withheld.', candidate: geometry.target.missingRefs })

    const reported = { items: analysed.regions, truncated: diff.regions.length > analysed.regions.length }
    let changedBounds: PixelRect | null = null
    if (diff.regions.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const { bbox } of diff.regions) {
        x0 = Math.min(x0, bbox.x); y0 = Math.min(y0, bbox.y)
        x1 = Math.max(x1, bbox.x + bbox.width); y1 = Math.max(y1, bbox.y + bbox.height)
      }
      changedBounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    }
    let diffImage: VisualObservation['diffImage'] = null
    if (diff.changedPixels > 0 || diff.antialiasedPixels > 0) {
      const rgba = renderDiffImage(candidatePng.data, diff.mask, diff.width, diff.height, reported.items.map(region => ({ rect: region.bbox, color: OUTLINE_COLORS[region.classification] })))
      diffPng = encodePng(diff.width, diff.height, rgba)
      diffImage = {
        artifactPath: diffArtifactPath, sha256: sha256Hex(diffPng), pixelSha256: pixelDigest(diff.width, diff.height, rgba), sizeBytes: diffPng.length,
        width: diff.width, height: diff.height, legend: { background: DIFF_IMAGE_LEGEND.background, changed: DIFF_IMAGE_LEGEND.changed, antialiased: DIFF_IMAGE_LEGEND.antialiased, outlines: OUTLINE_COLORS },
      }
    }
    observation = {
      outcome: diff.changedPixels > 0 ? 'changed' : 'unchanged',
      image: { width: diff.width, height: diff.height },
      totalPixels: diff.totalPixels, changedPixels: diff.changedPixels, changedRatio: round6(diff.changedPixels / diff.totalPixels), antialiasedPixels: diff.antialiasedPixels,
      changedBounds, regionCount: diff.regions.length, regionsTruncated: reported.truncated, regions: reported.items, diffImage,
    }
    findings.push(...observationFindings(observation, geometry))
    } catch (error) {
      if (!(error instanceof VisualResourceLimitError)) throw error
      analysisResourceFailure = true
      comparable = false
      observation = null
      diffPng = null
      geometry = emptyGeometry('not-evaluated', declaredRefs)
      findings.length = 0
      reasons.unshift({ code: 'analysis-resource-limit', detail: error.message })
    }
  }

  const risks = geometry.risks
  const riskProvenanceComplete = shots.every(shot => shot.record.declaredSha256 !== null && shot.record.hashMatchesDeclared === true) &&
    geometry.baseline.status === 'accepted' && geometry.candidate.status === 'accepted' &&
    geometry.baseline.screenshotBound && geometry.candidate.screenshotBound &&
    [b.descriptor, c.descriptor].every(descriptor =>
      descriptor.capture.completed === true && descriptor.capture.stable === true &&
      descriptor.capture.animationsDisabled === true && descriptor.capture.fontsReady === true)
  if (risks.length && !riskProvenanceComplete) limitations.push({ code: 'risk-provenance-incomplete', detail: 'Explicit geometry findings are advisory only: both producer screenshot hashes, both screenshot-bound DOM samples, and completed, stable captures with settled animations and fonts are required before a trusted risk result.' })
  let result: VisualEvidenceResult
  let resultReason: string
  if (identity.status === 'stale') {
    result = 'stale'
    resultReason = 'Inputs are bound to a different candidate, source digest or runtime than expected; no comparison was made.'
  } else if (invalid.length || hashMismatch.length || analysisResourceFailure) {
    result = 'failed-to-run'
    const overLimit = analysisResourceFailure || (invalid.length > 0 && !hashMismatch.length && invalid.every(shot => ['png-dimensions-out-of-bounds', 'png-file-too-large', 'screenshot-too-large', 'visual-analysis-resource-limit'].includes(shot.record.failure?.code ?? '')))
    resultReason = analysisResourceFailure
      ? 'The visual comparison exceeded its bounded region-analysis resource budget; no partial or trusted conclusion was produced.'
      : overLimit
      ? 'An input exceeds the analysis size limits or the bounded visual analysis resource budget (it is not necessarily corrupt); no comparison was made.'
      : 'A screenshot is corrupt, unreadable, over the analysis limits or differs from its recorded hash; no comparison was made.'
  } else if (missing.length) {
    result = 'not-run'
    resultReason = `${missing.length === 2 ? 'Both screenshots are' : 'A screenshot is'} missing; no comparison was made.`
  } else if (!comparable) {
    result = 'unknown'
    resultReason = `The screenshots are not comparable (${[...new Set(reasons.map(reason => reason.code))].join(', ')}); no visual conclusion is drawn.`
  } else if (risks.length && identity.status === 'consistent' && riskProvenanceComplete) {
    result = 'risk'
    resultReason = `${risks.length} explicit geometry rule finding(s): ${[...new Set(risks.map(risk => risk.rule))].join(', ')}.`
  } else {
    result = 'unknown'
    resultReason = risks.length
      ? 'Geometry rules fired, but candidate identity, screenshot provenance, geometry bindings or capture stability are incomplete; findings are advisory and the result remains unknown.'
      : `Compared: ${observation!.outcome}. Visual difference alone neither proves nor disproves the requested change; intent, Scope and non-target preservation are decided by the browser assertions.`
  }

  const extent = c.descriptor.capture.fullPage === null || b.descriptor.capture.fullPage === null ? 'unknown' : c.descriptor.capture.fullPage && b.descriptor.capture.fullPage ? 'full-page' : 'viewport'
  const notChecked: string[] = []
  if (!comparable) notChecked.push('entire-capture')
  else {
    if (extent === 'viewport') notChecked.push('content-outside-captured-viewport')
    if (extent === 'unknown') notChecked.push('unknown-capture-extent')
  }

  const inputs = {
    baseline: { descriptor: b.descriptor, descriptorIssues: b.issues, screenshot: bShot.record },
    candidate: { descriptor: c.descriptor, descriptorIssues: c.issues, screenshot: cShot.record },
  }
  const parameterRecord: VisualDifferenceEvidence['parameters'] = {
    algorithm: { name: 'pixelmatch', version: LIBRARY_VERSIONS.pixelmatch, colorMetric: 'OKLab HyAB' },
    decoder: { name: 'pngjs', version: LIBRARY_VERSIONS.pngjs },
    threshold: parameters.threshold, includeAA: parameters.includeAA,
    mergeDistanceCssPx: parameters.mergeDistanceCssPx, mergeDistancePx,
    targetMarginCssPx: parameters.targetMarginCssPx, targetMarginPx,
    geometryToleranceCssPx: parameters.geometryToleranceCssPx,
    maxRegions: parameters.maxRegions, maxElementsPerRegion: parameters.maxElementsPerRegion, maxListedItems: parameters.maxListedItems,
    png: { ...parameters.png }, geometry: { ...parameters.geometry }, geometryRules: GEOMETRY_RULES,
  }
  const id = `visual-${sha256Hex(JSON.stringify({
    checkId: request.checkId ?? null, subject, expected,
    baseline: { descriptor: b.descriptor, sha256: bShot.record.sha256 }, candidate: { descriptor: c.descriptor, sha256: cShot.record.sha256 },
    geometry: [geometryDigest(request.baseline?.geometry, 'baseline', parameters.geometry), geometryDigest(request.candidate?.geometry, 'candidate', parameters.geometry)],
    targets: declaredRefs, parameters: parameterRecord,
  })).slice(0, 32)}`

  const evidence: VisualDifferenceEvidence = {
    schema: VISUAL_EVIDENCE_SCHEMA, id, checkId: request.checkId ?? null, analyzedAt, result, resultReason,
    subject, identity, inputs,
    comparability: { comparable, reasons, limitations },
    observation, geometry, findings,
    coverage: {
      route: c.descriptor.route, viewport: c.descriptor.viewport, devicePixelRatio: c.descriptor.devicePixelRatio, interactionState: c.descriptor.interactionState,
      captureExtent: extent, compared: comparable, notChecked,
    },
    parameters: parameterRecord,
    environment: { runtime: 'node', nodeVersion: process.version, platform: process.platform, arch: process.arch, zlib: process.versions.zlib ?? null },
  }
  return { evidence, diffPng }
}

/** The `limit` largest regions (ties: earlier position first), returned in position order. */
function selectReportedRegions(diff: PixelDiff, limit: number): number[] {
  return diff.regions.map(region => region.index)
    .sort((a, b) => diff.regions[b].changedPixels - diff.regions[a].changedPixels || a - b)
    .slice(0, limit)
    .sort((a, b) => a - b)
}

function analyseGeometry(
  request: VisualComparisonRequest, bDesc: VisualCaptureDescriptor, cDesc: VisualCaptureDescriptor, bPng: DecodedPng, cPng: DecodedPng,
  diff: PixelDiff, reportedIndexes: number[], declaredRefs: string[], parameters: VisualDiffParameters, targetMarginPx: number,
): { report: GeometryReport; regions: VisualRegion[] } {
  const bGeo = sideGeometry(request.baseline?.geometry, 'baseline', bDesc, bPng, parameters.geometry)
  const cGeo = sideGeometry(request.candidate?.geometry, 'candidate', cDesc, cPng, parameters.geometry)
  const accepted = [bGeo.accepted, cGeo.accepted].filter((item): item is AcceptedGeometry => !!item)
  const anyProvided = bGeo.report.status !== 'missing' || cGeo.report.status !== 'missing'
  const status: GeometryReport['status'] = accepted.length === 2 ? 'mapped' : accepted.length === 1 ? 'partial' : anyProvided ? 'rejected' : 'unavailable'
  const report = emptyGeometry(status, declaredRefs)
  report.baseline = bGeo.report
  report.candidate = cGeo.report
  report.documentSize = { baseline: bGeo.accepted?.sample.documentSize ?? null, candidate: cGeo.accepted?.sample.documentSize ?? null }
  const dpr = cDesc.devicePixelRatio!
  const { width, height } = diff

  // Element boxes on the screenshot, per accepted side.
  const targetSet = new Set(declaredRefs)
  const boxes: Array<{ side: VisualSide; rect: PixelRect; area: number; sourceRef: string | null; runtimeInstanceId: string | null; identityCertainty: IdentityCertainty | null; target: boolean }> = []
  const mapped: Record<VisualSide, Set<string>> = { baseline: new Set(), candidate: new Set() }
  for (const side of accepted) {
    for (const element of side.sample.elements) {
      if (element.visible === false) continue
      const rect = toScreenshotRect(element.rect, side.mapping)
      if (!rect) continue
      const target = element.sourceRef !== null && targetSet.has(element.sourceRef)
      if (target) mapped[side.sample.side].add(element.sourceRef!)
      boxes.push({ side: side.sample.side, rect, area: rect.width * rect.height, sourceRef: element.sourceRef, runtimeInstanceId: element.runtimeInstanceId, identityCertainty: element.identityCertainty, target })
    }
  }
  if (accepted.length && declaredRefs.length) {
    report.target.mappedRefs = { baseline: [...mapped.baseline].sort(), candidate: [...mapped.candidate].sort() }
    report.target.missingRefs = declaredRefs.filter(ref => accepted.some(side => !mapped[side.sample.side].has(ref)))
    const foundAnywhere = declaredRefs.filter(ref => mapped.baseline.has(ref) || mapped.candidate.has(ref))
    report.target.status = report.target.missingRefs.length === 0 ? 'mapped' : foundAnywhere.length ? 'partial' : 'unmatched'
  }

  // Target mask: union of target boxes from every accepted side (1), plus a
  // margin ring (2) for glyph overhang and edge anti-aliasing. The ring is
  // withdrawn wherever a sampled non-target element that is neither an ancestor
  // nor a descendant of a target lies, so the margin never absorbs a change to
  // an adjacent sibling.
  let targetMask: Uint8Array | null = null
  if (report.target.status === 'mapped') {
    const mask = new Uint8Array(width * height)
    targetMask = mask
    const paint = (rect: PixelRect, value: number, onlyWhere?: number) => {
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        const row = y * width
        for (let x = rect.x; x < rect.x + rect.width; x++) if (onlyWhere === undefined ? mask[row + x] < value || value === 1 : mask[row + x] === onlyWhere) mask[row + x] = value
      }
    }
    const grown: PixelRect[] = []
    for (const side of accepted) for (const element of side.sample.elements) {
      if (element.visible === false || element.sourceRef === null || !targetSet.has(element.sourceRef)) continue
      const ring = toScreenshotRect(element.rect, side.mapping, targetMarginPx)
      if (ring) { paint(ring, 2); grown.push(ring) }
    }
    for (const side of accepted) for (const element of side.sample.elements) {
      if (element.visible === false || element.sourceRef === null || !targetSet.has(element.sourceRef)) continue
      const core = toScreenshotRect(element.rect, side.mapping)
      if (core) paint(core, 1)
    }
    for (const side of accepted) {
      const parents = new Map(side.sample.elements.map(element => [element.id, element.parentId]))
      const chain = (id: string) => { const ids: string[] = []; for (let cursor = parents.get(id) ?? null; cursor !== null; cursor = parents.get(cursor) ?? null) ids.push(cursor); return ids }
      const targets = side.sample.elements.filter(element => element.sourceRef !== null && targetSet.has(element.sourceRef))
      const targetIds = new Set(targets.map(element => element.id))
      const targetAncestors = new Set(targets.flatMap(element => chain(element.id)))
      for (const element of side.sample.elements) {
        if (element.visible === false || targetIds.has(element.id) || targetAncestors.has(element.id) || chain(element.id).some(id => targetIds.has(id))) continue
        const rect = toScreenshotRect(element.rect, side.mapping)
        if (!rect) continue
        for (const ring of grown) {
          const x0 = Math.max(rect.x, ring.x), y0 = Math.max(rect.y, ring.y)
          const x1 = Math.min(rect.x + rect.width, ring.x + ring.width), y1 = Math.min(rect.y + rect.height, ring.y + ring.height)
          if (x1 > x0 && y1 > y0) paint({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, 0, 2)
        }
      }
    }
  }
  const inside = new Float64Array(diff.regions.length)
  let insideTotal = 0
  if (targetMask) {
    for (let i = 0; i < diff.mask.length; i++) {
      if (diff.mask[i] !== MASK_CHANGED || !targetMask[i]) continue
      insideTotal++
      inside[diff.regionOfPixel(i)]++
    }
    report.changedPixelsInsideTarget = insideTotal
    report.changedPixelsOutsideTarget = diff.changedPixels - insideTotal
  }

  // Element attribution is computed for reported regions only; grid-cell and total-component budgets additionally bound the upstream clustering work.
  const regions: VisualRegion[] = reportedIndexes.map(index => diff.regions[index]).map(region => {
    const overlapping = boxes.map(box => {
      const ix = Math.max(0, Math.min(region.bbox.x + region.bbox.width, box.rect.x + box.rect.width) - Math.max(region.bbox.x, box.rect.x))
      const iy = Math.max(0, Math.min(region.bbox.y + region.bbox.height, box.rect.y + box.rect.height) - Math.max(region.bbox.y, box.rect.y))
      return { box, overlap: ix * iy }
    }).filter(item => item.overlap > 0)
      // Most specific first: smallest element box, then largest overlap, then a stable order.
      .sort((l, r) => l.box.area - r.box.area || r.overlap - l.overlap || (l.box.side < r.box.side ? -1 : l.box.side > r.box.side ? 1 : 0) ||
        String(l.box.sourceRef).localeCompare(String(r.box.sourceRef)) || String(l.box.runtimeInstanceId).localeCompare(String(r.box.runtimeInstanceId)) || l.box.rect.y - r.box.rect.y || l.box.rect.x - r.box.rect.x)
    const insideTargetPixels = targetMask ? inside[region.index] : null
    const classification: RegionClassification = insideTargetPixels === null ? 'unattributed'
      : insideTargetPixels === region.changedPixels ? 'target' : insideTargetPixels === 0 ? 'non-target' : 'mixed'
    return {
      id: `r${region.index + 1}`,
      bbox: region.bbox,
      cssBox: { x: round6(region.bbox.x / dpr), y: round6(region.bbox.y / dpr), width: round6(region.bbox.width / dpr), height: round6(region.bbox.height / dpr) },
      changedPixels: region.changedPixels,
      insideTargetPixels,
      classification,
      attribution: accepted.length === 0 ? 'unknown' : overlapping.length ? 'mapped' : 'unmapped',
      elements: overlapping.slice(0, parameters.maxElementsPerRegion).map(({ box, overlap }) => ({
        side: box.side, sourceRef: box.sourceRef, runtimeInstanceId: box.runtimeInstanceId, identityCertainty: box.identityCertainty, role: box.target ? 'target' : 'non-target', screenshotRect: box.rect, overlapPixels: overlap,
      })),
    }
  })

  if (bGeo.accepted && cGeo.accepted) {
    const matching = matchElements(bGeo.accepted.sample, cGeo.accepted.sample)
    const limit = parameters.maxListedItems
    const baselineOnly = cap(matching.baselineOnly, limit), candidateOnly = cap(matching.candidateOnly, limit), ambiguous = cap(matching.ambiguous, limit)
    report.matching = {
      matched: matching.matched.length, stableMatched: matching.matched.filter(item => item.stable).length,
      baselineOnly: baselineOnly.items, candidateOnly: candidateOnly.items, ambiguous: ambiguous.items, unidentified: matching.unidentified,
      truncated: baselineOnly.truncated || candidateOnly.truncated || ambiguous.truncated,
    }
    const displacements = cap(elementDisplacements(bGeo.accepted.sample, cGeo.accepted.sample, matching, parameters.geometryToleranceCssPx), limit)
    report.displacements = displacements.items
    report.displacementsTruncated = displacements.truncated
    const risks = detectGeometryRisks(bGeo.accepted.sample, cGeo.accepted.sample, matching, parameters.geometryToleranceCssPx, limit)
    report.risks = risks.findings
    report.risksTruncated = risks.truncated
  }
  return { report, regions }
}

function observationFindings(observation: VisualObservation, geometry: GeometryReport): VisualFinding[] {
  // regionIds name reported regions only (observation.regionsTruncated says whether others exist);
  // changedPixels totals for target / non-target cover every changed pixel.
  const regions = observation.regions
  const findings: VisualFinding[] = []
  const ids = (predicate: (region: VisualRegion) => boolean) => regions.filter(predicate).map(region => region.id)
  if (observation.outcome === 'unchanged') {
    findings.push({ code: 'no-visual-change', severity: 'info', detail: `No pixel differs beyond the threshold${observation.antialiasedPixels ? ` (${observation.antialiasedPixels} anti-aliasing pixel(s) excluded)` : ''}.` })
    if (geometry.target.status === 'mapped') findings.push({ code: 'target-visually-unchanged', severity: 'review', detail: 'The declared target area rendered identically in baseline and candidate.' })
  } else if (geometry.target.status === 'mapped') {
    const inside = geometry.changedPixelsInsideTarget ?? 0
    const outside = geometry.changedPixelsOutsideTarget ?? 0
    if (inside > 0) findings.push({ code: 'change-inside-target', severity: 'info', detail: 'Pixels changed inside the declared target area.', regionIds: ids(region => region.classification === 'target' || region.classification === 'mixed'), changedPixels: inside })
    else findings.push({ code: 'target-visually-unchanged', severity: 'review', detail: 'Pixels changed, but none inside the declared target area.' })
    if (outside > 0) findings.push({ code: 'change-outside-target', severity: 'review', detail: 'Pixels changed outside the declared target area. This may be an expected consequence (reflow, shared source) or an unintended change; it is not a proven risk on its own.', regionIds: ids(region => region.classification === 'non-target' || region.classification === 'mixed'), changedPixels: outside })
  } else {
    findings.push({ code: 'change-unattributed', severity: 'review', detail: 'Pixels changed, but the change cannot be related to the declared target (target not declared or not mapped).', regionIds: ids(() => true), changedPixels: observation.changedPixels })
  }
  if (geometry.status === 'mapped' || geometry.status === 'partial') {
    const unmapped = regions.filter(region => region.attribution === 'unmapped')
    if (unmapped.length) findings.push({ code: 'change-without-dom-geometry', severity: 'info', detail: `${unmapped.length} reported changed region(s) intersect no sampled element box.`, regionIds: unmapped.map(region => region.id), changedPixels: unmapped.reduce((sum, region) => sum + region.changedPixels, 0) })
  }
  const { baseline, candidate } = geometry.documentSize
  if (baseline && candidate && (baseline.width !== candidate.width || baseline.height !== candidate.height)) {
    findings.push({ code: 'document-size-changed', severity: 'info', detail: `Document size changed from ${baseline.width}×${baseline.height} to ${candidate.width}×${candidate.height} CSS px.` })
  }
  for (const risk of geometry.risks) findings.push({ code: 'geometry-risk', severity: 'risk', rule: risk.rule, detail: risk.detail })
  return findings
}

// ---------------------------------------------------------------------------
// Serialisation and integration helpers

/** Stable, human-readable JSON with its SHA-256. Field order is fixed by construction. */
export function serializeVisualEvidence(evidence: VisualDifferenceEvidence): { text: string; bytes: Uint8Array; sha256: string } {
  const text = `${JSON.stringify(evidence, null, 2)}\n`
  const bytes = new TextEncoder().encode(text)
  return { text, bytes, sha256: sha256Hex(bytes) }
}

/**
 * Reads a screenshot for comparison without following symbolic links or
 * blocking on FIFOs/devices; returns null when the file does not exist.
 */
export function readScreenshotFile(filePath: string, options: { maxBytes?: number; root?: string } = {}): ScreenshotInput {
  const maxBytes = options.maxBytes ?? DEFAULT_PNG_LIMITS.maxFileBytes
  if (options.root !== undefined) {
    // Confine to the evidence directory, resolving symbolic links in parent directories too.
    let parent: string, root: string
    try { parent = fs.realpathSync(path.dirname(path.resolve(filePath))); root = fs.realpathSync(options.root) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return { unreadable: 'read-failed', detail: 'Screenshot directory could not be resolved.' }
    }
    const relative = path.relative(root, parent)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { unreadable: 'not-regular-file', detail: 'Screenshot path resolves outside the evidence directory.' }
  }
  let fd: number
  try { fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)) }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    if (code === 'ELOOP') return { unreadable: 'not-regular-file', detail: 'Screenshot path is a symbolic link.' }
    return { unreadable: 'read-failed', detail: `Screenshot could not be opened (${code ?? 'error'}).` }
  }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) return { unreadable: 'not-regular-file', detail: 'Screenshot path is not a regular file.' }
    if (stat.size > maxBytes) return { unreadable: 'too-large', detail: `Screenshot is ${stat.size} bytes; the limit is ${maxBytes}.` }
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (read === 0) break
      offset += read
    }
    if (offset !== stat.size) return { unreadable: 'read-failed', detail: 'Screenshot changed size while being read.' }
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } catch (error) {
    return { unreadable: 'read-failed', detail: `Screenshot could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'}).` }
  } finally {
    fs.closeSync(fd)
  }
}

export class VisualEvidenceProjectionError extends Error {
  constructor(message: string) { super(message); this.name = 'VisualEvidenceProjectionError' }
}

/** Whether evidence describes exactly this planned route (incl. query/fragment digest), viewport and state. */
function evidenceMatchesCheck(evidence: VisualDifferenceEvidence, route: string, viewport: { width: number; height: number }, state: string, devicePixelRatio?: number): boolean {
  const planned = sanitizeRoute(route)
  const candidate = evidence.inputs.candidate.descriptor
  return !!planned && evidence.coverage.route === planned.route && candidate.routeSuffixSha256 === planned.suffixSha256 &&
    evidence.coverage.viewport?.width === viewport.width && evidence.coverage.viewport?.height === viewport.height &&
    evidence.coverage.interactionState === state &&
    (devicePixelRatio === undefined || evidence.coverage.devicePixelRatio === devicePixelRatio)
}

/**
 * Projects visual evidence onto the Project-first VerificationEvidence shape
 * for display or a future executor manifest. Refuses evidence recorded for a
 * different check, route, viewport or state. Values that were not observed
 * stay 'unknown' rather than being filled from the plan; the result is the
 * visual result (never 'pass'). This does not attest anything: only the
 * Playwright receipt does.
 */
export function toVerificationEvidence(evidence: VisualDifferenceEvidence, check: Pick<VerificationCheck, 'id' | 'route' | 'viewport' | 'state'>, artifact: { path: string; sha256: string }): VerificationEvidence {
  if (!evidence.checkId || evidence.checkId !== check.id) throw new VisualEvidenceProjectionError(`Visual evidence checkId is missing or differs from the selected check ${check.id}.`)
  if (!evidenceMatchesCheck(evidence, check.route, check.viewport, check.state)) {
    throw new VisualEvidenceProjectionError('Visual evidence route, viewport or interaction state does not match the check (or was not observed).')
  }
  const candidate = evidence.inputs.candidate.descriptor
  const observedRefs = new Set<string>()
  for (const region of evidence.observation?.regions ?? []) for (const element of region.elements) if (element.sourceRef) observedRefs.add(element.sourceRef)
  for (const ref of [...evidence.geometry.target.mappedRefs.baseline, ...evidence.geometry.target.mappedRefs.candidate]) observedRefs.add(ref)
  return {
    id: evidence.id,
    checkId: check.id,
    result: evidence.result,
    capturedAt: candidate.capture.capturedAt ?? 'unknown',
    pageUrl: candidate.pageUrl ?? 'unknown',
    viewport: { width: check.viewport.width, height: check.viewport.height },
    runtimeState: check.state,
    elementRefs: [...observedRefs].sort(),
    artifactPath: artifact.path,
    artifactHash: artifact.sha256,
    reason: evidence.resultReason,
  }
}

const RESULT_PRIORITY: VisualEvidenceResult[] = ['stale', 'failed-to-run', 'risk', 'not-run', 'unknown']

/**
 * Advisory roll-up of several visual evidences. Not one of the required
 * VerificationRun assertions and never 'pass'.
 */
export function summarizeVisualEvidence(evidences: readonly VisualDifferenceEvidence[]): VerificationAssertion {
  if (!evidences.length) return { id: 'visual-difference', result: 'not-run', detail: 'No visual comparison was run.' }
  const result = RESULT_PRIORITY.find(candidate => evidences.some(evidence => evidence.result === candidate)) ?? 'unknown'
  const counts = RESULT_PRIORITY.map(item => [item, evidences.filter(evidence => evidence.result === item).length] as const).filter(([, count]) => count > 0)
  return { id: 'visual-difference', result, detail: `${evidences.length} visual comparison(s): ${counts.map(([item, count]) => `${count} ${item}`).join(', ')}. Visual evidence is advisory and cannot produce PASS.` }
}

export interface VisualCoveragePlanItem {
  checkId?: string
  route: string
  viewport: { width: number; height: number }
  interactionState: string
  /** When given, evidence must have been captured at exactly this DPR. */
  devicePixelRatio?: number
}
export interface VisualCoverageEntry extends VisualCoveragePlanItem {
  status: 'compared' | 'not-comparable' | 'missing'
  /** Worst result over every matching evidence for the current candidate. */
  result: VisualEvidenceResult
  evidenceIds: string[]
}

/**
 * Lists, for a planned set of route × viewport × state checks, which were
 * visually compared for the expected candidate, which only have
 * non-comparable evidence and which have none. Evidence whose identity is not
 * consistent with `expected` (stale, unverified or for another candidate) is
 * excluded and listed, so it can neither cover a check nor hide a newer failure.
 */
export function summarizeVisualCoverage(plan: readonly VisualCoveragePlanItem[], evidences: readonly VisualDifferenceEvidence[], expected: ExpectedCandidateIdentity): {
  entries: VisualCoverageEntry[]; unplannedEvidenceIds: string[]; excludedEvidence: Array<{ id: string; reason: string }>; compared: number; notComparable: number; missing: number
} {
  const current = (evidence: VisualDifferenceEvidence) => evidence.identity.status === 'consistent' &&
    (['candidateId', 'patchHash', 'baseSourceDigest', 'candidateTreeDigest', 'runtimeFingerprint', 'scopeDecisionId', 'scopeVersion'] as const).every(field => evidence.subject[field] === expected[field])
  const excludedEvidence = evidences.filter(evidence => !current(evidence)).map(evidence => ({
    id: evidence.id,
    reason: evidence.identity.status !== 'consistent' ? `identity ${evidence.identity.status}` : 'identity consistent with a different candidate than expected',
  }))
  const eligible = evidences.filter(current)
  const used = new Set<string>()
  const entries = plan.map(item => {
    const matched = eligible.filter(evidence => (item.checkId === undefined || evidence.checkId === item.checkId) &&
      evidenceMatchesCheck(evidence, item.route, item.viewport, item.interactionState, item.devicePixelRatio))
    matched.forEach(evidence => used.add(evidence.id))
    const compared = matched.some(evidence => evidence.coverage.compared)
    const result = RESULT_PRIORITY.find(candidate => matched.some(evidence => evidence.result === candidate)) ?? 'not-run'
    return { ...item, status: compared ? 'compared' as const : matched.length ? 'not-comparable' as const : 'missing' as const, result, evidenceIds: matched.map(evidence => evidence.id) }
  })
  return {
    entries,
    unplannedEvidenceIds: eligible.filter(evidence => !used.has(evidence.id)).map(evidence => evidence.id),
    excludedEvidence,
    compared: entries.filter(entry => entry.status === 'compared').length,
    notComparable: entries.filter(entry => entry.status === 'not-comparable').length,
    missing: entries.filter(entry => entry.status === 'missing').length,
  }
}
