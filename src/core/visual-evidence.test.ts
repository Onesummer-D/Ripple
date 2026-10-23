import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExpectedCandidateIdentity } from './visual-capture'
import {
  analyzeVisualDifference, readScreenshotFile, serializeVisualEvidence, summarizeVisualCoverage, summarizeVisualEvidence, toVerificationEvidence, VisualEvidenceProjectionError,
  type VisualComparisonRequest, type VisualDifferenceEvidence,
} from './visual-evidence'
import { DOM_GEOMETRY_SCHEMA } from './visual-geometry'
import { encodePng, readPng, sha256Hex } from './visual-png'

const CSS_W = 100, CSS_H = 80
const expected: ExpectedCandidateIdentity = {
  candidateId: 'cand-1', projectId: 'proj-1', patchHash: 'p'.repeat(64), baseSourceDigest: 'b'.repeat(64), candidateTreeDigest: 't'.repeat(64),
  runtimeFingerprint: 'runtime-1', scopeDecisionId: 'scope-1', scopeVersion: 3,
}
type Fill = (x: number, y: number, w: number, h: number, color: [number, number, number]) => void
function png(draw: (fill: Fill) => void = () => {}, dpr = 1, cssHeight = CSS_H) {
  const width = CSS_W * dpr, height = cssHeight * dpr
  const data = new Uint8Array(width * height * 4).fill(255)
  const fill: Fill = (x, y, w, h, color) => {
    for (let yy = y * dpr; yy < (y + h) * dpr; yy++) for (let xx = x * dpr; xx < (x + w) * dpr; xx++) data.set([...color, 255], (yy * width + xx) * 4)
  }
  draw(fill)
  return encodePng(width, height, data)
}
const baseScene: (fill: Fill) => void = fill => { fill(10, 10, 40, 10, [17, 24, 39]); fill(10, 50, 30, 12, [37, 99, 235]) }
const titleChanged: (fill: Fill) => void = fill => { fill(10, 10, 30, 10, [17, 24, 39]); fill(10, 50, 30, 12, [37, 99, 235]) }

interface SideOptions { bytes?: Uint8Array | null; descriptor?: Record<string, unknown>; capture?: Record<string, unknown>; geometry?: Record<string, unknown> | null; elements?: Array<Record<string, unknown>>; dpr?: number; declare?: boolean }
const element = (id: string, sourceRef: string | null, rect: [number, number, number, number], extra: Record<string, unknown> = {}) => ({
  id, parentId: id === 'root' ? null : 'root', sourceRef, runtimeInstanceId: sourceRef ? `i:${sourceRef}` : null, identityCertainty: sourceRef ? 'stable-react-instance' : null,
  rect: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] }, clipRect: null, visible: true, ...extra,
})
const defaultElements = (titleWidth = 40, titleHeight = 10) => [
  element('root', 'App', [0, 0, CSS_W, CSS_H]),
  element('title', 'Hero#h1', [10, 10, titleWidth, titleHeight]),
  element('cta', 'Hero#cta', [10, 50, 30, 12]),
]
function side(name: 'baseline' | 'candidate', options: SideOptions) {
  const dpr = options.dpr ?? 1
  const bytes = options.bytes === undefined ? png(baseScene, dpr) : options.bytes
  const sha = bytes ? sha256Hex(bytes) : null
  const descriptor = {
    side: name, route: '/', pageUrl: 'http://127.0.0.2:5173/', viewport: { width: CSS_W, height: CSS_H }, devicePixelRatio: dpr,
    browser: { name: 'chromium', version: '140.0' }, runtimeFingerprint: expected.runtimeFingerprint, interactionState: 'rendered',
    sourceDigest: name === 'baseline' ? expected.baseSourceDigest : expected.candidateTreeDigest,
    capture: { completed: true, stable: true, fullPage: true, animationsDisabled: true, fontsReady: true, capturedAt: '2026-10-21T01:02:03.000Z', scroll: { x: 0, y: 0 }, ...options.capture },
    screenshot: options.declare === false || !sha ? {} : { declaredSha256: sha },
    ...options.descriptor,
  }
  const geometry = options.geometry === null ? null : {
    schema: DOM_GEOMETRY_SCHEMA, side: name, route: '/', viewport: { width: CSS_W, height: CSS_H }, devicePixelRatio: dpr, interactionState: descriptor.interactionState,
    coordinateSpace: 'document', scroll: { x: 0, y: 0 }, documentSize: { width: CSS_W, height: CSS_H }, screenshotSha256: sha,
    elements: options.elements ?? defaultElements(), ...options.geometry,
  }
  return { descriptor, screenshot: bytes, geometry }
}
function request(baseline: SideOptions = {}, candidate: SideOptions = {}, extra: Partial<VisualComparisonRequest> = {}): VisualComparisonRequest {
  return {
    checkId: 'check-1', subject: { ...expected, runId: 'run-1' }, expected, targets: { sourceRefs: ['Hero#h1'] },
    baseline: side('baseline', baseline), candidate: side('candidate', { bytes: png(titleChanged, candidate.dpr ?? 1), ...candidate }),
    analyzedAt: '2026-10-21T00:00:00.000Z', diffArtifactPath: 'check-1-visual-diff.png', ...extra,
  }
}
const analyze = (req: VisualComparisonRequest) => analyzeVisualDifference(req).evidence
const reasonCodes = (evidence: VisualDifferenceEvidence) => evidence.comparability.reasons.map(reason => reason.code)
const limitationCodes = (evidence: VisualDifferenceEvidence) => evidence.comparability.limitations.map(item => item.code)
const findingCodes = (evidence: VisualDifferenceEvidence) => evidence.findings.map(finding => finding.code)

describe('visual difference evidence: comparison outcomes', () => {
  it('reports zero difference for identical screenshots — and still not PASS', () => {
    const evidence = analyze(request({}, { bytes: png(baseScene) }))
    expect(evidence.result).toBe('unknown')
    expect(evidence.observation).toMatchObject({ outcome: 'unchanged', changedPixels: 0, changedRatio: 0, regionCount: 0, diffImage: null })
    expect(findingCodes(evidence)).toEqual(['no-visual-change', 'target-visually-unchanged'])
  })

  it('reports a single changed region confined to the target', () => {
    const { evidence, diffPng } = analyzeVisualDifference(request({}, {}))
    expect(evidence.result).toBe('unknown')
    expect(evidence.observation).toMatchObject({ outcome: 'changed', changedPixels: 100, regionCount: 1, changedBounds: { x: 40, y: 10, width: 10, height: 10 } })
    expect(evidence.observation!.changedRatio).toBe(Math.round((100 / 8000) * 1e6) / 1e6)
    expect(evidence.observation!.regions[0]).toMatchObject({ id: 'r1', bbox: { x: 40, y: 10, width: 10, height: 10 }, classification: 'target', insideTargetPixels: 100, attribution: 'mapped' })
    expect(evidence.geometry).toMatchObject({ status: 'mapped', target: { status: 'mapped', missingRefs: [] }, changedPixelsInsideTarget: 100, changedPixelsOutsideTarget: 0 })
    expect(findingCodes(evidence)).toEqual(['change-inside-target'])
    expect(evidence.geometry.displacements.map(item => [item.sourceRef, item.delta])).toEqual([])
    // The diff PNG is real, decodable and hash-recorded.
    expect(diffPng).not.toBeNull()
    const decoded = readPng(diffPng!)
    expect(decoded.ok && decoded.png.pixelSha256).toBe(evidence.observation!.diffImage!.pixelSha256)
    expect(evidence.observation!.diffImage).toMatchObject({ artifactPath: 'check-1-visual-diff.png', sha256: sha256Hex(diffPng!), sizeBytes: diffPng!.length })
  })

  it('reports several separated regions and attributes each to the most specific element', () => {
    const changed: (fill: Fill) => void = fill => { fill(10, 10, 30, 10, [17, 24, 39]); fill(10, 50, 30, 12, [220, 38, 38]); fill(80, 70, 6, 6, [0, 0, 0]) }
    const evidence = analyze(request({}, { bytes: png(changed) }))
    expect(evidence.observation!.regions.map(region => [region.id, region.classification, region.elements[0]?.sourceRef ?? null])).toEqual([
      ['r1', 'target', 'Hero#h1'],
      ['r2', 'non-target', 'Hero#cta'],
      ['r3', 'non-target', 'App'],
    ])
    expect(findingCodes(evidence)).toEqual(['change-inside-target', 'change-outside-target'])
    expect(evidence.findings[1]).toMatchObject({ severity: 'review', regionIds: ['r2', 'r3'], changedPixels: 360 + 36 })
    expect(evidence.result).toBe('unknown')
  })

  it('treats anti-aliasing-only differences as unchanged and counts them separately', () => {
    const aa: (fill: Fill) => void = fill => { baseScene(fill); fill(50, 10, 1, 10, [136, 139, 147]) }
    const evidence = analyze(request({}, { bytes: png(aa) }))
    expect(evidence.observation).toMatchObject({ outcome: 'unchanged', changedPixels: 0 })
    expect(evidence.observation!.antialiasedPixels).toBeGreaterThan(0)
    expect(evidence.observation!.diffImage).not.toBeNull()
    const counted = analyze(request({}, { bytes: png(aa) }, { parameters: { includeAA: true } }))
    expect(counted.observation!.outcome).toBe('changed')
    expect(counted.parameters.includeAA).toBe(true)
  })

  it('refuses to compare screenshots of different pixel size (page extent changed)', () => {
    const evidence = analyze(request({}, { bytes: png(baseScene, 1, 120) }))
    expect(evidence.result).toBe('unknown')
    expect(reasonCodes(evidence)).toEqual(['image-size-mismatch'])
    expect(evidence.comparability.reasons[0]).toMatchObject({ baseline: { width: 100, height: 80 }, candidate: { width: 100, height: 120 } })
    expect(evidence.observation).toBeNull()
    expect(evidence.geometry.status).toBe('not-evaluated')
  })

  it('refuses to compare different device pixel ratios', () => {
    const evidence = analyze(request({}, { dpr: 2, bytes: png(titleChanged, 2) }))
    expect(evidence.result).toBe('unknown')
    expect(reasonCodes(evidence)).toEqual(['device-pixel-ratio-mismatch', 'image-size-mismatch'])
    expect(evidence.observation).toBeNull()
  })

  it('refuses to compare viewport-only captures taken at different scroll positions', () => {
    const scrolled = { capture: { fullPage: false, scroll: { x: 0, y: 300 } } }
    const evidence = analyze(request({ capture: { fullPage: false, scroll: { x: 0, y: 0 } } }, { ...scrolled, bytes: png(baseScene) }))
    expect(evidence.result).toBe('unknown')
    expect(reasonCodes(evidence)).toContain('scroll-mismatch')
    expect(evidence.observation).toBeNull()
  })

  it('ignores scroll differences for full-page captures (the whole document is covered)', () => {
    const evidence = analyze(request({ capture: { scroll: { x: 0, y: 40 } } }, { capture: { scroll: { x: 0, y: 120 } }, bytes: png(baseScene) }))
    expect(reasonCodes(evidence)).not.toContain('scroll-mismatch')
    expect(evidence.result).toBe('unknown')
    expect(evidence.observation).not.toBeNull()
  })

  it('rejects a negative expected scopeVersion', () => {
    expect(() => analyzeVisualDifference(request({}, {}, { expected: { ...expected, scopeVersion: -1 } }))).toThrow(RangeError)
  })

  it('rejects a screenshot whose size contradicts its declared viewport × DPR', () => {
    const evidence = analyze(request({ descriptor: { devicePixelRatio: 2 } }, { descriptor: { devicePixelRatio: 2 } }))
    expect(reasonCodes(evidence)).toEqual(['image-viewport-inconsistent', 'image-viewport-inconsistent'])
    expect(evidence.result).toBe('unknown')
  })

  it('maps DOM geometry correctly at device pixel ratio 2', () => {
    const evidence = analyze(request({ dpr: 2, bytes: png(baseScene, 2) }, { dpr: 2, bytes: png(titleChanged, 2) }))
    expect(evidence.parameters).toMatchObject({ mergeDistancePx: 16, targetMarginPx: 4 })
    expect(evidence.observation!.regions).toEqual([expect.objectContaining({ bbox: { x: 80, y: 20, width: 20, height: 20 }, cssBox: { x: 40, y: 10, width: 10, height: 10 }, classification: 'target', changedPixels: 400 })])
  })

  it('reports not-run for a missing screenshot and failed-to-run for empty or corrupt ones', () => {
    expect(analyze(request({}, { bytes: null }))).toMatchObject({ result: 'not-run', observation: null })
    expect(analyze(request({ bytes: null }, { bytes: null })).resultReason).toContain('Both screenshots')
    const empty = analyze(request({}, { bytes: new Uint8Array() }))
    expect(empty).toMatchObject({ result: 'failed-to-run', inputs: { candidate: { screenshot: { status: 'invalid', failure: { code: 'png-empty' } } } } })
    const truncated = png(titleChanged).subarray(0, 40)
    const corrupt = analyze(request({}, { bytes: truncated }))
    expect(corrupt.result).toBe('failed-to-run')
    expect(corrupt.inputs.candidate.screenshot).toMatchObject({ status: 'invalid', sha256: sha256Hex(truncated), sizeBytes: 40 })
    expect(reasonCodes(analyze(request({}, { bytes: new TextEncoder().encode('not a png') })))).toContain('screenshot-invalid')
  })

  it('reports failed-to-run when screenshot bytes differ from their recorded hash', () => {
    const req = request()
    ;(req.candidate.descriptor as { screenshot: Record<string, unknown> }).screenshot = { declaredSha256: 'f'.repeat(64) }
    const evidence = analyze(req)
    expect(evidence.result).toBe('failed-to-run')
    expect(reasonCodes(evidence)).toEqual(['screenshot-hash-mismatch'])
    expect(evidence.inputs.candidate.screenshot.hashMatchesDeclared).toBe(false)
    expect(evidence.observation).toBeNull()
  })

  it('reports stale when the evidence belongs to another candidate, source or runtime', () => {
    const cases: Array<[Partial<VisualComparisonRequest>, SideOptions, SideOptions, string]> = [
      [{ subject: { ...expected, patchHash: 'old'.padEnd(64, '0') } }, {}, {}, 'subject.patchHash'],
      [{ subject: { ...expected, candidateId: 'cand-0' } }, {}, {}, 'subject.candidateId'],
      [{ subject: { ...expected, projectId: 'proj-0' } }, {}, {}, 'subject.projectId'],
      [{ subject: { ...expected, scopeVersion: 2 } }, {}, {}, 'subject.scopeVersion'],
      [{}, { descriptor: { sourceDigest: 'x'.repeat(64) } }, {}, 'baseline.sourceDigest'],
      [{}, {}, { descriptor: { sourceDigest: 'y'.repeat(64) } }, 'candidate.sourceDigest'],
      [{}, {}, { descriptor: { runtimeFingerprint: 'runtime-0' } }, 'candidate.runtimeFingerprint'],
    ]
    for (const [extra, baseline, candidate, field] of cases) {
      const evidence = analyze(request(baseline, candidate, extra))
      expect(evidence.result).toBe('stale')
      expect(evidence.identity.status).toBe('stale')
      expect(evidence.identity.checks.filter(item => item.status === 'mismatch').map(item => item.field)).toEqual([field])
      expect(evidence.observation).toBeNull()
    }
  })

  it('keeps identity unverified (never consistent) when no expected candidate is supplied', () => {
    const evidence = analyze(request({}, {}, { expected: null }))
    expect(evidence.identity).toMatchObject({ status: 'unverified', expectedProvided: false })
    expect(limitationCodes(evidence)).toContain('candidate-identity-unverified')
    expect(evidence.result).toBe('unknown')
  })

  it('downgrades to unverified when only one side declares projectId', () => {
    // Subject declares a project, the expected identity carries none: the
    // binding cannot be checked, so identity must degrade conservatively.
    const evidence = analyze(request({}, {}, { expected: { ...expected, projectId: undefined } }))
    expect(evidence.identity.checks.find(item => item.field === 'subject.projectId')).toMatchObject({ status: 'unknown' })
    expect(evidence.identity.status).toBe('unverified')
    expect(evidence.result).toBe('unknown')
  })

  it('ignores projectId entirely on legacy inputs where neither side declares it', () => {
    const legacy = { ...expected, projectId: undefined }
    const evidence = analyze(request({}, {}, { subject: { ...legacy, runId: 'run-1' }, expected: legacy }))
    expect(evidence.identity.checks.some(item => item.field === 'subject.projectId')).toBe(false)
    expect(evidence.identity.status).toBe('consistent')
  })

  it('refuses mismatched or unknown route, viewport, interaction state, browser and capture state', () => {
    const cases: Array<[SideOptions, SideOptions, string[]]> = [
      [{}, { descriptor: { route: '/products' } }, ['route-mismatch']],
      [{}, { descriptor: { viewport: { width: 101, height: 80 } } }, ['viewport-mismatch']],
      [{}, { descriptor: { viewport: { width: 120, height: 80 } } }, ['viewport-mismatch', 'image-viewport-inconsistent']],
      [{}, { descriptor: { interactionState: 'after:button:Open menu' } }, ['interaction-state-mismatch']],
      [{}, { descriptor: { browser: { name: 'chromium', version: '141.0' } } }, ['browser-mismatch']],
      [{}, { capture: { completed: false } }, ['capture-incomplete']],
      [{}, { capture: { completed: undefined } }, ['capture-completion-unknown']],
      [{}, { capture: { stable: false } }, ['capture-unstable']],
      [{}, { capture: { fullPage: false } }, ['capture-extent-mismatch']],
      [{}, { descriptor: { side: 'baseline' } }, ['descriptor-side-mismatch']],
      [{ descriptor: { devicePixelRatio: undefined } }, {}, ['device-pixel-ratio-unknown']],
      [{}, { descriptor: { route: undefined } }, ['route-unknown']],
      [{}, { descriptor: { interactionState: undefined } }, ['interaction-state-unknown']],
      [{ descriptor: { viewport: undefined } }, {}, ['viewport-unknown']],
    ]
    for (const [baseline, candidate, codes] of cases) {
      const evidence = analyze(request(baseline, candidate))
      expect(reasonCodes(evidence)).toEqual(codes)
      expect(evidence.result).toBe('unknown')
      expect(evidence.observation).toBeNull()
    }
  })

  it('treats different hash-router or query routes as different pages', () => {
    for (const [b, c] of [['/#/about', '/#/pricing'], ['/item?id=1', '/item?id=2'], ['/', '/#/about']]) {
      const evidence = analyze(request({ descriptor: { route: b }, geometry: null }, { descriptor: { route: c }, geometry: null }))
      expect(reasonCodes(evidence)).toEqual(['route-mismatch'])
      expect(serializeVisualEvidence(evidence).text).not.toMatch(/about|pricing|id=/)
    }
    const urls = analyze(request({ descriptor: { pageUrl: 'http://127.0.0.3:5173/#/a' } }, { descriptor: { pageUrl: 'http://127.0.0.2:5173/#/b' } }))
    expect(reasonCodes(urls)).toEqual(['route-mismatch'])
    // Same path, query and fragment on different preview origins are the same page.
    const same = analyze(request({ descriptor: { route: '/#/a', pageUrl: 'http://127.0.0.3:5173/#/a' }, geometry: null }, { descriptor: { route: '/#/a', pageUrl: 'http://127.0.0.2:5173/#/a' }, geometry: null }))
    expect(same.comparability.comparable).toBe(true)
  })

  it('requires geometry to have been sampled at the same query/fragment as the screenshot', () => {
    const hashRoute = { route: '/#/a' }
    const evidence = analyze(request({ descriptor: hashRoute, geometry: { locationSuffix: '#/a' } }, { descriptor: hashRoute, geometry: { locationSuffix: '#/b' } }))
    expect(evidence.geometry).toMatchObject({ baseline: { status: 'accepted' }, candidate: { status: 'rejected', detail: expect.stringMatching(/query string or fragment/) } })
    const unsampled = analyze(request({ descriptor: hashRoute }, { descriptor: hashRoute }))
    expect(unsampled.geometry.status).toBe('rejected')
  })

  it('flags transparent screenshots', () => {
    const translucent = (bytes: Uint8Array) => { const decoded = readPng(bytes); if (!decoded.ok) throw new Error(); const data = new Uint8Array(decoded.png.data); data[3] = 10; return encodePng(decoded.png.width, decoded.png.height, data) }
    expect(limitationCodes(analyze(request({ bytes: translucent(png(baseScene)) })))).toContain('transparent-pixels')
  })

  it('never fills unknown descriptor fields with defaults', () => {
    const evidence = analyze(request({ descriptor: { devicePixelRatio: undefined, browser: undefined }, capture: { stable: undefined, scroll: undefined } }))
    const descriptor = evidence.inputs.baseline.descriptor
    expect(descriptor.devicePixelRatio).toBeNull()
    expect(descriptor.browser).toBeNull()
    expect(descriptor.capture.stable).toBeNull()
    expect(descriptor.capture.scroll).toBeNull()
    expect(evidence.inputs.baseline.descriptorIssues).toEqual(expect.arrayContaining([
      { field: 'baseline.devicePixelRatio', problem: 'missing' }, { field: 'baseline.browser', problem: 'missing' },
    ]))
    const invalid = analyze(request({ descriptor: { devicePixelRatio: 'two', viewport: { width: -1, height: 2 } } }))
    expect(invalid.inputs.baseline.descriptor).toMatchObject({ devicePixelRatio: null, viewport: null })
    expect(invalid.inputs.baseline.descriptorIssues).toEqual(expect.arrayContaining([{ field: 'baseline.devicePixelRatio', problem: 'invalid' }, { field: 'baseline.viewport', problem: 'invalid' }]))
  })

  it('lists limitations instead of upgrading an unchanged comparison', () => {
    const evidence = analyze(request(
      { capture: { stable: undefined, animationsDisabled: false }, declare: false, geometry: null, descriptor: { browser: undefined } },
      { bytes: png(baseScene), capture: { stable: undefined }, declare: false, geometry: null },
    ))
    expect(evidence.result).toBe('unknown')
    expect(evidence.observation!.outcome).toBe('unchanged')
    expect(limitationCodes(evidence)).toEqual(['browser-unknown', 'capture-stability-unknown', 'animations-not-disabled', 'screenshot-hash-undeclared', 'geometry-unavailable', 'target-not-mapped'])
  })

  it('records viewport-only captures as not covering the rest of the page', () => {
    const evidence = analyze(request({ capture: { fullPage: false } }, { capture: { fullPage: false } }))
    expect(limitationCodes(evidence)).toContain('viewport-only-capture')
    expect(evidence.coverage).toMatchObject({ captureExtent: 'viewport', compared: true, notChecked: ['content-outside-captured-viewport'] })
  })

  it('strips credentials, query strings and fragments from recorded locations', () => {
    const evidence = analyze(request({}, { descriptor: { pageUrl: 'http://user:secret@127.0.0.2:5173/products?session=abc#frag', route: '/products?session=abc' } }))
    expect(evidence.inputs.candidate.descriptor).toMatchObject({ pageUrl: 'http://127.0.0.2:5173/products', route: '/products', locationRedacted: true })
    expect(serializeVisualEvidence(evidence).text).not.toMatch(/secret|session=abc|frag/)
  })
})

describe('visual difference evidence: DOM geometry', () => {
  it('classifies change outside the target as non-target review, not risk', () => {
    const outside: (fill: Fill) => void = fill => { fill(10, 10, 30, 10, [17, 24, 39]); fill(10, 50, 30, 12, [234, 88, 12]) }
    const evidence = analyze(request({}, { bytes: png(outside) }))
    expect(evidence.geometry).toMatchObject({ changedPixelsInsideTarget: 100, changedPixelsOutsideTarget: 360 })
    expect(evidence.observation!.regions.map(region => region.classification)).toEqual(['target', 'non-target'])
    expect(evidence.findings.find(finding => finding.code === 'change-outside-target')).toMatchObject({ severity: 'review', regionIds: ['r2'] })
    expect(evidence.result).toBe('unknown')
  })

  it('reports risk only through an explicit geometry rule on identity-consistent evidence', () => {
    const overlapScene: (fill: Fill) => void = fill => { fill(10, 10, 40, 45, [17, 24, 39]); fill(10, 50, 30, 12, [37, 99, 235]) }
    const candidate = { bytes: png(overlapScene), elements: defaultElements(40, 45) }
    const evidence = analyze(request({}, candidate))
    expect(evidence.result).toBe('risk')
    expect(evidence.geometry.risks.map(risk => [risk.rule, ...risk.elements.map(item => item.sourceRef)])).toEqual([['new-overlap', 'Hero#cta', 'Hero#h1']])
    expect(evidence.findings.filter(finding => finding.severity === 'risk')).toHaveLength(1)
    expect(evidence.geometry.displacements.map(item => [item.sourceRef, item.delta])).toEqual([['Hero#h1', { x: 0, y: 0, width: 0, height: 35 }]])
    // Same geometry, but without an expected candidate the risk cannot be attributed.
    expect(analyze(request({}, candidate, { expected: null })).result).toBe('unknown')
  })

  it('keeps changes unattributed when the declared target is absent from the sampled DOM', () => {
    const elements = [element('root', 'App', [0, 0, CSS_W, CSS_H]), element('cta', 'Hero#cta', [10, 50, 30, 12])]
    const evidence = analyze(request({ elements }, { elements }))
    expect(evidence.geometry.target).toMatchObject({ status: 'unmatched', missingRefs: ['Hero#h1'] })
    expect(evidence.observation!.regions[0]).toMatchObject({ classification: 'unattributed', insideTargetPixels: null, attribution: 'mapped' })
    expect(evidence.geometry.changedPixelsInsideTarget).toBeNull()
    expect(findingCodes(evidence)).toEqual(['change-unattributed'])
    expect(limitationCodes(evidence)).toContain('target-not-mapped')
  })

  it('does not guess a source for elements without runtime annotations', () => {
    const elements = [element('root', 'App', [0, 0, CSS_W, CSS_H]), element('title', null, [10, 10, 40, 10])]
    const evidence = analyze(request({ elements }, { elements }))
    expect(evidence.geometry.target.status).toBe('unmatched')
    expect(evidence.geometry.matching).toMatchObject({ matched: 1, unidentified: { baseline: 1, candidate: 1 } })
    expect(evidence.observation!.regions[0].elements.map(item => item.sourceRef)).toEqual([null, null, 'App', 'App'])
  })

  it('rejects geometry that cannot be mapped onto the screenshot and says why', () => {
    const cases: Array<[SideOptions, RegExp]> = [
      [{ geometry: { route: '/other' } }, /route/],
      [{ geometry: { devicePixelRatio: 2 } }, /device pixel ratio/],
      [{ geometry: { interactionState: 'hover' } }, /interaction state/],
      [{ geometry: { screenshotSha256: 'e'.repeat(64) } }, /different screenshot/],
      [{ geometry: { schema: 'v0' } }, /schema/],
      [{ capture: { fullPage: null } }, /extent/],
    ]
    for (const [candidate, detail] of cases) {
      const options = { ...candidate, ...(candidate.capture ? {} : {}) }
      const evidence = analyze(request(candidate.capture ? { capture: candidate.capture } : {}, options))
      if (candidate.capture) {
        // Unknown extent on both sides is comparable, but DOM geometry cannot be placed.
        expect(evidence.geometry.status).toBe('rejected')
      } else {
        expect(evidence.geometry.status).toBe('partial')
      }
      expect(evidence.geometry.candidate).toMatchObject({ status: 'rejected', detail: expect.stringMatching(detail) })
      expect(limitationCodes(evidence)).toContain('geometry-rejected')
      expect(evidence.geometry.risks).toEqual([])
      expect(evidence.result).toBe('unknown')
    }
  })

  it('uses one-sided geometry for classification but flags it and skips cross-version rules', () => {
    const evidence = analyze(request({ geometry: null }, {}))
    expect(evidence.geometry).toMatchObject({ status: 'partial', baseline: { status: 'missing' }, candidate: { status: 'accepted' }, matching: null, risks: [], displacements: [] })
    expect(evidence.geometry.target.status).toBe('mapped')
    expect(evidence.observation!.regions[0].classification).toBe('target')
    expect(limitationCodes(evidence)).toContain('geometry-partial')
  })

  it('records element boxes in screenshot pixels and flags geometry not bound to the screenshot bytes', () => {
    const evidence = analyze(request({ dpr: 2, bytes: png(baseScene, 2), geometry: { screenshotSha256: null } }, { dpr: 2, bytes: png(titleChanged, 2) }))
    expect(evidence.observation!.regions[0].elements[0]).toMatchObject({ sourceRef: 'Hero#h1', screenshotRect: { x: 20, y: 20, width: 80, height: 20 } })
    expect(limitationCodes(evidence)).toContain('geometry-screenshot-unbound')
  })

  it('does not let the target margin absorb a change to an adjacent sibling', () => {
    // A badge starts 1 CSS px right of the title, inside the 2 px margin ring.
    const elements = [...defaultElements(), element('badge', 'Hero#badge', [51, 10, 6, 10])]
    const before: (fill: Fill) => void = fill => { baseScene(fill); fill(51, 10, 6, 10, [37, 99, 235]) }
    const after: (fill: Fill) => void = fill => { baseScene(fill); fill(51, 10, 6, 10, [220, 38, 38]) }
    const evidence = analyze(request({ bytes: png(before), elements }, { bytes: png(after), elements }))
    expect(evidence.geometry).toMatchObject({ changedPixelsInsideTarget: 0, changedPixelsOutsideTarget: 60 })
    expect(evidence.observation!.regions[0]).toMatchObject({ classification: 'non-target' })
    // Without the sibling in the sample, the ring would count its first column as target.
    const unsampled = analyze(request({ bytes: png(before) }, { bytes: png(after) }))
    expect(unsampled.geometry.changedPixelsInsideTarget).toBe(10)
  })

  it('reports hostile or malformed geometry without throwing', () => {
    const cyclic: Record<string, unknown> = { schema: DOM_GEOMETRY_SCHEMA }
    cyclic.self = cyclic
    const huge = { ...side('candidate', {}).geometry, elements: { length: 10 ** 9 } }
    for (const geometry of [cyclic, { ...side('candidate', {}).geometry, devicePixelRatio: BigInt(2) }, huge, 'not an object', 42]) {
      const req = request()
      req.candidate.geometry = geometry
      const evidence = analyze(req)
      expect(evidence.geometry.candidate.status).toBe('rejected')
    }
    const odd = analyze({ ...request(), targets: { sourceRefs: 'Hero#h1' as unknown as string[] } })
    expect(odd.geometry.target.status).toBe('not-declared')
  })
})

describe('visual difference evidence: determinism, bounds and integration helpers', () => {
  it('is deterministic for identical inputs', () => {
    const a = serializeVisualEvidence(analyze(request()))
    const b = serializeVisualEvidence(analyze(request()))
    expect(a.sha256).toBe(b.sha256)
    expect(analyze(request()).id).toMatch(/^visual-[a-f0-9]{32}$/)
  })

  it('never returns pass', () => {
    const variants = [request(), request({}, { bytes: png(baseScene) }), request({}, { bytes: null }), request({}, { bytes: new Uint8Array([1]) }), request({}, { dpr: 2, bytes: png(titleChanged, 2) })]
    for (const variant of variants) expect(analyze(variant).result).not.toBe('pass')
  })

  it('fails closed when independently valid CSS merge distance and DPR exceed 256 device pixels', () => {
    const make = (dpr: number, mergeDistanceCssPx: number) =>
      analyzeVisualDifference(request({ dpr, geometry: null }, { dpr, geometry: null }, { parameters: { mergeDistanceCssPx } }))
    for (const [dpr, css, expectedPx] of [[8, 64, 512], [8, 32.01, 257]] as const) {
      const { evidence, diffPng } = make(dpr, css)
      expect(evidence.result).toBe('failed-to-run')
      expect(evidence.comparability.comparable).toBe(false)
      expect(evidence.observation).toBeNull()
      expect(diffPng).toBeNull()
      expect(evidence.inputs.baseline.screenshot.failure?.code).toBe('visual-analysis-resource-limit')
      expect(evidence.inputs.candidate.screenshot.failure?.code).toBe('visual-analysis-resource-limit')
      expect(evidence.inputs.baseline.screenshot.failure?.detail).toContain(String(expectedPx))
      expect(evidence.result).not.toBe('pass')
    }
  })

  it('accepts the combined 256-device-pixel grid boundary', () => {
    const evidence = analyze(request({ dpr: 4, geometry: null }, { dpr: 4, geometry: null },
      { parameters: { mergeDistanceCssPx: 64 } }))
    expect(evidence.parameters.mergeDistancePx).toBe(256)
    expect(evidence.comparability.comparable).toBe(true)
    expect(evidence.result).toBe('unknown')
    expect(evidence.observation?.outcome).toBe('changed')
  })

  it('only lets callers tighten safety limits', () => {
    expect(() => analyze(request({}, {}, { parameters: { png: { maxPixels: 10 ** 9 } } }))).toThrow(/tightened/)
    expect(() => analyze(request({}, {}, { parameters: { geometry: { maxElements: 10 ** 6 } } }))).toThrow(/tightened/)
    expect(() => analyze(request({}, {}, { parameters: { threshold: -1 } }))).toThrow(RangeError)
    const tight = analyze(request({}, {}, { parameters: { png: { maxPixels: 1000 } } }))
    expect(tight).toMatchObject({ result: 'failed-to-run', inputs: { baseline: { screenshot: { failure: { code: 'png-dimensions-out-of-bounds' } } } } })
    expect(tight.resultReason).toMatch(/exceeds the analysis size limits/)
  })

  it('bounds reported regions and records truncation', () => {
    const speckle: (fill: Fill) => void = fill => { for (let x = 0; x < 100; x += 10) for (let y = 0; y < 80; y += 10) fill(x, y, 1, 1, [0, 0, 0]) }
    const evidence = analyze(request({ bytes: png() }, { bytes: png(speckle) }, { parameters: { maxRegions: 5, mergeDistanceCssPx: 2 } }))
    expect(evidence.observation).toMatchObject({ regionCount: 80, regionsTruncated: true, changedPixels: 80 })
    expect(evidence.observation!.regions).toHaveLength(5)
  })

  it('keeps the largest regions when it has to truncate', () => {
    const scene: (fill: Fill) => void = fill => { for (let x = 0; x < 60; x += 10) fill(x, 2, 1, 1, [0, 0, 0]); fill(70, 60, 20, 15, [0, 0, 0]) }
    const evidence = analyze(request({ bytes: png() }, { bytes: png(scene) }, { parameters: { maxRegions: 2, mergeDistanceCssPx: 2 } }))
    expect(evidence.observation!.regionCount).toBe(7)
    expect(evidence.observation!.regions.map(region => [region.id, region.changedPixels])).toEqual([['r1', 1], ['r7', 300]])
  })

  it('accepts byte arrays from another JavaScript realm and refuses other screenshot inputs', () => {
    const foreign = runInNewContext('new Uint8Array(length)', { length: 0 }) as Uint8Array
    expect(foreign instanceof Uint8Array).toBe(false)
    const bytes = png(titleChanged)
    const copy = runInNewContext('new Uint8Array(source)', { source: Array.from(bytes) }) as Uint8Array
    const req = request()
    req.candidate.screenshot = copy
    expect(analyze(req).observation?.outcome).toBe('changed')
    req.candidate.screenshot = { not: 'bytes' } as never
    expect(analyze(req)).toMatchObject({ result: 'failed-to-run', inputs: { candidate: { screenshot: { failure: { code: 'screenshot-input-invalid' } } } } })
  })

  it('stays bounded on a large full-page capture with many elements and many regions', () => {
    const width = 1440, height = 6000
    const a = new Uint8Array(width * height * 4).fill(255)
    const b = new Uint8Array(a)
    for (let y = 0; y < height; y += 37) for (let x = (y * 7) % 50; x < width; x += 53) b.set([0, 0, 0, 255], (y * width + x) * 4)
    const elements = Array.from({ length: 1500 }, (_, index) => element(`e${index}`, `src/List.tsx#item:${index}`, [(index % 10) * 140, Math.floor(index / 10) * 40, 130, 30], { parentId: null }))
    const descriptor = (name: 'baseline' | 'candidate', bytes: Uint8Array) => ({ ...side(name, { bytes, elements }).descriptor, viewport: { width, height: 900 } })
    const geometry = (name: 'baseline' | 'candidate', bytes: Uint8Array) => ({ ...side(name, { bytes, elements }).geometry!, viewport: { width, height: 900 }, documentSize: { width, height } })
    const baseline = encodePng(width, height, a), candidate = encodePng(width, height, b)
    const started = Date.now()
    const evidence = analyze({
      ...request(), targets: { sourceRefs: ['src/List.tsx#item:3'] },
      baseline: { descriptor: descriptor('baseline', baseline), screenshot: baseline, geometry: geometry('baseline', baseline) },
      candidate: { descriptor: descriptor('candidate', candidate), screenshot: candidate, geometry: geometry('candidate', candidate) },
    })
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(evidence.comparability.comparable).toBe(true)
    expect(evidence.observation!.regionCount).toBeGreaterThan(1000)
    expect(evidence.observation!.regions).toHaveLength(100)
    expect(evidence.geometry.matching).toMatchObject({ matched: 1500, stableMatched: 1500 })
    expect(serializeVisualEvidence(evidence).bytes.length).toBeLessThan(512 * 1024)
  })

  it('records algorithm, parameters and environment', () => {
    const evidence = analyze(request())
    expect(evidence.parameters).toMatchObject({ algorithm: { name: 'pixelmatch', colorMetric: 'OKLab HyAB' }, decoder: { name: 'pngjs' }, threshold: 0.03, includeAA: false, mergeDistanceCssPx: 8, targetMarginCssPx: 2 })
    expect(evidence.parameters.algorithm.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(evidence.environment).toMatchObject({ runtime: 'node', nodeVersion: process.version })
  })

  it('projects onto VerificationEvidence only for its own check, without inventing values or a pass', () => {
    const evidence = analyze(request())
    const check = { id: 'check-1', route: '/', viewport: { width: CSS_W, height: CSS_H }, state: 'rendered' }
    const artifact = { path: 'visual/check-1.json', sha256: 'a'.repeat(64) }
    const projected = toVerificationEvidence(evidence, check, artifact)
    expect(projected).toMatchObject({ id: evidence.id, checkId: 'check-1', result: 'unknown', pageUrl: 'http://127.0.0.2:5173/', runtimeState: 'rendered', artifactPath: 'visual/check-1.json', artifactHash: 'a'.repeat(64), capturedAt: '2026-10-21T01:02:03.000Z' })
    expect(projected.elementRefs).toEqual(['App', 'Hero#h1'])
    expect(() => toVerificationEvidence(evidence, { ...check, viewport: { width: 1440, height: 900 } }, artifact)).toThrow(VisualEvidenceProjectionError)
    expect(() => toVerificationEvidence(evidence, { ...check, route: '/checkout' }, artifact)).toThrow(VisualEvidenceProjectionError)
    expect(() => toVerificationEvidence(evidence, { ...check, route: '/#/checkout' }, artifact)).toThrow(VisualEvidenceProjectionError)
    expect(() => toVerificationEvidence(evidence, { ...check, state: 'after:button:Menu' }, artifact)).toThrow(VisualEvidenceProjectionError)
    expect(() => toVerificationEvidence(evidence, { ...check, id: 'mobile-390' }, artifact)).toThrow(VisualEvidenceProjectionError)
    const missing = analyze(request({}, { bytes: null, descriptor: { pageUrl: undefined }, capture: { capturedAt: undefined } }))
    expect(toVerificationEvidence(missing, check, artifact)).toMatchObject({ result: 'not-run', pageUrl: 'unknown', capturedAt: 'unknown' })
    expect(() => toVerificationEvidence(analyze(request({}, { descriptor: { interactionState: undefined } })), check, artifact)).toThrow(VisualEvidenceProjectionError)
  })

  it('never assigns a check identity while projecting exploratory evidence', () => {
    const check = { id: 'check-1', route: '/', viewport: { width: CSS_W, height: CSS_H }, state: 'rendered' }
    const artifact = { path: 'visual/check-1.json', sha256: 'a'.repeat(64) }
    for (const missing of [null, '']) {
      const exploratory = analyze(request({}, {}, { checkId: missing }))
      expect(exploratory.checkId).toBe(missing)
      expect(() => toVerificationEvidence(exploratory, check, artifact)).toThrow(VisualEvidenceProjectionError)
    }
    expect(() => toVerificationEvidence(analyze(request({}, {}, { checkId: 'other' })), check, artifact)).toThrow(VisualEvidenceProjectionError)
    expect(toVerificationEvidence(analyze(request({}, {}, { checkId: 'check-1' })), check, artifact).checkId).toBe('check-1')
  })

  it('keeps geometry findings advisory until both screenshots and geometry are SHA-bound and stable', () => {
    const overlapScene: (fill: Fill) => void = fill => { fill(10, 10, 40, 45, [17, 24, 39]); fill(10, 50, 30, 12, [37, 99, 235]) }
    const candidate = { bytes: png(overlapScene), elements: defaultElements(40, 45) }
    const scenarios: Array<[string, SideOptions, SideOptions]> = [
      ['baseline producer hash absent', { declare: false }, candidate],
      ['candidate producer hash absent', {}, { ...candidate, declare: false }],
      ['baseline geometry hash absent', { geometry: { screenshotSha256: null } }, candidate],
      ['candidate geometry hash absent', {}, { ...candidate, geometry: { screenshotSha256: null } }],
      ['capture stable unknown', { capture: { stable: undefined } }, candidate],
      ['animations disabled unknown', {}, { ...candidate, capture: { animationsDisabled: undefined } }],
      ['fonts not ready', {}, { ...candidate, capture: { fontsReady: false } }],
    ]
    for (const [name, baseline, changed] of scenarios) {
      const evidence = analyze(request(baseline, changed))
      expect(evidence.result, name).toBe('unknown')
      expect(evidence.geometry.risks, name).toHaveLength(1)
      expect(limitationCodes(evidence), name).toContain('risk-provenance-incomplete')
      expect(evidence.findings.some(f => f.code === 'geometry-risk'), name).toBe(true)
    }
    for (const bad of [
      request({ descriptor: { screenshot: { declaredSha256: 'e'.repeat(64) } } }, candidate),
      request({}, { ...candidate, descriptor: { screenshot: { declaredSha256: 'e'.repeat(64) } } }),
    ]) {
      const evidence = analyze(bad)
      expect(evidence.result).toBe('failed-to-run')
      expect(reasonCodes(evidence)).toContain('screenshot-hash-mismatch')
      expect(evidence.observation).toBeNull()
    }
    const bound = analyze(request({}, candidate))
    expect(bound.result).toBe('risk')
    expect(limitationCodes(bound)).not.toContain('risk-provenance-incomplete')
  })

  it('rejects traversal, drive paths, control characters and ambiguous diff artifact paths', () => {
    for (const invalid of ['/tmp/diff.png', '../diff.png', 'a/../diff.png', 'a/./diff.png', 'a//diff.png',
      'C:/diff.png', 'C:\\diff.png', 'a\\b.png', 'bad\nname.png', '', '.']) {
      expect(() => analyzeVisualDifference(request({}, {}, { diffArtifactPath: invalid })), invalid).toThrow(RangeError)
    }
    expect(analyze(request({}, {}, { diffArtifactPath: 'visual/sha-123.png' })).observation?.diffImage?.artifactPath).toBe('visual/sha-123.png')
  })

  it('fails closed before decoding screenshots when mergeDistanceCssPx=1 exceeds its grid budget', () => {
    const large = encodePng(1500, 1500, new Uint8Array(1500 * 1500 * 4).fill(255))
    const evidence = analyze(request({ bytes: large, geometry: null }, { bytes: large, geometry: null }, { parameters: { mergeDistanceCssPx: 1 } }))
    expect(evidence.result).toBe('failed-to-run')
    expect(evidence.inputs.baseline.screenshot.failure?.code).toBe('visual-analysis-resource-limit')
    expect(evidence.observation).toBeNull()
    expect(evidence.coverage.compared).toBe(false)
  })

  it('rolls several evidences into an advisory assertion that cannot pass', () => {
    expect(summarizeVisualEvidence([])).toMatchObject({ id: 'visual-difference', result: 'not-run' })
    const unknown = analyze(request())
    const missing = analyze(request({}, { bytes: null }))
    const stale = analyze(request({}, {}, { subject: { ...expected, patchHash: '0'.repeat(64) } }))
    expect(summarizeVisualEvidence([unknown]).result).toBe('unknown')
    expect(summarizeVisualEvidence([unknown, missing]).result).toBe('not-run')
    expect(summarizeVisualEvidence([unknown, missing, stale])).toMatchObject({ result: 'stale', detail: expect.stringMatching(/cannot produce PASS/) })
  })

  it('lists which planned checks were compared, not comparable or never run for the expected candidate', () => {
    const compared = analyze(request())
    const mismatched = analyze(request({}, { descriptor: { interactionState: 'after:button:Menu' } }))
    const plan = [
      { checkId: 'check-1', route: '/', viewport: { width: CSS_W, height: CSS_H }, interactionState: 'rendered' },
      { route: '/', viewport: { width: CSS_W, height: CSS_H }, interactionState: 'after:button:Menu' },
      { route: '/products', viewport: { width: CSS_W, height: CSS_H }, interactionState: 'rendered' },
      { route: '/', viewport: { width: CSS_W, height: CSS_H }, interactionState: 'rendered', devicePixelRatio: 2 },
    ]
    const summary = summarizeVisualCoverage(plan, [compared, mismatched], expected)
    expect(summary.entries.map(entry => [entry.route, entry.interactionState, entry.status, entry.result])).toEqual([
      ['/', 'rendered', 'compared', 'unknown'],
      ['/', 'after:button:Menu', 'not-comparable', 'unknown'],
      ['/products', 'rendered', 'missing', 'not-run'],
      ['/', 'rendered', 'missing', 'not-run'],
    ])
    expect(summary).toMatchObject({ compared: 1, notComparable: 1, missing: 2, unplannedEvidenceIds: [], excludedEvidence: [] })
  })

  it('does not let evidence for another candidate cover a check or hide a newer failure', () => {
    const older = { ...expected, patchHash: 'o'.repeat(64) }
    const oldCompared = analyze(request({}, {}, { subject: { ...older }, expected: older }))
    const currentFailed = analyze(request({}, { bytes: new Uint8Array([1, 2, 3]) }))
    const unverified = analyze(request({}, {}, { expected: null }))
    const plan = [{ route: '/', viewport: { width: CSS_W, height: CSS_H }, interactionState: 'rendered' }]
    const summary = summarizeVisualCoverage(plan, [oldCompared, currentFailed, unverified], expected)
    expect(summary.entries[0]).toMatchObject({ status: 'not-comparable', result: 'failed-to-run', evidenceIds: [currentFailed.id] })
    expect(summary.excludedEvidence.map(item => item.id)).toEqual([oldCompared.id, unverified.id])
    expect(summarizeVisualCoverage(plan, [oldCompared], expected).entries[0]).toMatchObject({ status: 'missing', result: 'not-run' })
    // A plan item that names its check only accepts evidence recorded for that check.
    expect(summarizeVisualCoverage([{ ...plan[0], checkId: 'other' }], [analyze(request())], expected).entries[0].status).toBe('missing')
  })
})

describe('screenshot file intake', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-visual-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads regular files and refuses links, special files and oversized files', () => {
    const file = path.join(dir, 'shot.png')
    fs.writeFileSync(file, png())
    expect(readScreenshotFile(file)).toBeInstanceOf(Uint8Array)
    expect(readScreenshotFile(path.join(dir, 'missing.png'))).toBeNull()
    fs.symlinkSync(file, path.join(dir, 'link.png'))
    expect(readScreenshotFile(path.join(dir, 'link.png'))).toMatchObject({ unreadable: 'not-regular-file' })
    expect(readScreenshotFile(dir)).toMatchObject({ unreadable: expect.stringMatching(/not-regular-file|read-failed/) })
    expect(readScreenshotFile(file, { maxBytes: 10 })).toMatchObject({ unreadable: 'too-large' })
    // Confinement resolves symbolic links in parent directories too.
    const evidenceDir = path.join(dir, 'evidence')
    fs.mkdirSync(evidenceDir)
    fs.writeFileSync(path.join(evidenceDir, 'inside.png'), png())
    fs.symlinkSync(dir, path.join(evidenceDir, 'escape'))
    expect(readScreenshotFile(path.join(evidenceDir, 'inside.png'), { root: evidenceDir })).toBeInstanceOf(Uint8Array)
    expect(readScreenshotFile(path.join(evidenceDir, 'escape', 'shot.png'), { root: evidenceDir })).toMatchObject({ unreadable: 'not-regular-file' })
    expect(readScreenshotFile(path.join(evidenceDir, '..', 'shot.png'), { root: evidenceDir })).toMatchObject({ unreadable: 'not-regular-file' })
    if (process.platform !== 'win32') {
      const fifo = path.join(dir, 'fifo.png')
      execFileSync('mkfifo', [fifo])
      expect(readScreenshotFile(fifo)).toMatchObject({ unreadable: 'not-regular-file' })
    }
    const req = request()
    req.candidate.screenshot = readScreenshotFile(path.join(dir, 'link.png'))
    const evidence = analyze(req)
    expect(evidence).toMatchObject({ result: 'failed-to-run', inputs: { candidate: { screenshot: { status: 'invalid', failure: { code: 'screenshot-not-regular-file' } } } } })
  })
})
