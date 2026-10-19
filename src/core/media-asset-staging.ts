import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * MEDIA asset-swap 执行器（B 侧模块）。
 *
 * 职责：把新图片字节 staged 进候选 worktree，并做 SHA-256 完整性校验。
 * 不修改 A 的共享核心（candidate.ts / model.ts / session.ts）；
 * 与 candidate.ts 的集成通过 A 确认后的最小扩展点接入。
 */

export class MediaAssetStagingError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaAssetStagingError' }
}

export interface StagedMediaAsset {
  /** 写入源码的引用（payload.assetRef），如 /images/new-hero.jpg */
  assetRef: string
  /** 候选 worktree 内的项目相对路径，如 public/images/new-hero.jpg */
  relativePath: string
  sha256: string
  bytes: number
}

export const sha256File = (absolutePath: string): string => {
  const digest = createHash('sha256')
  digest.update(fs.readFileSync(absolutePath))
  return digest.digest('hex')
}

/** 绝对路径越界检查（与 candidate.ts resolveTargetPath 同一策略）。 */
function assertInsideRoot(root: string, absolutePath: string, label: string): void {
  const relative = path.relative(root, absolutePath)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MediaAssetStagingError(`${label} 越界：${absolutePath}`)
  }
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new MediaAssetStagingError(`${label} 不允许穿过符号链接：${absolutePath}`)
    }
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
    const publicDir = options.publicDir ?? 'public'
    const relative = path.posix.join(publicDir, assetRef)
    if (relative.split('/').includes('..')) throw new MediaAssetStagingError(`assetRef 越出 public 目录：${assetRef}`)
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

/**
 * 暂存一项媒体资产：拷贝字节到候选 worktree 并校验哈希。
 * - expectedHash 必须提供且与实际 SHA-256 完全一致，否则拒绝（fail-closed）。
 * - 目标位置已存在文件时拒绝覆盖（候选 worktree 来自干净检出）。
 */
export function stageMediaAsset(candidateRoot: string, relativePath: string, sourceAbsolutePath: string, expectedHash: string): StagedMediaAsset {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new MediaAssetStagingError(`assetHash 不是合法 SHA-256：${expectedHash}`)
  if (!fs.existsSync(sourceAbsolutePath) || !fs.statSync(sourceAbsolutePath).isFile()) {
    throw new MediaAssetStagingError(`资产字节源不存在或不是文件：${sourceAbsolutePath}`)
  }
  const targetAbsolute = path.resolve(candidateRoot, relativePath)
  assertInsideRoot(candidateRoot, targetAbsolute, '暂存目标')
  if (fs.existsSync(targetAbsolute)) throw new MediaAssetStagingError(`暂存目标已存在，拒绝覆盖：${relativePath}`)
  const actualHash = sha256File(sourceAbsolutePath)
  if (actualHash !== expectedHash) {
    throw new MediaAssetStagingError(`资产字节哈希不匹配：期望 ${expectedHash}，实际 ${actualHash}`)
  }
  fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true })
  fs.copyFileSync(sourceAbsolutePath, targetAbsolute)
  return { assetRef: '', relativePath, sha256: actualHash, bytes: fs.statSync(targetAbsolute).size }
}

/** 复核候选 worktree 内已暂存资产的哈希（验证期/回滚前调用）。 */
export function verifyStagedMediaAsset(candidateRoot: string, relativePath: string, expectedHash: string): StagedMediaAsset {
  const targetAbsolute = path.resolve(candidateRoot, relativePath)
  assertInsideRoot(candidateRoot, targetAbsolute, '复核目标')
  if (!fs.existsSync(targetAbsolute) || !fs.statSync(targetAbsolute).isFile()) {
    throw new MediaAssetStagingError(`已暂存资产缺失：${relativePath}`)
  }
  const actualHash = sha256File(targetAbsolute)
  if (actualHash !== expectedHash) {
    throw new MediaAssetStagingError(`已暂存资产哈希不匹配：${relativePath} 期望 ${expectedHash}，实际 ${actualHash}`)
  }
  return { assetRef: '', relativePath, sha256: actualHash, bytes: fs.statSync(targetAbsolute).size }
}
