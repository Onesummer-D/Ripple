import type { EditOperation, MediaAssetSwapPayload } from './model'
import type { CandidateOperationContext, CandidateOperationExecutor, CandidateOperationPlan } from './candidate-operation-executors'
import { resolveAssetRefToRelativePath } from './media-asset-staging'

/**
 * MEDIA asset-swap 执行器（B 侧，接入 A 的 CandidateOperationExecutor seam）。
 *
 * 职责边界（与 A 的 structured-candidate-executors.md 一致）：
 * - plan 同步返回数据，不做任何写盘；候选核心统一执行写入、Git binary patch、
 *   patchHash / candidateTreeDigest 与完整性校验。
 * - 只覆盖已存在、可由 SourceGraph 定位且 Scope 已证明传播范围的 src / srcSet
 *   属性值替换：sourceEdit 严格落在 target.location 区间内（核心再校验）。
 * - 新增不可变资产字节通过 fileWrites（create-only）+ readStagedAsset(sha256) 进入候选；
 *   不支持替换既有共享二进制。
 * - variants（任何 mechanism）需要新增 JSX 属性或生成 srcSet 值，超出当前授权区间，
 *   显式拒绝；如真实青野用例需要，按 A 在 Issue #6 的要求提交用例后协商最小授权扩展。
 * - focalPoint / containerHint 为 Evidence 阶段的输入，plan 不消费但不拒绝。
 */

export class MediaAssetSwapError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaAssetSwapError' }
}

export type MediaAssetSwapOperation = Extract<EditOperation, { kind: 'MEDIA'; action: 'asset-swap' }>

/** URL 引用安全段：拒绝引号、空格、反斜杠等可注入或跨平台分歧的字符 */
const ASSET_REF_SEGMENT = /^[A-Za-z0-9._~%+-]+$/

function isSafeAssetRef(assetRef: unknown): assetRef is string {
  if (typeof assetRef !== 'string' || !assetRef) return false
  if (!assetRef.startsWith('/') && !assetRef.startsWith('./') && !assetRef.startsWith('../')) return false
  const segments = assetRef.split('/').filter(segment => segment && segment !== '.')
  // '..' 段必须显式拒绝：过滤掉会让 '/../x' 被判为安全。
  // '%2e' 编码点段同样拒绝：经 URL 解码的静态服务器可能将其折叠为 '..'
  const rawSegments = assetRef.split('/')
  if (rawSegments.includes('..') || rawSegments.some(segment => /%2e/i.test(segment))) return false
  return segments.length > 0 && segments.every(segment => ASSET_REF_SEGMENT.test(segment))
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function readPayload(operation: unknown): MediaAssetSwapPayload | undefined {
  if (!operation || typeof operation !== 'object') return undefined
  const payload = (operation as { payload?: unknown }).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return payload as MediaAssetSwapPayload
}

/**
 * 校验操作的完整形状（kind/action/before/after/payload 字段）。
 * variants 在这里不拒绝：让 plan 抛出明确的 unsupported 语义错误，
 * 使失败信息可区分"畸形输入"与"v1 明确不支持的能力"。
 */
function isWellFormedSwapOperation(operation: unknown): operation is MediaAssetSwapOperation {
  if (!operation || typeof operation !== 'object') return false
  const candidate = operation as Record<string, unknown>
  if (candidate.kind !== 'MEDIA' || candidate.action !== 'asset-swap') return false
  if (typeof candidate.before !== 'string' || typeof candidate.after !== 'string') return false
  if (!candidate.before || candidate.before === candidate.after) return false
  const payload = readPayload(operation)
  if (!payload) return false
  if (!isSafeAssetRef(payload.assetRef) || !isHex64(payload.assetHash)) return false
  if (payload.focalPoint !== undefined) {
    const focal = payload.focalPoint
    if (typeof focal !== 'object' || focal === null ||
        typeof (focal as { x?: unknown }).x !== 'number' || typeof (focal as { y?: unknown }).y !== 'number') return false
  }
  if (payload.variants !== undefined) {
    if (!Array.isArray(payload.variants)) return false
    for (const variant of payload.variants) {
      if (!variant || typeof variant !== 'object') return false
      const item = variant as Record<string, unknown>
      if (typeof item.mechanism !== 'string' || typeof item.condition !== 'string') return false
      if (!isSafeAssetRef(item.assetRef) || !isHex64(item.assetHash)) return false
    }
  }
  if (payload.containerHint !== undefined) {
    const hint = payload.containerHint
    if (typeof hint !== 'object' || hint === null ||
        typeof (hint as { selector?: unknown }).selector !== 'string' || typeof (hint as { aspect?: unknown }).aspect !== 'number') return false
  }
  return true
}

export function createMediaAssetSwapExecutor(): CandidateOperationExecutor<MediaAssetSwapOperation> {
  return {
    kind: 'MEDIA',
    action: 'asset-swap',
    validate(operation: unknown): operation is MediaAssetSwapOperation {
      return isWellFormedSwapOperation(operation)
    },
    plan(input: CandidateOperationContext<MediaAssetSwapOperation>): CandidateOperationPlan {
      const { operation, target, readStagedAsset } = input
      if (target.kind !== 'media' || !target.location?.path || target.location.start === undefined || target.location.end === undefined) {
        throw new MediaAssetSwapError(`asset-swap 目标缺少媒体 AST 源位置：${operation.targetRef}`)
      }
      const payload = operation.payload
      if (payload.variants !== undefined && payload.variants.length > 0) {
        throw new MediaAssetSwapError(
          `MEDIA asset-swap v1 不支持 variants（需要新增 JSX 属性或生成 srcSet 值，超出当前授权源码区间）：` +
          `${operation.id}。请先使用不带 variants 的 src/srcSet 值替换；如真实项目必须新增属性，请提交固定源码片段、targetRef、预期属性位置与负例，与 A 协商最小授权扩展。`,
        )
      }
      if (operation.after !== payload.assetRef) {
        throw new MediaAssetSwapError(`operation.after 必须与 payload.assetRef 一致（保持候选记录真实）：${operation.id}`)
      }
      // 核心会再次核对源码区间内的原始字节等于 edit.before；这里只规划，不读文件、不写文件
      const relativePath = resolveAssetRefToRelativePath(payload.assetRef, target.location.path)
      return {
        sourceEdits: [{
          path: target.location.path,
          start: target.location.start,
          end: target.location.end,
          before: operation.before,
          after: payload.assetRef,
        }],
        fileWrites: [{ path: relativePath, bytes: readStagedAsset(payload.assetHash) }],
      }
    },
  }
}

export const mediaAssetSwapExecutor = createMediaAssetSwapExecutor()

/** 供应用侧组装注册表使用。 */
export function mediaAssetSwapExecutors(): readonly CandidateOperationExecutor[] {
  return [mediaAssetSwapExecutor]
}
