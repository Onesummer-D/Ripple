import { createHash } from 'node:crypto'
import type {
  BrowserVerificationContract,
  RuntimeRunIdentity,
  RuntimeRunIdentityArchiveFailure,
  SourceGraph,
} from './model'
import { assessRuntimeIdentity, sourceFileFromRef, type RuntimeIdentityRecord } from './runtime-identity'
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

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function expectedPageFor(route: string, contract: BrowserVerificationContract | undefined) {
  const matches = contract?.pages.filter(page => page.path === route) ?? []
  if (matches.length !== 1) return undefined
  return { pathname: matches[0].path, search: '', hash: '' }
}

function failedVersionBinding(
  entry: Extract<RuntimeIdentityArchiveReadEntry, { archive: 'stored' }>,
): RuntimeRunIdentityArchiveFailure {
  return {
    checkId: entry.checkId,
    route: entry.route,
    viewport: { ...entry.viewport },
    state: entry.state,
    side: entry.side,
    archive: 'failed',
    reason: 'version-unverifiable',
    detail: `${entry.side} source tree or graph revision does not match its trusted bound digest.`,
  }
}

function revisionBound(side: RuntimeIdentitySideSource): boolean {
  if (!/^[a-f0-9]{64}$/.test(side.boundDigest) || side.graph.revision.sourceDigest !== side.boundDigest) return false
  try { return digestTrackedTree(side.root) === side.boundDigest }
  catch { return false }
}

function hostRecordForAssessment(record: RuntimeIdentityRecord, duplicateIds: ReadonlySet<string>, sameSourceCounts: ReadonlyMap<string, number>): RuntimeIdentityRecord {
  const reasons = new Set(record.reasons)
  if (!nonEmpty(record.runtimeInstanceId)) reasons.add('instance-unavailable')
  else if (duplicateIds.has(record.runtimeInstanceId)) reasons.add('duplicate-runtime-instance')

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

function assessStoredEntry(
  entry: Extract<RuntimeIdentityArchiveReadEntry, { archive: 'stored' }>,
  input: AssessRuntimeIdentityArchivesInput,
): RuntimeRunIdentity | RuntimeRunIdentityArchiveFailure {
  const side = input.sides[entry.side]
  if (!revisionBound(side)) return failedVersionBinding(entry)

  const records = entry.snapshot.records
  const idCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  for (const record of records) {
    if (nonEmpty(record.runtimeInstanceId)) idCounts.set(record.runtimeInstanceId, (idCounts.get(record.runtimeInstanceId) ?? 0) + 1)
    sourceCounts.set(record.sourceRef, (sourceCounts.get(record.sourceRef) ?? 0) + 1)
  }
  const duplicateIds = new Set([...idCounts].filter(([, count]) => count > 1).map(([id]) => id))
  const files = [...new Set(records.map(record => sourceFileFromRef(record.sourceRef)).filter((file): file is string => !!file))].sort()
  const sourceDigests: Record<string, string> = {}
  for (const file of files) {
    try { sourceDigests[file] = servedSourceDigest(side.root, file) }
    catch { /* Missing or unsafe source files become source-version-unavailable per record. */ }
  }

  const expectedPage = expectedPageFor(entry.route, input.verificationContract)
  const assessments = records.map((record, index) => {
    const hostRecord = hostRecordForAssessment(record, duplicateIds, sourceCounts)
    const sourceFile = sourceFileFromRef(record.sourceRef)
    const assessment = assessRuntimeIdentity(side.graph, entry.snapshot, hostRecord, {
      fileDigest: file => sourceFile && file === sourceFile ? sourceDigests[sourceFile] : undefined,
      ...(expectedPage ? { expectedPage } : {}),
    })
    const recordKey = `${record.sourceRef}#${record.runtimeInstanceId ?? `@${index}`}`
    return { recordKey, assessment, assessmentSha256: sha256(canonicalRuntimeIdentityJson(assessment)) }
  })

  return {
    checkId: entry.checkId,
    route: entry.route,
    viewport: { ...entry.viewport },
    state: entry.state,
    side: entry.side,
    snapshot: entry.snapshot,
    snapshotSha256: entry.snapshotSha256,
    assessments,
    sourceDigests: Object.fromEntries(Object.entries(sourceDigests).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    boundDigest: side.boundDigest,
    artifacts: { snapshot: { ...entry.artifact.snapshot } },
  }
}

/** Host-only assessment of already host-verified A① snapshots. */
export function assessRuntimeIdentityArchives(input: AssessRuntimeIdentityArchivesInput): Array<RuntimeRunIdentity | RuntimeRunIdentityArchiveFailure> {
  return input.archiveEntries.map(entry => entry.archive === 'stored'
    ? assessStoredEntry(entry, input)
    : { ...entry, viewport: { ...entry.viewport } })
}
