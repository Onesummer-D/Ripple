import type {
  RuntimeIdentityPairReason,
  RuntimeRunIdentity,
  RuntimeRunIdentityArchiveFailure,
  RuntimeRunIdentityVersionFailure,
  VerificationRun,
} from './model'
import { runtimeIdentityAssessmentChecksum, runtimeIdentityAssessmentChecksumAvailable } from './runtime-identity-checksum'
import type { RuntimeIdentityRecord } from './runtime-identity'

export const RUNTIME_IDENTITY_PAIRING_VIEW_SCHEMA = 'ripple-runtime-identity-pairing-view/v1'

export interface RuntimeIdentityCapturePoint {
  verificationRunId: string
  checkId: string
  route: string
  viewport: { width: number; height: number }
  state: string
}

export type RuntimeIdentityPairingDiagnostic =
  | 'run-id-mismatch'
  | 'invalid-capture-point'
  | 'missing-baseline-receipt'
  | 'missing-candidate-receipt'
  | 'duplicate-baseline-receipt'
  | 'duplicate-candidate-receipt'
  | 'baseline-archive-failed'
  | 'candidate-archive-failed'
  | 'baseline-version-unverifiable'
  | 'candidate-version-unverifiable'
  | 'baseline-snapshot-invalid'
  | 'candidate-snapshot-invalid'
  | 'baseline-page-mismatch'
  | 'candidate-page-mismatch'
  | 'empty-target-set'
  | 'unpaired-records'
  | 'incomplete-assessment-set'
  | 'invalid-assessment-digest'
  | 'assessment-checksum-unavailable'
  | 'invalid-record-binding'
  | 'duplicate-runtime-instance'
  | 'source-ref-mismatch'
  | 'assessment-missing'
  | 'assessment-unproven'
  | 'assessment-digest-mismatch'
  | 'unexpected-assessment'
  | 'assessment-projection-mismatch'
  | 'no-counterpart'
  | 'invalid-record-source-ref'
  | 'duplicate-record-key'
  | 'duplicate-record-assessment'
  | 'duplicate-assessment-entry'
  | 'invalid-assessment-entry'
  | 'unexpected-runpoint'

export type RuntimeIdentityRunPairingDiagnostic =
  | 'verification-run-id-missing'
  | 'runtime-identity-receipts-missing'
  | 'invalid-runtime-identity-receipt'
  | 'invalid-capture-point'
  | 'unexpected-runpoint'
  | 'duplicate-runpoint'
  | 'checks-missing'

export interface RuntimeIdentityPairingRecordView {
  recordKey: string
  sourceRef: string | null
  runtimeInstanceId: string | null
  proof: 'unproven'
  diagnostics: string[]
}

export interface RuntimeIdentityPairingPairView {
  runtimeInstanceId: string
  sourceRef: { baseline: string; candidate: string }
  recordKey: { baseline: string; candidate: string }
  proof: 'instance-proven' | 'unproven'
  proofLabel: string
  /** Reasons retained on each single-side assessment; E never merges them. */
  assessmentReasons: { baseline: string[]; candidate: string[] }
  /** Pair-level reasons, separate from both single-side Assessment objects. */
  pairReasons: RuntimeIdentityPairReason[]
  diagnostics: string[]
}

export interface RuntimeIdentityPairingView {
  schema: typeof RUNTIME_IDENTITY_PAIRING_VIEW_SCHEMA
  verificationRunId: string | null
  capture: Omit<RuntimeIdentityCapturePoint, 'verificationRunId'> | null
  scope: {
    /** True only when every record in both nonempty Snapshots is paired and proven. */
    strictInstanceProofAvailable: boolean
    state: 'instance-proven' | 'partial' | 'unproven'
    baselineRecordCount: number
    candidateRecordCount: number
    provenPairCount: number
    unprovenPairCount: number
    baselineOnlyCount: number
    candidateOnlyCount: number
    diagnostics: RuntimeIdentityPairingDiagnostic[]
  }
  pairs: RuntimeIdentityPairingPairView[]
  baselineOnly: RuntimeIdentityPairingRecordView[]
  candidateOnly: RuntimeIdentityPairingRecordView[]
}

export interface RuntimeIdentityRunPairingView {
  schema: 'ripple-runtime-identity-run-pairing-view/v1'
  verificationRunId: string | null
  strictInstanceProofAvailable: boolean
  state: 'instance-proven' | 'partial' | 'unproven' | 'unavailable'
  diagnostics: RuntimeIdentityRunPairingDiagnostic[]
  /** One independently evaluated entry per runpoint found in formal receipts. */
  captures: RuntimeIdentityPairingView[]
}

type StoredIdentityReceipt = RuntimeRunIdentity | RuntimeRunIdentityVersionFailure
type IdentityReceipt = StoredIdentityReceipt | RuntimeRunIdentityArchiveFailure
type RunIdentityProjection = Pick<VerificationRun, 'id' | 'runtimeIdentities'> & Partial<Pick<VerificationRun, 'runtimeIdentitySourceRefMappings'>>
type PageTuple = { pathname: string; search: string; hash: string }

interface AssessedRecord {
  record: RuntimeIdentityRecord
  recordKey: string
  reasons: string[]
  valid: boolean
  assessment?: RuntimeRunIdentity['assessments'][number]['assessment']
}

interface SideResult {
  receipt?: IdentityReceipt
  records: AssessedRecord[]
  diagnostics: RuntimeIdentityPairingDiagnostic[]
  pageMatches: boolean
  assessmentSetComplete: boolean
}

const HASH = /^[a-f0-9]{64}$/
const MAX_SOURCE_REF = 512
const MAX_INSTANCE_ID = 1024
const HOST_ORIGIN = 'http://ripple.local'

function nonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function validRuntimeInstanceId(value: unknown): value is string {
  return nonEmptyString(value, MAX_INSTANCE_ID)
}

function validSourceRef(value: unknown): value is string {
  return nonEmptyString(value, MAX_SOURCE_REF) && /^jsx:.+#\d+$/.test(value)
}

function parseCaptureRoute(route: string): PageTuple | undefined {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return undefined
  try {
    const parsed = new URL(route, HOST_ORIGIN)
    if (parsed.origin !== HOST_ORIGIN || `${parsed.pathname}${parsed.search}${parsed.hash}` !== route) return undefined
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
  } catch {
    return undefined
  }
}

function isPageTuple(value: unknown): value is PageTuple {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const page = value as Record<string, unknown>
  return typeof page.pathname === 'string' && page.pathname.startsWith('/') && !page.pathname.startsWith('//') && !page.pathname.includes('\\') &&
    typeof page.search === 'string' && (page.search === '' || page.search.startsWith('?')) &&
    typeof page.hash === 'string' && (page.hash === '' || page.hash.startsWith('#'))
}

function samePage(left: PageTuple, right: PageTuple): boolean {
  return left.pathname === right.pathname && left.search === right.search && left.hash === right.hash
}

function sameViewport(left: { width: number; height: number }, right: { width: number; height: number }): boolean {
  return left.width === right.width && left.height === right.height
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordKeyForSide(record: RuntimeIdentityRecord, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Runtime identity snapshot index must be a non-negative safe integer.')
  return JSON.stringify([record.sourceRef, record.runtimeInstanceId ?? null, index])
}

function isCapturePoint(value: unknown): value is RuntimeIdentityCapturePoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const point = value as Record<string, unknown>
  const viewport = point.viewport
  return nonEmptyString(point.verificationRunId, 256) && nonEmptyString(point.checkId, 256) &&
    nonEmptyString(point.route, 2048) && !!parseCaptureRoute(point.route) && nonEmptyString(point.state, 300) &&
    !!viewport && typeof viewport === 'object' && !Array.isArray(viewport) &&
    Number.isSafeInteger((viewport as Record<string, unknown>).width) && Number((viewport as Record<string, unknown>).width) > 0 &&
    Number.isSafeInteger((viewport as Record<string, unknown>).height) && Number((viewport as Record<string, unknown>).height) > 0
}

function matchesCapture(value: unknown, point: RuntimeIdentityCapturePoint): value is IdentityReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const receipt = value as Record<string, unknown>
  const viewport = receipt.viewport
  return receipt.checkId === point.checkId && receipt.route === point.route &&
    !!viewport && typeof viewport === 'object' && !Array.isArray(viewport) &&
    Number.isSafeInteger((viewport as Record<string, unknown>).width) && Number.isSafeInteger((viewport as Record<string, unknown>).height) &&
    sameViewport(viewport as { width: number; height: number }, point.viewport) && receipt.state === point.state
}

function emptyView(point: Partial<RuntimeIdentityCapturePoint> | undefined, diagnostics: RuntimeIdentityPairingDiagnostic[]): RuntimeIdentityPairingView {
  const hasCapture = !!point && typeof point.checkId === 'string' && typeof point.route === 'string' && !!point.viewport && typeof point.state === 'string'
  return {
    schema: RUNTIME_IDENTITY_PAIRING_VIEW_SCHEMA,
    verificationRunId: typeof point?.verificationRunId === 'string' ? point.verificationRunId : null,
    capture: hasCapture ? { checkId: point.checkId!, route: point.route!, viewport: { ...point.viewport! }, state: point.state! } : null,
    scope: {
      strictInstanceProofAvailable: false,
      state: 'unproven',
      baselineRecordCount: 0,
      candidateRecordCount: 0,
      provenPairCount: 0,
      unprovenPairCount: 0,
      baselineOnlyCount: 0,
      candidateOnlyCount: 0,
      diagnostics: [...new Set(diagnostics)],
    },
    pairs: [],
    baselineOnly: [],
    candidateOnly: [],
  }
}

function pageMatchesSnapshot(snapshot: unknown, expectedPage: PageTuple): boolean {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
  const page = (snapshot as Record<string, unknown>).page
  return isPageTuple(page) && samePage(page, expectedPage)
}

async function assessSide(receipt: IdentityReceipt, side: 'baseline' | 'candidate', point: RuntimeIdentityCapturePoint, expectedPage: PageTuple): Promise<SideResult> {
  const diagnostics: RuntimeIdentityPairingDiagnostic[] = []
  if (receipt.archive === 'failed') {
    diagnostics.push(side === 'baseline' ? 'baseline-archive-failed' : 'candidate-archive-failed')
    return { receipt, records: [], diagnostics, pageMatches: false, assessmentSetComplete: false }
  }

  const stored = receipt as StoredIdentityReceipt
  const pageMatches = pageMatchesSnapshot(stored.snapshot, expectedPage)
  if (!pageMatches) diagnostics.push(side === 'baseline' ? 'baseline-page-mismatch' : 'candidate-page-mismatch')
  if (stored.assessmentStatus !== 'complete') diagnostics.push(side === 'baseline' ? 'baseline-version-unverifiable' : 'candidate-version-unverifiable')
  const snapshot = isObject(stored.snapshot) ? stored.snapshot : undefined
  const snapshotRecords = snapshot?.records
  if (!HASH.test(stored.snapshotSha256) || stored.artifacts?.snapshot?.sha256 !== stored.snapshotSha256 ||
      !snapshot || !Array.isArray(snapshotRecords) || !snapshotRecords.every(isObject) ||
      (snapshot.protocol !== 'ripple-runtime-identity/v1' && snapshot.protocol !== 'ripple-runtime-identity/v2')) {
    diagnostics.push(side === 'baseline' ? 'baseline-snapshot-invalid' : 'candidate-snapshot-invalid')
    return { receipt, records: [], diagnostics, pageMatches: false, assessmentSetComplete: false }
  }
  const recordsInSnapshot = snapshotRecords as RuntimeIdentityRecord[]

  const rawEntries: unknown = stored.assessments
  const entries = Array.isArray(rawEntries) ? rawEntries : []
  if (!Array.isArray(rawEntries)) diagnostics.push('incomplete-assessment-set')
  const entriesByKey = new Map<string, typeof entries>()
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.recordKey !== 'string' || entry.recordKey.length === 0) {
      diagnostics.push('invalid-assessment-entry')
      continue
    }
    const matchingEntries = entriesByKey.get(entry.recordKey) ?? []
    if (matchingEntries.length > 0) diagnostics.push('duplicate-assessment-entry')
    entriesByKey.set(entry.recordKey, [...matchingEntries, entry])
  }

  const seenKeys = new Set<string>()
  const duplicateIds = new Set<string>()
  const idCounts = new Map<string, number>()
  for (const record of recordsInSnapshot) {
    if (validRuntimeInstanceId(record.runtimeInstanceId)) idCounts.set(record.runtimeInstanceId, (idCounts.get(record.runtimeInstanceId) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) if (count > 1) duplicateIds.add(id)

  const capture = {
    checkId: point.checkId,
    route: point.route,
    viewport: { ...point.viewport },
    state: point.state,
    side,
  }
  const records = await Promise.all(recordsInSnapshot.map(async (record, index): Promise<AssessedRecord> => {
    const recordKey = recordKeyForSide(record, index)
    const reasons: string[] = []
    if (!validSourceRef(record.sourceRef)) reasons.push('invalid-record-source-ref')
    if (!validRuntimeInstanceId(record.runtimeInstanceId)) reasons.push('instance-unavailable')
    if (validRuntimeInstanceId(record.runtimeInstanceId) && record.runtimeInstanceId === record.sourceRef) reasons.push('invalid-record-binding')
    if (validRuntimeInstanceId(record.runtimeInstanceId) && duplicateIds.has(record.runtimeInstanceId)) reasons.push('duplicate-runtime-instance')
    if (seenKeys.has(recordKey)) reasons.push('duplicate-record-key')
    seenKeys.add(recordKey)

    const matchingEntries = entriesByKey.get(recordKey) ?? []
    if (matchingEntries.length === 0) reasons.push('assessment-missing')
    else if (matchingEntries.length !== 1) reasons.push('duplicate-record-assessment')
    const entry = matchingEntries.length === 1 ? matchingEntries[0] : undefined
    if (entry) {
      const assessment = entry.assessment
      const safeAssessment = assessment && typeof assessment === 'object' && !Array.isArray(assessment)
      const assessmentPage = safeAssessment ? assessment.page : undefined
      if (!HASH.test(entry.assessmentSha256) || !HASH.test(stored.snapshotSha256)) reasons.push('invalid-assessment-digest')
      else if (!runtimeIdentityAssessmentChecksumAvailable()) reasons.push('assessment-checksum-unavailable')
      else {
        try {
          if (await runtimeIdentityAssessmentChecksum(capture, stored.snapshotSha256, recordKey, assessment) !== entry.assessmentSha256) reasons.push('assessment-digest-mismatch')
        } catch (error) {
          reasons.push(error instanceof Error && error.message.includes('Web Crypto SHA-256 is unavailable')
            ? 'assessment-checksum-unavailable'
            : 'invalid-assessment-digest')
        }
      }
      if (!safeAssessment || assessment.sourceRef !== record.sourceRef || assessment.runtimeInstanceId !== record.runtimeInstanceId ||
          assessment.certainty !== record.certainty || !isPageTuple(assessmentPage) || !isPageTuple(snapshot.page) || !samePage(assessmentPage, snapshot.page)) {
        reasons.push('invalid-record-binding')
      }
      if (safeAssessment && (assessment.instanceIdentityProven !== true || assessment.locatable !== true || !Array.isArray(assessment.reasons) || assessment.reasons.length !== 0)) {
        reasons.push('assessment-unproven')
      }
    }
    if (stored.assessmentStatus !== 'complete') reasons.push('version-unverifiable')
    if (!pageMatches) reasons.push('page-mismatch')
    return { record, recordKey, reasons: [...new Set(reasons)], valid: reasons.length === 0, ...(entry ? { assessment: entry.assessment } : {}) }
  }))

  if (records.some(record => record.reasons.includes('assessment-checksum-unavailable'))) diagnostics.push('assessment-checksum-unavailable')
  const malformedAssessmentEntry = entries.some(entry => !isObject(entry) || typeof entry.recordKey !== 'string' || entry.recordKey.length === 0)
  const unexpectedAssessment = entries.some(entry => !isObject(entry) || typeof entry.recordKey !== 'string' || !seenKeys.has(entry.recordKey))
  if (entries.length !== recordsInSnapshot.length || diagnostics.includes('duplicate-assessment-entry') || malformedAssessmentEntry) diagnostics.push('incomplete-assessment-set')
  if (unexpectedAssessment) diagnostics.push('unexpected-assessment')
  if (!pageMatches) records.forEach(record => { if (!record.reasons.includes('page-mismatch')) record.reasons.push('page-mismatch'); record.valid = false })
  const expectedKeys = new Set(records.map(record => record.recordKey))
  const assessmentSetComplete = !malformedAssessmentEntry && entries.length === recordsInSnapshot.length &&
    entriesByKey.size === expectedKeys.size && [...expectedKeys].every(key => entriesByKey.get(key)?.length === 1) &&
    [...entriesByKey.keys()].every(key => expectedKeys.has(key))
  return { receipt, records, diagnostics, pageMatches, assessmentSetComplete }
}

function projectionMismatch(baseline: AssessedRecord, candidate: AssessedRecord): boolean {
  const left = baseline.record
  const right = candidate.record
  const leftAssessment = baseline.assessment
  const rightAssessment = candidate.assessment
  if (!leftAssessment || !rightAssessment) return false
  return leftAssessment.sourceRef !== rightAssessment.sourceRef || leftAssessment.runtimeInstanceId !== rightAssessment.runtimeInstanceId ||
    leftAssessment.certainty !== rightAssessment.certainty || !samePage(leftAssessment.page, rightAssessment.page) ||
    left.sourceRef !== right.sourceRef || left.runtimeInstanceId !== right.runtimeInstanceId
}

function sideOnly(record: AssessedRecord, diagnostics: RuntimeIdentityPairingDiagnostic[]): RuntimeIdentityPairingRecordView {
  return {
    recordKey: record.recordKey,
    sourceRef: validSourceRef(record.record.sourceRef) ? record.record.sourceRef : null,
    runtimeInstanceId: validRuntimeInstanceId(record.record.runtimeInstanceId) ? record.record.runtimeInstanceId : null,
    proof: 'unproven',
    diagnostics: [...new Set([...record.reasons, ...diagnostics])],
  }
}

/**
 * Consumes only the host-produced receipts already attached to one formal
 * VerificationRun. It validates receipt bindings and content checksums, but
 * never re-runs host Assessment, trusts raw container data, or treats a hash
 * as a host signature. Source-ref mapping receipts are intentionally not used
 * as instance-equivalence evidence by current v1/v2.
 */
export async function pairRuntimeIdentityReceipts(
  run: RunIdentityProjection,
  point: RuntimeIdentityCapturePoint,
): Promise<RuntimeIdentityPairingView> {
  if (!isCapturePoint(point)) return emptyView(point, ['invalid-capture-point'])
  if (!isObject(run) || run.id !== point.verificationRunId) return emptyView(point, ['run-id-mismatch'])

  const rawReceipts: unknown = run.runtimeIdentities
  const receipts = (Array.isArray(rawReceipts) ? rawReceipts : []).filter(receipt => matchesCapture(receipt, point))
  const baselineReceipts = receipts.filter(receipt => receipt.side === 'baseline')
  const candidateReceipts = receipts.filter(receipt => receipt.side === 'candidate')
  const diagnostics: RuntimeIdentityPairingDiagnostic[] = []
  if (baselineReceipts.length === 0) diagnostics.push('missing-baseline-receipt')
  if (candidateReceipts.length === 0) diagnostics.push('missing-candidate-receipt')
  if (baselineReceipts.length > 1) diagnostics.push('duplicate-baseline-receipt')
  if (candidateReceipts.length > 1) diagnostics.push('duplicate-candidate-receipt')
  const expectedPage = parseCaptureRoute(point.route)
  if (!expectedPage) return emptyView(point, [...diagnostics, 'invalid-capture-point'])
  const [baseline, candidate] = await Promise.all([
    baselineReceipts.length === 1 ? assessSide(baselineReceipts[0], 'baseline', point, expectedPage) : Promise.resolve({ records: [], diagnostics: [], pageMatches: false, assessmentSetComplete: false } as SideResult),
    candidateReceipts.length === 1 ? assessSide(candidateReceipts[0], 'candidate', point, expectedPage) : Promise.resolve({ records: [], diagnostics: [], pageMatches: false, assessmentSetComplete: false } as SideResult),
  ])
  diagnostics.push(...baseline.diagnostics, ...candidate.diagnostics)

  const baselineGroups = new Map<string, AssessedRecord[]>()
  const candidateGroups = new Map<string, AssessedRecord[]>()
  for (const record of baseline.records) {
    if (validRuntimeInstanceId(record.record.runtimeInstanceId)) baselineGroups.set(record.record.runtimeInstanceId, [...(baselineGroups.get(record.record.runtimeInstanceId) ?? []), record])
  }
  for (const record of candidate.records) {
    if (validRuntimeInstanceId(record.record.runtimeInstanceId)) candidateGroups.set(record.record.runtimeInstanceId, [...(candidateGroups.get(record.record.runtimeInstanceId) ?? []), record])
  }
  const usedBaseline = new Set<string>()
  const usedCandidate = new Set<string>()
  const pairs: RuntimeIdentityPairingPairView[] = []
  const baselineOnly: RuntimeIdentityPairingRecordView[] = []
  const candidateOnly: RuntimeIdentityPairingRecordView[] = []

  for (const id of [...new Set([...baselineGroups.keys(), ...candidateGroups.keys()])].sort()) {
    const left = baselineGroups.get(id) ?? []
    const right = candidateGroups.get(id) ?? []
    if (left.length > 1 || right.length > 1) {
      left.forEach(record => { usedBaseline.add(record.recordKey); baselineOnly.push(sideOnly(record, ['duplicate-runtime-instance'])) })
      right.forEach(record => { usedCandidate.add(record.recordKey); candidateOnly.push(sideOnly(record, ['duplicate-runtime-instance'])) })
      continue
    }
    if (left.length !== 1 || right.length !== 1) {
      left.forEach(record => { usedBaseline.add(record.recordKey); baselineOnly.push(sideOnly(record, ['no-counterpart'])) })
      right.forEach(record => { usedCandidate.add(record.recordKey); candidateOnly.push(sideOnly(record, ['no-counterpart'])) })
      continue
    }
    const b = left[0]
    const c = right[0]
    usedBaseline.add(b.recordKey)
    usedCandidate.add(c.recordKey)
    if (!validSourceRef(b.record.sourceRef) || !validSourceRef(c.record.sourceRef) || b.record.sourceRef !== c.record.sourceRef) {
      baselineOnly.push(sideOnly(b, ['source-ref-mismatch']))
      candidateOnly.push(sideOnly(c, ['source-ref-mismatch']))
      continue
    }
    const pairReasons: RuntimeIdentityPairReason[] = []
    const diagnosticsForPair = [...b.reasons, ...c.reasons]
    if (b.valid && c.valid && projectionMismatch(b, c)) {
      pairReasons.push('cross-side-assessment-mismatch')
      diagnosticsForPair.push('assessment-projection-mismatch')
    }
    const proven = b.valid && c.valid && pairReasons.length === 0
    pairs.push({
      runtimeInstanceId: id,
      sourceRef: { baseline: b.record.sourceRef, candidate: c.record.sourceRef },
      recordKey: { baseline: b.recordKey, candidate: c.recordKey },
      proof: proven ? 'instance-proven' : 'unproven',
      proofLabel: proven ? '实例级已证明' : '未证明实例配对',
      assessmentReasons: {
        baseline: b.assessment && Array.isArray(b.assessment.reasons) ? [...b.assessment.reasons] : [...b.reasons],
        candidate: c.assessment && Array.isArray(c.assessment.reasons) ? [...c.assessment.reasons] : [...c.reasons],
      },
      pairReasons,
      diagnostics: [...new Set(diagnosticsForPair)],
    })
  }

  for (const record of baseline.records) if (!usedBaseline.has(record.recordKey)) baselineOnly.push(sideOnly(record, ['no-counterpart']))
  for (const record of candidate.records) if (!usedCandidate.has(record.recordKey)) candidateOnly.push(sideOnly(record, ['no-counterpart']))

  const baselineCount = baseline.records.length
  const candidateCount = candidate.records.length
  const provenPairCount = pairs.filter(pair => pair.proof === 'instance-proven').length
  const unprovenPairCount = pairs.length - provenPairCount
  if (baselineCount === 0 && candidateCount === 0) diagnostics.push('empty-target-set')
  if (baselineOnly.length > 0 || candidateOnly.length > 0) diagnostics.push('unpaired-records')
  const strictInstanceProofAvailable = baselineCount > 0 && candidateCount > 0 &&
    baselineReceipts.length === 1 && candidateReceipts.length === 1 &&
    baseline.receipt?.archive === 'stored' && baseline.receipt.assessmentStatus === 'complete' &&
    candidate.receipt?.archive === 'stored' && candidate.receipt.assessmentStatus === 'complete' &&
    baseline.pageMatches && candidate.pageMatches && baseline.assessmentSetComplete && candidate.assessmentSetComplete &&
    baselineOnly.length === 0 && candidateOnly.length === 0 && unprovenPairCount === 0 && provenPairCount === baselineCount && provenPairCount === candidateCount
  const state = strictInstanceProofAvailable ? 'instance-proven' : provenPairCount > 0 ? 'partial' : 'unproven'
  return {
    schema: RUNTIME_IDENTITY_PAIRING_VIEW_SCHEMA,
    verificationRunId: run.id,
    capture: { checkId: point.checkId, route: point.route, viewport: { ...point.viewport }, state: point.state },
    scope: {
      strictInstanceProofAvailable,
      state,
      baselineRecordCount: baselineCount,
      candidateRecordCount: candidateCount,
      provenPairCount,
      unprovenPairCount,
      baselineOnlyCount: baselineOnly.length,
      candidateOnlyCount: candidateOnly.length,
      diagnostics: [...new Set(diagnostics)],
    },
    pairs,
    baselineOnly,
    candidateOnly,
  }
}

function capturePointKey(point: Omit<RuntimeIdentityCapturePoint, 'verificationRunId'>): string {
  return JSON.stringify([point.checkId, point.route, point.viewport.width, point.viewport.height, point.state])
}

function capturePointFromCheck(value: unknown, verificationRunId: string): RuntimeIdentityCapturePoint | undefined {
  if (!isObject(value)) return undefined
  const point = {
    verificationRunId,
    checkId: value.id,
    route: value.route,
    viewport: value.viewport,
    state: value.state,
  }
  return isCapturePoint(point) ? point : undefined
}

function capturePointFromReceipt(value: unknown, verificationRunId: string): RuntimeIdentityCapturePoint | undefined {
  if (!isObject(value)) return undefined
  const point = {
    verificationRunId,
    checkId: value.checkId,
    route: value.route,
    viewport: value.viewport,
    state: value.state,
  }
  return isCapturePoint(point) ? point : undefined
}

function receiptHasKnownSideAndArchive(value: unknown): boolean {
  return isObject(value) && (value.side === 'baseline' || value.side === 'candidate') &&
    (value.archive === 'stored' || value.archive === 'failed')
}

function markUnexpectedRunpoint(view: RuntimeIdentityPairingView): RuntimeIdentityPairingView {
  return {
    ...view,
    scope: {
      ...view.scope,
      strictInstanceProofAvailable: false,
      state: 'unproven',
      provenPairCount: 0,
      unprovenPairCount: view.pairs.length,
      diagnostics: [...new Set<RuntimeIdentityPairingDiagnostic>([...view.scope.diagnostics, 'unexpected-runpoint'])],
    },
    pairs: view.pairs.map(pair => ({
      ...pair,
      proof: 'unproven',
      proofLabel: '未证明运行点',
      diagnostics: [...new Set([...pair.diagnostics, 'unexpected-runpoint'])],
    })),
  }
}

/**
 * Builds the stable, read-only run projection from formal checks and formal
 * Runtime Identity receipts. Visual evidence and its coverage claims are never
 * consulted. Every declared check is represented even when both receipts are
 * absent; receipt-only runpoints are retained but forced unproven.
 */
export async function pairRuntimeIdentityRun(
  run: Pick<VerificationRun, 'id' | 'checks' | 'runtimeIdentities'>,
): Promise<RuntimeIdentityRunPairingView> {
  const rawRun: Record<string, unknown> = isObject(run) ? run : {}
  const verificationRunId = nonEmptyString(rawRun.id, 256) ? rawRun.id : null
  const diagnostics: RuntimeIdentityRunPairingDiagnostic[] = []
  if (!verificationRunId) {
    return {
      schema: 'ripple-runtime-identity-run-pairing-view/v1',
      verificationRunId: null,
      strictInstanceProofAvailable: false,
      state: 'unavailable',
      diagnostics: ['verification-run-id-missing'],
      captures: [],
    }
  }

  const rawChecks: unknown = rawRun.checks
  const checks = Array.isArray(rawChecks) ? rawChecks : []
  if (!Array.isArray(rawChecks) || checks.length === 0) diagnostics.push('checks-missing')
  const pointsByKey = new Map<string, { point: RuntimeIdentityCapturePoint; fromCheck: boolean }>()
  for (const check of checks) {
    const point = capturePointFromCheck(check, verificationRunId)
    if (!point) {
      diagnostics.push('invalid-capture-point')
      continue
    }
    const key = capturePointKey(point)
    if (pointsByKey.has(key)) diagnostics.push('duplicate-runpoint')
    else pointsByKey.set(key, { point, fromCheck: true })
  }

  const rawReceipts: unknown = rawRun.runtimeIdentities
  const receipts = Array.isArray(rawReceipts) ? rawReceipts : []
  if (!Array.isArray(rawReceipts) || receipts.length === 0) diagnostics.push('runtime-identity-receipts-missing')
  for (const receipt of receipts) {
    const point = capturePointFromReceipt(receipt, verificationRunId)
    if (!point || !receiptHasKnownSideAndArchive(receipt)) {
      diagnostics.push('invalid-runtime-identity-receipt')
      continue
    }
    const key = capturePointKey(point)
    if (!pointsByKey.has(key)) {
      diagnostics.push('unexpected-runpoint')
      pointsByKey.set(key, { point, fromCheck: false })
    }
  }

  const captures: RuntimeIdentityPairingView[] = []
  for (const [, entry] of [...pointsByKey].sort(([left], [right]) => left.localeCompare(right))) {
    const projected = await pairRuntimeIdentityReceipts(
      { id: verificationRunId, runtimeIdentities: receipts as IdentityReceipt[] },
      entry.point,
    )
    captures.push(entry.fromCheck ? projected : markUnexpectedRunpoint(projected))
    if (!entry.fromCheck && !diagnostics.includes('unexpected-runpoint')) diagnostics.push('unexpected-runpoint')
  }

  const strictInstanceProofAvailable = captures.length > 0 && diagnostics.length === 0 &&
    captures.every(capture => capture.scope.strictInstanceProofAvailable)
  const anyProvenPair = captures.some(capture => capture.scope.provenPairCount > 0)
  const state = strictInstanceProofAvailable
    ? 'instance-proven'
    : captures.length === 0 && diagnostics.includes('runtime-identity-receipts-missing')
      ? 'unavailable'
      : anyProvenPair ? 'partial' : 'unproven'
  return {
    schema: 'ripple-runtime-identity-run-pairing-view/v1',
    verificationRunId,
    strictInstanceProofAvailable,
    state,
    diagnostics: [...new Set(diagnostics)],
    captures,
  }
}
