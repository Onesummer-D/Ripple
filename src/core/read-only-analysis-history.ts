import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import { canonicalJson } from './graph-identity-v2'
import { workbenchStateRoot } from './workbench-store'
import type { ReadOnlyAnalysisVerified } from './local-project-read-only-analysis'

export const READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION = 'ripple/read-only-analysis-history/v1' as const
export const READ_ONLY_ANALYSIS_HISTORY_MAX_RECORD_BYTES = 64 * 1024
export const READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS = 100
export const READ_ONLY_ANALYSIS_HISTORY_MAX_BYTES = 16 * 1024 * 1024
const ROOT_NAME = 'read-only-analysis-history'
const locks = new Map<string, Promise<void>>()
export interface ReadOnlyAnalysisHistoryRecordV1 {
  readonly schemaVersion: typeof READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION
  readonly recordId: string
  readonly capturedAt: string
  readonly projectId: string
  readonly repository: string
  readonly gitHead: string
  readonly rootTree: string
  readonly sourceDigest: string
  readonly graphDigest: string
  readonly mappingCount: number
  readonly unresolvedCount: number
  readonly hostReceiptStatus: 'verified'
  readonly producerEvidenceStatus: 'available-producer-evidence'
}
type Identity = Omit<ReadOnlyAnalysisHistoryRecordV1, 'recordId' | 'capturedAt'>
const projectHash = (id: string) => createHash('sha256').update(id, 'utf8').digest('hex')
const validProject = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v === v.trim() && !/[\u0000-\u001f\u007f]/u.test(v)
const validHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/u.test(v)
const validOid = (v: unknown): v is string => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(v)
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
function identityTuple(r: Identity): unknown[] {
  return [r.schemaVersion, r.projectId, r.repository, r.gitHead, r.rootTree, r.sourceDigest, r.graphDigest, r.mappingCount, r.unresolvedCount, r.hostReceiptStatus, r.producerEvidenceStatus]
}
export function readOnlyAnalysisRecordId(r: Identity): string {
  return createHash('sha256').update(READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION + '\0' + canonicalJson(identityTuple(r)), 'utf8').digest('hex')
}
function assertDir(p: string) {
  const stat = fs.lstatSync(p)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('history-storage-invalid')
}
function assertRecordName(name: string): void {
  if (!/^[0-9a-f]{64}\.json$/u.test(name)) throw new Error('history-storage-invalid')
}
function storageBytes(root: string): number {
  if (!fs.existsSync(root)) return 0
  assertDir(root)
  let total = 0
  for (const projectEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!/^[0-9a-f]{64}$/u.test(projectEntry.name)) throw new Error('history-storage-invalid')
    const projectPath = path.join(root, projectEntry.name)
    const projectStat = fs.lstatSync(projectPath)
    if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) throw new Error('history-storage-invalid')
    for (const recordEntry of fs.readdirSync(projectPath, { withFileTypes: true })) {
      assertRecordName(recordEntry.name)
      const recordPath = path.join(projectPath, recordEntry.name)
      const recordStat = fs.lstatSync(recordPath)
      if (recordStat.isSymbolicLink() || !recordStat.isFile()) throw new Error('history-storage-invalid')
      total += recordStat.size
    }
  }
  return total
}
function validateRecord(value: unknown, projectId: string): ReadOnlyAnalysisHistoryRecordV1 {
  if (!plain(value) || Object.keys(value).length !== 13 || value.schemaVersion !== READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION ||
      value.projectId !== projectId || typeof value.recordId !== 'string' || !/^[0-9a-f]{64}$/.test(value.recordId) ||
      typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt)) || typeof value.repository !== 'string' ||
      !validOid(value.gitHead) || !validOid(value.rootTree) || !validHash(value.sourceDigest) || !validHash(value.graphDigest) ||
      !Number.isSafeInteger(value.mappingCount) || (value.mappingCount as number) < 0 || !Number.isSafeInteger(value.unresolvedCount) || (value.unresolvedCount as number) < 0 ||
      value.hostReceiptStatus !== 'verified' || value.producerEvidenceStatus !== 'available-producer-evidence') throw new Error('history-record-corrupt')
  const record = value as unknown as ReadOnlyAnalysisHistoryRecordV1
  if (readOnlyAnalysisRecordId(record) !== record.recordId) throw new Error('history-record-corrupt')
  return record
}
function paths(projectId: string) {
  const root = path.join(workbenchStateRoot(), ROOT_NAME)
  return { root, directory: path.join(root, projectHash(projectId)) }
}
function readRecords(projectId: string): ReadOnlyAnalysisHistoryRecordV1[] {
  if (!validProject(projectId)) throw new Error('history-project-invalid')
  const { root, directory } = paths(projectId)
  if (!fs.existsSync(root)) return []
  assertDir(root)
  if (!fs.existsSync(directory)) return []
  assertDir(directory)
  let totalBytes = 0
  const records = fs.readdirSync(directory, { withFileTypes: true }).map(entry => {
    assertRecordName(entry.name)
    const file = path.join(directory, entry.name)
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('history-storage-invalid')
    totalBytes += stat.size
    if (stat.size > READ_ONLY_ANALYSIS_HISTORY_MAX_RECORD_BYTES) throw new Error('history-record-corrupt')
    if (totalBytes > READ_ONLY_ANALYSIS_HISTORY_MAX_BYTES) throw new Error('history-storage-limit')
    try {
      return validateRecord(JSON.parse(fs.readFileSync(file, 'utf8')), projectId)
    } catch (error) {
      if (error instanceof Error && (error.message === 'history-record-corrupt' || error.message === 'history-storage-invalid')) throw error
      throw new Error('history-record-corrupt')
    }
  })
  return records.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.recordId.localeCompare(a.recordId))
}
function fromVerified(v: ReadOnlyAnalysisVerified): Identity {
  return {
    schemaVersion: READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION, projectId: v.summary.projectId, repository: v.repository,
    gitHead: v.gitHead, rootTree: v.rootTree, sourceDigest: v.sourceDigest, graphDigest: v.graphDigest,
    mappingCount: v.mappingCount, unresolvedCount: v.unresolvedCount,
    hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
  }
}
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>(resolve => { release = resolve })
  locks.set(id, previous.then(() => next))
  await previous
  try { return await fn() } finally { release(); if (locks.get(id) === next) locks.delete(id) }
}
async function save(v: ReadOnlyAnalysisVerified) {
  return withLock(v.summary.projectId, async () => {
    const identity = fromVerified(v)
    const recordId = readOnlyAnalysisRecordId(identity)
    const existing = readRecords(identity.projectId).find(record => record.recordId === recordId)
    if (existing) return { status: 'saved' as const, record: existing, deduplicated: true }
    if (readRecords(identity.projectId).length >= READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS) throw new Error('history-storage-limit')
    const record = { ...identity, recordId, capturedAt: new Date().toISOString() }
    const bytes = Buffer.from(JSON.stringify(record) + '\n', 'utf8')
    if (bytes.length > READ_ONLY_ANALYSIS_HISTORY_MAX_RECORD_BYTES) throw new Error('history-storage-limit')
    const { root, directory } = paths(identity.projectId)
    const existingBytes = storageBytes(root)
    if (existingBytes + bytes.length > READ_ONLY_ANALYSIS_HISTORY_MAX_BYTES) throw new Error('history-storage-limit')
    fs.mkdirSync(root, { recursive: true, mode: 0o700 }); assertDir(root)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); assertDir(directory)
    const file = path.join(directory, recordId + '.json')
    const temp = path.join(directory, '.record-' + randomUUID() + '.tmp')
    const handle = fs.openSync(temp, 'wx', 0o600)
    try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
    try { fs.renameSync(temp, file) } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
    return { status: 'saved' as const, record, deduplicated: false }
  })
}
export interface ReadOnlyAnalysisHistoryService {
  capture(verified: ReadOnlyAnalysisVerified): Promise<{ status: 'saved'; record: ReadOnlyAnalysisHistoryRecordV1; deduplicated: boolean }>
  list(projectId: string, limit?: number): ReadOnlyAnalysisHistoryRecordV1[]
}
export function createReadOnlyAnalysisHistoryService(): ReadOnlyAnalysisHistoryService {
  return {
    capture: save,
    list(projectId, limit = READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS) {
      if (!Number.isInteger(limit) || limit < 1 || limit > READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS) throw new Error('history-limit-invalid')
      return readRecords(projectId).slice(0, limit)
    },
  }
}
