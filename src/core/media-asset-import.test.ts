import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createAssetImportLedger, AssetImportError, type AssetImportConsent } from './media-asset-import'
import { removeTree } from './test-fixture-dir'
import { mediaAssetSwapExecutor, type MediaAssetSwapOperation } from './media-asset-swap'

const roots: string[] = []
const temp = () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.tmp', 'ripple-media-import-'))
  roots.push(root)
  return root
}
const consent: AssetImportConsent = { granted: true, by: 'test-user', at: '2026-10-25T00:00:00.000Z' }
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root)
})

function writeAsset(root: string, name = 'hero.webp', bytes = webp): string {
  const file = path.join(root, name)
  fs.writeFileSync(file, bytes)
  return file
}

describe('AssetImportRecord ledger', () => {
  it('records explicit local consent, content hash and unresolved target without leaking absolute path', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'local-hero', createdAt: consent.at })

    expect(record).toMatchObject({
      schemaVersion: 1,
      importId: 'local-hero',
      consent,
      source: { kind: 'local-file', fileName: 'hero.webp' },
      stagedAssetHash: sha256(webp),
      extension: '.webp',
      format: 'webp',
      targetCertainty: 'unresolved',
      result: 'staged',
    })
    expect(record.source).not.toHaveProperty('localPath')
    expect(JSON.stringify(record)).not.toContain(path.dirname(source))
    expect(ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toEqual(webp)
    expect(ledger.get('local-hero')).toEqual(record)
    expect(ledger.list()).toHaveLength(1)
  })

  it('hands the staged hash to the existing MEDIA executor for a source edit and candidate file write', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'executor-input' })
    const target = { id: 'media:hero', kind: 'media' as const, label: 'hero', value: '/images/old.webp', location: { path: 'src/Home.tsx', start: 20, end: 40 } }
    const operation: MediaAssetSwapOperation = {
      id: 'swap-hero', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
      before: target.value, after: '/media/hero.webp',
      payload: { assetRef: '/media/hero.webp', assetHash: record.stagedAssetHash! },
    }
    const plan = mediaAssetSwapExecutor.plan({
      operation,
      target,
      graph: { id: 'graph', revision: { projectId: 'project', sourceDigest: 'digest', runtimeFingerprint: 'runtime' }, nodes: [target], edges: [], unresolved: [] },
      scope: { id: 'scope', version: 1, includedRefs: [target.id], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: consent.at },
      readStagedAsset: ledger.stagedStore.readStagedAsset,
    })

    expect(plan.sourceEdits).toEqual([{ path: 'src/Home.tsx', start: 20, end: 40, before: '/images/old.webp', after: '/media/hero.webp' }])
    expect(plan.fileWrites?.[0]).toMatchObject({ path: 'public/media/hero.webp', bytes: webp })
  })

  it('requires proven source target before recording targetRef, then permits only source-proven binding', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))

    expect(() => ledger.importLocal({ localPath: source, consent, targetRef: 'media:hero', targetCertainty: 'semantic-candidate' })).toThrowError(/source-proven/)
    const record = ledger.importLocal({ localPath: source, consent, importId: 'bindable' })
    expect(() => ledger.bindTarget(record.importId, { targetRef: 'media:hero', certainty: 'runtime-observed' })).toThrowError(/source-proven/)
    const bound = ledger.bindTarget(record.importId, { targetRef: 'media:hero', certainty: 'source-proven' })
    expect(bound.targetRef).toBe('media:hero')
    expect(bound.targetCertainty).toBe('source-proven')
  })

  it('keeps external URL as reference-only and never stages or fetches it', () => {
    const ledger = createAssetImportLedger(path.join(temp(), 'ledger'))
    const record = ledger.referenceExternalUrl({ url: 'https://cdn.example.invalid/assets/hero.webp', consent, importId: 'remote-reference' })

    expect(record).toMatchObject({
      source: { kind: 'external-url-reference', url: 'https://cdn.example.invalid/assets/hero.webp' },
      targetCertainty: 'unresolved',
      result: 'reference-only',
    })
    expect(record.stagedAssetHash).toBeUndefined()
    expect(fs.readdirSync(path.join(ledger.root, 'staged-assets'))).toEqual([])
    expect(() => ledger.referenceExternalUrl({ url: 'https://user:pass@example.invalid/hero.webp', consent })).toThrowError(/无凭据/)
    expect(() => ledger.referenceExternalUrl({ url: 'file:///secret/hero.webp', consent })).toThrowError(/http\/https/)
  })

  it('rejects missing consent, malformed bytes, extension mismatch, duplicate imports and path traversal IDs', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))

    expect(() => ledger.importLocal({ localPath: source, consent: { ...consent, granted: false } })).toThrowError(AssetImportError)
    expect(() => ledger.importLocal({ localPath: writeAsset(root, 'fake.png', Uint8Array.from([1, 2, 3])), consent })).toThrowError(/格式头/)
    expect(() => ledger.importLocal({ localPath: writeAsset(root, 'fake.png'), consent })).toThrowError(/扩展名/)
    ledger.importLocal({ localPath: source, consent, importId: 'first' })
    expect(() => ledger.importLocal({ localPath: source, consent, importId: 'second' })).toThrowError(/重复导入/)
    expect(() => ledger.importLocal({ localPath: source, consent, importId: 'first' })).toThrowError(/重复导入记录/)
    expect(() => ledger.importLocal({ localPath: source, consent, importId: '../escape' })).toThrowError(/非法路径字符/)
  })

  it('rejects a source symlink when the platform can create one', () => {
    if (process.platform === 'win32') return
    const root = temp()
    const source = writeAsset(root)
    const link = path.join(root, 'hero-link.webp')
    fs.symlinkSync(source, link)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))
    expect(() => ledger.importLocal({ localPath: link, consent })).toThrowError(/符号链接/)
  })

  it('removes unreferenced staged bytes while retaining bytes referenced by records', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'kept' })
    const orphan = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 5, 6, 7, 0x57, 0x45, 0x42, 0x50])
    const orphanHash = ledger.stagedStore.store(orphan)
    const result = ledger.cleanupUnreferencedAssets()

    expect(result.retainedHashes).toContain(record.stagedAssetHash)
    expect(result.removedHashes).toContain(orphanHash)
    expect(() => ledger.stagedStore.readStagedAsset(orphanHash)).toThrowError(/不存在/)
    expect(ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toEqual(webp)
  })

  it('rejects a staged asset replaced by a symlink when the platform can create one', () => {
    if (process.platform === 'win32') return
    const root = temp()
    const source = writeAsset(root)
    const outside = writeAsset(root, 'outside.webp', webp)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'symlink-target' })
    const stagedPath = path.join(ledger.root, 'staged-assets', record.stagedAssetHash!.slice(0, 2), record.stagedAssetHash!)
    fs.unlinkSync(stagedPath)
    fs.symlinkSync(outside, stagedPath)
    expect(() => ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toThrowError(/物理路径越界|普通文件/)
  })

  it('does not silently reuse an import record across project revisions', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = createAssetImportLedger(path.join(root, 'ledger'))
    const revision = { projectId: 'project-1', sourceDigest: 'base-a', runtimeFingerprint: 'runtime-a' }
    const record = ledger.importLocal({ localPath: source, consent, importId: 'candidate-bound', projectRevision: revision })

    expect(() => ledger.bindCandidate(record.importId, { ...revision, sourceDigest: 'base-b' }, 'candidate-b')).toThrowError(/不同项目修订/)
    const bound = ledger.bindCandidate(record.importId, revision, 'candidate-a')
    expect(bound.candidateId).toBe('candidate-a')
    expect(bound.projectRevision).toEqual(revision)
  })
})
