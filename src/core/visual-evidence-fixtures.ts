// Deterministic synthetic fixtures for visual-difference evidence.
//
// The scenes are drawn pixel by pixel from integer rectangles; "text" is a
// seeded sequence of glyph-like bars, so no font, browser or platform
// rendering is involved. These fixtures prove the image/geometry algorithms
// only. They are labelled with browser "synthetic-scene-renderer" and an
// .invalid URL so they can never be mistaken for real browser evidence, and
// they are not Bolt (or any real project) acceptance.
import { createHash } from 'node:crypto'
import type { ExpectedCandidateIdentity } from './visual-capture'
import { DOM_GEOMETRY_SCHEMA } from './visual-geometry'
import type { VisualComparisonRequest, VisualDifferenceEvidence } from './visual-evidence'
import { encodePng, pixelDigest } from './visual-png'

type Rgb = readonly [number, number, number]
interface Box { x: number; y: number; width: number; height: number }

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

export const FIXTURE_ANALYZED_AT = '2026-10-21T00:00:00.000Z'
export const FIXTURE_IDENTITY: ExpectedCandidateIdentity = Object.freeze({
  candidateId: 'candidate-fixture-1',
  patchHash: sha('ripple-visual-fixture:patch'),
  baseSourceDigest: sha('ripple-visual-fixture:base-source'),
  candidateTreeDigest: sha('ripple-visual-fixture:candidate-tree'),
  runtimeFingerprint: 'fixture-runtime:synthetic-scene-renderer/1',
  scopeDecisionId: 'scope-fixture-1',
  scopeVersion: 1,
})

class Canvas {
  readonly width: number
  readonly height: number
  readonly dpr: number
  readonly data: Uint8Array
  constructor(cssWidth: number, cssHeight: number, dpr: number, background: Rgb) {
    this.dpr = dpr
    this.width = Math.round(cssWidth * dpr)
    this.height = Math.round(cssHeight * dpr)
    this.data = new Uint8Array(this.width * this.height * 4)
    this.fillDevice(0, 0, this.width, this.height, background)
  }
  fillDevice(x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha = 1) {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        const p = (y * this.width + x) * 4
        for (let k = 0; k < 3; k++) this.data[p + k] = Math.round(this.data[p + k] * (1 - alpha) + color[k] * alpha)
        this.data[p + 3] = 255
      }
    }
  }
  /** Fills a CSS-pixel box (integer CSS coordinates). */
  fill(box: Box, color: Rgb) {
    const d = this.dpr
    this.fillDevice(Math.round(box.x * d), Math.round(box.y * d), Math.round((box.x + box.width) * d), Math.round((box.y + box.height) * d), color)
  }
  /** Seeded glyph-like bars standing in for a text run inside `box`. */
  glyphs(box: Box, seed: string, color: Rgb, lineHeight = 12) {
    let state = Number.parseInt(sha(seed).slice(0, 8), 16) >>> 0
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32 }
    for (let top = box.y; top + lineHeight <= box.y + box.height; top += lineHeight) {
      let x = box.x
      while (true) {
        const glyph = 2 + Math.floor(next() * 5)
        if (x + glyph > box.x + box.width) break
        const tall = next() < 0.3
        this.fill({ x, y: top + (tall ? 1 : 3), width: glyph, height: lineHeight - (tall ? 3 : 5) }, color)
        x += glyph + 1 + (next() < 0.18 ? 3 : 0)
      }
    }
  }
}

const COLORS = {
  page: [248, 250, 252], header: [15, 23, 42], headerText: [226, 232, 240], title: [17, 24, 39], body: [71, 85, 105],
  cta: [37, 99, 235], ctaText: [255, 255, 255], footer: [226, 232, 240], footerAlt: [254, 226, 226], footerText: [100, 116, 139], menu: [255, 255, 255], menuEdge: [148, 163, 184],
} as const satisfies Record<string, Rgb>

interface SceneOptions {
  dpr?: number
  pageHeight?: number
  titleSeed?: string
  titleBox?: Box
  footerColor?: Rgb
  footerTop?: number
  menuOpen?: boolean
  ctaEdgeAntialiased?: boolean
  annotateTitle?: boolean
}

const SOURCES = {
  app: 'src/App.tsx#App',
  header: 'src/components/Header.tsx#header',
  title: 'src/components/Hero.tsx#h1',
  body: 'src/components/Hero.tsx#p',
  cta: 'src/components/Hero.tsx#a.cta',
  footer: 'src/components/Footer.tsx#footer',
  menu: 'src/components/Header.tsx#nav.menu',
} as const
export const FIXTURE_TARGET_REFS = [SOURCES.title]

interface Scene { width: number; height: number; rgba: Uint8Array; elements: unknown[]; documentSize: { width: number; height: number } }

function drawScene(options: SceneOptions = {}): Scene {
  const dpr = options.dpr ?? 1
  const pageHeight = options.pageHeight ?? 240
  const titleBox = options.titleBox ?? { x: 16, y: 56, width: 200, height: 24 }
  const footerTop = options.footerTop ?? 208
  const canvas = new Canvas(320, pageHeight, dpr, COLORS.page)
  const header: Box = { x: 0, y: 0, width: 320, height: 40 }
  const body: Box = { x: 16, y: 92, width: 288, height: 40 }
  const cta: Box = { x: 16, y: 150, width: 120, height: 36 }
  const footer: Box = { x: 0, y: footerTop, width: 320, height: 32 }
  const menu: Box = { x: 200, y: 40, width: 120, height: 96 }
  canvas.fill(header, COLORS.header)
  canvas.glyphs({ x: 12, y: 14, width: 80, height: 12 }, 'brand', COLORS.headerText)
  canvas.fill({ x: 292, y: 14, width: 16, height: 12 }, COLORS.headerText)
  canvas.glyphs(body, 'body-copy', COLORS.body, 13)
  canvas.fill(cta, COLORS.cta)
  canvas.glyphs({ x: 32, y: 162, width: 88, height: 12 }, 'cta-label', COLORS.ctaText)
  if (options.ctaEdgeAntialiased) {
    // A half-pixel wider button: one column of 50 % coverage on its right edge,
    // the classic sub-pixel rendering difference that is not a content change.
    const d = dpr
    canvas.fillDevice(Math.round((cta.x + cta.width) * d), Math.round(cta.y * d), Math.round((cta.x + cta.width) * d) + 1, Math.round((cta.y + cta.height) * d), COLORS.cta, 0.5)
  }
  canvas.fill(footer, options.footerColor ?? COLORS.footer)
  canvas.glyphs({ x: 16, y: footerTop + 10, width: 120, height: 12 }, 'footer', COLORS.footerText)
  canvas.glyphs(titleBox, options.titleSeed ?? 'Spring collection', COLORS.title, titleBox.height > 24 ? 26 : 24)
  if (options.menuOpen) {
    canvas.fill(menu, COLORS.menuEdge)
    canvas.fill({ x: menu.x + 1, y: menu.y + 1, width: menu.width - 2, height: menu.height - 2 }, COLORS.menu)
    canvas.glyphs({ x: menu.x + 12, y: menu.y + 12, width: 90, height: 72 }, 'menu-items', COLORS.body, 18)
  }
  const element = (id: string, parentId: string | null, sourceRef: string | null, runtimeInstanceId: string | null, rect: Box) => ({
    id, parentId, sourceRef, runtimeInstanceId, identityCertainty: sourceRef ? 'stable-react-instance' : 'unmapped', rect, clipRect: null, visible: true,
  })
  const elements = [
    element('e0', null, SOURCES.app, 'App', { x: 0, y: 0, width: 320, height: pageHeight }),
    element('e1', 'e0', SOURCES.header, 'App/Header', header),
    options.annotateTitle === false ? element('e2', 'e0', null, null, titleBox) : element('e2', 'e0', SOURCES.title, 'App/Hero/h1', titleBox),
    element('e3', 'e0', SOURCES.body, 'App/Hero/p', body),
    element('e4', 'e0', SOURCES.cta, 'App/Hero/a.cta', cta),
    element('e5', 'e0', SOURCES.footer, 'App/Footer', footer),
    ...(options.menuOpen ? [element('e6', 'e1', SOURCES.menu, 'App/Header/nav.menu', menu)] : []),
  ]
  return { width: canvas.width, height: canvas.height, rgba: canvas.data, elements, documentSize: { width: 320, height: pageHeight } }
}

/** JSON form of a fixture input: screenshots are referenced by file name. */
export interface VisualFixtureInput {
  description: string
  demonstrates: string[]
  checkId: string
  subject: Record<string, unknown>
  expected: ExpectedCandidateIdentity
  targets: { sourceRefs: string[] }
  baseline: { descriptor: Record<string, unknown>; screenshot: string | null; geometry: Record<string, unknown> | null }
  candidate: { descriptor: Record<string, unknown>; screenshot: string | null; geometry: Record<string, unknown> | null }
  analyzedAt: string
  diffArtifactPath: string
}

export interface VisualFixtureCase {
  name: string
  input: VisualFixtureInput
  /** Files to write next to input.json. */
  files: Record<string, Uint8Array>
  /** Decoded-pixel digests of the drawn screenshots, for regeneration checks. */
  pixelDigests: Record<string, string>
}

interface SideSpec {
  scene: Scene | null
  /** Replace the encoded PNG with these bytes (corruption cases). */
  bytes?: (png: Uint8Array) => Uint8Array
  descriptor?: Record<string, unknown>
  capture?: Record<string, unknown>
  declareHash?: boolean
  geometry?: boolean
  pageUrl?: string
}

function side(name: 'baseline' | 'candidate', spec: SideSpec, dpr: number) {
  const fileName = `${name}.png`
  const files: Record<string, Uint8Array> = {}
  const pixelDigests: Record<string, string> = {}
  let sha256: string | null = null
  if (spec.scene) {
    const png = encodePng(spec.scene.width, spec.scene.height, spec.scene.rgba)
    const bytes = spec.bytes ? spec.bytes(png) : png
    files[fileName] = bytes
    pixelDigests[fileName] = pixelDigest(spec.scene.width, spec.scene.height, spec.scene.rgba)
    sha256 = createHash('sha256').update(spec.bytes ? png : bytes).digest('hex')
  }
  const descriptor: Record<string, unknown> = {
    side: name, route: '/', pageUrl: spec.pageUrl ?? 'http://fixture.invalid/',
    viewport: { width: 320, height: 240 }, devicePixelRatio: dpr,
    browser: { name: 'synthetic-scene-renderer', version: '1' },
    runtimeFingerprint: FIXTURE_IDENTITY.runtimeFingerprint, interactionState: 'rendered',
    sourceDigest: name === 'baseline' ? FIXTURE_IDENTITY.baseSourceDigest : FIXTURE_IDENTITY.candidateTreeDigest,
    capture: { completed: true, stable: true, fullPage: true, animationsDisabled: true, fontsReady: true, capturedAt: FIXTURE_ANALYZED_AT, scroll: { x: 0, y: 0 }, ...spec.capture },
    screenshot: { ...(spec.declareHash === false || !sha256 ? {} : { declaredSha256: sha256 }), artifactPath: fileName },
    ...spec.descriptor,
  }
  const geometry = spec.scene && spec.geometry !== false ? {
    schema: DOM_GEOMETRY_SCHEMA, side: name, route: '/', viewport: { width: 320, height: 240 }, devicePixelRatio: dpr,
    interactionState: descriptor.interactionState, coordinateSpace: 'document', scroll: { x: 0, y: 0 },
    documentSize: spec.scene.documentSize, screenshotSha256: sha256, elements: spec.scene.elements,
  } : null
  return { input: { descriptor, screenshot: spec.scene ? fileName : null, geometry }, files, pixelDigests }
}

function fixture(name: string, description: string, demonstrates: string[], baseline: SideSpec, candidate: SideSpec, options: { subject?: Record<string, unknown>; baselineDpr?: number; candidateDpr?: number } = {}): VisualFixtureCase {
  const b = side('baseline', baseline, options.baselineDpr ?? 1)
  const c = side('candidate', candidate, options.candidateDpr ?? 1)
  return {
    name,
    input: {
      description, demonstrates, checkId: `fixture-${name}`,
      subject: { ...FIXTURE_IDENTITY, runId: `run-fixture-${name}`, ...options.subject },
      expected: { ...FIXTURE_IDENTITY },
      targets: { sourceRefs: [...FIXTURE_TARGET_REFS] },
      baseline: b.input, candidate: c.input,
      analyzedAt: FIXTURE_ANALYZED_AT, diffArtifactPath: 'diff.png',
    },
    files: { ...b.files, ...c.files },
    pixelDigests: { ...b.pixelDigests, ...c.pixelDigests },
  }
}

/** Builds every synthetic fixture case in memory. Deterministic. */
export function buildVisualFixtureCases(): VisualFixtureCase[] {
  const base = () => drawScene()
  const changedTitle = () => drawScene({ titleSeed: 'Autumn collection now in store' })
  return [
    fixture('target-text-change', 'Only the declared target text renders differently; the change is confined to the target box.',
      ['changed', 'change-inside-target', 'url-redaction', 'result unknown (a visual change is not PASS)'],
      { scene: base(), pageUrl: 'http://fixture.invalid/?preview_token=EXAMPLE-NOT-A-SECRET#top' }, { scene: changedTitle(), pageUrl: 'http://fixture.invalid/?preview_token=EXAMPLE-NOT-A-SECRET#top' }),
    fixture('non-target-change', 'The target text changes and, unexpectedly, the footer background changes too.',
      ['change-outside-target (review, not risk)', 'non-target region attribution'],
      { scene: base() }, { scene: drawScene({ titleSeed: 'Autumn collection now in store', footerColor: COLORS.footerAlt }) }),
    fixture('geometric-overlap', 'The longer target text wraps to four lines; its box now overlaps the paragraph and the call-to-action button.',
      ['geometry-risk new-overlap', 'element displacement', 'result risk'],
      { scene: base() }, { scene: drawScene({ titleSeed: 'Autumn collection: forty new pieces, hand thrown and glazed in small batches', titleBox: { x: 16, y: 56, width: 200, height: 104 } }) }),
    fixture('dpr-mismatch', 'Baseline was captured at device pixel ratio 1 and the candidate at 2.',
      ['not comparable: device-pixel-ratio-mismatch, image-size-mismatch'],
      { scene: base() }, { scene: drawScene({ dpr: 2, titleSeed: 'Autumn collection now in store' }) }, { candidateDpr: 2 }),
    fixture('page-extent-changed', 'Full-page captures of different heights (the footer moved down by 40 CSS px).',
      ['not comparable: image-size-mismatch'],
      { scene: base() }, { scene: drawScene({ pageHeight: 280, footerTop: 248 }) }),
    fixture('screenshot-missing', 'The candidate screenshot was never produced.',
      ['result not-run'],
      { scene: base() }, { scene: null, capture: { completed: false } }),
    fixture('corrupt-png', 'The candidate screenshot is truncated after 64 bytes.',
      ['result failed-to-run', 'png-structure-invalid'],
      { scene: base() }, { scene: changedTitle(), bytes: png => png.subarray(0, 64), geometry: false }),
    fixture('interaction-state-mismatch', 'Baseline shows the default state while the candidate shows the opened menu.',
      ['not comparable: interaction-state-mismatch'],
      { scene: base() }, { scene: drawScene({ menuOpen: true }), descriptor: { interactionState: 'after:button:Open menu' } }),
    fixture('unchanged-insufficient-evidence', 'Pixel-identical screenshots without stability marker, recorded hashes or DOM geometry.',
      ['unchanged is not PASS', 'limitations listed'],
      { scene: base(), capture: { stable: null }, declareHash: false, geometry: false },
      { scene: base(), capture: { stable: null }, declareHash: false, geometry: false }),
    fixture('identity-stale', 'The captures claim an older patch hash than the current candidate.',
      ['result stale', 'no comparison'],
      { scene: base() }, { scene: changedTitle() }, { subject: { patchHash: sha('ripple-visual-fixture:previous-patch') } }),
    fixture('antialias-noise', 'The only difference is a half-covered pixel column on the button edge.',
      ['anti-aliasing excluded', 'unchanged'],
      { scene: base() }, { scene: drawScene({ ctaEdgeAntialiased: true }) }),
    fixture('target-unmapped', 'The target changes but the sampled DOM has no annotation for the target element.',
      ['target-not-mapped', 'change-unattributed', 'regions attributed only to annotated elements'],
      { scene: drawScene({ annotateTitle: false }) }, { scene: drawScene({ titleSeed: 'Autumn collection now in store', annotateTitle: false }) }),
  ]
}

/** Turns a fixture's JSON input back into an analysis request, loading screenshots by name. */
export function requestFromFixtureInput(input: VisualFixtureInput, readFile: (name: string) => Uint8Array): VisualComparisonRequest {
  return {
    checkId: input.checkId, subject: input.subject, expected: input.expected, targets: input.targets,
    baseline: { descriptor: input.baseline.descriptor, screenshot: input.baseline.screenshot ? readFile(input.baseline.screenshot) : null, geometry: input.baseline.geometry },
    candidate: { descriptor: input.candidate.descriptor, screenshot: input.candidate.screenshot ? readFile(input.candidate.screenshot) : null, geometry: input.candidate.geometry },
    analyzedAt: input.analyzedAt, diffArtifactPath: input.diffArtifactPath,
  }
}

/**
 * Removes the fields that legitimately differ between machines: the runtime
 * environment, and the encoded diff PNG's byte hash/size (zlib output may vary
 * between Node releases; its decoded pixel digest is kept and must match).
 */
export function comparableEvidence(evidence: VisualDifferenceEvidence): unknown {
  const copy = JSON.parse(JSON.stringify(evidence)) as { environment: unknown; observation: { diffImage: Record<string, unknown> | null } | null }
  copy.environment = '<machine-dependent>'
  if (copy.observation?.diffImage) {
    copy.observation.diffImage.sha256 = '<encoder-dependent>'
    copy.observation.diffImage.sizeBytes = '<encoder-dependent>'
  }
  return copy
}
