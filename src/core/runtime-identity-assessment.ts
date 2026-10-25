import { createHash } from 'node:crypto'
import type {
  BrowserVerificationContract,
  RuntimeRunIdentity,
  RuntimeRunIdentityArchiveFailure,
  RuntimeRunIdentityVersionFailure,
  SourceGraph,
} from './model'
import { assessRuntimeIdentity, RUNTIME_IDENTITY_PROTOCOL, RUNTIME_IDENTITY_PROTOCOL_V2, sourceFileFromRef, type RuntimeIdentityRecord, type RuntimeIdentitySnapshot } from './runtime-identity'
import { canonicalRuntimeIdentityJson, type RuntimeIdentityArchiveReadEntry } from './runtime-identity-archive'
import { digestTrackedTree, servedSourceDigest } from './project'

export interface RuntimeIdentitySideSource {
  /** Host-owned root: baseline projectRoot or candidate candidateRoot. */
  root: string
  graph: SourceGraph
  /** baseSourceDigest for baseline, candidateTreeDigest for candidate. */
  boundDigest: string
}

export interface AssessRuntimeIdentityArchivesInput {
  archiveEntries: readonly RuntimeIdentityArchiveReadEntry[]
  verificationContract?: BrowserVerificationContract
  sides: Record<'baseline' | 'candidate', RuntimeIdentitySideSource>
}

const CONTRACT_ORIGIN = 'http://ripple.local'
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function parseSameOriginPagePath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined
  try {
    const parsed = new URL(value, CONTRACT_ORIGIN)
    if (parsed.origin !== CONTRACT_ORIGIN) return undefined
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
  } catch {
    return undefined
  }
}

function samePagePath(left: { pathname: string; search: string; hash: string }, right: { pathname: string; search: string; hash: string }): boolean {
  return left.pathname === right.pathname && left.search === right.search && left.hash === right.hash
}

function expectedPageFor(route: string, contract: BrowserVerificationContract | undefined) {
  const routePage = parseSameOriginPagePath(route)
  if (!routePage || !Array.isArray(contract?.pages)) return undefined
  const matches = contract.pages
    .map(page => parseSameOriginPagePath(page?.path))
    .filter((page): page is NonNullable<typeof page> => !!page && samePagePath(page, routePage))
  return matches.length === 1 ? matches[0] : undefined
}

function revisionBound(side: RuntimeIdentitySideSource): boolean {
  if (!/^[a-f0-9]{64}$/.test(side.boundDigest) || side.graph.revision.sourceDigest !== side.boundDigest) return false
  try { return digestTrackedTree(side.root) === side.boundDigest }
  catch { return false }
}

function validOwnerTail(value: string, sourceRef: string): boolean {
  if (!/^(?:jsx:|[_:\u00ab])/.test(value) || !nonEmpty(sourceRef)) return false
  // Historical direct-source identities have no owner prefix. Keep those
  // valid while requiring all nested identities to anchor the current JSX
  // source at a colon boundary.
  if (value === sourceRef) return true
  const anchor = `:${sourceRef}`
  const sourceOffset = value.indexOf(anchor)
  if (sourceOffset <= 0 || sourceOffset !== value.lastIndexOf(anchor)) return false
  const suffix = value.slice(sourceOffset + anchor.length)
  // The collector appends only list/key suffixes after the current source.
  // A later JSX source marker means the match was an owner/ancestor anchor.
  if (/(?:^|[:/])jsx:/.test(suffix)) return false
  return suffix === '' || suffix.startsWith(':')
}

/**
 * The v1 namespace records pathname only. It cannot prove a page with search/hash.
 * V2 binds the exact serialized [pathname, search, hash] tuple into each id.
 */
export function runtimeIdentityNamespaceProven(snapshot: RuntimeIdentitySnapshot, record: Pick<RuntimeIdentityRecord, 'runtimeInstanceId' | 'sourceRef'>): boolean {
  const runtimeInstanceId = record.runtimeInstanceId
  if (!nonEmpty(runtimeInstanceId)) return false
  const { pathname, search, hash } = snapshot.page
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') ||
    search && !search.startsWith('?') || hash && !hash.startsWith('#')) return false
  try {
    const parsed = new URL(`${pathname}${search}${hash}`, CONTRACT_ORIGIN)
    if (parsed.origin !== CONTRACT_ORIGIN || parsed.pathname !== pathname || parsed.search !== search || parsed.hash !== hash) return false
  } catch { return false }

  if (snapshot.protocol === RUNTIME_IDENTITY_PROTOCOL) {
    if (search !== '' || hash !== '') return false
    const prefix = `${pathname}:`
    return runtimeInstanceId.startsWith(prefix) && validOwnerTail(runtimeInstanceId.slice(prefix.length), record.sourceRef)
  }

  if (snapshot.protocol !== RUNTIME_IDENTITY_PROTOCOL_V2) return false
  const prefix = 'ripple-page-v2:'
  if (!runtimeInstanceId.startsWith(prefix)) return false
  const separator = runtimeInstanceId.indexOf(':', prefix.length)
  if (separator < 0) return false
  const encodedTuple = runtimeInstanceId.slice(prefix.length, separator)
  const ownerTail = runtimeInstanceId.slice(separator + 1)
  let decoded: unknown
  try { decoded = JSON.parse(decodeURIComponent(encodedTuple)) } catch { return false }
  const expectedTuple = [pathname, search, hash]
  return encodedTuple === encodeURIComponent(JSON.stringify(decoded)) &&
    JSON.stringify(decoded) === JSON.stringify(expectedTuple) && validOwnerTail(ownerTail, record.sourceRef)
}

function hostRecordForAssessment(record: RuntimeIdentityRecord, snapshot: RuntimeIdentitySnapshot, duplicateIds: ReadonlySet<string>, sameSourceCounts: ReadonlyMap<string, number>): RuntimeIdentityRecord {
  const reasons = new Set(record.reasons)
  if (!nonEmpty(record.runtimeInstanceId)) reasons.add('instance-unavailable')
  else if (duplicateIds.has(record.runtimeInstanceId)) reasons.add('duplicate-runtime-instance')
  if (!runtimeIdentityNamespaceProven(snapshot, record)) reasons.add('route-namespace-stale')

  // sourceRef, not a container supplied sourceFile string, selects the host file.
  // This prevents a mismatching advisory field from redirecting the digest read.
  const sourceFile = sourceFileFromRef(record.sourceRef)
  return {
    ...record,
    ...(sourceFile ? { sourceFile } : { sourceFile: undefined }),
    sameSourceCount: sameSourceCounts.get(record.sourceRef) ?? 1,
    reasons: [...reasons],
  }
}

/** Stable, unambiguous tuple key; the snapshot index distinguishes duplicate source/id records. */
export function runtimeIdentityRecordKey(record: RuntimeIdentityRecord, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Runtime identity snapshot index must be a non-negative safe integer.')
  return JSON.stringify([record.sourceRef, record.runtimeInstanceId ?? null, index])
}

export interface RuntimeIdentityAssessmentCaptureTuple {
  checkId: string
  route: string
  viewport: { width: number; height: number }
  state: string
  side: 'baseline' | 'candidate'
}

/** Deterministic content checksum over the assessment and its local trusted keys; not a signature. */
export function runtimeIdentityAssessmentSha256(capture: RuntimeIdentityAssessmentCaptureTuple, snapshotSha256: string, recordKey: string, assessment: unknown): string {
  return sha256(canonicalRuntimeIdentityJson({
    protocol: 'ripple-runtime-identity-assessment/v1.2',
    capture: {
      checkId: capture.checkId,
      route: capture.route,
      viewport: { width: capture.viewport.width, height: capture.viewport.height },
      state: capture.state,
      side: capture.side,
    },
    snapshotSha256,
    recordKey,
    assessment,
  }))
}

function sourceDigestsFor(records: readonly RuntimeIdentityRecord[], side: RuntimeIdentitySideSource): Record<string, string> {
  const files = [...new Set(records.map(record => sourceFileFromRef(record.sourceRef)).filter((file): file is string => !!file))].sort()
  const sourceDigests: Record<string, string> = {}
  for (const file of files) {
    try { sourceDigests[file] = servedSourceDigest(side.root, file) }
    catch { /* Missing or unsafe source files become source-version-unavailable per record. */ }
  }
  return Object.fromEntries(Object.entries(sourceDigests).sort(([left], [right]) => left.localeCompare(right, 'en')))
}

function assessRecords(
  entry: Extract<RuntimeIdentityArchiveReadEntry, { archive: 'stored' }>,
  side: RuntimeIdentitySideSource,
  sourceDigests: Record<string, string>,
  expectedPage: ReturnType<typeof parseSameOriginPagePath>,
  versionBound: boolean,
) {
  const records = entry.snapshot.records
  const idCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  for (const record of records) {
    if (nonEmpty(record.runtimeInstanceId)) idCounts.set(record.runtimeInstanceId, (idCounts.get(record.runtimeInstanceId) ?? 0) + 1)
    sourceCounts.set(record.sourceRef, (sourceCounts.get(record.sourceRef) ?? 0) + 1)
  }
  const duplicateIds = new Set([...idCounts].filter(([, count]) => count > 1).map(([id]) => id))

  return records.map((record, index) => {
    const hostRecord = hostRecordForAssessment(record, entry.snapshot, duplicateIds, sourceCounts)
    const sourceFile = sourceFileFromRef(record.sourceRef)
    const assessment = assessRuntimeIdentity(side.graph, entry.snapshot, hostRecord, {
      // A graph/root binding failure withholds source digests even when files can be read.
      fileDigest: file => versionBound && sourceFile && file === sourceFile ? sourceDigests[sourceFile] : undefined,
      ...(expectedPage ? { expectedPage } : {}),
    })
    const failClosedAssessment = versionBound ? assessment : {
      ...assessment,
      locatable: false,
      instanceIdentityProven: false,
      reasons: [...new Set([...assessment.reasons, 'source-version-unavailable' as const])],
    }
    return {
      recordKey: runtimeIdentityRecordKey(record, index),
      assessment: failClosedAssessment,
      assessmentSha256: runtimeIdentityAssessmentSha256(entry, entry.snapshotSha256, runtimeIdentityRecordKey(record, index), failClosedAssessment),
    }
  })
}

function assessStoredEntry(
  entry: Extract<RuntimeIdentityArchiveReadEntry, { archive: 'stored' }>,
  input: AssessRuntimeIdentityArchivesInput,
): RuntimeRunIdentity | RuntimeRunIdentityVersionFailure {
  const side = input.sides[entry.side]
  const versionBound = revisionBound(side)
  const sourceDigests = sourceDigestsFor(entry.snapshot.records, side)
  const expectedPage = expectedPageFor(entry.route, input.verificationContract)
  const verifiedArchive = {
    archive: 'stored' as const,
    checkId: entry.checkId,
    route: entry.route,
    viewport: { ...entry.viewport },
    state: entry.state,
    side: entry.side,
    snapshot: entry.snapshot,
    snapshotSha256: entry.snapshotSha256,
    assessments: assessRecords(entry, side, sourceDigests, expectedPage, versionBound),
    sourceDigests,
    boundDigest: side.boundDigest,
    artifacts: { snapshot: { ...entry.artifact.snapshot } },
  }
  if (!versionBound) {
    const { sourceDigests: observedSourceDigests, boundDigest: expectedBoundDigest, ...archiveWithoutUnverifiedBindings } = verifiedArchive
    return {
      ...archiveWithoutUnverifiedBindings,
      assessmentStatus: 'version-unverifiable',
      reason: 'version-unverifiable',
      detail: `${entry.side} source tree or graph revision does not match its trusted bound digest.`,
      observedSourceDigests,
      expectedBoundDigest,
    }
  }
  return { ...verifiedArchive, assessmentStatus: 'complete' }
}

/** Host-only assessment of already host-verified A① snapshots. */
export function assessRuntimeIdentityArchives(input: AssessRuntimeIdentityArchivesInput): Array<RuntimeRunIdentity | RuntimeRunIdentityVersionFailure | RuntimeRunIdentityArchiveFailure> {
  return input.archiveEntries.map(entry => entry.archive === 'stored'
    ? assessStoredEntry(entry, input)
    : { ...entry, viewport: { ...entry.viewport } })
}
