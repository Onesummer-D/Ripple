import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import * as path from 'node:path'
import { createAssetImportLedger, type AssetImportConsentAuthority, type AssetImportConsentRequest } from './media-asset-import'
import { removeTree } from './test-fixture-dir'
import type { MediaAssetSwapOperation } from './media-asset-swap'
import type { SourceGraph } from './model'

const roots: string[] = []
const temp = () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.tmp', 'ripple-media-import-'))
  roots.push(root)
  return root
}
const consent: AssetImportConsentRequest = { actorId: 'test-user', requestedAt: '2026-10-25T00:00:00.000Z' }
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const consentProofs = new Map<string, string>()
const authority: AssetImportConsentAuthority = {
  authorize(request, context) {
    if (!request.actorId || request.actorId === 'deny') return undefined
    const authorizationId = randomUUID()
    const proof = `${context.importId}:${context.sourceKind}:${context.sourceFingerprint}:${request.actorId}:${authorizationId}`
    consentProofs.set(proof, `${request.actorId}|${context.importId}|${context.sourceKind}|${context.sourceFingerprint}`)
    return { authorityId: 'test-user-consent', authorizationId, actorId: request.actorId, authorizedAt: request.requestedAt, ...context, proof }
  },
  verify(receipt, context) {
    return consentProofs.get(receipt.proof) === `${receipt.actorId}|${context.importId}|${context.sourceKind}|${context.sourceFingerprint}`
  },
}
const makeLedger = (root: string) => createAssetImportLedger(root, authority)

function provenMediaGraph(sourceDigest = 'digest'): SourceGraph {
  const revision = { projectId: 'project', sourceDigest, runtimeFingerprint: 'runtime' }
  return {
    id: `graph-${sourceDigest}`,
    revision,
    nodes: [
      { id: 'media:hero', kind: 'media' as const, label: 'hero', value: '/images/hero.webp', location: { path: 'src/Home.tsx', start: 10, end: 25 } },
      { id: 'component:home', kind: 'component' as const, label: 'Home', pages: ['home'] },
      { id: 'page:home', kind: 'route' as const, label: 'Home' },
    ],
    edges: [{ id: 'consumer:hero', from: 'component:home', to: 'media:hero', kind: 'asset-consumer' as const, certainty: 'source-proven' as const, evidenceRefs: ['ast:hero'] }],
    unresolved: [] as string[],
  }
}

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
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'local-hero', createdAt: consent.requestedAt })

    expect(record).toMatchObject({
      schemaVersion: 1,
      importId: 'local-hero',
      consent: expect.objectContaining({ actorId: consent.actorId, importId: 'local-hero', sourceKind: 'local-file' }),
      source: { kind: 'local-file', fileName: 'hero.webp' },
      stagedAssetHash: sha256(webp),
      extension: '.webp',
      format: 'webp',
      formatValidation: 'header-only',
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
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'executor-input' })
    const target = { id: 'media:hero', kind: 'media' as const, label: 'hero', value: '/images/old.webp', location: { path: 'src/Home.tsx', start: 20, end: 40 } }
    const operation: MediaAssetSwapOperation = {
      id: 'swap-hero', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
      before: target.value, after: '/media/hero.webp',
      payload: { assetRef: '/media/hero.webp', assetHash: record.stagedAssetHash! },
    }
    const plan = ledger.mediaExecutor.plan({
      operation,
      target,
      graph: { id: 'graph', revision: { projectId: 'project', sourceDigest: 'digest', runtimeFingerprint: 'runtime' }, nodes: [target], edges: [], unresolved: [] },
      scope: { id: 'scope', version: 1, includedRefs: [target.id], excludedRefs: [], protectedRefs: [], decidedBy: 'test-user', decidedAt: consent.requestedAt },
      readStagedAsset: ledger.stagedStore.readStagedAsset,
    })

    expect(plan.sourceEdits).toEqual([{ path: 'src/Home.tsx', start: 20, end: 40, before: '/images/old.webp', after: '/media/hero.webp' }])
    expect(plan.fileWrites?.[0]).toMatchObject({ path: 'public/media/hero.webp', bytes: webp })
  })

  it('requires a complete current SourceGraph target and PageImpact before binding', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))

    const record = ledger.importLocal({ localPath: source, consent, importId: 'bindable' })
    const graph = provenMediaGraph()
    expect(() => ledger.bindTarget(record.importId, { targetRef: 'media:missing', graph })).toThrowError(/SourceGraph/)
    const uncertain = provenMediaGraph()
    uncertain.edges[0].certainty = 'semantic-candidate'
    expect(() => ledger.bindTarget(record.importId, { targetRef: 'media:hero', graph: uncertain })).toThrowError(/PageImpact/)
    expect(ledger.get(record.importId)?.targetCertainty).toBe('unresolved')
    const bound = ledger.bindTarget(record.importId, { targetRef: 'media:hero', graph })
    expect(bound.targetRef).toBe('media:hero')
    expect(bound.targetCertainty).toBe('source-proven')
    expect(bound.pageImpact).toEqual({ pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' })
  })

  it('keeps external URL as redacted reference-only provenance and never fetches it', () => {
    const ledger = makeLedger(path.join(temp(), 'ledger'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const record = ledger.referenceExternalUrl({ url: 'https://cdn.example.invalid/assets/hero.webp?token=abc123&width=640', consent, importId: 'remote-reference' })

    expect(record).toMatchObject({
      source: { kind: 'external-url-reference', url: 'https://cdn.example.invalid/assets/hero.webp?token=%5BREDACTED%5D&width=640' },
      targetCertainty: 'unresolved',
      result: 'reference-only',
    })
    expect(JSON.stringify(record)).not.toContain('abc123')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    expect(record.stagedAssetHash).toBeUndefined()
    expect(fs.readdirSync(path.join(ledger.root, 'staged-assets'))).toEqual([])
    expect(() => ledger.bindTarget(record.importId, { targetRef: 'media:hero', graph: provenMediaGraph() })).toThrowError(/不能直接绑定/)
    expect(() => ledger.referenceExternalUrl({ url: 'https://user:pass@example.invalid/hero.webp', consent })).toThrowError(/无凭据/)
    expect(() => ledger.referenceExternalUrl({ url: 'file:///secret/hero.webp', consent })).toThrowError(/http\/https/)
  })

  it('rejects missing consent, malformed bytes, extension mismatch, duplicate imports and path traversal IDs', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))

    expect(() => ledger.importLocal({ localPath: source, consent: { ...consent, actorId: 'deny' } })).toThrowError(/未明确同意/)
    const forgedGrant = { granted: true, by: 'forged-user', at: consent.requestedAt } as unknown as AssetImportConsentRequest
    expect(() => ledger.importLocal({ localPath: source, consent: forgedGrant, importId: 'forged-grant' })).toThrowError(/同意者/)
    expect(() => ledger.importLocal({ localPath: writeAsset(root, 'fake.png', Uint8Array.from([1, 2, 3])), consent })).toThrowError(/格式头/)
    expect(() => ledger.importLocal({ localPath: writeAsset(root, 'fake.png'), consent })).toThrowError(/扩展名/)
    ledger.importLocal({ localPath: source, consent, importId: 'first' })
    expect(ledger.importLocal({ localPath: source, consent, importId: 'second' }).stagedAssetHash).toBe(sha256(webp))
    expect(ledger.importLocal({ localPath: source, consent, importId: 'first' })).toEqual(ledger.get('first'))
    expect(() => ledger.importLocal({ localPath: source, consent, importId: '../escape' })).toThrowError(/非法路径字符/)
  })

  it('rejects a source symlink when the platform can create one', () => {
    if (process.platform === 'win32') return
    const root = temp()
    const source = writeAsset(root)
    const link = path.join(root, 'hero-link.webp')
    fs.symlinkSync(source, link)
    const ledger = makeLedger(path.join(root, 'ledger'))
    expect(() => ledger.importLocal({ localPath: link, consent })).toThrowError(/符号链接/)
  })

  it('rejects the source path when it is replaced after lstat and before open', () => {
    const root = temp()
    const source = writeAsset(root)
    const replacement = writeAsset(root, 'replacement.webp', Uint8Array.from([...webp, 0x44]))
    const originalOpen = fs.openSync.bind(fs)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const spy = vi.spyOn(fs, 'openSync').mockImplementation(((file: string | Buffer | URL, ...args: unknown[]) => {
      if (String(file) === source) {
        const displaced = `${source}.displaced`
        fs.renameSync(source, displaced)
        fs.copyFileSync(replacement, source)
      }
      return (originalOpen as (...input: unknown[]) => number)(file, ...args)
    }) as typeof fs.openSync)
    try {
      expect(() => ledger.importLocal({ localPath: source, consent, importId: 'replaced-source' })).toThrowError(/已被替换/)
      expect(ledger.list()).toHaveLength(0)
    } finally { spy.mockRestore() }
  })

  it('previews unreferenced staged bytes while retaining bytes referenced by records', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'kept' })
    const orphan = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 5, 6, 7, 0x57, 0x45, 0x42, 0x50])
    const orphanHash = ledger.stagedStore.store(orphan)
    const result = ledger.previewUnreferencedAssets()

    expect(result.retainedHashes).toContain(record.stagedAssetHash)
    expect(result.previewHashes).toContain(orphanHash)
    expect(ledger.stagedStore.readStagedAsset(orphanHash)).toEqual(orphan)
    expect(ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toEqual(webp)
  })

  it('rejects a staged asset replaced by a symlink when the platform can create one', () => {
    if (process.platform === 'win32') return
    const root = temp()
    const source = writeAsset(root)
    const outside = writeAsset(root, 'outside.webp', webp)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'symlink-target' })
    const stagedPath = path.join(ledger.root, 'staged-assets', record.stagedAssetHash!.slice(0, 2), record.stagedAssetHash!)
    fs.unlinkSync(stagedPath)
    fs.symlinkSync(outside, stagedPath)
    expect(() => ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toThrowError(/物理路径越界|普通文件/)
  })

  it('does not silently reuse an import record across project revisions', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const graph = provenMediaGraph('base-a')
    const record = ledger.importLocal({ localPath: source, consent, importId: 'candidate-bound' })
    ledger.bindTarget(record.importId, { targetRef: 'media:hero', graph })

    expect(() => ledger.assertCurrentForGraph(record.importId, provenMediaGraph('base-b'))).toThrowError(/已过期/)
    expect(() => ledger.bindCandidate(record.importId, provenMediaGraph('base-b'), 'candidate-b')).toThrowError(/已过期/)
    const bound = ledger.bindCandidate(record.importId, graph, 'candidate-a')
    expect(bound.candidateId).toBe('candidate-a')
    expect(bound.projectRevision).toEqual(graph.revision)
  })

  it('makes same importId idempotent, allows multiple records to share bytes, and keeps bytes after removing one record', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const first = ledger.importLocal({ localPath: source, consent, importId: 'same-event' })
    const repeated = ledger.importLocal({ localPath: source, consent, importId: 'same-event' })
    const second = ledger.importLocal({ localPath: source, consent, importId: 'second-event' })

    expect(repeated).toEqual(first)
    expect(second.stagedAssetHash).toBe(first.stagedAssetHash)
    expect(ledger.list()).toHaveLength(2)
    ledger.remove(first.importId)
    expect(ledger.get(second.importId)).toBeDefined()
    expect(ledger.stagedStore.readStagedAsset(second.stagedAssetHash!)).toEqual(webp)
  })

  it.each(['candidate', 'verification-run', 'manual'] as const)('refuses to remove a record with a %s retention reference', kind => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: `retained-${kind}` })
    if (kind === 'candidate') {
      const graph = provenMediaGraph()
      ledger.bindTarget(record.importId, { targetRef: 'media:hero', graph })
      ledger.bindCandidate(record.importId, graph, 'candidate-1')
    } else {
      ledger.retain(record.importId, { kind, id: `${kind}-1` })
    }

    expect(() => ledger.remove(record.importId)).toThrowError(/存在保留引用，拒绝删除/)
    expect(ledger.get(record.importId)).toBeDefined()
    expect(ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toEqual(webp)
  })

  it('retains bytes referenced by Candidate, verification run, and other retention markers', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'retained' })
    const graph = provenMediaGraph()
    ledger.bindTarget(record.importId, { targetRef: 'media:hero', graph })
    ledger.bindCandidate(record.importId, graph, 'candidate-1')
    ledger.retain(record.importId, { kind: 'verification-run', id: 'run-1' })
    ledger.retain(record.importId, { kind: 'manual', id: 'hold-1' })

    const preview = ledger.previewUnreferencedAssets()
    expect(preview.retainedHashes).toContain(record.stagedAssetHash)
    expect(preview.protectedBy[record.stagedAssetHash!]).toEqual(expect.arrayContaining([
      'import:retained', 'candidate:candidate-1', 'verification-run:run-1', 'manual:hold-1',
    ]))
    expect(ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toEqual(webp)
  })

  it('rejects partial, corrupt, forged-consent, missing, and tampered ledger state', () => {
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    expect(() => createAssetImportLedger(path.join(root, 'untrusted-ledger'), undefined as unknown as AssetImportConsentAuthority)).toThrowError(/可信用户授权/)
    const record = ledger.importLocal({ localPath: source, consent, importId: 'integrity' })
    const file = path.join(ledger.root, 'records', 'integrity.json')
    const saved = fs.readFileSync(file, 'utf8')
    const forged = JSON.parse(saved)
    forged.consent.proof = 'forged'
    fs.writeFileSync(file, JSON.stringify(forged))
    expect(() => ledger.get(record.importId)).toThrowError(/未经可信授权/)
    fs.writeFileSync(file, '{"schemaVersion":1')
    expect(() => ledger.list()).toThrowError(/JSON 损坏/)
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, importId: 'partial' }))
    expect(() => ledger.get('integrity')).toThrowError(/JSON 损坏|schema|授权回执|时间必须|结构无效/)
    fs.writeFileSync(file, saved)
    const leakedPath = JSON.parse(saved)
    leakedPath.source.localPath = 'C:/private/source.webp'
    fs.writeFileSync(file, JSON.stringify(leakedPath))
    expect(() => ledger.get(record.importId)).toThrowError(/未授权字段/)
    fs.writeFileSync(file, saved)
    const stagedPath = path.join(ledger.root, 'staged-assets', record.stagedAssetHash!.slice(0, 2), record.stagedAssetHash!)
    fs.writeFileSync(stagedPath, 'tampered')
    expect(() => ledger.get(record.importId)).toThrowError(/身份不匹配/)
  })

  it('keeps a magic-header-only image explicitly unverified for full decoding', () => {
    const root = temp()
    const malformedButHeadered = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0xde, 0xad])
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: writeAsset(root, 'undecodable.webp', malformedButHeadered), consent, importId: 'header-only' })
    expect(record.formatValidation).toBe('header-only')
    expect(ledger.mediaExecutor.kind).toBe('MEDIA')
    // The import ledger never claims full decoding; browser Verification's media-loaded assertion must pass separately.
  })

  it('fails closed on a missing staged hash and does not modify project bytes after a rejected import', () => {
    const root = temp()
    const source = writeAsset(root)
    const original = fs.readFileSync(source)
    const ledger = makeLedger(path.join(root, 'ledger'))
    expect(() => ledger.importLocal({ localPath: source, consent: { ...consent, actorId: 'deny' }, importId: 'denied' })).toThrowError(/未明确同意/)
    expect(ledger.list()).toHaveLength(0)
    expect(fs.readFileSync(source)).toEqual(original)
    expect(ledger.previewUnreferencedAssets().previewHashes).toEqual([])

    const record = ledger.importLocal({ localPath: source, consent, importId: 'missing-bytes' })
    fs.unlinkSync(path.join(ledger.root, 'staged-assets', record.stagedAssetHash!.slice(0, 2), record.stagedAssetHash!))
    expect(() => ledger.get(record.importId)).toThrowError(/不存在/)
  })

  it('rejects symlinked hash parent and symlinked ledger records directory where supported', () => {
    if (process.platform === 'win32') return
    const root = temp()
    const source = writeAsset(root)
    const ledger = makeLedger(path.join(root, 'ledger'))
    const record = ledger.importLocal({ localPath: source, consent, importId: 'parent-link' })
    const prefix = path.join(ledger.root, 'staged-assets', record.stagedAssetHash!.slice(0, 2))
    const backup = `${prefix}-saved`
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    fs.renameSync(prefix, backup)
    fs.symlinkSync(outside, prefix, 'dir')
    expect(() => ledger.stagedStore.readStagedAsset(record.stagedAssetHash!)).toThrowError(/物理路径越界|前缀目录/)
    fs.unlinkSync(prefix)
    fs.renameSync(backup, prefix)

    const records = path.join(root, 'unsafe-ledger', 'records')
    fs.mkdirSync(path.dirname(records), { recursive: true })
    fs.symlinkSync(outside, records, 'dir')
    expect(() => makeLedger(path.dirname(records))).toThrowError(/记录目录/)
  })
})
