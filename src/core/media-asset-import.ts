import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ProjectRevision, RelationCertainty } from './model'
import {
  assertImageBytes,
  assertMediaSwapAsset,
  createStagedAssetStore,
  type SniffedImageFormat,
  type StagedAssetStore,
} from './media-asset-staging'

/**
 * 资产导入追溯记录。
 *
 * 这是一层导入 provenance，不是 CandidateRecord 的替代品：候选仍由
 * candidate.ts 创建、校验和写入。记录只回答素材从哪里来、是否得到明确
 * 同意、暂存字节是什么，以及后续是否已绑定到一个已证明的源码目标。
 */
export interface AssetImportConsent {
  granted: boolean
  by: string
  at: string
}

export type AssetImportSourceKind = 'local-file' | 'external-url-reference'
export type AssetImportResult = 'staged' | 'reference-only'

export interface AssetImportSource {
  kind: AssetImportSourceKind
  /** 本地来源只保留文件名，避免把个人绝对路径写入记录或工件。 */
  fileName?: string
  /** 外部 URL 只作为 provenance；本模块不会抓取或解析它。 */
  url?: string
}

export interface AssetImportRecord {
  schemaVersion: 1
  importId: string
  consent: AssetImportConsent
  source: AssetImportSource
  stagedAssetHash?: string
  extension?: string
  format?: SniffedImageFormat
  /** 只有 source-proven 绑定成功后才会写入。 */
  targetRef?: string
  targetCertainty: 'source-proven' | 'unresolved'
  projectRevision?: ProjectRevision
  candidateId?: string
  createdAt: string
  result: AssetImportResult
}

export interface LocalAssetImportInput {
  localPath: string
  consent: AssetImportConsent
  importId?: string
  targetRef?: string
  targetCertainty?: RelationCertainty
  projectRevision?: ProjectRevision
  candidateId?: string
  createdAt?: string
}

export interface ExternalUrlReferenceInput {
  url: string
  consent: AssetImportConsent
  importId?: string
  createdAt?: string
}

export interface AssetTargetBinding {
  targetRef: string
  certainty: RelationCertainty
}

export interface AssetImportCleanupResult {
  removedHashes: string[]
  retainedHashes: string[]
  removedInvalidEntries: string[]
}

export class AssetImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetImportError'
  }
}

const IMPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const HASH = /^[0-9a-f]{64}$/
const EXTENSION = /^\.[a-z0-9]{1,8}$/
const URL_SCHEME = /^https?:$/i

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new AssetImportError(`${label}必须是非空字符串`)
}

function assertImportId(importId: string): void {
  if (!IMPORT_ID.test(importId)) throw new AssetImportError(`importId 含有非法路径字符：${importId}`)
}

function assertConsent(consent: AssetImportConsent): void {
  if (!consent || consent.granted !== true) throw new AssetImportError('资产导入需要用户明确同意')
  assertNonEmpty(consent.by, '同意者')
  assertTimestamp(consent.at, '同意时间')
}

function assertTimestamp(value: string, label: string): void {
  assertNonEmpty(value, label)
  if (!Number.isFinite(Date.parse(value))) throw new AssetImportError(`${label}必须是有效 ISO 时间`)
}

function assertRevision(revision: ProjectRevision | undefined): void {
  if (!revision) return
  assertNonEmpty(revision.projectId, '项目身份')
  assertNonEmpty(revision.sourceDigest, '项目源码摘要')
  assertNonEmpty(revision.runtimeFingerprint, '运行时指纹')
}

function assertCandidateId(candidateId: string | undefined): void {
  if (candidateId !== undefined) assertNonEmpty(candidateId, 'candidateId')
}

function normalizeExtension(localPath: string): string {
  const extension = path.extname(localPath).toLowerCase()
  if (!EXTENSION.test(extension)) throw new AssetImportError(`本地素材缺少受支持的扩展名：${path.basename(localPath)}`)
  return extension
}

function assertHttpsReference(url: string): string {
  assertNonEmpty(url, '外部素材 URL')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new AssetImportError(`外部素材 URL 无法解析：${url}`) }
  if (!URL_SCHEME.test(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    throw new AssetImportError('外部素材 URL 必须是无凭据的 http/https 地址')
  }
  return parsed.toString()
}

function createImportId(value?: string): string {
  const importId = value ?? `asset-import-${randomUUID()}`
  assertImportId(importId)
  return importId
}

function nowIso(value?: string): string {
  const result = value ?? new Date().toISOString()
  assertTimestamp(result, '创建时间')
  return result
}

function assertNoTargetWithoutProof(targetRef: string | undefined, certainty: RelationCertainty | undefined): void {
  if (targetRef !== undefined) {
    assertNonEmpty(targetRef, 'targetRef')
    if (certainty !== 'source-proven') {
      throw new AssetImportError('targetRef 只有在 source-proven 证明后才能写入导入记录')
    }
  }
}

function readLocalImage(localPath: string): { bytes: Uint8Array; extension: string; format: SniffedImageFormat; fileName: string } {
  assertNonEmpty(localPath, '本地素材路径')
  const resolved = path.resolve(localPath)
  let stat: fs.Stats
  try { stat = fs.lstatSync(resolved) } catch { throw new AssetImportError(`本地素材不存在：${localPath}`) }
  if (stat.isSymbolicLink()) throw new AssetImportError('拒绝从符号链接导入素材；请显式选择普通文件')
  if (!stat.isFile()) throw new AssetImportError('本地素材必须是普通文件')
  const bytes = Uint8Array.from(fs.readFileSync(resolved))
  const format = assertImageBytes(bytes, '本地素材')
  const extension = normalizeExtension(resolved)
  // 复用 MEDIA 执行器的格式/扩展名一致性规则，避免导入层与候选层产生两套判定。
  assertMediaSwapAsset(bytes, `/asset-import${extension}`)
  return { bytes, extension, format, fileName: path.basename(resolved) }
}

function cloneRecord(record: AssetImportRecord): AssetImportRecord {
  return JSON.parse(JSON.stringify(record)) as AssetImportRecord
}

function recordPath(recordsRoot: string, importId: string): string {
  assertImportId(importId)
  const resolvedRoot = path.resolve(recordsRoot)
  const target = path.resolve(resolvedRoot, `${importId}.json`)
  const relative = path.relative(resolvedRoot, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new AssetImportError('导入记录路径越界')
  return target
}

function writeRecord(recordsRoot: string, record: AssetImportRecord): void {
  const target = recordPath(recordsRoot, record.importId)
  if (fs.existsSync(target)) throw new AssetImportError(`重复导入记录：${record.importId}`)
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    const stat = fs.lstatSync(temporary)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new AssetImportError('导入记录临时文件不是普通文件')
    fs.renameSync(temporary, target)
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    throw error
  }
}

function readRecord(target: string): AssetImportRecord {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new AssetImportError(`导入记录不是普通文件：${path.basename(target)}`)
  let parsed: unknown
  try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')) } catch { throw new AssetImportError(`导入记录 JSON 损坏：${path.basename(target)}`) }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new AssetImportError(`导入记录 schema 不受支持：${path.basename(target)}`)
  }
  const record = parsed as AssetImportRecord
  assertImportRecord(record)
  return cloneRecord(record)
}

function assertImportRecord(record: AssetImportRecord): void {
  if (!record || record.schemaVersion !== 1) throw new AssetImportError('导入记录 schema 不受支持')
  assertImportId(record.importId)
  assertConsent(record.consent)
  assertTimestamp(record.createdAt, '创建时间')
  if (!record.source || (record.source.kind !== 'local-file' && record.source.kind !== 'external-url-reference')) {
    throw new AssetImportError(`导入记录来源类型不受支持：${record.importId}`)
  }
  if (record.source.kind === 'local-file') {
    assertNonEmpty(record.source.fileName, '本地素材文件名')
    if (record.source.fileName.includes('/') || record.source.fileName.includes('\\')) throw new AssetImportError('导入记录文件名不能包含路径分隔符')
    if (record.result !== 'staged' || !record.stagedAssetHash || !HASH.test(record.stagedAssetHash) || !record.extension || !EXTENSION.test(record.extension) || !record.format) {
      throw new AssetImportError(`本地导入记录缺少完整暂存信息：${record.importId}`)
    }
  } else {
    if (record.result !== 'reference-only' || !record.source.url || record.stagedAssetHash || record.extension || record.format) {
      throw new AssetImportError(`外部 URL 记录不能携带本地暂存信息：${record.importId}`)
    }
    assertHttpsReference(record.source.url)
  }
  if (record.targetCertainty === 'source-proven') assertNonEmpty(record.targetRef, '已证明 targetRef')
  else if (record.targetCertainty !== 'unresolved' || record.targetRef) throw new AssetImportError(`导入记录 targetRef 证明状态不一致：${record.importId}`)
  assertRevision(record.projectRevision)
  assertCandidateId(record.candidateId)
}

export interface AssetImportLedger {
  readonly root: string
  readonly stagedStore: StagedAssetStore
  importLocal(input: LocalAssetImportInput): AssetImportRecord
  referenceExternalUrl(input: ExternalUrlReferenceInput): AssetImportRecord
  get(importId: string): AssetImportRecord | undefined
  list(): AssetImportRecord[]
  bindTarget(importId: string, binding: AssetTargetBinding): AssetImportRecord
  bindCandidate(importId: string, projectRevision: ProjectRevision, candidateId: string): AssetImportRecord
  remove(importId: string): void
  cleanupUnreferencedAssets(): AssetImportCleanupResult
}

export function createAssetImportLedger(root: string): AssetImportLedger {
  assertNonEmpty(root, '资产导入 ledger 根目录')
  const resolvedRoot = path.resolve(root)
  const recordsRoot = path.join(resolvedRoot, 'records')
  const stagedRoot = path.join(resolvedRoot, 'staged-assets')
  if (fs.existsSync(resolvedRoot)) {
    const rootStat = fs.lstatSync(resolvedRoot)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new AssetImportError('ledger 根目录必须是安全普通目录')
  }
  fs.mkdirSync(recordsRoot, { recursive: true })
  const recordsStat = fs.lstatSync(recordsRoot)
  if (recordsStat.isSymbolicLink() || !recordsStat.isDirectory()) throw new AssetImportError('导入记录目录不是安全普通目录')
  if (fs.existsSync(stagedRoot)) {
    const stagedRootStat = fs.lstatSync(stagedRoot)
    if (stagedRootStat.isSymbolicLink() || !stagedRootStat.isDirectory()) throw new AssetImportError('暂存目录必须是安全普通目录')
  }
  const stagedStore = createStagedAssetStore(stagedRoot)

  const list = (): AssetImportRecord[] => fs.readdirSync(recordsRoot, { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => readRecord(path.join(recordsRoot, entry.name)))

  const getRecord = (importId: string): AssetImportRecord | undefined => {
    const target = recordPath(recordsRoot, importId)
    if (!fs.existsSync(target)) return undefined
    return readRecord(target)
  }

  const ensureUniqueHash = (hash: string): void => {
    if (list().some(record => record.stagedAssetHash === hash)) {
      throw new AssetImportError(`重复导入相同素材字节：${hash}`)
    }
  }

  const persist = (record: AssetImportRecord): AssetImportRecord => {
    writeRecord(recordsRoot, record)
    return cloneRecord(record)
  }

  return {
    root: resolvedRoot,
    stagedStore,
    importLocal(input) {
      assertConsent(input.consent)
      const importId = createImportId(input.importId)
      if (getRecord(importId)) throw new AssetImportError(`重复导入记录：${importId}`)
      assertNoTargetWithoutProof(input.targetRef, input.targetCertainty)
      assertRevision(input.projectRevision)
      assertCandidateId(input.candidateId)
      const image = readLocalImage(input.localPath)
      const hash = stagedStore.store(image.bytes)
      ensureUniqueHash(hash)
      return persist({
        schemaVersion: 1,
        importId,
        consent: { ...input.consent },
        source: { kind: 'local-file', fileName: image.fileName },
        stagedAssetHash: hash,
        extension: image.extension,
        format: image.format,
        ...(input.targetRef ? { targetRef: input.targetRef } : {}),
        targetCertainty: input.targetRef ? 'source-proven' : 'unresolved',
        ...(input.projectRevision ? { projectRevision: { ...input.projectRevision } } : {}),
        ...(input.candidateId ? { candidateId: input.candidateId } : {}),
        createdAt: nowIso(input.createdAt),
        result: 'staged',
      })
    },
    referenceExternalUrl(input) {
      assertConsent(input.consent)
      const importId = createImportId(input.importId)
      if (getRecord(importId)) throw new AssetImportError(`重复导入记录：${importId}`)
      const url = assertHttpsReference(input.url)
      if (list().some(record => record.source.kind === 'external-url-reference' && record.source.url === url)) {
        throw new AssetImportError(`重复导入外部素材 URL：${url}`)
      }
      return persist({
        schemaVersion: 1,
        importId,
        consent: { ...input.consent },
        source: { kind: 'external-url-reference', url },
        targetCertainty: 'unresolved',
        createdAt: nowIso(input.createdAt),
        result: 'reference-only',
      })
    },
    get(importId) {
      return getRecord(importId)
    },
    list,
    bindTarget(importId, binding) {
      const record = getRecord(importId)
      if (!record) throw new AssetImportError(`导入记录不存在：${importId}`)
      assertNonEmpty(binding.targetRef, 'targetRef')
      if (binding.certainty !== 'source-proven') throw new AssetImportError('只有 source-proven 目标才能绑定到导入记录')
      if (record.targetRef && record.targetRef !== binding.targetRef) throw new AssetImportError('导入记录已有不同的已证明目标')
      const next = { ...record, targetRef: binding.targetRef, targetCertainty: 'source-proven' as const }
      fs.unlinkSync(recordPath(recordsRoot, importId))
      return persist(next)
    },
    bindCandidate(importId, projectRevision, candidateId) {
      const record = getRecord(importId)
      if (!record) throw new AssetImportError(`导入记录不存在：${importId}`)
      assertRevision(projectRevision)
      assertNonEmpty(candidateId, 'candidateId')
      if (record.projectRevision && record.projectRevision.sourceDigest !== projectRevision.sourceDigest) {
        throw new AssetImportError('导入记录已绑定不同项目修订，拒绝跨版本复用')
      }
      const next = { ...record, projectRevision: { ...projectRevision }, candidateId }
      fs.unlinkSync(recordPath(recordsRoot, importId))
      return persist(next)
    },
    remove(importId) {
      const target = recordPath(recordsRoot, importId)
      if (!fs.existsSync(target)) return
      const record = readRecord(target)
      fs.unlinkSync(target)
      // 保守策略：素材字节由 cleanupUnreferencedAssets 统一回收，避免删除仍被
      // 其他记录引用的内容寻址对象。
      void record
    },
    cleanupUnreferencedAssets() {
      const referenced = new Set(list().flatMap(record => record.stagedAssetHash ? [record.stagedAssetHash] : []))
      const removedHashes: string[] = []
      const retainedHashes: string[] = []
      const removedInvalidEntries: string[] = []
      for (const prefixEntry of fs.readdirSync(stagedRoot, { withFileTypes: true })) {
        const prefixPath = path.join(stagedRoot, prefixEntry.name)
        if (!prefixEntry.isDirectory() || !/^[0-9a-f]{2}$/.test(prefixEntry.name)) {
          fs.rmSync(prefixPath, { recursive: prefixEntry.isDirectory(), force: true }); removedInvalidEntries.push(prefixEntry.name)
          continue
        }
        for (const assetEntry of fs.readdirSync(prefixPath, { withFileTypes: true })) {
          const assetPath = path.join(prefixPath, assetEntry.name)
          const hash = assetEntry.name
          if (assetEntry.isSymbolicLink() || !assetEntry.isFile() || !HASH.test(hash) || !hash.startsWith(prefixEntry.name)) {
            fs.rmSync(assetPath, { recursive: assetEntry.isDirectory(), force: true }); removedInvalidEntries.push(path.relative(stagedRoot, assetPath))
          } else if (referenced.has(hash)) {
            retainedHashes.push(hash)
          } else {
            fs.rmSync(assetPath, { force: true }); removedHashes.push(hash)
          }
        }
        if (fs.readdirSync(prefixPath).length === 0) fs.rmSync(prefixPath, { recursive: true, force: true })
      }
      return { removedHashes: removedHashes.sort(), retainedHashes: retainedHashes.sort(), removedInvalidEntries: removedInvalidEntries.sort() }
    },
  }
}
