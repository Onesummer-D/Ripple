// @vitest-environment node
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  READ_ONLY_ANALYSIS_HISTORY_MAX_BYTES,
  READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS,
  READ_ONLY_ANALYSIS_HISTORY_MAX_RECORD_BYTES,
  READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION,
  createReadOnlyAnalysisHistoryService,
  readOnlyAnalysisRecordId,
} from './read-only-analysis-history'
import type { ReadOnlyAnalysisVerified } from './local-project-read-only-analysis'

const roots: string[] = []
const verified = (projectId = 'project:history', source = 'a'.repeat(64), graph = 'b'.repeat(64)): ReadOnlyAnalysisVerified => ({
  summary: {
    projectId, sourceDigest: source, graphDigest: graph, mappingCount: 2, unresolvedCount: 3,
    hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
  },
  binding: { projectId, repository: 'fixture/history', gitHead: '1'.repeat(40), rootTree: '2'.repeat(40), sourceDigest: source },
  repository: 'fixture/history', gitHead: '1'.repeat(40), rootTree: '2'.repeat(40),
  sourceDigest: source, graphDigest: graph, mappingCount: 2, unresolvedCount: 3,
})

function digestNumber(value: number): string {
  return value.toString(16).padStart(64, '0')
}

function writePaddedRecord(root: string, projectId: string, index: number, size: number): void {
  const identity = {
    schemaVersion: READ_ONLY_ANALYSIS_HISTORY_SCHEMA_VERSION,
    projectId,
    repository: 'fixture/history',
    gitHead: digestNumber(index).slice(0, 40),
    rootTree: digestNumber(index + 1).slice(0, 40),
    sourceDigest: digestNumber(index + 2),
    graphDigest: digestNumber(index + 3),
    mappingCount: index,
    unresolvedCount: index + 1,
    hostReceiptStatus: 'verified' as const,
    producerEvidenceStatus: 'available-producer-evidence' as const,
  }
  const record = { ...identity, recordId: readOnlyAnalysisRecordId(identity), capturedAt: new Date(0).toISOString() }
  const json = JSON.stringify(record)
  const baseBytes = Buffer.byteLength(json + '\n', 'utf8')
  if (baseBytes >= size) throw new Error(`record fixture too small: ${baseBytes} >= ${size}`)
  const directory = path.join(root, 'read-only-analysis-history', createHash('sha256').update(projectId).digest('hex'))
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(directory, record.recordId + '.json'), json + ' '.repeat(size - baseBytes - 1) + '\n', { mode: 0o600 })
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  delete process.env.RIPPLE_WORKBENCH_STATE_DIR
})

describe('read-only analysis history v1', () => {
  it('saves atomically, deduplicates the same source version and keeps new versions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    const first = await service.capture(verified())
    const duplicate = await service.capture(verified())
    const second = await service.capture(verified('project:history', 'c'.repeat(64), 'd'.repeat(64)))
    expect(first.deduplicated).toBe(false)
    expect(duplicate).toMatchObject({ deduplicated: true, record: { recordId: first.record.recordId } })
    expect(second.deduplicated).toBe(false)
    expect(service.list('project:history')).toHaveLength(2)
    const idHash = createHash('sha256').update('project:history').digest('hex')
    const persistedFiles = fs.readdirSync(path.join(root, 'read-only-analysis-history', idHash))
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'read-only-analysis-history', idHash, persistedFiles[0]), 'utf8'))
    expect(persisted.schemaVersion).toBe('ripple/read-only-analysis-history/v1')
  })

  it('recovers after service recreation and isolates project records', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    await service.capture(verified())
    expect(createReadOnlyAnalysisHistoryService().list('project:history')).toHaveLength(1)
    expect(service.list('another-project')).toEqual([])
  })

  it('enforces the 100-record project limit independently of the global byte limit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    for (let index = 0; index < READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS; index += 1) {
      writePaddedRecord(root, 'record-limit', index, 1_024)
    }
    await expect(service.capture(verified('record-limit', digestNumber(10000), digestNumber(11000)))).rejects.toThrow('history-storage-limit')
    expect(service.list('record-limit')).toHaveLength(READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS)
  })

  it('enforces the global byte limit across projects and preserves isolated histories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const projects = ['capacity-one', 'capacity-two', 'capacity-three']
    const recordSize = 55_920
    for (const [projectIndex, projectId] of projects.entries()) {
      for (let index = 0; index < READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS; index += 1) {
        writePaddedRecord(root, projectId, projectIndex * 100 + index, recordSize)
      }
    }
    const orphanDirectory = path.join(root, 'read-only-analysis-history', createHash('sha256').update(projects[2]).digest('hex'))
    const orphan = path.join(orphanDirectory, '.record-123e4567-e89b-42d3-a456-426614174000.tmp')
    fs.writeFileSync(orphan, 'o'.repeat(1_000), { mode: 0o600 })
    const service = createReadOnlyAnalysisHistoryService()
    expect(service.list(projects[0])).toHaveLength(READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS)
    expect(service.list(projects[1])).toHaveLength(READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS)
    const existing = service.list(projects[2])
    expect(existing).toHaveLength(READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS)
    await expect(service.capture(verified('capacity-four', 'f'.repeat(64), 'e'.repeat(64)))).rejects.toThrow('history-storage-limit')
    expect(service.list(projects[0])).toHaveLength(READ_ONLY_ANALYSIS_HISTORY_MAX_RECORDS)
    expect(service.list('capacity-four')).toEqual([])
    expect(fs.existsSync(orphan)).toBe(true)
    expect(READ_ONLY_ANALYSIS_HISTORY_MAX_BYTES).toBeGreaterThan(300 * recordSize)
    expect(recordSize).toBeLessThan(READ_ONLY_ANALYSIS_HISTORY_MAX_RECORD_BYTES)
  })

  it('ignores only regular service temp files left by an interrupted write', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    await service.capture(verified())
    const directory = path.join(root, 'read-only-analysis-history', createHash('sha256').update('project:history').digest('hex'))
    const temp = path.join(directory, '.record-123e4567-e89b-42d3-a456-426614174000.tmp')
    fs.writeFileSync(temp, '{"unfinished":true}', { mode: 0o600 })
    await service.capture(verified('project:history', 'c'.repeat(64), 'd'.repeat(64)))
    expect(service.list('project:history')).toHaveLength(2)
    expect(fs.existsSync(temp)).toBe(true)

    const nearMiss = path.join(directory, '.record-123e4567-e89b-52d3-a456-426614174000.tmp')
    fs.writeFileSync(nearMiss, 'near miss')
    expect(() => service.list('project:history')).toThrow('history-storage-invalid')
    expect(fs.existsSync(nearMiss)).toBe(true)
    fs.rmSync(nearMiss)

    const unknown = path.join(directory, 'leftover.tmp')
    fs.writeFileSync(unknown, 'untrusted')
    await expect(service.capture(verified('project:history', 'e'.repeat(64), 'f'.repeat(64)))).rejects.toThrow('history-storage-invalid')
    expect(fs.existsSync(unknown)).toBe(true)
  })

  it('serializes concurrent captures and leaves no blocked lock queue', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    await Promise.all(Array.from({ length: 4 }, (_, index) => service.capture(verified('concurrent-project', digestNumber(index + 200), digestNumber(index + 300)))))
    expect(service.list('concurrent-project')).toHaveLength(4)
    await service.capture(verified('concurrent-project', digestNumber(500), digestNumber(600)))
    expect(service.list('concurrent-project')).toHaveLength(5)
  })

  it('rejects corrupt records', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    await service.capture(verified())
    const actual = fs.readdirSync(path.join(root, 'read-only-analysis-history'))[0]
    const directory = path.join(root, 'read-only-analysis-history', actual)
    const actualFile = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json'))!)
    fs.writeFileSync(actualFile, '{"schemaVersion":"ripple/read-only-analysis-history/v1","projectId":"project:history","bad":true}')
    expect(() => service.list('project:history')).toThrow('history-record-corrupt')
  })

  it.skipIf(process.platform === 'win32')('rejects symlinked storage', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-history-')); roots.push(root)
    process.env.RIPPLE_WORKBENCH_STATE_DIR = root
    const service = createReadOnlyAnalysisHistoryService()
    await service.capture(verified())
    const actual = fs.readdirSync(path.join(root, 'read-only-analysis-history'))[0]
    const directory = path.join(root, 'read-only-analysis-history', actual)
    const actualFile = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json'))!)
    fs.rmSync(actualFile)
    fs.symlinkSync(root, actualFile, 'file')
    expect(() => service.list('project:history')).toThrow('history-storage-invalid')
  })
})

