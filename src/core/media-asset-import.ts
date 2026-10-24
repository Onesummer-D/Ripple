import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import * as path from 'node:path'
import type { ProjectRevision, SourceGraph } from './model'
import { sourceProvenPageImpact, type PageImpact } from './scope'
import { createMediaAssetSwapExecutor } from './media-asset-swap'
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
/** 用户交互层提出的授权请求；它本身不是授权凭据。 */
export interface AssetImportConsentRequest {
  actorId: string
  requestedAt: string
}

/** 由可信应用边界签发并可验证的授权回执。ledger 不接受请求字段冒充回执。 */
export interface AssetImportConsentReceipt {
  authorityId: string
  authorizationId: string
  actorId: string
  authorizedAt: string
  importId: string
  sourceKind: AssetImportSourceKind
  sourceFingerprint: string
  proof: string
}

export interface AssetImportConsentContext {
  importId: string
  sourceKind: AssetImportSourceKind
  sourceFingerprint: string
}

export interface AssetImportConsentAuthority {
  authorize(request: AssetImportConsentRequest, context: AssetImportConsentContext): AssetImportConsentReceipt | undefined
  verify(receipt: AssetImportConsentReceipt, context: AssetImportConsentContext): boolean
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
  consent: AssetImportConsentReceipt
  source: AssetImportSource
  stagedAssetHash?: string
  extension?: string
  format?: SniffedImageFormat
  /** 格式头识别不是解码；完整解码须由 Verification 浏览器证据证明。 */
  formatValidation?: 'header-only'
  /** 只有 source-proven 绑定成功后才会写入。 */
  targetRef?: string
  targetCertainty: 'source-proven' | 'unresolved'
  projectRevision?: ProjectRevision
  sourceGraphId?: string
  pageImpact?: PageImpact
  candidateId?: string
  retainedReferences?: Array<{ kind: 'candidate' | 'verification-run' | 'manual'; id: string }>
  createdAt: string
  result: AssetImportResult
}

export interface LocalAssetImportInput {
  localPath: string
  consent: AssetImportConsentRequest
  importId?: string
  createdAt?: string
}

export interface ExternalUrlReferenceInput {
  url: string
  consent: AssetImportConsentRequest
  importId?: string
  createdAt?: string
}

export interface AssetTargetBinding {
  graph: SourceGraph
  targetRef: string
}

export interface AssetImportCleanupResult {
  /** 仅预览。阶段一不会物理删除字节或不认识的目录项。 */
  previewHashes: string[]
  retainedHashes: string[]
  invalidEntries: string[]
  protectedBy: Record<string, string[]>
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

/** 外部 URL 永远不抓取；常见凭据参数只在 provenance 中保留键名并清空值。 */
const SENSITIVE_QUERY_KEY = /(?:token|key|auth|signature|secret|password|credential|session|access[_-]?code)/i
const hashText = (value: string) => createHash('sha256').update(value).digest('hex')
const hashBytes = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new AssetImportError(`${label}必须是非空字符串`)
}

function assertImportId(importId: string): void {
  if (!IMPORT_ID.test(importId)) throw new AssetImportError(`importId 含有非法路径字符：${importId}`)
}

function assertConsentRequest(consent: AssetImportConsentRequest): void {
  if (!consent || typeof consent !== 'object') throw new AssetImportError('资产导入需要可信授权边界提供的显式同意')
  assertNonEmpty(consent.actorId, '同意者')
  assertTimestamp(consent.requestedAt, '同意时间')
}

function assertConsentReceipt(receipt: AssetImportConsentReceipt, authority: AssetImportConsentAuthority, context: AssetImportConsentContext): void {
  if (!receipt || typeof receipt !== 'object') throw new AssetImportError('资产导入缺少可信授权回执')
  assertNonEmpty(receipt.authorityId, '授权机构')
  assertNonEmpty(receipt.authorizationId, '授权回执 ID')
  assertNonEmpty(receipt.actorId, '授权用户')
  assertNonEmpty(receipt.proof, '授权证明')
  if (receipt.importId !== context.importId || receipt.sourceKind !== context.sourceKind || receipt.sourceFingerprint !== context.sourceFingerprint) {
    throw new AssetImportError('用户同意回执与当前导入记录或来源字节不匹配')
  }
  assertTimestamp(receipt.authorizedAt, '授权时间')
  if (!authority.verify(receipt, context)) throw new AssetImportError('用户同意回执未经可信授权边界验证')
}

function authorizeConsent(request: AssetImportConsentRequest, authority: AssetImportConsentAuthority, context: AssetImportConsentContext): AssetImportConsentReceipt {
  assertConsentRequest(request)
  const receipt = authority.authorize(request, context)
  if (!receipt) throw new AssetImportError('用户未明确同意资产导入')
  assertConsentReceipt(receipt, authority, context)
  if (receipt.actorId !== request.actorId) throw new AssetImportError('授权回执用户与同意请求不一致')
  return receipt
}

function assertTimestamp(value: string, label: string): void {
  assertNonEmpty(value, label)
  if (!Number.isFinite(Date.parse(value))) throw new AssetImportError(`${label}必须是有效 ISO 时间`)
}

function assertOnlyKeys(value: unknown, label: string, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssetImportError(`${label}结构无效`)
  const invalid = Object.keys(value).filter(key => !allowed.includes(key))
  if (invalid.length) throw new AssetImportError(`${label}含有未授权字段：${invalid.join(', ')}`)
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
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.set(key, '[REDACTED]')
  }
  parsed.hash = ''
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

function readLocalImage(localPath: string): { bytes: Uint8Array; extension: string; format: SniffedImageFormat; fileName: string } {
  assertNonEmpty(localPath, '本地素材路径')
  const resolved = path.resolve(localPath)
  let stat: fs.Stats
  try { stat = fs.lstatSync(resolved) } catch { throw new AssetImportError(`本地素材不存在：${localPath}`) }
  if (stat.isSymbolicLink()) throw new AssetImportError('拒绝从符号链接导入素材；请显式选择普通文件')
  if (!stat.isFile()) throw new AssetImportError('本地素材必须是普通文件')
  let fd: number | undefined
  let bytes: Uint8Array
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow)
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new AssetImportError('本地素材在校验时已被替换；请重新选择文件')
    }
    bytes = Uint8Array.from(fs.readFileSync(fd))
    const afterRead = fs.fstatSync(fd)
    const pathAfterRead = fs.lstatSync(resolved)
    if (pathAfterRead.isSymbolicLink() || pathAfterRead.dev !== opened.dev || pathAfterRead.ino !== opened.ino ||
      afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs || afterRead.ctimeMs !== opened.ctimeMs) {
      throw new AssetImportError('本地素材在读取过程中发生变化；拒绝导入')
    }
  } catch (error) {
    if (error instanceof AssetImportError) throw error
    throw new AssetImportError(`本地素材读取失败：${path.basename(resolved)}`)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
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

function writeRecord(recordsRoot: string, record: AssetImportRecord, replace = false): void {
  const target = recordPath(recordsRoot, record.importId)
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new AssetImportError(`导入记录目标不是普通文件：${record.importId}`)
    if (!replace) throw new AssetImportError(`重复导入记录：${record.importId}`)
  } else if (replace) throw new AssetImportError(`待更新导入记录不存在：${record.importId}`)
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

function readRecord(target: string, recordsRoot: string, authority: AssetImportConsentAuthority): AssetImportRecord {
  const parentStat = fs.lstatSync(recordsRoot)
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || fs.realpathSync(recordsRoot) !== fs.realpathSync(path.dirname(target))) {
    throw new AssetImportError('导入记录父目录发生变化或越界')
  }
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new AssetImportError(`导入记录不是普通文件：${path.basename(target)}`)
  let parsed: unknown
  let fd: number | undefined
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new AssetImportError('导入记录在校验时已被替换')
    const text = fs.readFileSync(fd, 'utf8')
    const afterRead = fs.fstatSync(fd)
    const current = fs.lstatSync(target)
    if (current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino ||
      afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs || afterRead.ctimeMs !== opened.ctimeMs) {
      throw new AssetImportError('导入记录在读取过程中发生变化')
    }
    parsed = JSON.parse(text)
  } catch (error) {
    if (error instanceof AssetImportError) throw error
    throw new AssetImportError(`导入记录 JSON 损坏或读取失败：${path.basename(target)}`)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new AssetImportError(`导入记录 schema 不受支持：${path.basename(target)}`)
  }
  const record = parsed as AssetImportRecord
  assertImportRecord(record, authority)
  return cloneRecord(record)
}

function assertImportRecord(record: AssetImportRecord, authority: AssetImportConsentAuthority): void {
  if (!record || record.schemaVersion !== 1) throw new AssetImportError('导入记录 schema 不受支持')
  assertOnlyKeys(record, '导入记录', ['schemaVersion', 'importId', 'consent', 'source', 'stagedAssetHash', 'extension', 'format', 'formatValidation', 'targetRef', 'targetCertainty', 'projectRevision', 'sourceGraphId', 'pageImpact', 'candidateId', 'retainedReferences', 'createdAt', 'result'])
  assertImportId(record.importId)
  assertOnlyKeys(record.consent, '授权回执', ['authorityId', 'authorizationId', 'actorId', 'authorizedAt', 'importId', 'sourceKind', 'sourceFingerprint', 'proof'])
  assertTimestamp(record.createdAt, '创建时间')
  if (!record.source || (record.source.kind !== 'local-file' && record.source.kind !== 'external-url-reference')) {
    throw new AssetImportError(`导入记录来源类型不受支持：${record.importId}`)
  }
  if (record.source.kind === 'local-file') {
    assertOnlyKeys(record.source, '本地来源', ['kind', 'fileName'])
    assertNonEmpty(record.source.fileName, '本地素材文件名')
    if (record.source.fileName.includes('/') || record.source.fileName.includes('\\')) throw new AssetImportError('导入记录文件名不能包含路径分隔符')
    if (record.result !== 'staged' || !record.stagedAssetHash || !HASH.test(record.stagedAssetHash) || !record.extension || !EXTENSION.test(record.extension) || !record.format || record.formatValidation !== 'header-only') {
      throw new AssetImportError(`本地导入记录缺少完整暂存信息：${record.importId}`)
    }
    assertConsentReceipt(record.consent, authority, { importId: record.importId, sourceKind: 'local-file', sourceFingerprint: record.stagedAssetHash })
  } else if (record.source.kind === 'external-url-reference') {
    assertOnlyKeys(record.source, 'URL 来源', ['kind', 'url'])
    if (record.result !== 'reference-only' || !record.source.url || record.stagedAssetHash || record.extension || record.format || record.formatValidation) {
      throw new AssetImportError(`外部 URL 记录不能携带本地暂存信息：${record.importId}`)
    }
    if (assertHttpsReference(record.source.url) !== record.source.url) throw new AssetImportError(`外部 URL provenance 未脱敏：${record.importId}`)
    assertConsentReceipt(record.consent, authority, { importId: record.importId, sourceKind: 'external-url-reference', sourceFingerprint: hashText(record.source.url) })
  }
  if (record.targetCertainty === 'source-proven') {
    assertNonEmpty(record.targetRef, '已证明 targetRef')
    assertNonEmpty(record.sourceGraphId, 'SourceGraph 身份')
    assertRevision(record.projectRevision)
    assertPageImpact(record.pageImpact)
    assertOnlyKeys(record.projectRevision!, '项目修订', ['projectId', 'sourceDigest', 'gitCommit', 'ref', 'runtimeFingerprint'])
    assertOnlyKeys(record.pageImpact, '页面影响', ['pageRefs', 'unresolved', 'certainty'])
  } else if (record.targetCertainty !== 'unresolved' || record.targetRef || record.sourceGraphId || record.pageImpact || record.projectRevision || record.candidateId) {
    throw new AssetImportError(`导入记录 targetRef 证明状态不一致：${record.importId}`)
  }
  assertCandidateId(record.candidateId)
  if (record.retainedReferences !== undefined) {
    if (!Array.isArray(record.retainedReferences)) throw new AssetImportError(`导入记录保留引用无效：${record.importId}`)
    for (const reference of record.retainedReferences) {
      if (!reference || !['candidate', 'verification-run', 'manual'].includes(reference.kind)) throw new AssetImportError(`导入记录保留引用类型无效：${record.importId}`)
      assertOnlyKeys(reference, '保留引用', ['kind', 'id'])
      assertNonEmpty(reference.id, '保留引用 ID')
    }
  }
  if (record.candidateId && !record.retainedReferences?.some(reference => reference.kind === 'candidate' && reference.id === record.candidateId)) {
    throw new AssetImportError(`候选绑定缺少对应的保留引用：${record.importId}`)
  }
}

function assertPageImpact(impact: PageImpact | undefined): asserts impact is PageImpact {
  if (!impact || impact.certainty !== 'source-proven' || !Array.isArray(impact.pageRefs) || !impact.pageRefs.length ||
    !Array.isArray(impact.unresolved) || impact.unresolved.length !== 0 || impact.pageRefs.some(ref => typeof ref !== 'string' || !ref)) {
    throw new AssetImportError('MEDIA 目标需要完整、无 unresolved 的 sourceProvenPageImpact')
  }
}

export interface AssetImportLedger {
  readonly root: string
  readonly stagedStore: StagedAssetStore
  /** 直接复用已有执行器；Candidate 和执行器的门控仍在原核心中。 */
  readonly mediaExecutor: ReturnType<typeof createMediaAssetSwapExecutor>
  importLocal(input: LocalAssetImportInput): AssetImportRecord
  referenceExternalUrl(input: ExternalUrlReferenceInput): AssetImportRecord
  get(importId: string): AssetImportRecord | undefined
  list(): AssetImportRecord[]
  bindTarget(importId: string, binding: AssetTargetBinding): AssetImportRecord
  bindCandidate(importId: string, graph: SourceGraph, candidateId: string): AssetImportRecord
  assertCurrentForGraph(importId: string, graph: SourceGraph): AssetImportRecord
  retain(importId: string, reference: { kind: 'candidate' | 'verification-run' | 'manual'; id: string }): AssetImportRecord
  remove(importId: string): void
  previewUnreferencedAssets(): AssetImportCleanupResult
}

export function createAssetImportLedger(root: string, authority: AssetImportConsentAuthority): AssetImportLedger {
  assertNonEmpty(root, '资产导入 ledger 根目录')
  if (!authority || typeof authority.authorize !== 'function' || typeof authority.verify !== 'function') {
    throw new AssetImportError('必须注入可信用户授权与回执验证边界')
  }
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
  const recordsPhysical = fs.realpathSync(recordsRoot)
  const rootPhysical = fs.realpathSync(resolvedRoot)
  const recordsRelative = path.relative(rootPhysical, recordsPhysical)
  if (recordsRelative.startsWith('..') || path.isAbsolute(recordsRelative)) throw new AssetImportError('导入记录目录物理路径越界')
  if (fs.existsSync(stagedRoot)) {
    const stagedRootStat = fs.lstatSync(stagedRoot)
    if (stagedRootStat.isSymbolicLink() || !stagedRootStat.isDirectory()) throw new AssetImportError('暂存目录必须是安全普通目录')
  }
  const stagedStore = createStagedAssetStore(stagedRoot)

  const assertStoredBytes = (record: AssetImportRecord): AssetImportRecord => {
    if (record.stagedAssetHash) {
      const bytes = stagedStore.readStagedAsset(record.stagedAssetHash)
      const actualFormat = assertMediaSwapAsset(bytes, `/ledger-asset${record.extension}`)
      if (actualFormat !== record.format) throw new AssetImportError(`导入记录格式与暂存字节不匹配：${record.importId}`)
    }
    return record
  }

  const list = (): AssetImportRecord[] => fs.readdirSync(recordsRoot, { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => assertStoredBytes(readRecord(path.join(recordsRoot, entry.name), recordsRoot, authority)))

  const getRecord = (importId: string): AssetImportRecord | undefined => {
    const target = recordPath(recordsRoot, importId)
    if (!fs.existsSync(target)) return undefined
    return assertStoredBytes(readRecord(target, recordsRoot, authority))
  }

  const persist = (record: AssetImportRecord, replace = false): AssetImportRecord => {
    writeRecord(recordsRoot, record, replace)
    return cloneRecord(record)
  }

  const sameRevision = (a: ProjectRevision | undefined, b: ProjectRevision): boolean =>
    !!a && a.projectId === b.projectId && a.sourceDigest === b.sourceDigest && a.runtimeFingerprint === b.runtimeFingerprint && a.gitCommit === b.gitCommit && a.ref === b.ref

  const assertGraphCurrentForRecord = (record: AssetImportRecord, graph: SourceGraph): AssetImportRecord => {
    if (record.targetCertainty !== 'source-proven' || !record.targetRef || !sameRevision(record.projectRevision, graph.revision)) {
      throw new AssetImportError('SourceGraph targetRef 已过期；必须基于当前源码版本重新证明目标与页面影响')
    }
    const target = graph.nodes.find(node => node.id === record.targetRef)
    if (!target || target.kind !== 'media' || !target.location?.path || target.location.start === undefined || target.location.end === undefined) {
      throw new AssetImportError('当前 SourceGraph 不再包含有效的媒体 targetRef')
    }
    const impact = sourceProvenPageImpact(graph, record.targetRef)
    assertPageImpact(impact)
    if (JSON.stringify(impact) !== JSON.stringify(record.pageImpact)) {
      throw new AssetImportError('当前 SourceGraph 的 PageImpact 与历史绑定不一致；必须重新确认影响范围')
    }
    return record
  }

  const sameImport = (existing: AssetImportRecord, candidate: AssetImportRecord): boolean =>
    existing.importId === candidate.importId && existing.result === candidate.result && existing.source.kind === candidate.source.kind &&
    existing.source.fileName === candidate.source.fileName && existing.source.url === candidate.source.url &&
    existing.stagedAssetHash === candidate.stagedAssetHash && existing.extension === candidate.extension && existing.format === candidate.format &&
    existing.consent.actorId === candidate.consent.actorId

  const persistOrReturnIdempotent = (record: AssetImportRecord): AssetImportRecord => {
    const existing = getRecord(record.importId)
    if (existing) {
      if (sameImport(existing, record)) return existing
      throw new AssetImportError(`重复 importId 指向不同导入内容：${record.importId}`)
    }
    return persist(record)
  }

  const update = (record: AssetImportRecord): AssetImportRecord => persist(record, true)

  const mediaExecutor = createMediaAssetSwapExecutor()

  return {
    root: resolvedRoot,
    stagedStore,
    mediaExecutor,
    importLocal(input) {
      const importId = createImportId(input.importId)
      const image = readLocalImage(input.localPath)
      const hash = hashBytes(image.bytes)
      const consent = authorizeConsent(input.consent, authority, { importId, sourceKind: 'local-file', sourceFingerprint: hash })
      const stagedHash = stagedStore.store(image.bytes)
      if (stagedHash !== hash) throw new AssetImportError('暂存服务返回的素材 hash 与读取字节不一致')
      const candidate: AssetImportRecord = {
        schemaVersion: 1,
        importId,
        consent,
        source: { kind: 'local-file', fileName: image.fileName },
        stagedAssetHash: stagedHash,
        extension: image.extension,
        format: image.format,
        formatValidation: 'header-only',
        targetCertainty: 'unresolved',
        createdAt: nowIso(input.createdAt),
        result: 'staged',
      }
      return persistOrReturnIdempotent(candidate)
    },
    referenceExternalUrl(input) {
      const importId = createImportId(input.importId)
      const url = assertHttpsReference(input.url)
      const consent = authorizeConsent(input.consent, authority, { importId, sourceKind: 'external-url-reference', sourceFingerprint: hashText(url) })
      return persistOrReturnIdempotent({
        schemaVersion: 1,
        importId,
        consent,
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
      if (record.result !== 'staged') throw new AssetImportError('reference-only 外部 URL 不能直接绑定媒体目标；需另行完成获批的本地导入')
      assertNonEmpty(binding.targetRef, 'targetRef')
      const target = binding.graph.nodes.find(node => node.id === binding.targetRef)
      if (!target || target.kind !== 'media' || !target.location?.path || target.location.start === undefined || target.location.end === undefined) {
        throw new AssetImportError('导入目标必须是当前 SourceGraph 中有 AST 位置的 media 节点')
      }
      const impact = sourceProvenPageImpact(binding.graph, binding.targetRef)
      assertPageImpact(impact)
      if (impact.pageRefs.some(pageRef => binding.graph.nodes.find(node => node.id === pageRef)?.kind !== 'route')) {
        throw new AssetImportError('PageImpact 含有未解析或非 route 页面引用')
      }
      if (record.targetRef && record.targetRef !== binding.targetRef) throw new AssetImportError('导入记录已有不同的已证明目标')
      if (record.targetRef && !sameRevision(record.projectRevision, binding.graph.revision)) throw new AssetImportError('项目源码或运行时版本已变化，历史 targetRef 不能继续授权')
      const next: AssetImportRecord = {
        ...record, targetRef: binding.targetRef, targetCertainty: 'source-proven',
        projectRevision: { ...binding.graph.revision }, sourceGraphId: binding.graph.id,
        pageImpact: { pageRefs: [...impact.pageRefs], unresolved: [...impact.unresolved], certainty: impact.certainty },
      }
      return update(next)
    },
    bindCandidate(importId, graph, candidateId) {
      const record = getRecord(importId)
      if (!record) throw new AssetImportError(`导入记录不存在：${importId}`)
      assertGraphCurrentForRecord(record, graph)
      assertNonEmpty(candidateId, 'candidateId')
      const references = [...(record.retainedReferences ?? []).filter(item => !(item.kind === 'candidate' && item.id === candidateId)), { kind: 'candidate' as const, id: candidateId }]
      return update({ ...record, candidateId, retainedReferences: references })
    },
    assertCurrentForGraph(importId, graph) {
      const record = getRecord(importId)
      if (!record) throw new AssetImportError(`导入记录不存在：${importId}`)
      return assertGraphCurrentForRecord(record, graph)
    },
    retain(importId, reference) {
      const record = getRecord(importId)
      if (!record) throw new AssetImportError(`导入记录不存在：${importId}`)
      assertNonEmpty(reference.id, '保留引用 ID')
      const refs = record.retainedReferences ?? []
      if (refs.some(item => item.kind === reference.kind && item.id === reference.id)) return record
      return update({ ...record, retainedReferences: [...refs, { ...reference }] })
    },
    remove(importId) {
      const target = recordPath(recordsRoot, importId)
      if (!fs.existsSync(target)) return
      const record = readRecord(target, recordsRoot, authority)
      fs.unlinkSync(target)
      // 阶段一保留内容寻址字节；孤儿只预览，不物理删除。
      void record
    },
    previewUnreferencedAssets() {
      const records = list()
      const byHash = new Map<string, AssetImportRecord[]>()
      for (const record of records) {
        if (record.stagedAssetHash) byHash.set(record.stagedAssetHash, [...(byHash.get(record.stagedAssetHash) ?? []), record])
      }
      const previewHashes: string[] = []
      const retainedHashes: string[] = []
      const invalidEntries: string[] = []
      const protectedBy: Record<string, string[]> = {}
      for (const prefixEntry of fs.readdirSync(stagedRoot, { withFileTypes: true })) {
        const prefixPath = path.join(stagedRoot, prefixEntry.name)
        if (!prefixEntry.isDirectory() || prefixEntry.isSymbolicLink() || !/^[0-9a-f]{2}$/.test(prefixEntry.name)) {
          invalidEntries.push(prefixEntry.name)
          continue
        }
        for (const assetEntry of fs.readdirSync(prefixPath, { withFileTypes: true })) {
          const assetPath = path.join(prefixPath, assetEntry.name)
          const hash = assetEntry.name
          if (assetEntry.isSymbolicLink() || !assetEntry.isFile() || !HASH.test(hash) || !hash.startsWith(prefixEntry.name)) {
            invalidEntries.push(path.relative(stagedRoot, assetPath))
          } else if ((() => { try { stagedStore.readStagedAsset(hash); return true } catch { return false } })() === false) {
            invalidEntries.push(path.relative(stagedRoot, assetPath))
          } else if (byHash.has(hash)) {
            retainedHashes.push(hash)
            protectedBy[hash] = byHash.get(hash)!.flatMap(record => [
              `import:${record.importId}`,
              ...(record.candidateId ? [`candidate:${record.candidateId}`] : []),
              ...(record.retainedReferences ?? []).map(reference => `${reference.kind}:${reference.id}`),
            ])
          } else {
            previewHashes.push(hash)
          }
        }
      }
      return { previewHashes: previewHashes.sort(), retainedHashes: retainedHashes.sort(), invalidEntries: invalidEntries.sort(), protectedBy }
    },
  }
}

/** 显式给应用侧复用既有 MEDIA executor，不复制其 Candidate 授权或 plan 逻辑。 */
export function createAssetImportMediaExecutor(): ReturnType<typeof createMediaAssetSwapExecutor> {
  return createMediaAssetSwapExecutor()
}
