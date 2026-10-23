// The F workbench consumes visual evidence only through the read-only view.
import { describe, expect, it } from 'vitest'
import { analyzeVisualDifference } from './visual-evidence'
import { toEvidenceItemView, toVisualEvidenceView, VISUAL_EVIDENCE_STATE_LABEL, VISUAL_EVIDENCE_VIEW_SCHEMA } from './visual-evidence-view'
import { encodePng } from './visual-png'

const CSS_W = 100, CSS_H = 80
function png(draw: (fill: (x: number, y: number, w: number, h: number, color: [number, number, number]) => void) => void = () => {}) {
  const data = new Uint8Array(CSS_W * CSS_H * 4).fill(255)
  draw((x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set([...color, 255], (yy * CSS_W + xx) * 4)
  })
  return encodePng(CSS_W, CSS_H, data)
}

const identity = {
  candidateId: 'cand-1', projectId: 'proj-1', patchHash: 'p'.repeat(64), baseSourceDigest: 'b'.repeat(64), candidateTreeDigest: 't'.repeat(64),
  runtimeFingerprint: 'runtime-1', scopeDecisionId: 'scope-1', scopeVersion: 1,
}
const side = (name: 'baseline' | 'candidate', bytes: Uint8Array, titleHeight: number) => ({
  descriptor: {
    side: name, route: '/', pageUrl: 'http://127.0.0.2:4173/', viewport: { width: CSS_W, height: CSS_H }, devicePixelRatio: 1,
    browser: { name: 'chromium', version: '140.0' }, runtimeFingerprint: identity.runtimeFingerprint, interactionState: 'rendered',
    sourceDigest: name === 'baseline' ? identity.baseSourceDigest : identity.candidateTreeDigest,
    capture: { completed: true, stable: true, fullPage: true, animationsDisabled: true, fontsReady: true, capturedAt: '2026-10-21T00:00:00.000Z', scroll: { x: 0, y: 0 } },
    screenshot: { declaredSha256: null },
  },
  screenshot: bytes,
  geometry: {
    schema: 'ripple-dom-geometry/v1', side: name, route: '/', viewport: { width: CSS_W, height: CSS_H }, devicePixelRatio: 1,
    interactionState: 'rendered', coordinateSpace: 'document', scroll: { x: 0, y: 0 }, documentSize: { width: CSS_W, height: CSS_H }, screenshotSha256: null,
    elements: [
      { id: 'root', parentId: null, sourceRef: 'App', runtimeInstanceId: 'i:App', identityCertainty: 'stable-react-instance', rect: { x: 0, y: 0, width: CSS_W, height: CSS_H }, clipRect: null, hiddenClipRect: null, visible: true },
      { id: 'title', parentId: 'root', sourceRef: 'Hero#h1', runtimeInstanceId: 'i:Hero#h1', identityCertainty: 'stable-react-instance', rect: { x: 10, y: 10, width: 40, height: titleHeight }, clipRect: null, hiddenClipRect: null, visible: true },
    ],
  },
})

const request = (baselineBytes: Uint8Array, candidateBytes: Uint8Array, titleHeight = 20) => ({
  checkId: 'check-view', subject: identity, expected: identity, targets: { sourceRefs: ['Hero#h1'] },
  baseline: side('baseline', baselineBytes, 10), candidate: side('candidate', candidateBytes, titleHeight),
})

describe('read-only visual evidence view for the F workbench', () => {
  it('maps a changed, target-confined comparison into a plain view', () => {
    const { evidence } = analyzeVisualDifference(request(png(), png(fill => fill(10, 10, 30, 10, [17, 24, 39]))))
    const view = toVisualEvidenceView(evidence, { diffImageUrl: '/artifacts/diff.png', evidenceUrl: '/artifacts/evidence.json' })
    expect(view.schema).toBe(VISUAL_EVIDENCE_VIEW_SCHEMA)
    expect(view.state).toBe('unknown')
    expect(view.stateLabel).toBe(VISUAL_EVIDENCE_STATE_LABEL.unknown)
    expect(view.changedPixels).toBeGreaterThan(0)
    expect(view.regions).toHaveLength(1)
    expect(view.regions[0]).toMatchObject({ classification: 'target', attribution: 'mapped' })
    expect(view.regions[0].sourceRefs).toContain('Hero#h1')
    expect(view.artifacts.urls).toEqual({ baseline: undefined, candidate: undefined, diff: '/artifacts/diff.png', evidence: '/artifacts/evidence.json' })
    expect(view.summary).toContain('不构成通过判定')
    const item = toEvidenceItemView(view)
    expect(item).toMatchObject({ id: evidence.id, state: 'unknown', sourceKind: 'runtime-observation' })
    expect(JSON.parse(item.detail)).toMatchObject({ schema: VISUAL_EVIDENCE_VIEW_SCHEMA, identity: 'consistent' })
  })

  it('maps a not-run comparison without inventing observation data', () => {
    const { evidence } = analyzeVisualDifference(request(png(), null as unknown as Uint8Array))
    const view = toVisualEvidenceView(evidence)
    expect(view.state).toBe('not-run')
    expect(view.changedPixels).toBeNull()
    expect(view.regions).toEqual([])
    expect(view.regionCount).toBe(0)
  })

  it('never emits pass and is pure for the same evidence', () => {
    const { evidence } = analyzeVisualDifference(request(png(), png()))
    const a = toVisualEvidenceView(evidence)
    const b = toVisualEvidenceView(evidence)
    expect(a.state).not.toBe('pass')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
