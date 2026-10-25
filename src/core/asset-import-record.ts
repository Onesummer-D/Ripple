import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  assertMediaSwapAsset,
  canonicalImageExtension,
  MediaAssetStagingError,
  type SniffedImageFormat,
  type StagedAssetStore,
} from './media-asset-staging'

/**
 * AssetImportRecord（D 侧最小原型，Issue #35 B3 本地资产优先）。
 *
 * 为现有媒体暂存能力（createStagedAssetStore / readStagedAsset）增加合法、
 * 可追溯的用户导入记录：校验 → 内容寻址暂存 → 记录来源/哈希/目标，三者绑定。
 *
 * 边界（与 A 的约定）：
 * - 不修改 A 公共领域模型；记录是暂存服务旁的独立 JSON 工件（一记录一文件，只增不改），
 *   不写入正式 CandidateRecord。
 * - source.kind = 'external-url-reference' 仅用于来源追溯，**不触发任何网络抓取**；
 *   远程抓取是独立设计（docs/media/remote-media-import-design.md），默认关闭、未实现。
 * - 导入校验复用 assertMediaSwapAsset（格式头嗅探 + 扩展名一致性）；
 *   头识别 ≠ 完整可解码性证明（validation.decodeGuarantee = 'header-only'），
 *   真实可解码性仍由浏览器证据链（naturalWidth > 0）兜底。
 * - 用户显式导入确认（confirmation.confirmedBy）为必填；缺失即拒绝，不存在隐式导入。
 */

export class AssetImportError extends Error {
  constructor(message: string) { super(message); this.name = 'AssetImportError' }
}

export type AssetImportSource =
  | { kind: 'local-file'; value: string }              // 原始文件名/路径语义描述（用户上传）
  | { kind: 'external-url-reference'; value: string }  // 被替换的原始外链 URL（仅追溯，不抓取）

export interface AssetImportConfirmation {
  confirmedBy: string   // 显式确认导入的用户身份，必填
  confirmedAt: string   // ISO 8601
}

export interface AssetImportRecord {
  schema: 'asset-import-record/v1'
  importId: string
  source: AssetImportSource
  stagedAssetHash: string
  format: SniffedImageFormat
  canonicalExtension: string
  byteSize: number
  dimensions?: { width: number; height: number }
  assetRef: string
  targetRef?: string            // 已证明的修改目标（media:…）；未证明时缺省
  sourceRevision?: string       // 关联的候选 sourceRevision（attachImportToCandidate 登记）
  candidateId?: string          // 关联的候选 id
  confirmation: AssetImportConfirmation
  validation: {
    sniffedFormat: SniffedImageFormat
    extensionMatch: true
    decodeGuarantee: 'header-only'   // 能力边界显式声明：不保证完整可解码
    validatedAt: string
  }
  importedBy: string
  importedAt: string
  /** 记录完整性：对除 integrity 外的全部字段做 SHA-256（canonical JSON，indent=2）。
   *  integrity 恒为最后一个键；读取时重算比对，任何字段级篡改（含来源 URL）即拒读。 */
  integrity: { algorithm: 'sha256-v1'; recordHash: string }
}

const encoder = new TextEncoder()
const computeIntegrity = (record: Omit<AssetImportRecord, 'integrity'>): AssetImportRecord['integrity'] => ({
  algorithm: 'sha256-v1',
  recordHash: createHash('sha256').update(encoder.encode(JSON.stringify(record, null, 2))).digest('hex'),
})

export interface AssetImportInput {
  bytes: Uint8Array
  assetRef: string
  source: AssetImportSource
  confirmedBy: string            // 用户显式导入确认（必填，空字符串拒绝）
  targetRef?: string
  importedBy?: string
}

const sha256Bytes = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

/** JPEG SOF 段解析尺寸（不解码、不证明完整有效性）；其他格式返回 undefined。 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2) return undefined
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] }
    }
    offset += 2 + length
  }
  return undefined
}

function validateSource(source: AssetImportSource): void {
  if (!source || typeof source !== 'object') throw new AssetImportError('导入来源缺失')
  if (source.kind === 'local-file') {
    if (typeof source.value !== 'string' || !source.value.trim()) throw new AssetImportError('local-file 来源必须提供原始素材描述（文件名）')
  } else if (source.kind === 'external-url-reference') {
    let url: URL
    try { url = new URL(source.value) } catch { throw new AssetImportError(`external-url-reference 必须是合法 URL：${source.value}`) }
    if (!['http:', 'https:'].includes(url.protocol)) throw new AssetImportError(`external-url-reference 仅支持 http/https：${source.value}`)
  } else {
    throw new AssetImportError(`未知导入来源类型：${String((source as { kind?: unknown }).kind)}`)
  }
}

function recordPath(importsRoot: string, importId: string): string {
  if (!/^import-[0-9a-f]{12}$/.test(importId)) throw new AssetImportError(`非法 importId：${importId}`)
  return path.join(path.resolve(importsRoot), `${importId}.json`)
}

function assertRecordShape(record: unknown): AssetImportRecord {
  const candidate = record as AssetImportRecord
  if (!candidate || typeof candidate !== 'object' || candidate.schema !== 'asset-import-record/v1') {
    throw new AssetImportError('导入记录 schema 无效或缺失')
  }
  if (typeof candidate.importId !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.stagedAssetHash)) {
    throw new AssetImportError('导入记录身份字段损坏（importId / stagedAssetHash）')
  }
  if (typeof candidate.byteSize !== 'number' || candidate.byteSize <= 0) throw new AssetImportError('导入记录 byteSize 损坏')
  // 完整性哈希：integrity 恒为最后一键，读取时重算 canonical JSON 比对，字段级篡改即拒读
  const { integrity, ...rest } = candidate as AssetImportRecord & { integrity?: AssetImportRecord['integrity'] }
  if (!integrity || integrity.algorithm !== 'sha256-v1' || !/^[0-9a-f]{64}$/.test(integrity.recordHash)) {
    throw new AssetImportError('导入记录缺少有效完整性哈希（integrity.recordHash）')
  }
  const recomputed = computeIntegrity(rest as Omit<AssetImportRecord, 'integrity'>)
  if (recomputed.recordHash !== integrity.recordHash) throw new AssetImportError('导入记录完整性校验失败（记录已被篡改）')
  return candidate
}

/**
 * 用户显式导入本地图片：统一素材校验 → 内容寻址暂存 → 落一条只增不改的导入记录。
 * 同一字节重复导入是幂等的（返回已存在且字段一致的记录）；同 importId 字段不一致即拒绝。
 */
export function createAssetImport(store: StagedAssetStore, importsRoot: string, input: AssetImportInput): AssetImportRecord {
  if (!store || typeof store.store !== 'function' || typeof store.readStagedAsset !== 'function') {
    throw new AssetImportError('缺少受信任的暂存服务')
  }
  if (typeof input.confirmedBy !== 'string' || !input.confirmedBy.trim()) {
    throw new AssetImportError('缺少用户显式导入确认（confirmedBy 必填），拒绝隐式导入')
  }
  validateSource(input.source)
  // 统一素材校验入口（格式头嗅探 + 扩展名一致性），与执行器 plan 同源
  const format = assertMediaSwapAsset(input.bytes, input.assetRef, '导入素材')
  const stagedAssetHash = store.store(input.bytes)
  const base: Omit<AssetImportRecord, 'integrity'> = {
    schema: 'asset-import-record/v1',
    importId: `import-${stagedAssetHash.slice(0, 12)}`,
    source: input.source,
    stagedAssetHash,
    format,
    canonicalExtension: canonicalImageExtension(format),
    byteSize: input.bytes.byteLength,
    dimensions: format === 'jpeg' ? jpegDimensions(input.bytes) : undefined,
    assetRef: input.assetRef,
    targetRef: input.targetRef,
    confirmation: { confirmedBy: input.confirmedBy.trim(), confirmedAt: new Date().toISOString() },
    validation: {
      sniffedFormat: format,
      extensionMatch: true,
      decodeGuarantee: 'header-only',
      validatedAt: new Date().toISOString(),
    },
    importedBy: input.importedBy ?? input.confirmedBy.trim(),
    importedAt: new Date().toISOString(),
  }
  const record: AssetImportRecord = { ...base, integrity: computeIntegrity(base) }
  const target = recordPath(importsRoot, record.importId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) {
    const existing = readAssetImport(importsRoot, record.importId)
    // 幂等重导：忽略时间戳类字段与完整性哈希，比较语义字段
    const comparable = (value: AssetImportRecord) => JSON.stringify({
      ...value, confirmation: { confirmedBy: value.confirmation.confirmedBy }, importedAt: null, importedBy: null,
      validation: { ...value.validation, validatedAt: null }, integrity: null,
    })
    if (comparable(existing) !== comparable(record)) {
      throw new AssetImportError(`导入记录 ${record.importId} 已存在且字段不一致（记录只增不改，拒绝覆盖）`)
    }
    return existing
  }
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2), { flag: 'wx' })
  fs.renameSync(temporary, target)
  return record
}

export function readAssetImport(importsRoot: string, importId: string): AssetImportRecord {
  const target = recordPath(importsRoot, importId)
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new AssetImportError(`导入记录不存在：${importId}`)
  let parsed: unknown
  try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')) } catch { throw new AssetImportError(`导入记录不是合法 JSON（可能已被篡改）：${importId}`) }
  const record = assertRecordShape(parsed)
  if (record.importId !== importId) throw new AssetImportError(`导入记录 importId 与文件名不一致：${importId}`)
  return record
}

export function listAssetImports(importsRoot: string): AssetImportRecord[] {
  const root = path.resolve(importsRoot)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root)
    .filter(name => /^import-[0-9a-f]{12}\.json$/.test(name))
    .map(name => readAssetImport(root, name.replace(/\.json$/, '')))
}

/**
 * 追溯一致性核对：暂存字节 ↔ 记录（哈希/格式/字节数）。
 * 暂存缺失或字节被篡改时 fail-closed，错误原因区分"缺失"与"不匹配"。
 */
export function verifyImportTraceability(store: StagedAssetStore, record: AssetImportRecord): { ok: true; byteSize: number } {
  if (!record || record.schema !== 'asset-import-record/v1') throw new AssetImportError('追溯核对需要合法导入记录')
  let bytes: Uint8Array
  try { bytes = store.readStagedAsset(record.stagedAssetHash) }
  catch (error) {
    if (error instanceof MediaAssetStagingError && /不存在/.test(error.message)) throw new AssetImportError(`追溯核对失败：暂存资产缺失（${record.stagedAssetHash.slice(0, 12)}…）`)
    throw error
  }
  if (sha256Bytes(bytes) !== record.stagedAssetHash) throw new AssetImportError('追溯核对失败：暂存字节与记录哈希不一致')
  if (bytes.byteLength !== record.byteSize) throw new AssetImportError(`追溯核对失败：字节数不一致（暂存 ${bytes.byteLength} ≠ 记录 ${record.byteSize}）`)
  const sniffed = assertMediaSwapAsset(bytes, record.assetRef, '追溯核对')
  if (sniffed !== record.format) throw new AssetImportError(`追溯核对失败：格式不一致（暂存 ${sniffed} ≠ 记录 ${record.format}）`)
  return { ok: true, byteSize: bytes.byteLength }
}

/**
 * 登记候选关联（sourceRevision / candidateId）。幂等：重复登记同一组合直接返回；
 * 已关联其他候选或 revision 即拒绝（fail-closed，不静默改写追溯链）。
 */
export function attachImportToCandidate(
  store: StagedAssetStore, importsRoot: string, importId: string,
  link: { candidateId: string; sourceRevision: string; linkedBy: string },
): AssetImportRecord {
  if (!link.candidateId || !link.sourceRevision || !link.linkedBy) throw new AssetImportError('候选关联需要 candidateId / sourceRevision / linkedBy')
  const record = readAssetImport(importsRoot, importId)
  verifyImportTraceability(store, record)
  if (record.candidateId && record.candidateId !== link.candidateId) {
    throw new AssetImportError(`导入记录已关联候选 ${record.candidateId}，拒绝改关联到 ${link.candidateId}`)
  }
  if (record.sourceRevision && record.sourceRevision !== link.sourceRevision) {
    throw new AssetImportError(`导入记录已关联 revision ${record.sourceRevision}，拒绝改关联`)
  }
  const { integrity: _discarded, ...rest } = record
  const updatedBase: Omit<AssetImportRecord, 'integrity'> = { ...rest, candidateId: link.candidateId, sourceRevision: link.sourceRevision }
  const updated: AssetImportRecord = { ...updatedBase, integrity: computeIntegrity(updatedBase) }
  const target = recordPath(importsRoot, importId)
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(updated, null, 2), { flag: 'wx' })
  fs.renameSync(temporary, target)
  return updated
}
