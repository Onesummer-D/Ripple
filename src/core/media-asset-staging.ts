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

/** 常见光栅图格式的魔数嗅探（仅识别，不解码）。MEDIA v1 只支持图片素材替换。 */
export type SniffedImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif'

export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | undefined {
  if (bytes.byteLength >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.byteLength >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.byteLength >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  if (bytes.byteLength >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  // AVIF/HEIF：ftyp box 在第 4-8 字节，brand 'avif' 或 'avis'
  if (bytes.byteLength >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 &&
      ((bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66) ||
       (bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x73))) return 'avif'
  return undefined
}

/**
 * 素材文件类型验证：确认字节确是受支持的图片格式。
 * 暂存 store 本身保持内容寻址的通用字节语义（测试与未来的非图资产仍可存取）；
 * 真实素材入口（验收脚本/未来的媒体库 UI）在写入暂存前必须经此校验，
 * 防止把可执行/SVG 脚本等内容以图片扩展名放进项目 public 目录。
 */
export function assertImageBytes(bytes: Uint8Array, context = '媒体素材'): SniffedImageFormat {
  if (!isByteArray(bytes) || !bytes.byteLength) throw new MediaAssetStagingError(`${context}必须是非空字节`)
  const format = sniffImageFormat(bytes)
  if (!format) {
    throw new MediaAssetStagingError(
      `${context}不是受支持的图片格式（按魔数识别 jpeg/png/webp/gif/avif）；拒绝以图片扩展名写入项目。`,
    )
  }
  return format
}

/**
 * 把 assetRef（写入源码的 URL 引用）映射为候选 worktree 内的相对路径。
 * - 以 / 开头：按 public 目录资源处理（Vite/Bolt 约定，publicDir 可配）。
 * - 以 ./ 或 ../ 开头：相对消费文件所在目录解析。
 * 不做项目名特判；无法确定布局时显式报错，不猜测。
 */
export function resolveAssetRefToRelativePath(assetRef: string, consumerFile: string, options: { publicDir?: string } = {}): string {
  if (!assetRef || typeof assetRef !== 'string') throw new MediaAssetStagingError('assetRef 必须是非空字符串')
  // 反斜杠防御：Windows 下游 path.join 会把返回值中的 '\' 重新解释为分隔符，
  // 使 'public/..\\x' 逃逸 public 目录（即便仍在 worktree 内也违背写入意图）。
  if (assetRef.includes('\\')) throw new MediaAssetStagingError(`assetRef 不允许包含反斜杠：${assetRef}`)
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
