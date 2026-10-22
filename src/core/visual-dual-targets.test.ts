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
import { toVisualEvidenceView } from './visual-evidence-view'
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

  it('首页标题修改后 JSX 位置偏移: same file + stable instance id pairs at instance-candidate level', () => {
    const baseline = sample('baseline', [el('h1', 'jsx:src/App.tsx#100', [4, 4, 50, 12])])
    const candidate = sample('candidate', [el('h1', 'jsx:src/App.tsx#156', [4, 4, 50, 12])])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(1)
    expect(pairing.instanceCandidate[0].reasons).toEqual([])
    expect(pairing.instanceCandidate[0].sourceRef).toEqual({ baseline: 'jsx:src/App.tsx#100', candidate: 'jsx:src/App.tsx#156' })
    expect(pairing.sameSourceRefObserved).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(0)
    expect(pairing.baselineOnly).toHaveLength(0)
    expect(pairing.candidateOnly).toHaveLength(0)
    // A candidate pairing is NOT a C+D strict instance proof: the scope says
    // which strict-proof inputs are missing, and they are missing here.
    expect(pairing.scope.level).toBe('annotation-pairing')
    expect(pairing.scope.strictInstanceProofAvailable).toBe(false)
    expect(pairing.scope.missingEvidence).toEqual(['source-version', 'page-context', 'collection-reasons', 'graph-membership'])
  })

  it('共享 Footer 两页消费: a duplicated instance id pairs at nothing', () => {
    const baseline = sample('baseline', [el('f1', 'jsx:src/Footer.tsx#8', [0, 30, 60, 10], { runtimeInstanceId: '/:footer' }), el('f2', 'jsx:src/Footer.tsx#8', [0, 0, 60, 10], { runtimeInstanceId: '/:footer' })])
    const candidate = sample('candidate', [el('f1', 'jsx:src/Footer.tsx#8', [0, 30, 60, 10], { runtimeInstanceId: '/:footer' }), el('f2', 'jsx:src/Footer.tsx#8', [0, 0, 60, 10], { runtimeInstanceId: '/:footer' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.unproven.every(pair => pair.reasons.includes('duplicate-runtime-instance'))).toBe(true)
    expect(pairing.unproven.length).toBe(4)
  })

  it('同源不同运行时实例: same sourceRef but different instance ids stay per-side', () => {
    const baseline = sample('baseline', [el('a', 'jsx:src/App.tsx#40', [0, 0, 20, 10], { runtimeInstanceId: '/:a' })])
    const candidate = sample('candidate', [el('b', 'jsx:src/App.tsx#40', [0, 0, 20, 10], { runtimeInstanceId: '/:b' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.sameSourceRefObserved).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(0)
    expect(pairing.baselineOnly).toHaveLength(1)
    expect(pairing.candidateOnly).toHaveLength(1)
  })

  it('RouterProvider 下实例身份 unknown: never stronger than source-level observation', () => {
    const baseline = sample('baseline', [el('r', 'jsx:src/App.tsx#64', [0, 0, 30, 10], { identityCertainty: 'unknown' })])
    const candidate = sample('candidate', [el('r', 'jsx:src/App.tsx#64', [0, 0, 30, 10], { identityCertainty: 'unknown' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    // Same sourceRef string is an observation only; the unstable identity is recorded.
    expect(pairing.sameSourceRefObserved).toHaveLength(1)
    expect(pairing.sameSourceRefObserved[0].reasons).toContain('identity-not-stable')
  })

  it('baseline/candidate 来源不一致: same instance id from different files is unproven', () => {
    const baseline = sample('baseline', [el('x', 'jsx:src/A.tsx#10', [0, 0, 20, 10])])
    const candidate = sample('candidate', [el('x', 'jsx:src/B.tsx#10', [0, 0, 20, 10])])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.sameSourceRefObserved).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(1)
    expect(pairing.unproven[0].reasons).toContain('different-source-file')
  })

  it('position-dependent identity cannot reach instance level even with the same id and file', () => {
    const baseline = sample('baseline', [el('p', 'jsx:src/List.tsx#22', [0, 0, 20, 10], { identityCertainty: 'position-dependent' })])
    const candidate = sample('candidate', [el('p', 'jsx:src/List.tsx#22', [0, 0, 20, 10], { identityCertainty: 'position-dependent' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.sameSourceRefObserved).toHaveLength(1)
    expect(pairing.sameSourceRefObserved[0].reasons).toContain('position-dependent-identity')
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

function sideInput(kind: 'baseline' | 'candidate', elements: Element[], pngBytes: Uint8Array, sampleExtra: Record<string, unknown> = {}) {
  const sha256 = sha256Hex(pngBytes)
  const descriptor = normalizeVisualCaptureDescriptor({
    side: kind, route: '/', viewport: { width: 60, height: 40 }, devicePixelRatio: 1, interactionState: 'rendered',
    sourceDigest: kind === 'baseline' ? IDENTITY.baseSourceDigest : IDENTITY.candidateTreeDigest,
    capture: { completed: true, stable: true, fullPage: true, scroll: { x: 0, y: 0 } },
    screenshot: { declaredSha256: sha256 },
  }, kind).descriptor
  const geometry = { ...rawSample(kind, elements, { screenshotSha256: sha256, ...sampleExtra }), elements }
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
    expect(dual.evidence.geometry?.crossVersion?.instanceCandidate).toBe(2)
    expect(dual.evidence.geometry?.crossVersion?.scope.strictInstanceProofAvailable).toBe(false)
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
    expect(cross?.instanceCandidate).toBe(1)
    expect(cross?.unproven).toBe(4)
    expect(cross?.scope.strictInstanceProofAvailable).toBe(false)
    expect(cross?.pairs.filter(pair => pair.proof === 'unproven').every(pair => pair.reasons.includes('duplicate-runtime-instance'))).toBe(true)
  })
})

// --- P1 negative cases: strict-proof downgrades --------------------------------
//
// These pin the review-mandated counter-examples. They assert the VISIBLE
// proof level of the final evidence / view model wherever the scenario can be
// driven end-to-end — never only the internal pairing arrays.

describe('P1 negative cases: strict-proof downgrades', () => {
  const V1 = '1'.repeat(64)
  const V2 = '2'.repeat(64)

  it('反例1 两侧合法修订版本不同(H1!=H2 均有效): 不得仅因版本不同标记失效', () => {
    // Baseline App.tsx hash H1 matches its own revision; candidate hash H2
    // matches candidate's revision. Different revisions are EXPECTED to
    // differ — without per-side expected digests the version evidence is
    // UNVERIFIED (stays in scope.missingEvidence) but must NOT downgrade.
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const candidate = sample('candidate', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const withVersions = (s: DomGeometrySample, v: string): DomGeometrySample => ({ ...s, sourceFileVersions: { 'src/App.tsx': v } })
    const pairing = pairCrossVersionElements(withVersions(baseline, V1), withVersions(candidate, V2))
    expect(pairing.instanceCandidate).toHaveLength(1)
    expect(pairing.unproven).toHaveLength(0)
    // 未核验 ≠ 失效：没有各自图谱预期摘要时保留未核验状态。
    expect(pairing.scope.missingEvidence).toContain('source-version')
    expect(pairing.scope.strictInstanceProofAvailable).toBe(false)
  })

  it('反例2 runtimeInstanceId 相同但 pageContext 不同: 禁止实例候选配对', () => {
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const onAbout = sample('candidate', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const candidate: DomGeometrySample = { ...onAbout, route: '/about' }
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(1)
    expect(pairing.unproven[0].reasons).toContain('different-page-context')
  })

  it('反例3 采集版本与该侧图谱预期摘要不符: 真正的 source-version-mismatch', () => {
    // Candidate served V2, but candidate's own SourceGraph revision expects
    // V3 for App.tsx — a per-side contradiction, the only valid source of
    // source-version-mismatch. Baseline collected V1 == expected V1.
    const V3 = '3'.repeat(64)
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const candidateRaw = sample('candidate', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const pairing = pairCrossVersionElements(
      { ...baseline, sourceFileVersions: { 'src/App.tsx': V1 } },
      { ...candidateRaw, sourceFileVersions: { 'src/App.tsx': V2 } },
      { expectedSourceVersions: { baseline: { 'src/App.tsx': V1 }, candidate: { 'src/App.tsx': V3 } } },
    )
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(1)
    expect(pairing.unproven[0].reasons).toContain('source-version-mismatch')
  })

  it('严格证明开关: missingEvidence 为空也不 sufficient，必须显式 C+D 评估结果', () => {
    // Even with verified versions AND a positive assessment claim, the
    // remaining strict-proof inputs (page-context, collection-reasons,
    // graph-membership) keep the flag false; and an assessment alone with
    // unverified versions is likewise insufficient.
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const candidate = sample('candidate', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const verified = pairCrossVersionElements(
      { ...baseline, sourceFileVersions: { 'src/App.tsx': V1 } },
      { ...candidate, sourceFileVersions: { 'src/App.tsx': V2 } },
      {
        expectedSourceVersions: { baseline: { 'src/App.tsx': V1 }, candidate: { 'src/App.tsx': V2 } },
        identityAssessment: { assessedBy: 'c+d-resolve-runtime-element', strictInstanceProof: true },
      },
    )
    expect(verified.scope.missingEvidence).not.toContain('source-version')
    // 版本已核验且评估为真，但 page-context / collection-reasons / graph-membership 未清。
    expect(verified.scope.strictInstanceProofAvailable).toBe(false)
    const unverified = pairCrossVersionElements(baseline, candidate, { identityAssessment: { assessedBy: 'c+d-resolve-runtime-element', strictInstanceProof: true } })
    expect(unverified.scope.missingEvidence).toContain('source-version')
    expect(unverified.scope.strictInstanceProofAvailable).toBe(false)
  })

  it('反例3b offset 漂移 + candidate 自身版本失效: 不得依赖 sourceRef 字符串相等才检查版本', () => {
    // baseline jsx:src/App.tsx#120 collected H1 == expected H1; candidate
    // jsx:src/App.tsx#148 (same file, offset drift) collected H_BAD !=
    // candidate's own expected H2. The per-side check must key on each
    // side's OWN sourceRef file, not on the two strings being equal.
    const H3 = '3'.repeat(64)
    const HBAD = '9'.repeat(64)
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#120', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const candidateRaw = sample('candidate', [el('h', 'jsx:src/App.tsx#148', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const pairing = pairCrossVersionElements(
      { ...baseline, sourceFileVersions: { 'src/App.tsx': V1 } },
      { ...candidateRaw, sourceFileVersions: { 'src/App.tsx': HBAD } },
      { expectedSourceVersions: { baseline: { 'src/App.tsx': V1 }, candidate: { 'src/App.tsx': H3 } } },
    )
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(1)
    expect(pairing.unproven[0].reasons).toContain('source-version-mismatch')
  })

  it('正例 offset 漂移 + 合法 H1!=H2 各自有效: 维持 instance-candidate', () => {
    // Same file, offset shifted, each side's collected digest matches its
    // OWN expected digest — a legal cross-revision difference must not
    // downgrade, and version evidence is verified (out of missingEvidence).
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#120', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const candidateRaw = sample('candidate', [el('h', 'jsx:src/App.tsx#148', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const pairing = pairCrossVersionElements(
      { ...baseline, sourceFileVersions: { 'src/App.tsx': V1 } },
      { ...candidateRaw, sourceFileVersions: { 'src/App.tsx': V2 } },
      { expectedSourceVersions: { baseline: { 'src/App.tsx': V1 }, candidate: { 'src/App.tsx': V2 } } },
    )
    expect(pairing.instanceCandidate).toHaveLength(1)
    expect(pairing.unproven).toHaveLength(0)
    expect(pairing.scope.missingEvidence).not.toContain('source-version')
    expect(pairing.scope.strictInstanceProofAvailable).toBe(false) // page-context 等仍未清
  })

  it('反例4 同一 sourceRef 多次渲染且无稳定实例身份: 不配对', () => {
    const baseline = sample('baseline', [
      el('a', 'jsx:src/Item.tsx#5', [0, 0, 20, 10], { runtimeInstanceId: null, identityCertainty: 'unknown' }),
      el('b', 'jsx:src/Item.tsx#5', [0, 12, 20, 10], { runtimeInstanceId: null, identityCertainty: 'unknown' }),
    ])
    const candidate = sample('candidate', [
      el('c', 'jsx:src/Item.tsx#5', [0, 0, 20, 10], { runtimeInstanceId: null, identityCertainty: 'unknown' }),
      el('d', 'jsx:src/Item.tsx#5', [0, 12, 20, 10], { runtimeInstanceId: null, identityCertainty: 'unknown' }),
    ])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.sameSourceRefObserved).toHaveLength(0)
    expect(pairing.unproven).toHaveLength(0)
    expect(pairing.baselineOnly).toHaveLength(2)
    expect(pairing.candidateOnly).toHaveLength(2)
  })

  it('反例5 多个无实例 ID 元素同 sourceRef: 禁止按数组顺序推定逐元素对应', () => {
    // Stable certainty but no instance ids, deliberately listed in an order
    // that would "line up" by position — array order must NOT be used.
    const baseline = sample('baseline', [
      el('a', 'jsx:src/Row.tsx#7', [0, 0, 30, 8], { runtimeInstanceId: null }),
      el('b', 'jsx:src/Row.tsx#7', [0, 10, 30, 8], { runtimeInstanceId: null }),
    ])
    const candidate = sample('candidate', [
      el('c', 'jsx:src/Row.tsx#7', [0, 10, 30, 8], { runtimeInstanceId: null }),
      el('d', 'jsx:src/Row.tsx#7', [0, 0, 30, 8], { runtimeInstanceId: null }),
    ])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.sameSourceRefObserved).toHaveLength(0)
    expect(pairing.baselineOnly).toHaveLength(2)
    expect(pairing.candidateOnly).toHaveLength(2)
  })

  it('反例6 采集期 blocking reasons 存在时: 不允许实例候选，只记观察', () => {
    const baseline = sample('baseline', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h', identityReasons: ['route-namespace-stale'] })])
    const candidate = sample('candidate', [el('h', 'jsx:src/App.tsx#10', [0, 0, 20, 10], { runtimeInstanceId: '/:h' })])
    const pairing = pairCrossVersionElements(baseline, candidate)
    expect(pairing.instanceCandidate).toHaveLength(0)
    expect(pairing.sameSourceRefObserved).toHaveLength(1)
    expect(pairing.sameSourceRefObserved[0].reasons).toContain('blocking-identity-reason')
  })

  it('反例7 RouterProvider unknown 端到端: ViewModel 不得呈现实例级已证明', () => {
    const unknown = (id: string): Element => el(id, 'jsx:src/App.tsx#64', [4, 4, 50, 20], { identityCertainty: 'unknown' })
    const baseline = sideInput('baseline', [unknown('r')], baselinePng())
    const candidate = sideInput('candidate', [unknown('r')], candidatePngInTarget())
    const outcome = analyzeVisualDifference({
      checkId: 'dual-router-unknown', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: ['jsx:src/App.tsx#64'], dual: { baseline: ['jsx:src/App.tsx#64'], candidate: ['jsx:src/App.tsx#64'] } },
      baseline, candidate, diffArtifactPath: 'dual-router-unknown/diff.png',
    })
    const view = toVisualEvidenceView(outcome.evidence)
    expect(view.crossVersion).toBeDefined()
    expect(view.crossVersion!.scope.level).toBe('annotation-pairing')
    expect(view.crossVersion!.scope.strictInstanceProofAvailable).toBe(false)
    expect(view.crossVersion!.pairs.every(pair => pair.proof !== 'instance-candidate')).toBe(true)
    expect(view.crossVersion!.pairs[0].proof).toBe('same-sourceRef-observed')
    expect(view.crossVersion!.pairs[0].proofLabel).toContain('仅观察到相同 sourceRef')
    // 像素变化可展示，但不得归属为特定实例的确定修改。
    expect(view.changedPixels).toBeGreaterThan(0)
    expect(view.state).not.toBe('pass' as never)
  })

  it('unproven 证据端到端: ViewModel 等级与文案禁止实例归属', () => {
    // Same stable instance id but the candidate element moved to a DIFFERENT
    // source file: the pair collapses to unproven (different-source-file),
    // so the view must not let a pixel change read as one specific instance's
    // certain edit. (Legal per-revision version differences downgrade to
    // nothing — see 反例1.)
    const moved = el('h1', 'jsx:src/Moved.tsx#9', [4, 4, 50, 20])
    const baseline = sideInput('baseline', [h1(H1_BASELINE)], baselinePng())
    const candidate = sideInput('candidate', [moved], candidatePngInTarget())
    const outcome = analyzeVisualDifference({
      checkId: 'dual-source-only', subject: IDENTITY, expected: IDENTITY,
      targets: { sourceRefs: [H1_BASELINE, 'jsx:src/Moved.tsx#9'], dual: { baseline: [H1_BASELINE], candidate: ['jsx:src/Moved.tsx#9'] } },
      baseline, candidate, diffArtifactPath: 'dual-source-only/diff.png',
    })
    const view = toVisualEvidenceView(outcome.evidence)
    expect(view.crossVersion!.scope.strictInstanceProofAvailable).toBe(false)
    expect(view.crossVersion!.pairs.every(pair => pair.proof === 'unproven')).toBe(true)
    expect(view.crossVersion!.pairs[0].proofLabel).toContain('需人工复核')
    // 展示像素差异与区域是允许的；实例级确定归属是不允许的。
    expect(view.changedPixels).toBeGreaterThan(0)
    expect(view.crossVersion!.counts.instanceCandidate).toBe(0)
  })
})
