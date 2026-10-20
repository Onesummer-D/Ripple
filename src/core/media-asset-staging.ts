import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * MEDIA 资产暂存（B 侧受信任资产服务）。
 *
 * - createStagedAssetStore：内容寻址的暂存区，供应用注入 readStagedAsset；
 *   候选核心会按 SHA-256 重算并复制字节，本服务只做受控存取。
 * - resolveAssetRefToRelativePath：把写入源码的 assetRef（/、./、../ 开头）
 *   映射为候选 worktree 内的新增文件相对路径；无项目名特判，无法确定布局即报错。
 */

export class MediaAssetStagingError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaAssetStagingError' }
}

const sha256Bytes = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

/** 跨 realm 安全的字节数组判定（jsdom 环境下 instanceof Uint8Array 会失真，沿用候选核心的 BYTES_PER_ELEMENT 判法） */
const isByteArray = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && (value as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT === 1

export interface StagedAssetStore {
  /** 存入字节，返回其 SHA-256 身份（内容寻址，重复存入安全） */
  store(bytes: Uint8Array): string
  /** 按 SHA-256 身份读取字节副本；缺失即抛错（fail-closed，永不返回空字节冒充） */
  readStagedAsset(sha256: string): Uint8Array
  readonly root: string
}

export function createStagedAssetStore(root: string): StagedAssetStore {
  const resolved = path.resolve(root)
  fs.mkdirSync(resolved, { recursive: true })
  const resolvedRoot = fs.realpathSync(resolved)
  const resolveHashPath = (sha256: string): string => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new MediaAssetStagingError(`暂存资产身份必须是小写 SHA-256：${sha256}`)
    const target = path.join(resolvedRoot, sha256.slice(0, 2), sha256)
    const relative = path.relative(resolvedRoot, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new MediaAssetStagingError('暂存资产路径越界')
    return target
  }
  return {
    root: resolvedRoot,
    store(bytes) {
      if (!isByteArray(bytes) || !bytes.byteLength) throw new MediaAssetStagingError('暂存资产必须是非空字节')
      const sha256 = sha256Bytes(bytes)
      const target = resolveHashPath(sha256)
      if (fs.existsSync(target)) {
        // 内容寻址：已存在则复核一致性
        const existing = fs.readFileSync(target)
        if (sha256Bytes(existing) !== sha256) throw new MediaAssetStagingError(`暂存区哈希目录损坏：${sha256}`)
        return sha256
      }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const temporary = path.join(path.dirname(target), `.${sha256}.${process.pid}.tmp`)
      fs.writeFileSync(temporary, bytes, { flag: 'wx' })
      try {
        const stat = fs.lstatSync(temporary)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new MediaAssetStagingError('暂存写入产生了非普通文件')
        fs.renameSync(temporary, target)
      } catch (error) {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
        throw error
      }
      return sha256
    },
    readStagedAsset(sha256) {
      const target = resolveHashPath(sha256)
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new MediaAssetStagingError(`暂存资产不存在：${sha256}`)
      }
      const bytes = fs.readFileSync(target)
      if (sha256Bytes(bytes) !== sha256) throw new MediaAssetStagingError(`暂存资产字节与身份不匹配：${sha256}`)
      return Uint8Array.from(bytes)
    },
  }
}

/**
 * 把 assetRef（写入源码的 URL 引用）映射为候选 worktree 内的相对路径。
 * - 以 / 开头：按 public 目录资源处理（Vite/Bolt 约定，publicDir 可配）。
 * - 以 ./ 或 ../ 开头：相对消费文件所在目录解析。
 * 不做项目名特判；无法确定布局时显式报错，不猜测。
 */
export function resolveAssetRefToRelativePath(assetRef: string, consumerFile: string, options: { publicDir?: string } = {}): string {
  if (!assetRef || typeof assetRef !== 'string') throw new MediaAssetStagingError('assetRef 必须是非空字符串')
  if (assetRef.startsWith('/')) {
    // 先拒绝原始引用中的 .. 段：join/normalize 会把 '/../x' 折叠成 'x'，事后检查形同虚设
    if (assetRef.split('/').includes('..')) throw new MediaAssetStagingError(`assetRef 不允许包含 .. 段：${assetRef}`)
    const publicDir = (options.publicDir ?? 'public').split(path.sep).join('/')
    const relative = path.posix.normalize(path.posix.join(publicDir, `.${assetRef}`))
    if (relative !== publicDir && !relative.startsWith(`${publicDir}/`)) throw new MediaAssetStagingError(`assetRef 越出 public 目录：${assetRef}`)
    return relative
  }
  if (assetRef.startsWith('./') || assetRef.startsWith('../')) {
    const consumerDir = path.posix.dirname(consumerFile.split(path.sep).join('/'))
    const relative = path.posix.normalize(path.posix.join(consumerDir, assetRef))
    if (relative.startsWith('..') || path.posix.isAbsolute(relative)) throw new MediaAssetStagingError(`相对 assetRef 越出项目：${assetRef}`)
    return relative
  }
  throw new MediaAssetStagingError(`不支持的 assetRef 形式（只能是 /、./、../ 开头）：${assetRef}`)
}
