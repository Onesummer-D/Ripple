import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  BrowserVerificationContract,
  RuntimeIdentityArtifactFailureReason,
  RuntimeRunIdentityArchiveFailure,
  RuntimePageContext,
} from './model'
import { RUNTIME_IDENTITY_PROTOCOL, type RuntimeIdentityRecord, type RuntimeIdentitySnapshot } from './runtime-identity'
// @ts-expect-error Plain ESM is shared with the isolated Chromium executor.
import { planVisualCaptures, visualViewportDir, VISUAL_CAPTURE_STATE } from './visual-capture-executor.mjs'

export const RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES = 16 * 1024 * 1024
const CAPTURE_SCHEMA = 'ripple-runtime-identity-capture/v1'
const HASH_PATTERN = /^[a-f0-9]{64}$/
const DETAIL_LIMIT = 240
const READ_CHUNK_BYTES = 64 * 1024

const archiveFailureReasons: readonly RuntimeIdentityArtifactFailureReason[] = [
  'collector-error', 'snapshot-unavailable', 'side-missing', 'artifact-hash-mismatch',
]
const runtimeIdentityReasons = new Set([
  'invalid-certainty', 'unmapped-owner', 'instance-unavailable', 'duplicate-runtime-instance',
  'route-namespace-stale', 'source-version-unavailable', 'source-version-ambiguous',
  'source-version-mismatch', 'source-not-in-graph', 'page-context-mismatch',
  'page-context-unverified', 'react-keys-unavailable', 'identity-not-stable',
])
const identityCertainties = new Set(['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped'])

export interface RuntimeIdentityCapturePlan {
  checkId: string
  route: string
  viewport: { width: number; height: number }
  state: string
  side: 'baseline' | 'candidate'
  /** Derived from the trusted viewport name, never from the container manifest. */
  artifactPath: string
}

export interface VerifiedRuntimeIdentitySnapshotArchive {
  checkId: string
  route: string
  viewport: { width: number; height: number }
  state: string
  side: 'baseline' | 'candidate'
  archive: 'stored'
  snapshot: RuntimeIdentitySnapshot
  snapshotSha256: string
  artifact: { snapshot: { path: string; sha256: string } }
}

export type RuntimeIdentityArchiveReadEntry = VerifiedRuntimeIdentitySnapshotArchive | RuntimeRunIdentityArchiveFailure

export interface RuntimeIdentityArchiveReadResult {
  /** Exactly one result for each side in the trusted capture plan. */
  entries: RuntimeIdentityArchiveReadEntry[]
  /** Bounded host diagnostics for manifest entries that do not map to a trusted run point. */
  diagnostics: string[]
}

export interface PlanRuntimeIdentityCapturesInput {
  runId: string
  viewports: ReadonlyArray<{ name: string; width: number; height: number }>
  verificationContract?: BrowserVerificationContract
}

export interface ReadRuntimeIdentityArchivesInput {
  runRoot: string
  plannedCaptures: RuntimeIdentityCapturePlan[]
  manifestEntries: unknown
}

class ArchiveReadError extends Error {
  constructor(
    readonly reason: RuntimeIdentityArtifactFailureReason,
    readonly detail: string,
    readonly artifactLanded = false,
  ) {
    super(detail)
    this.name = 'ArchiveReadError'
  }
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key))
const isHash = (value: unknown): value is string => typeof value === 'string' && HASH_PATTERN.test(value)

function sanitizeArchiveDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const detail = value
    .replace(/https?:\/\/[^\s]+/gi, '<url>')
    .replace(/[A-Za-z]:[\\/][^\s'"<>]+/g, '<path>')
    .replace(/(^|\s)\/(?:[^\s'"<>]+)/g, '$1<path>')
    .replace(/\b(token|password|secret|api[_-]?key|authorization)\b\s*[:=]\s*[^,\s;]+/gi, '$1=<redacted>')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, DETAIL_LIMIT)
  return detail || undefined
}

function isRuntimePageContext(value: unknown): value is RuntimePageContext {
  return isObject(value) && hasOnlyKeys(value, ['pathname', 'search', 'hash']) &&
    typeof value.pathname === 'string' && typeof value.search === 'string' && typeof value.hash === 'string'
}

function isRuntimeIdentityRecord(value: unknown): value is RuntimeIdentityRecord {
  if (!isObject(value) || !hasOnlyKeys(value, [
    'sourceRef', 'sourceFile', 'runtimeInstanceId', 'declaredCertainty', 'certainty', 'listKey',
    'sourceVersion', 'domNode', 'sameSourceCount', 'reasons', 'label',
  ])) return false
  return typeof value.sourceRef === 'string' &&
    (value.sourceFile === undefined || typeof value.sourceFile === 'string') &&
    (value.runtimeInstanceId === undefined || typeof value.runtimeInstanceId === 'string') &&
    typeof value.declaredCertainty === 'string' && identityCertainties.has(value.declaredCertainty) &&
    typeof value.certainty === 'string' && identityCertainties.has(value.certainty) &&
    (value.listKey === undefined || typeof value.listKey === 'string') &&
    (value.sourceVersion === undefined || isHash(value.sourceVersion)) &&
    Number.isSafeInteger(value.domNode) && Number(value.domNode) > 0 &&
    Number.isSafeInteger(value.sameSourceCount) && Number(value.sameSourceCount) > 0 &&
    Array.isArray(value.reasons) && value.reasons.every(reason => typeof reason === 'string' && runtimeIdentityReasons.has(reason)) &&
    (value.label === undefined || typeof value.label === 'string')
}

function isRuntimeIdentitySnapshot(value: unknown): value is RuntimeIdentitySnapshot {
  return isObject(value) && hasOnlyKeys(value, ['protocol', 'page', 'records']) &&
    value.protocol === RUNTIME_IDENTITY_PROTOCOL && isRuntimePageContext(value.page) &&
    Array.isArray(value.records) && value.records.every(isRuntimeIdentityRecord)
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Runtime identity snapshot contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  throw new Error('Runtime identity snapshot contains an unsupported value.')
}

/** Deterministic JSON for host-side snapshot and per-record assessment hashes. */
export const canonicalRuntimeIdentityJson = stableSerialize

const planKey = (item: Pick<RuntimeIdentityCapturePlan, 'checkId' | 'route' | 'viewport' | 'state' | 'side'>) =>
  `${item.checkId}\u0000${item.route}\u0000${item.viewport.width}x${item.viewport.height}\u0000${item.state}\u0000${item.side}`

function isViewport(value: unknown): value is { width: number; height: number } {
  return isObject(value) && hasOnlyKeys(value, ['width', 'height']) &&
    Number.isInteger(value.width) && Number(value.width) > 0 && Number.isInteger(value.height) && Number(value.height) > 0
}

function captureKey(value: unknown): string | undefined {
  if (!isObject(value) || typeof value.checkId !== 'string' || typeof value.route !== 'string' ||
    !isViewport(value.viewport) || typeof value.state !== 'string' ||
    (value.side !== 'baseline' && value.side !== 'candidate')) return undefined
  return planKey({
    checkId: value.checkId,
    route: value.route,
    viewport: { width: Number(value.viewport.width), height: Number(value.viewport.height) },
    state: value.state,
    side: value.side,
  })
}

function failure(
  plan: RuntimeIdentityCapturePlan,
  reason: RuntimeIdentityArtifactFailureReason,
  detail?: unknown,
  declaredSnapshotSha256?: unknown,
): RuntimeRunIdentityArchiveFailure {
  const safeDetail = sanitizeArchiveDetail(detail)
  return {
    checkId: plan.checkId,
    route: plan.route,
    viewport: { ...plan.viewport },
    state: plan.state,
    side: plan.side,
    archive: 'failed',
    reason,
    ...(isHash(declaredSnapshotSha256) ? { declaredSnapshotSha256 } : {}),
    ...(safeDetail ? { detail: safeDetail } : {}),
  }
}

function failureReason(value: unknown): RuntimeIdentityArtifactFailureReason {
  // `version-unverifiable` is host-only: a container claim cannot establish source-version failure.
  return typeof value === 'string' && archiveFailureReasons.includes(value as RuntimeIdentityArtifactFailureReason)
    ? value as RuntimeIdentityArtifactFailureReason
    : 'snapshot-unavailable'
}

function safeRunRoot(runRoot: string): string {
  const absolute = path.resolve(runRoot)
  const root = path.parse(absolute).root
  const segments = absolute.slice(root.length).split(path.sep).filter(Boolean)
  let current = root
  const paths = [root]
  for (const segment of segments) {
    current = path.join(current, segment)
    paths.push(current)
  }
  for (const [index, item] of paths.entries()) {
    let stat: fs.Stats
    try { stat = fs.lstatSync(item) }
    catch (error) {
      const code = isObject(error) ? error.code : undefined
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new ArchiveReadError('side-missing', 'Trusted verification run directory is missing.')
      throw new ArchiveReadError('snapshot-unavailable', 'Trusted verification run directory cannot be inspected.')
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ArchiveReadError('snapshot-unavailable', index === paths.length - 1
        ? 'Trusted verification run root is not a regular directory.'
        : 'Trusted verification run root traverses a symbolic link or non-directory.')
    }
  }
  try { return fs.realpathSync(absolute) }
  catch { throw new ArchiveReadError('snapshot-unavailable', 'Trusted verification run root cannot be resolved.') }
}

function readRegularArtifact(runRoot: string, relativePath: string): Buffer {
  if (path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact path is invalid.')
  }
  const absolute = path.resolve(runRoot, ...relativePath.split('/'))
  const relative = path.relative(runRoot, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact path escaped its trusted run root.')
  }

  let current = runRoot
  const segments = relativePath.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index])
    let stat: fs.Stats
    try { stat = fs.lstatSync(current) }
    catch (error) {
      const code = isObject(error) ? error.code : undefined
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new ArchiveReadError('side-missing', 'Runtime identity snapshot artifact is missing.')
      throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity snapshot artifact cannot be inspected.')
    }
    const isLast = index === segments.length - 1
    if (stat.isSymbolicLink()) throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact cannot traverse a symbolic link.')
    if (isLast ? !stat.isFile() : !stat.isDirectory()) throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact path contains a non-regular file or directory.')
    if (isLast && stat.size > RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES) {
      throw new ArchiveReadError('snapshot-unavailable', `Runtime identity snapshot exceeds the ${RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES}-byte limit.`, true)
    }
  }

  let rootBefore: fs.Stats
  try { rootBefore = fs.lstatSync(runRoot) }
  catch { throw new ArchiveReadError('side-missing', 'Trusted verification run directory is missing.') }
  if (rootBefore.isSymbolicLink() || !rootBefore.isDirectory()) {
    throw new ArchiveReadError('snapshot-unavailable', 'Trusted verification run root changed before artifact read.')
  }

  let fd: number | undefined
  let artifactLanded = false
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)
    fd = fs.openSync(absolute, flags)
    const before = fs.fstatSync(fd)
    if (!before.isFile()) throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact is not a regular file.')
    artifactLanded = true
    if (before.size > RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES) {
      throw new ArchiveReadError('snapshot-unavailable', `Runtime identity snapshot exceeds the ${RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES}-byte limit.`, true)
    }

    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const remaining = RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES + 1 - total
      if (remaining <= 0) throw new ArchiveReadError('snapshot-unavailable', `Runtime identity snapshot exceeds the ${RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES}-byte limit.`, true)
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining))
      const read = fs.readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) break
      total += read
      if (total > RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES) {
        throw new ArchiveReadError('snapshot-unavailable', `Runtime identity snapshot exceeds the ${RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES}-byte limit.`, true)
      }
      chunks.push(chunk.subarray(0, read))
    }
    const after = fs.fstatSync(fd)
    const pathStat = fs.lstatSync(absolute)
    let parent = runRoot
    for (const segment of segments.slice(0, -1)) {
      parent = path.join(parent, segment)
      const parentStat = fs.lstatSync(parent)
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
        throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact parent changed or became a symbolic link.', true)
      }
    }
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || after.size !== total ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
      pathStat.dev !== before.dev || (pathStat.ino !== 0 && before.ino !== 0 && pathStat.ino !== before.ino)) {
      throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact changed while the host was reading it.', true)
    }
    const rootAfter = fs.lstatSync(runRoot)
    if (rootAfter.isSymbolicLink() || !rootAfter.isDirectory() || rootAfter.dev !== rootBefore.dev ||
      (rootAfter.ino !== 0 && rootBefore.ino !== 0 && rootAfter.ino !== rootBefore.ino) || safeRunRoot(runRoot) !== runRoot) {
      throw new ArchiveReadError('snapshot-unavailable', 'Trusted verification run root changed while the host was reading it.', true)
    }
    return Buffer.concat(chunks, total)
  } catch (error) {
    if (error instanceof ArchiveReadError) throw error
    throw new ArchiveReadError('snapshot-unavailable', 'Runtime identity artifact could not be read as a regular file.', artifactLanded)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function captureEnvelopeError(entry: Record<string, unknown>, plan: RuntimeIdentityCapturePlan): string | undefined {
  if (entry.schema !== CAPTURE_SCHEMA || entry.checkId !== plan.checkId || entry.route !== plan.route ||
    entry.state !== plan.state || entry.side !== plan.side || !isViewport(entry.viewport) ||
    entry.viewport.width !== plan.viewport.width || entry.viewport.height !== plan.viewport.height) {
    return 'Runtime identity capture tuple does not match the trusted run plan.'
  }
  const allowed = entry.archive === 'stored'
    ? ['schema', 'checkId', 'route', 'viewport', 'state', 'side', 'archive', 'snapshotSha256', 'artifact']
    : ['schema', 'checkId', 'route', 'viewport', 'state', 'side', 'archive', 'reason', 'detail']
  if (!hasOnlyKeys(entry, allowed)) return 'Runtime identity capture entry has an invalid protocol shape.'
  if (!isObject(entry.viewport) || !hasOnlyKeys(entry.viewport, ['width', 'height'])) return 'Runtime identity capture viewport is malformed.'
  return undefined
}

function verifyOneCapture(entryValue: unknown, plan: RuntimeIdentityCapturePlan, runRoot: string): RuntimeIdentityArchiveReadEntry {
  if (!isObject(entryValue)) return failure(plan, 'snapshot-unavailable', 'Runtime identity capture entry is malformed.')
  const envelopeError = captureEnvelopeError(entryValue, plan)
  if (envelopeError) return failure(plan, 'snapshot-unavailable', envelopeError)

  if (entryValue.archive === 'failed') {
    return failure(plan, failureReason(entryValue.reason), entryValue.detail)
  }
  if (entryValue.archive !== 'stored') return failure(plan, 'snapshot-unavailable', 'Runtime identity capture is not marked stored.')
  if (!isObject(entryValue.artifact) || !hasOnlyKeys(entryValue.artifact, ['snapshot']) ||
    !isObject(entryValue.artifact.snapshot) || !hasOnlyKeys(entryValue.artifact.snapshot, ['path', 'sha256'])) {
    return failure(plan, 'snapshot-unavailable', 'Runtime identity artifact declaration is malformed.')
  }
  const artifact = entryValue.artifact.snapshot
  if (artifact.path !== plan.artifactPath) return failure(plan, 'snapshot-unavailable', 'Runtime identity artifact path does not match the host-derived path.')

  let bytes: Buffer
  try { bytes = readRegularArtifact(runRoot, plan.artifactPath) }
  catch (error) {
    if (error instanceof ArchiveReadError) {
      return failure(plan, error.reason, error.detail, error.artifactLanded ? entryValue.snapshotSha256 : undefined)
    }
    return failure(plan, 'snapshot-unavailable', 'Runtime identity artifact could not be read.')
  }
  const actualSha256 = sha256(bytes)
  const declaredSha256 = isHash(entryValue.snapshotSha256) ? entryValue.snapshotSha256 : undefined
  const artifactSha256 = isHash(artifact.sha256) ? artifact.sha256 : undefined
  if (!declaredSha256 || !artifactSha256 || declaredSha256 !== artifactSha256 || actualSha256 !== declaredSha256) {
    return failure(plan, 'artifact-hash-mismatch', 'Runtime identity artifact hash does not match the host-computed bytes.', declaredSha256 ?? artifactSha256)
  }

  let snapshotValue: unknown
  try { snapshotValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { return failure(plan, 'snapshot-unavailable', 'Runtime identity artifact is not valid UTF-8 JSON.', declaredSha256) }
  if (!isRuntimeIdentitySnapshot(snapshotValue)) {
    return failure(plan, 'snapshot-unavailable', 'Runtime identity snapshot does not match ripple-runtime-identity/v1.', declaredSha256)
  }
  let canonicalBytes: Buffer
  try { canonicalBytes = Buffer.from(`${stableSerialize(snapshotValue)}\n`, 'utf8') }
  catch { return failure(plan, 'snapshot-unavailable', 'Runtime identity snapshot cannot be canonically serialized.', declaredSha256) }
  if (!canonicalBytes.equals(bytes)) {
    return failure(plan, 'snapshot-unavailable', 'Runtime identity snapshot is not in the A① canonical JSON form.', declaredSha256)
  }
  return {
    checkId: plan.checkId,
    route: plan.route,
    viewport: { ...plan.viewport },
    state: plan.state,
    side: plan.side,
    archive: 'stored',
    snapshot: snapshotValue,
    snapshotSha256: actualSha256,
    artifact: { snapshot: { path: plan.artifactPath, sha256: actualSha256 } },
  }
}

/** Derive every allowed side and artifact path from the host's verification plan. */
export function planRuntimeIdentityCaptures(input: PlanRuntimeIdentityCapturesInput): RuntimeIdentityCapturePlan[] {
  const captures = planVisualCaptures({
    runId: input.runId,
    viewports: input.viewports,
    verificationContract: input.verificationContract,
  }) as Array<{ checkId: string; route: string; viewport: { name: string; width: number; height: number } }>
  const result: RuntimeIdentityCapturePlan[] = []
  for (const capture of captures) {
    for (const side of ['baseline', 'candidate'] as const) {
      result.push({
        checkId: capture.checkId,
        route: capture.route,
        viewport: { width: capture.viewport.width, height: capture.viewport.height },
        state: VISUAL_CAPTURE_STATE,
        side,
        artifactPath: `identity/${visualViewportDir(capture.viewport.name)}/${side}-identity.json`,
      })
    }
  }
  const keys = result.map(planKey)
  if (new Set(keys).size !== keys.length) throw new Error('Trusted runtime identity capture plan contains duplicate sides.')
  const paths = result.map(capture => capture.artifactPath)
  if (new Set(paths).size !== paths.length) throw new Error('Trusted runtime identity capture plan contains colliding artifact paths.')
  return result
}

/**
 * Re-read A① artifacts on the host. The manifest is treated as untrusted metadata:
 * it can select neither a path nor a run point, and its hashes are checked against
 * the exact regular-file bytes before JSON is parsed.
 */
export function readRuntimeIdentityArchives(input: ReadRuntimeIdentityArchivesInput): RuntimeIdentityArchiveReadResult {
  const diagnostics: string[] = []
  const plans = input.plannedCaptures
  const entries = Array.isArray(input.manifestEntries) ? input.manifestEntries : []
  if (!Array.isArray(input.manifestEntries)) diagnostics.push('Runtime identity capture list is missing or malformed.')

  const planKeys = new Set(plans.map(planKey))
  if (planKeys.size !== plans.length) throw new Error('Trusted runtime identity capture plan contains duplicate sides.')
  const byKey = new Map<string, unknown[]>()
  for (const entry of entries) {
    const key = captureKey(entry)
    if (!key || !planKeys.has(key)) continue
    const group = byKey.get(key) ?? []
    group.push(entry)
    byKey.set(key, group)
  }

  let runRoot: string | undefined
  let rootFailure: ArchiveReadError | undefined
  try { runRoot = safeRunRoot(input.runRoot) }
  catch (error) {
    rootFailure = error instanceof ArchiveReadError ? error : new ArchiveReadError('snapshot-unavailable', 'Trusted verification run root is invalid.')
    diagnostics.push(rootFailure.detail)
  }

  const consumed = new Set<unknown>()
  const results = plans.map(plan => {
    const key = planKey(plan)
    const matches = byKey.get(key) ?? []
    const sameCheckSide = entries.filter(entry => isObject(entry) && entry.checkId === plan.checkId && entry.side === plan.side)
    for (const entry of sameCheckSide) consumed.add(entry)
    for (const entry of matches) consumed.add(entry)

    if (rootFailure) return failure(plan, rootFailure.reason, rootFailure.detail)
    if (matches.length > 1 || sameCheckSide.length > 1) {
      return failure(plan, 'snapshot-unavailable', 'Runtime identity manifest repeats this planned side.')
    }
    if (matches.length === 0) {
      const sameCheck = entries.some(entry => isObject(entry) && entry.checkId === plan.checkId)
      const sameSide = sameCheckSide.length > 0
      return sameSide
        ? failure(plan, 'snapshot-unavailable', 'Runtime identity capture tuple differs from the trusted run plan.')
        : failure(plan, 'side-missing', sameCheck ? 'Runtime identity side is missing from the manifest.' : 'Runtime identity capture entry is missing from the manifest.')
    }
    return verifyOneCapture(matches[0], plan, runRoot!)
  })

  if (Array.isArray(input.manifestEntries)) {
    const unexpected = entries.filter(entry => !consumed.has(entry))
    if (unexpected.length > 0) diagnostics.push(`${unexpected.length} unplanned runtime identity capture entr${unexpected.length === 1 ? 'y was' : 'ies were'} rejected.`)
  }
  return { entries: results, diagnostics: diagnostics.slice(0, 32).map(detail => sanitizeArchiveDetail(detail) ?? 'Runtime identity archive diagnostic.') }
}
