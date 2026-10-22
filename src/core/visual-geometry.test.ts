import { describe, expect, it } from 'vitest'
import { normalizeVisualCaptureDescriptor } from './visual-capture'
import {
  bindGeometryToCapture, detectGeometryRisks, DOM_GEOMETRY_SCHEMA, elementDisplacements, matchElements, parseDomGeometrySample, toScreenshotRect,
  type DomGeometrySample,
} from './visual-geometry'

type Element = Record<string, unknown>
const el = (id: string, sourceRef: string | null, rect: [number, number, number, number], extra: Element = {}): Element => ({
  id, parentId: null, sourceRef, runtimeInstanceId: sourceRef ? `inst:${sourceRef}` : null, identityCertainty: sourceRef ? 'stable-keyed-instance' : null,
  rect: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] }, clipRect: null, visible: true, ...extra,
})
const rawSample = (side: 'baseline' | 'candidate', elements: Element[], extra: Record<string, unknown> = {}) => ({
  schema: DOM_GEOMETRY_SCHEMA, side, route: '/', viewport: { width: 400, height: 300 }, devicePixelRatio: 1, interactionState: 'rendered',
  coordinateSpace: 'document', scroll: { x: 0, y: 0 }, documentSize: { width: 400, height: 600 }, screenshotSha256: null, elements, ...extra,
})
function sample(side: 'baseline' | 'candidate', elements: Element[], extra: Record<string, unknown> = {}): DomGeometrySample {
  const parsed = parseDomGeometrySample(rawSample(side, elements, extra), side)
  if (!parsed.ok) throw new Error(parsed.detail)
  return parsed.sample
}
const descriptor = (overrides: Record<string, unknown> = {}, capture: Record<string, unknown> = {}) => normalizeVisualCaptureDescriptor({
  route: '/', viewport: { width: 400, height: 300 }, devicePixelRatio: 1, interactionState: 'rendered',
  capture: { completed: true, stable: true, fullPage: true, scroll: { x: 0, y: 0 }, ...capture }, ...overrides,
}, 'candidate').descriptor
const shot = { sha256: 'a'.repeat(64), width: 400, height: 600 }

describe('DOM geometry samples', () => {
  it('accepts a well-formed sample and rejects malformed ones', () => {
    expect(parseDomGeometrySample(rawSample('candidate', [el('a', 'x', [0, 0, 10, 10])]), 'candidate').ok).toBe(true)
    const bad: Array<[unknown, string]> = [
      [{ ...rawSample('candidate', []), schema: 'other' }, 'schema'],
      [rawSample('baseline', []), 'side'],
      [rawSample('candidate', [el('a', 'x', [0, 0, 10, 10]), el('a', 'y', [0, 0, 1, 1])]), 'duplicate'],
      [rawSample('candidate', [el('a', 'x', [0, 0, -1, 10])]), 'rect'],
      [rawSample('candidate', [el('a', 'x', [0, 0, Number.NaN, 10])]), 'rect'],
      [rawSample('candidate', [el('a', 'x', [0, 0, 1, 1], { parentId: 'missing' })]), 'parent'],
      [rawSample('candidate', [el('a', 'x', [0, 0, 1, 1], { parentId: 'b' }), el('b', 'y', [0, 0, 1, 1], { parentId: 'a' })]), 'cycle'],
      [rawSample('candidate', [el('a', 'x', [0, 0, 1, 1], { identityCertainty: 'guessed' })]), 'identityCertainty'],
      [rawSample('candidate', []) && { ...rawSample('candidate', []), coordinateSpace: 'page' }, 'coordinateSpace'],
    ]
    for (const [value, hint] of bad) {
      const parsed = parseDomGeometrySample(value, 'candidate')
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.detail.toLowerCase()).toContain(hint.toLowerCase().slice(0, 5))
    }
    const many = Array.from({ length: 11 }, (_, index) => el(`e${index}`, `s${index}`, [0, 0, 1, 1]))
    expect(parseDomGeometrySample(rawSample('candidate', many), 'candidate', { maxElements: 10 }).ok).toBe(false)
  })

  it('binds a sample only to the screenshot it describes', () => {
    const s = sample('candidate', [el('a', 'x', [0, 0, 10, 10])])
    expect(bindGeometryToCapture(s, descriptor(), shot).ok).toBe(true)
    expect(bindGeometryToCapture(s, descriptor({ route: '/other' }), shot)).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(s, descriptor({ devicePixelRatio: 2 }), shot)).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(s, descriptor({ interactionState: 'after:button:Menu' }), shot)).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(s, descriptor({ viewport: { width: 401, height: 300 } }), shot)).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(s, descriptor({}, { fullPage: null }), shot)).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(s, descriptor({ devicePixelRatio: undefined }), shot)).toMatchObject({ ok: false })
    const bound = sample('candidate', [], { screenshotSha256: 'b'.repeat(64) })
    expect(bindGeometryToCapture(bound, descriptor(), shot)).toMatchObject({ ok: false, detail: expect.stringMatching(/SHA-256/) })
    expect(bindGeometryToCapture(bound, descriptor(), { ...shot, sha256: 'b'.repeat(64) })).toMatchObject({ ok: true, screenshotBound: true })
  })

  it('needs the scroll offset to map onto a viewport-only screenshot', () => {
    const viewportSample = sample('candidate', [], { coordinateSpace: 'viewport', scroll: { x: 0, y: 120 } })
    expect(bindGeometryToCapture(viewportSample, descriptor({}, { fullPage: false, scroll: undefined }), { ...shot, height: 300 })).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(viewportSample, descriptor({}, { fullPage: false, scroll: { x: 0, y: 0 } }), { ...shot, height: 300 })).toMatchObject({ ok: false })
    expect(bindGeometryToCapture(viewportSample, descriptor({}, { fullPage: false, scroll: { x: 0, y: 120 } }), { ...shot, height: 300 })).toMatchObject({ ok: true, mapping: { offset: { x: 0, y: 0 } } })
    const documentSample = sample('candidate', [])
    expect(bindGeometryToCapture(documentSample, descriptor({}, { fullPage: false, scroll: { x: 0, y: 120 } }), { ...shot, height: 300 })).toMatchObject({ ok: true, mapping: { offset: { x: -0, y: -120 } } })
  })

  it('converts CSS rects to covering device-pixel rects for integer and fractional DPR', () => {
    const map = (dpr: number, offset = { x: 0, y: 0 }) => ({ devicePixelRatio: dpr, offset, image: { width: 1000, height: 1000 } })
    expect(toScreenshotRect({ x: 10, y: 20, width: 30, height: 5 }, map(1))).toEqual({ x: 10, y: 20, width: 30, height: 5 })
    expect(toScreenshotRect({ x: 10, y: 20, width: 30, height: 5 }, map(2))).toEqual({ x: 20, y: 40, width: 60, height: 10 })
    // 1.5 × 10.5 = 15.75 → floor 15; 1.5 × (10.5 + 3) = 20.25 → ceil 21.
    expect(toScreenshotRect({ x: 10.5, y: 0, width: 3, height: 2 }, map(1.5))).toEqual({ x: 15, y: 0, width: 6, height: 3 })
    // Viewport-space sample on a full-page screenshot: add the scroll offset.
    expect(toScreenshotRect({ x: 0, y: 10, width: 10, height: 10 }, map(2, { x: 0, y: 100 }))).toEqual({ x: 0, y: 220, width: 20, height: 20 })
    expect(toScreenshotRect({ x: 0, y: 0, width: 4, height: 4 }, map(1), 2)).toEqual({ x: 0, y: 0, width: 6, height: 6 })
    expect(toScreenshotRect({ x: 2000, y: 0, width: 10, height: 10 }, map(1))).toBeNull()
  })
})

describe('cross-version element matching', () => {
  it('matches only unambiguous, identified elements and never by text or position', () => {
    const b = sample('baseline', [
      el('a', 'title', [0, 0, 10, 10]),
      el('b', 'dup', [0, 0, 10, 10]), el('c', 'dup', [0, 20, 10, 10]),
      el('d', 'gone', [0, 40, 10, 10]),
      el('e', null, [0, 60, 10, 10]),
      el('f', 'list', [0, 80, 10, 10], { identityCertainty: 'position-dependent' }),
      el('g', 'unknown', [0, 90, 10, 10], { identityCertainty: 'unknown' }),
    ])
    const c = sample('candidate', [
      el('a', 'title', [0, 0, 10, 12]),
      el('b', 'dup', [0, 0, 10, 10]),
      el('h', 'new', [0, 40, 10, 10]),
      el('e', null, [0, 60, 10, 10]),
      el('f', 'list', [0, 80, 10, 10], { identityCertainty: 'stable-keyed-instance' }),
      el('g', 'unknown', [0, 90, 10, 10], { identityCertainty: 'unknown' }),
    ])
    const matching = matchElements(b, c)
    expect(matching.matched.map(item => [item.sourceRef, item.stable, item.identityCertainty])).toEqual([['list', false, 'position-dependent'], ['title', true, 'stable-keyed-instance']])
    expect(matching.ambiguous.map(item => item.sourceRef)).toEqual(['dup'])
    expect(matching.baselineOnly.map(item => item.sourceRef)).toEqual(['gone'])
    expect(matching.candidateOnly.map(item => item.sourceRef)).toEqual(['new'])
    expect(matching.unidentified).toEqual({ baseline: 2, candidate: 2 })
    expect(elementDisplacements(b, c, matching, 2)).toEqual([])
    expect(elementDisplacements(b, c, matching, 1).map(item => [item.sourceRef, item.delta])).toEqual([['title', { x: 0, y: 0, width: 0, height: 2 }]])
  })
})

describe('explicit geometry rules', () => {
  const rules = (b: DomGeometrySample, c: DomGeometrySample) => detectGeometryRisks(b, c, matchElements(b, c), 1, 50).findings.map(finding => [finding.rule, ...finding.elements.map(item => item.sourceRef)])

  it('reports a new overlap between stable, non-nested elements', () => {
    const b = sample('baseline', [el('t', 'title', [0, 0, 100, 20]), el('btn', 'cta', [0, 40, 80, 30])])
    const c = sample('candidate', [el('t', 'title', [0, 0, 100, 60]), el('btn', 'cta', [0, 40, 80, 30])])
    expect(rules(b, c)).toEqual([['new-overlap', 'cta', 'title']])
  })

  it('does not report overlaps that already existed, nested elements, touching edges or unstable identities', () => {
    const badge = [el('img', 'image', [0, 0, 100, 100]), el('badge', 'badge', [80, 0, 30, 20])]
    expect(rules(sample('baseline', badge), sample('candidate', [...badge.slice(0, 1), el('badge', 'badge', [70, 0, 40, 20])]))).toEqual([])
    const nested = (h: number) => [el('card', 'card', [0, 0, 100, 100]), el('text', 'text', [0, 0, 100, h], { parentId: 'card' })]
    expect(rules(sample('baseline', [el('x', 'x', [500, 500, 1, 1]), ...nested(20)]), sample('candidate', [el('x', 'x', [500, 500, 1, 1]), ...nested(120)]))).toEqual([])
    expect(rules(sample('baseline', [el('a', 'a', [0, 0, 10, 10]), el('b', 'b', [0, 20, 10, 10])]), sample('candidate', [el('a', 'a', [0, 0, 10, 21]), el('b', 'b', [0, 20, 10, 10])]))).toEqual([])
    const unstable = { identityCertainty: 'position-dependent' }
    expect(rules(sample('baseline', [el('a', 'a', [0, 0, 10, 10], unstable), el('b', 'b', [0, 20, 10, 10])]), sample('candidate', [el('a', 'a', [0, 0, 10, 30], unstable), el('b', 'b', [0, 20, 10, 10])]))).toEqual([])
    const hidden = { visible: false }
    expect(rules(sample('baseline', [el('a', 'a', [0, 0, 10, 10]), el('b', 'b', [0, 20, 10, 10], hidden)]), sample('candidate', [el('a', 'a', [0, 0, 10, 30]), el('b', 'b', [0, 20, 10, 10], hidden)]))).toEqual([])
  })

  it('reports new viewport overflow, but not content inside a clipping container', () => {
    const b = sample('baseline', [el('w', 'wide', [0, 0, 380, 20]), el('slide', 'slide', [0, 50, 900, 20], { clipRect: { x: 0, y: 50, width: 400, height: 20 } })])
    const c = sample('candidate', [el('w', 'wide', [0, 0, 460, 20]), el('slide', 'slide', [0, 50, 1200, 20], { clipRect: { x: 0, y: 50, width: 400, height: 20 } })])
    expect(rules(b, c)).toEqual([['new-viewport-overflow', 'wide']])
  })

  it('reports new clipping and new document horizontal overflow', () => {
    const clip = { clipRect: { x: 0, y: 0, width: 200, height: 40 }, hiddenClipRect: { x: 0, y: 0, width: 200, height: 40 } }
    const b = sample('baseline', [el('label', 'label', [10, 10, 100, 20], clip)])
    const c = sample('candidate', [el('label', 'label', [10, 10, 100, 44], clip)], { documentSize: { width: 520, height: 600 } })
    expect(rules(b, c)).toEqual([['new-document-horizontal-overflow'], ['new-clip-overflow', 'label']])
  })

  it('does not treat growing content inside a scroll container as clipped or overlapping what lies below it', () => {
    const scroller = { clipRect: { x: 0, y: 0, width: 200, height: 100 } }
    const b = sample('baseline', [el('list', 'list', [0, 0, 200, 80], scroller), el('footer', 'footer', [0, 110, 200, 40])])
    const c = sample('candidate', [el('list', 'list', [0, 0, 200, 300], scroller), el('footer', 'footer', [0, 110, 200, 40])])
    expect(rules(b, c)).toEqual([])
    // The same growth without a clipping ancestor does overlap the footer.
    const unclipped = (h: number, s: 'baseline' | 'candidate') => sample(s, [el('list', 'list', [0, 0, 200, h]), el('footer', 'footer', [0, 110, 200, 40])])
    expect(rules(unclipped(80, 'baseline'), unclipped(300, 'candidate'))).toEqual([['new-overlap', 'footer', 'list']])
  })

  it('only cuts the axes an overflow:hidden ancestor actually clips', () => {
    // overflow-x:hidden: horizontal cut, vertical axis scrolls (sampler emits ±1e6 for it).
    const xOnly = { clipRect: { x: 0, y: 0, width: 200, height: 100 }, hiddenClipRect: { x: 0, y: -1e6, width: 200, height: 2e6 } }
    const grow = (w: number, h: number, s: 'baseline' | 'candidate') => sample(s, [el('t', 'text', [0, 0, w, h], xOnly)])
    expect(rules(grow(180, 80, 'baseline'), grow(180, 400, 'candidate'))).toEqual([])
    expect(rules(grow(180, 80, 'baseline'), grow(260, 80, 'candidate'))).toEqual([['new-clip-overflow', 'text']])
  })

  it('rejects a full-page binding whose image size contradicts the sampled document at the declared DPR', () => {
    const s = sample('candidate', [], { documentSize: { width: 400, height: 600 } })
    expect(bindGeometryToCapture(s, descriptor(), { ...shot, width: 400, height: 600 }).ok).toBe(true)
    expect(bindGeometryToCapture(s, descriptor(), { ...shot, width: 800, height: 1200 })).toMatchObject({ ok: false, detail: expect.stringMatching(/DPR/) })
    expect(bindGeometryToCapture(s, descriptor(), { ...shot, width: 800, height: 600 })).toMatchObject({ ok: false })
  })

  it('compares viewport-space samples in document coordinates', () => {
    const b = sample('baseline', [el('t', 'title', [0, 100, 100, 20]), el('btn', 'cta', [0, 140, 80, 30])], { coordinateSpace: 'viewport', scroll: { x: 0, y: 0 } })
    const c = sample('candidate', [el('t', 'title', [0, 0, 100, 20]), el('btn', 'cta', [0, 40, 80, 30])], { coordinateSpace: 'viewport', scroll: { x: 0, y: 100 } })
    const matching = matchElements(b, c)
    expect(elementDisplacements(b, c, matching, 1)).toEqual([])
    expect(rules(b, c)).toEqual([])
  })
})
