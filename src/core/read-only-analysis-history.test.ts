// @vitest-environment node
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReadOnlyAnalysisHistoryService } from './read-only-analysis-history'
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

