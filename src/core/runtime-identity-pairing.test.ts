import { describe, expect, it } from 'vitest'
import type { RuntimeIdentityRecord, RuntimeIdentitySnapshot } from './runtime-identity'
import type { RuntimeRunIdentity, RuntimeRunIdentityArchiveFailure, RuntimeRunIdentityAssessmentEntry, RuntimeRunIdentityVersionFailure, VerificationRun } from './model'
import { runtimeIdentityAssessmentSha256, runtimeIdentityRecordKey } from './runtime-identity-assessment'
import { pairRuntimeIdentityReceipts, type RuntimeIdentityCapturePoint } from './runtime-identity-pairing'

const point: RuntimeIdentityCapturePoint = {
  verificationRunId: 'run-1',
  checkId: 'home-wide',
  route: '/',
  viewport: { width: 1440, height: 900 },
  state: 'rendered',
}

const page = { pathname: '/', search: '', hash: '' }
const digest = 'a'.repeat(64)

function makeRecord(overrides: Partial<RuntimeIdentityRecord> = {}): RuntimeIdentityRecord {
  return {
    sourceRef: 'jsx:src/App.tsx#10',
    runtimeInstanceId: 'ripple-page-v2:%5B%22%2F%22%2C%22%22%2C%22%22%5D:jsx:src/App.tsx#10:key-home',
    declaredCertainty: 'stable-keyed-instance',
    certainty: 'stable-keyed-instance',
    domNode: 1,
    sameSourceCount: 1,
    reasons: [],
    ...overrides,
  }
}

function makeReceipt(
  side: 'baseline' | 'candidate',
  records: RuntimeIdentityRecord[],
  options: {
    runPoint?: Partial<RuntimeIdentityCapturePoint>
    status?: 'complete' | 'version-unverifiable'
    page?: typeof page
    assessmentOverrides?: Array<Partial<RuntimeRunIdentityAssessmentEntry['assessment']> | null | undefined>
    digestOverride?: string
    recordKeyOverride?: string
  } = {},
): RuntimeRunIdentity | RuntimeRunIdentityVersionFailure {
  const snapshot: RuntimeIdentitySnapshot = { protocol: 'ripple-runtime-identity/v2', page: options.page ?? page, records }
  const snapshotSha256 = digest
  const tuple = {
    checkId: options.runPoint?.checkId ?? point.checkId,
    route: options.runPoint?.route ?? point.route,
    viewport: options.runPoint?.viewport ?? point.viewport,
    state: options.runPoint?.state ?? point.state,
    side,
  }
  const assessments = records.map((record, index): RuntimeRunIdentityAssessmentEntry => {
    const assessment = {
      sourceRef: record.sourceRef,
      runtimeInstanceId: record.runtimeInstanceId,
      certainty: record.certainty,
      page: snapshot.page,
      locatable: true,
      instanceIdentityProven: true,
      sameSourceCount: record.sameSourceCount,
      reasons: [],
      ...options.assessmentOverrides?.[index],
    }
    const recordKey = index === 0 && options.recordKeyOverride !== undefined ? options.recordKeyOverride : runtimeIdentityRecordKey(record, index)
    return {
      recordKey,
      assessment,
      assessmentSha256: options.digestOverride ?? runtimeIdentityAssessmentSha256(tuple, snapshotSha256, recordKey, assessment),
    }
  })
  const stored = {
    archive: 'stored' as const,
    checkId: tuple.checkId,
    route: tuple.route,
    viewport: { ...tuple.viewport },
    state: tuple.state,
    side,
    snapshot,
    snapshotSha256,
    assessments,
    artifacts: { snapshot: { path: `${side}.json`, sha256: snapshotSha256 } },
  }
  return options.status === 'version-unverifiable'
    ? { ...stored, assessmentStatus: 'version-unverifiable', reason: 'version-unverifiable', detail: 'fixture unbound', observedSourceDigests: {}, expectedBoundDigest: digest }
    : { ...stored, assessmentStatus: 'complete', sourceDigests: { 'src/App.tsx': digest }, boundDigest: digest }
}

function run(runtimeIdentities: NonNullable<VerificationRun['runtimeIdentities']>): Pick<VerificationRun, 'id' | 'runtimeIdentities' | 'runtimeIdentitySourceRefMappings'> {
  return { id: point.verificationRunId, runtimeIdentities }
}

function sides(baselineRecords: RuntimeIdentityRecord[], candidateRecords: RuntimeIdentityRecord[], options: Parameters<typeof makeReceipt>[2] = {}) {
  return run([makeReceipt('baseline', baselineRecords, options), makeReceipt('candidate', candidateRecords, options)])
}

describe('pairRuntimeIdentityReceipts', () => {
  it('严格按真实运行点、唯一 ID 和 sourceRef 配对；数组顺序与 snapshot index 不建立跨侧关系', async () => {
    const first = makeRecord()
    const second = makeRecord({
      sourceRef: 'jsx:src/App.tsx#20',
      runtimeInstanceId: 'ripple-page-v2:%5B%22%2F%22%2C%22%22%2C%22%22%5D:jsx:src/App.tsx#20:key-footer',
      domNode: 2,
    })
    const result = await pairRuntimeIdentityReceipts(sides([first, second], [second, first]), point)
    expect(result.scope.strictInstanceProofAvailable).toBe(true)
    expect(result.scope.state).toBe('instance-proven')
    expect(result.pairs).toHaveLength(2)
    expect(result.pairs.every(pair => pair.proof === 'instance-proven')).toBe(true)
    const firstPair = result.pairs.find(pair => pair.runtimeInstanceId === first.runtimeInstanceId)
    expect(firstPair?.recordKey).toEqual({ baseline: runtimeIdentityRecordKey(first, 0), candidate: runtimeIdentityRecordKey(first, 1) })
    expect(result.pairs.map(pair => pair.recordKey.baseline)).not.toEqual(result.pairs.map(pair => pair.recordKey.candidate))
  })

  it('保留同源多实例中的独立成功；一条单侧失败只使整页范围降级', async () => {
    const good = makeRecord()
    const bad = makeRecord({
      sourceRef: 'jsx:src/App.tsx#20',
      runtimeInstanceId: 'ripple-page-v2:%5B%22%2F%22%2C%22%22%2C%22%22%5D:jsx:src/App.tsx#20:key-footer',
      domNode: 2,
    })
    const runData = run([
      makeReceipt('baseline', [good, bad]),
      makeReceipt('candidate', [good, bad], { assessmentOverrides: [undefined, { instanceIdentityProven: false, reasons: ['identity-not-stable'] }] }),
    ])
    const result = await pairRuntimeIdentityReceipts(runData, point)
    expect(result.pairs.find(pair => pair.runtimeInstanceId === good.runtimeInstanceId)?.proof).toBe('instance-proven')
    expect(result.pairs.find(pair => pair.runtimeInstanceId === bad.runtimeInstanceId)).toMatchObject({
      proof: 'unproven',
      assessmentReasons: { baseline: [], candidate: ['identity-not-stable'] },
      pairReasons: [],
    })
    expect(result.scope.strictInstanceProofAvailable).toBe(false)
    expect(result.scope.state).toBe('partial')
  })

  it('拒绝单侧 instanceIdentityProven=false 或非空 reasons，但不污染另一侧 Assessment', async () => {
    const record = makeRecord()
    const result = await pairRuntimeIdentityReceipts(run([
      makeReceipt('baseline', [record]),
      makeReceipt('candidate', [record], { assessmentOverrides: [{ instanceIdentityProven: false, reasons: ['source-version-unavailable'] }] }),
    ]), point)
    expect(result.pairs[0]).toMatchObject({
      proof: 'unproven',
      assessmentReasons: { baseline: [], candidate: ['source-version-unavailable'] },
      pairReasons: [],
    })
    expect(result.scope.strictInstanceProofAvailable).toBe(false)
  })

  it('把 cross-side-assessment-mismatch 放在 pair 层，且只在两个单侧 Assessment 都独立有效时产生', async () => {
    const record = makeRecord()
    const otherStableCertainty = makeRecord({ declaredCertainty: 'stable-react-instance', certainty: 'stable-react-instance' })
    const result = await pairRuntimeIdentityReceipts(run([
      makeReceipt('baseline', [record]),
      makeReceipt('candidate', [otherStableCertainty]),
    ]), point)
    expect(result.pairs[0]).toMatchObject({
      proof: 'unproven',
      assessmentReasons: { baseline: [], candidate: [] },
      pairReasons: ['cross-side-assessment-mismatch'],
    })
    expect(result.pairs[0].diagnostics).toContain('assessment-projection-mismatch')
  })

  it('缺少回执、重复回执、归档失败和 version-unverifiable 都不能得到整页证明', async () => {
    const record = makeRecord()
    const baseline = makeReceipt('baseline', [record])
    const candidate = makeReceipt('candidate', [record])
    const archiveFailure: RuntimeRunIdentityArchiveFailure = {
      archive: 'failed', reason: 'snapshot-unavailable', checkId: point.checkId, route: point.route,
      viewport: point.viewport, state: point.state, side: 'candidate',
    }
    expect((await pairRuntimeIdentityReceipts(run([baseline]), point)).scope.diagnostics).toContain('missing-candidate-receipt')
    expect((await pairRuntimeIdentityReceipts(run([baseline, candidate, candidate]), point)).scope.diagnostics).toContain('duplicate-candidate-receipt')
    expect((await pairRuntimeIdentityReceipts(run([baseline, archiveFailure]), point)).scope.strictInstanceProofAvailable).toBe(false)
    expect((await pairRuntimeIdentityReceipts(run([baseline, makeReceipt('candidate', [record], { status: 'version-unverifiable' })]), point)).scope.strictInstanceProofAvailable).toBe(false)
  })

  it('拒绝错误运行 ID 与任何 checkId/route/viewport/state 错配', async () => {
    const record = makeRecord()
    const completeRun = sides([record], [record])
    expect((await pairRuntimeIdentityReceipts(completeRun, { ...point, verificationRunId: 'other-run' })).scope.diagnostics).toContain('run-id-mismatch')
    const wrongRunpoint = run([
      makeReceipt('baseline', [record], { runPoint: { route: '/other' } }),
      makeReceipt('candidate', [record]),
    ])
    expect((await pairRuntimeIdentityReceipts(wrongRunpoint, point)).scope.strictInstanceProofAvailable).toBe(false)
    expect((await pairRuntimeIdentityReceipts(wrongRunpoint, point)).scope.diagnostics).toContain('missing-baseline-receipt')
    expect((await pairRuntimeIdentityReceipts(completeRun, { ...point, state: 'hovered' })).scope.strictInstanceProofAvailable).toBe(false)
    expect((await pairRuntimeIdentityReceipts(completeRun, { ...point, viewport: { width: 800, height: 600 } })).scope.strictInstanceProofAvailable).toBe(false)
  })

  it('拒绝两侧页面三元组不一致', async () => {
    const record = makeRecord()
    const result = await pairRuntimeIdentityReceipts(run([
      makeReceipt('baseline', [record]),
      makeReceipt('candidate', [record], { page: { pathname: '/other', search: '', hash: '' } }),
    ]), point)
    expect(result.scope.strictInstanceProofAvailable).toBe(false)
    expect(result.scope.diagnostics).toContain('candidate-page-mismatch')
    expect(result.pairs[0].proof).toBe('unproven')
  })

  it('非法或重复 runtimeInstanceId 不配对；sourceRef 偏移变化也保留为两侧未配对', async () => {
    const repeated = makeRecord()
    const anotherSameId = makeRecord({ domNode: 2 })
    const duplicateResult = await pairRuntimeIdentityReceipts(sides([repeated, anotherSameId], [repeated]), point)
    expect(duplicateResult.pairs).toHaveLength(0)
    expect(duplicateResult.baselineOnly).toHaveLength(2)
    expect(duplicateResult.baselineOnly.every(record => record.diagnostics.includes('duplicate-runtime-instance'))).toBe(true)

    const offsetChanged = makeRecord({ sourceRef: 'jsx:src/App.tsx#11' })
    const sourceMismatch = await pairRuntimeIdentityReceipts(sides([repeated], [offsetChanged]), point)
    expect(sourceMismatch.pairs).toHaveLength(0)
    expect(sourceMismatch.baselineOnly[0].diagnostics).toContain('source-ref-mismatch')
    expect(sourceMismatch.candidateOnly[0].diagnostics).toContain('source-ref-mismatch')
  })

  it('来源映射 receipt 不会把不同 sourceRef 强行变成实例配对', async () => {
    const baselineRecord = makeRecord()
    const candidateRecord = makeRecord({ sourceRef: 'jsx:src/App.tsx#11' })
    const data = sides([baselineRecord], [candidateRecord])
    const result = await pairRuntimeIdentityReceipts({
      ...data,
      runtimeIdentitySourceRefMappings: [{
        protocol: 'ripple-source-ref-mapping/v1', verificationRunId: point.verificationRunId, candidateId: 'candidate-1', patchHash: digest,
        baselineSourceDigest: digest, candidateSourceDigest: digest, baselineGraphId: 'base-graph', candidateGraphId: 'candidate-graph',
        parserSchemaVersion: 'v1', mappingSha256: digest,
        mappings: [{ baselineSourceRef: baselineRecord.sourceRef, candidateSourceRef: candidateRecord.sourceRef }],
      }],
    }, point)
    expect(result.pairs).toHaveLength(0)
    expect(result.scope.strictInstanceProofAvailable).toBe(false)
  })

  it('拒绝错误摘要、recordKey、被交换的 side 和缺失 Assessment', async () => {
    const record = makeRecord()
    const wrongDigest = run([
      makeReceipt('baseline', [record]),
      makeReceipt('candidate', [record], { digestOverride: digest }),
    ])
    // The fixed digest is deliberately not the digest of the candidate-side tuple.
    expect((await pairRuntimeIdentityReceipts(wrongDigest, point)).pairs[0].proof).toBe('unproven')
    expect((await pairRuntimeIdentityReceipts(wrongDigest, point)).pairs[0].diagnostics).toContain('assessment-digest-mismatch')

    const wrongKey = run([makeReceipt('baseline', [record], { recordKeyOverride: '["wrong",null,0]' }), makeReceipt('candidate', [record])])
    expect((await pairRuntimeIdentityReceipts(wrongKey, point)).pairs[0].proof).toBe('unproven')
    expect((await pairRuntimeIdentityReceipts(wrongKey, point)).pairs[0].diagnostics).toContain('assessment-missing')

    const sideSwapped = run([
      { ...makeReceipt('baseline', [record]), side: 'candidate' },
      { ...makeReceipt('candidate', [record]), side: 'baseline' },
    ])
    expect((await pairRuntimeIdentityReceipts(sideSwapped, point)).pairs[0].proof).toBe('unproven')
    expect((await pairRuntimeIdentityReceipts(sideSwapped, point)).pairs[0].diagnostics).toContain('assessment-digest-mismatch')

    const missingAssessment = makeReceipt('candidate', [record])
    missingAssessment.assessments = []
    const incomplete = await pairRuntimeIdentityReceipts(run([makeReceipt('baseline', [record]), missingAssessment]), point)
    expect(incomplete.pairs[0].proof).toBe('unproven')
    expect(incomplete.scope.strictInstanceProofAvailable).toBe(false)
  })

  it('非空完整记录集合才可证明整页；空集合和混合缺项均降级', async () => {
    const empty = await pairRuntimeIdentityReceipts(sides([], []), point)
    expect(empty.scope.strictInstanceProofAvailable).toBe(false)
    expect(empty.scope.diagnostics).toContain('empty-target-set')

    const good = makeRecord()
    const unmatched = makeRecord({
      sourceRef: 'jsx:src/App.tsx#30',
      runtimeInstanceId: 'ripple-page-v2:%5B%22%2F%22%2C%22%22%2C%22%22%5D:jsx:src/App.tsx#30:key-extra',
    })
    const partial = await pairRuntimeIdentityReceipts(sides([good, unmatched], [good]), point)
    expect(partial.pairs[0].proof).toBe('instance-proven')
    expect(partial.baselineOnly).toHaveLength(1)
    expect(partial.scope.strictInstanceProofAvailable).toBe(false)
  })

  it('原始 Run 和 Snapshot 均保持只读', async () => {
    const record = makeRecord()
    const runData = sides([record], [record])
    const before = structuredClone(runData)
    await pairRuntimeIdentityReceipts(runData, point)
    expect(runData).toEqual(before)
  })
})
