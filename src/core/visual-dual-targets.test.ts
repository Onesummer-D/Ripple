// Dual-side (baseline/candidate) sourceRef alignment tests.
//
// Pins the precise cross-version contract against the C+D source-identity
// semantics (PR #28): a sourceRef is `jsx:<file>#<offset>` and the offset
// shifts when the candidate moves the JSX node, so the flat union can never
// map. Provenance comes only from exact sourceRef equality, the source file
// parsed out of the ref, runtimeInstanceId equality and the annotated
// certainty — never from rendered text, DOM position or asset URLs.
import { describe, expect, it } from 'vitest'
import { normalizeVisualCaptureDescriptor } from './visual-capture'
import { DOM_GEOMETRY_SCHEMA, pairCrossVersionElements, parseDomGeometrySample, sourceFileFromSourceRef, type DomGeometrySample } from './visual-geometry'
import { analyzeVisualDifference } from './visual-evidence'
import { encodePng, sha256Hex } from './visual-png'

type Element = Record<string, unknown>
const el = (id: string, sourceRef: string | null, rect: [number, number, number, number], extra: Element = {}): Element => ({
  id, parentId: null, sourceRef,
  runtimeInstanceId: sourceRef ? `/:${id}` : null,
  identityCertainty: sourceRef ? 'stable-react-instance' : null,
  rect: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] }, clipRect: null, visible: true, ...extra,
})
const rawSample = (side: 'baseline' | 'candidate', elements: Element[], extra: Record<string, unknown> = {}) => ({
  schema: DOM_GEOMETRY_SCHEMA, side, route: '/', viewport: { width: 60, height: 40 }, devicePixelRatio: 1, interactionState: 'rendered',
  coordinateSpace: 'document', scroll: { x: 0, y: 0 }, documentSize: { width: 60, height: 40 }, screenshotSha256: null, elements, ...extra,
})
function sample(side: 'baseline' | 'candidate', elements: Element[], screenshotSha256: string | null = null): DomGeometrySample {
  const parsed = parseDomGeometrySample(rawSample(side, elements, screenshotSha256 ? { screenshotSha256 } : {}), side)
  if (!parsed.ok) throw new Error(parsed.detail)
  return parsed.sample
}

describe('cross-version pairing proof ladder', () => {
  it('parses the source file out of a C+D sourceRef and nothing else', () => {
    expect(sourceFileFromSourceRef('jsx:src/App.tsx#120')).toBe('src/App.tsx')
    expect(sourceFileFromSourceRef('jsx:src/deep/dir/Footer.tsx#9')).toBe('src/deep/dir/Footer.tsx')
    expect(sourceFileFromSourceRef('jsx:src/App.tsx')).toBeNull()
    expect(sourceFileFromSourceRef('data:copy#1')).toBeNull()
    expect(sourceFileFromSourceRef(null)).toBeNull()
  })

  it('首页标题修改后 JSX 位置偏移: same file + stable instance id pairs at instance level', () => {
    const baseline = sample('baseline', [el('h1', 'jsx:src/App.tsx#100', [4, 4, 50, 12])])
    const candidate = sample('candidate', [el('h1', 'jsx:src/App.tsx#156', [4, 4, 50, 12])])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceProven).toHaveLength(1)
    expect(pairing.instanceProven[0].reasons).toEqual([])
    expect(pairing.instanceProven[0].sourceRef).toEqual({ baseline: 'jsx:src/App.tsx#100', candidate: 'jsx:src/App.tsx#156' })
    expect(pairing.sourceFileProven).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(0)
    expect(pairing.baselineOnly).toHaveLength(0)
    expect(pairing.candidateOnly).toHaveLength(0)
  })

  it('共享 Footer 两页消费: a duplicated instance id pairs at nothing', () => {
    const baseline = sample('baseline', [el('f1', 'jsx:src/Footer.tsx#8', [0, 30, 60, 10], { runtimeInstanceId: '/:footer' }), el('f2', 'jsx:src/Footer.tsx#8', [0, 0, 60, 10], { runtimeInstanceId: '/:footer' })])
    const candidate = sample('candidate', [el('f1', 'jsx:src/Footer.tsx#8', [0, 30, 60, 10], { runtimeInstanceId: '/:footer' }), el('f2', 'jsx:src/Footer.tsx#8', [0, 0, 60, 10], { runtimeInstanceId: '/:footer' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceProven).toHaveLength(0)
    expect(pairing.unproven.every(pair => pair.reasons.includes('duplicate-runtime-instance'))).toBe(true)
    expect(pairing.unproven.length).toBe(4)
  })

  it('同源不同运行时实例: same sourceRef but different instance ids stay per-side', () => {
    const baseline = sample('baseline', [el('a', 'jsx:src/App.tsx#40', [0, 0, 20, 10], { runtimeInstanceId: '/:a' })])
    const candidate = sample('candidate', [el('b', 'jsx:src/App.tsx#40', [0, 0, 20, 10], { runtimeInstanceId: '/:b' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceProven).toHaveLength(0)
    expect(pairing.sourceFileProven).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(0)
    expect(pairing.baselineOnly).toHaveLength(1)
    expect(pairing.candidateOnly).toHaveLength(1)
  })

  it('RouterProvider 下实例身份 unknown: never stronger than source-file proof', () => {
    const baseline = sample('baseline', [el('r', 'jsx:src/App.tsx#64', [0, 0, 30, 10], { identityCertainty: 'unknown' })])
    const candidate = sample('candidate', [el('r', 'jsx:src/App.tsx#64', [0, 0, 30, 10], { identityCertainty: 'unknown' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceProven).toHaveLength(0)
    // Same sourceRef is source-level evidence; the unstable identity is recorded.
    expect(pairing.sourceFileProven).toHaveLength(1)
    expect(pairing.sourceFileProven[0].reasons).toContain('identity-not-stable')
  })

  it('baseline/candidate 来源不一致: same instance id from different files is unproven', () => {
    const baseline = sample('baseline', [el('x', 'jsx:src/A.tsx#10', [0, 0, 20, 10])])
    const candidate = sample('candidate', [el('x', 'jsx:src/B.tsx#10', [0, 0, 20, 10])])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceProven).toHaveLength(0)
    expect(pairing.sourceFileProven).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(1)
    expect(pairing.unproven[0].reasons).toContain('different-source-file')
  })

  it('position-dependent identity cannot reach instance level even with the same id and file', () => {
    const baseline = sample('baseline', [el('p', 'jsx:src/List.tsx#22', [0, 0, 20, 10], { identityCertainty: 'position-dependent' })])
    const candidate = sample('candidate', [el('p', 'jsx:src/List.tsx#22', [0, 0, 20, 10], { identityCertainty: 'position-dependent' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceProven).toHaveLength(0)
    expect(pairing.sourceFileProven).toHaveLength(1)
    expect(pairing.sourceFileProven[0].reasons).toContain('position-dependent-identity')
  })
})

// --- Analysis-level dual-target scenarios -----------------------------------

const IDENTITY = {
  candidateId: 'candidate-dual-1', projectId: 'project-dual-1',
  patchHash: 'p'.repeat(64), baseSourceDigest: 'b'.repeat(64), candidateTreeDigest: 'c'.repeat(64),
  runtimeFingerprint: 'dual-test-runtime', scopeDecisionId: 'scope-dual-1', scopeVersion: 1,
}

const rgba = (width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]) => {
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = paint(x, y)
    const at = (y * width + x) * 4
    bytes[at] = r; bytes[at + 1] = g; bytes[at + 2] = b; bytes[at + 3] = a
  }
  return bytes
}

function sideInput(kind: 'baseline' | 'candidate', elements: Element[], pngBytes: Uint8Array) {
  const sha256 = sha256Hex(pngBytes)
  const descriptor = normalizeVisualCaptureDescriptor({
    side: kind, route: '/', viewport: { width: 60, height: 40 }, devicePixelRatio: 1, interactionState: 'rendered',
    sourceDigest: kind === 'baseline' ? IDENTITY.baseSourceDigest : IDENTITY.candidateTreeDigest,
    capture: { completed: true, stable: true, fullPage: true, scroll: { x: 0, y: 0 } },
    screenshot: { declaredSha256: sha256 },
  }, kind).descriptor
  const geometry = { ...rawSample(kind, elements, { screenshotSha256: sha256 }), elements }
  return { descriptor, screenshot: pngBytes, geometry }
}

/** White page; the candidate paints a 10x10 block inside the h1 rect (4,4)-(54,24). */
const baselinePng = () => encodePng(60, 40, rgba(60, 40, () => [255, 255, 255, 255]))
const candidatePngInTarget = () => encodePng(60, 40, rgba(60, 40, (x, y) => (x >= 6 && x < 16 && y >= 6 && y < 16 ? [200, 30, 30, 255] : [255, 255, 255, 255])))
const candidatePngOutsideTarget = () => encodePng(60, 40, rgba(60, 40, (x, y) => (x >= 40 && x < 50 && y >= 30 && y < 38 ? [200, 30, 30, 255] : [255, 255, 255, 255])))

const H1_BASELINE = 'jsx:src/App.tsx#100'
const H1_CANDIDATE = 'jsx:src/App.tsx#156'
const FOOTER = 'jsx:src/Footer.tsx#8'
const h1 = (ref: string): Element => el('h1', ref, [4, 4, 50, 20])
/** Two footer instances rendered from the same JSX source: same instance id on
 * purpose — a duplicated id proves nothing (same-source consumers). */
const footer = (id: string): Element => el(id, FOOTER, id === 'f1' ? [0, 28, 60, 12] : [0, 0, 60, 10], { runtimeInstanceId: '/:footer' })

describe('dual targets in analysis', () => {
  it('位置偏移目标: dual 声明双侧各自映射为 mapped，平铺并集只能 partial', () => {
    const baseline = sideInput('baseline', [h1(H1_BASELINE), footer('f1')], baselinePng())
    const candidate = sideInput('candidate', [h1(H1_CANDIDATE), footer('f1')], candidatePngInTarget())

    const dual = analyzeVisualDifference({
      checkId: 'dual-shift', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: [H1_BASELINE, H1_CANDIDATE], dual: { baseline: [H1_BASELINE], candidate: [H1_CANDIDATE] } },
      baseline, candidate, diffArtifactPath: 'dual-shift/diff.png',
    })
    expect(dual.evidence.geometry?.target.status).toBe('mapped')
    expect(dual.evidence.geometry?.target.dual?.baseline.missingRefs).toEqual([])
    expect(dual.evidence.geometry?.target.dual?.candidate.missingRefs).toEqual([])
    expect(dual.evidence.geometry?.crossVersion?.instanceProven).toBe(2)
    expect(dual.evidence.geometry?.crossVersion?.baselineOnly).toBe(0)
    expect(dual.evidence.geometry?.matching?.matched).toBe(1) // legacy exact-ref matching still sees the footer only
    const region = dual.evidence.observation?.regions[0]
    expect(region?.classification).toBe('target')
    expect(dual.evidence.result).toBe('unknown')

    const flat = analyzeVisualDifference({
      checkId: 'flat-shift', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: [H1_BASELINE, H1_CANDIDATE] },
      baseline, candidate, diffArtifactPath: 'flat-shift/diff.png',
    })
    expect(flat.evidence.geometry?.target.status).toBe('partial')
    expect(flat.evidence.geometry?.target.missingRefs.sort()).toEqual([H1_BASELINE, H1_CANDIDATE].sort())
  })

  it('无法证明的跨页面消费者: change outside every target stays non-target and is never upgraded', () => {
    const baseline = sideInput('baseline', [h1(H1_BASELINE), footer('f1')], baselinePng())
    const candidate = sideInput('candidate', [h1(H1_CANDIDATE), footer('f1')], candidatePngOutsideTarget())
    const outcome = analyzeVisualDifference({
      checkId: 'dual-outside', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: [H1_BASELINE, H1_CANDIDATE], dual: { baseline: [H1_BASELINE], candidate: [H1_CANDIDATE] } },
      baseline, candidate, diffArtifactPath: 'dual-outside/diff.png',
    })
    expect(outcome.evidence.geometry?.target.status).toBe('mapped')
    const region = outcome.evidence.observation?.regions[0]
    expect(region?.classification).toBe('non-target')
    expect(outcome.evidence.findings.some(finding => finding.code === 'change-outside-target')).toBe(true)
    expect(outcome.evidence.result).toBe('unknown')
  })

  it('无明确目标但视觉像素确实变化: compared, not-declared, never pass', () => {
    const baseline = sideInput('baseline', [h1(H1_BASELINE)], baselinePng())
    const candidate = sideInput('candidate', [h1(H1_CANDIDATE)], candidatePngInTarget())
    const outcome = analyzeVisualDifference({
      checkId: 'dual-no-target', subject: IDENTITY, expected: IDENTITY,
      baseline, candidate, diffArtifactPath: 'dual-no-target/diff.png',
    })
    expect(outcome.evidence.result).toBe('unknown')
    expect(outcome.evidence.geometry?.target.status).toBe('not-declared')
    expect(outcome.evidence.comparability.limitations.some(limitation => limitation.code === 'target-not-declared')).toBe(true)
    expect(outcome.evidence.observation && outcome.evidence.observation.changedPixels > 0).toBe(true)
  })

  it('候选版本来源失效: identity stale, geometry rules not evaluated', () => {
    const baseline = sideInput('baseline', [h1(H1_BASELINE)], baselinePng())
    const candidateSide = sideInput('candidate', [h1(H1_CANDIDATE)], candidatePngInTarget())
    candidateSide.descriptor = { ...candidateSide.descriptor, sourceDigest: 'e'.repeat(64) }
    const outcome = analyzeVisualDifference({
      checkId: 'dual-stale', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: [], dual: { baseline: [H1_BASELINE], candidate: [H1_CANDIDATE] } },
      baseline, candidate: candidateSide, diffArtifactPath: 'dual-stale/diff.png',
    })
    expect(outcome.evidence.identity.status).toBe('stale')
    expect(outcome.evidence.result).toBe('stale')
  })

  it('共享 Footer 被改且无法证明实例: dual 报告记录 unproven，不升级', () => {
    const baseline = sideInput('baseline', [h1(H1_BASELINE), footer('f1'), footer('f2')], baselinePng())
    const candidate = sideInput('candidate', [h1(H1_CANDIDATE), footer('f1'), footer('f2')], candidatePngInTarget())
    const outcome = analyzeVisualDifference({
      checkId: 'dual-footer', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: [H1_BASELINE, H1_CANDIDATE], dual: { baseline: [H1_BASELINE], candidate: [H1_CANDIDATE] } },
      baseline, candidate, diffArtifactPath: 'dual-footer/diff.png',
    })
    const cross = outcome.evidence.geometry?.crossVersion
    expect(cross?.instanceProven).toBe(1)
    expect(cross?.unproven).toBe(4)
    expect(cross?.pairs.filter(pair => pair.proof === 'unproven').every(pair => pair.reasons.includes('duplicate-runtime-instance'))).toBe(true)
  })
})
