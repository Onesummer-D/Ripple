import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { EditOperation, MediaAssetSwapPayload, SourceGraph, SourceNode } from './model'
import { MediaAssetStagingError, resolveAssetRefToRelativePath, stageMediaAsset, type StagedMediaAsset } from './media-asset-staging'

/**
 * MEDIA asset-swap 执行器（B 侧模块）。
 *
 * 输入：候选 worktree 根、结构化 MEDIA 操作（action: 'asset-swap'）、资产字节源。
 * 输出：修改的项目相对路径列表（源码文件 + 暂存资产），供候选完整性校验纳入
 * patchHash / candidateTreeDigest。
 *
 * 支持边界（如实记录，不为覆盖任意写法无限扩充）：
 * - JSX/TSX 中 src 属性的字符串字面量替换（含引号保留）。
 * - variants 中 mechanism 'srcset'：在同一 JSX 开始标签上设置/替换 srcSet 属性。
 * - mechanism 'picture' / 'css' / 'container-rule'：暂不支持，显式拒绝。
 * - 非 JSX 消费（CSS url() 等）：暂不支持，显式拒绝。
 */

export class MediaAssetSwapError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaAssetSwapError' }
}

export interface MediaAssetSwapContext {
  candidateRoot: string
  graph: SourceGraph
  nodes: Map<string, SourceNode>
  /** assetRef → 新资产字节的绝对源路径（上传暂存区） */
  assetBytes: Record<string, string>
  publicDir?: string
}

export interface MediaSwapFileResult {
  /** 源码编辑（按文件归并后一次性应用） */
  edits: Array<{ start: number; end: number; replacement: string; operationId: string }>
  /** 暂存成功的资产（含 SHA-256） */
  staged: StagedMediaAsset[]
}

const isAssetSwap = (operation: EditOperation): operation is EditOperation & { kind: 'MEDIA'; action: 'asset-swap'; payload: MediaAssetSwapPayload } =>
  operation.kind === 'MEDIA' && (operation as { action?: string }).action === 'asset-swap'

function assertSwapOperation(operation: EditOperation): asserts operation is EditOperation & { kind: 'MEDIA'; action: 'asset-swap'; payload: MediaAssetSwapPayload } {
  if (!isAssetSwap(operation)) throw new MediaAssetSwapError(`不是 MEDIA asset-swap 操作：${operation.id}`)
  const payload = operation.payload
  if (!payload || typeof payload !== 'object') throw new MediaAssetSwapError(`缺少 asset-swap payload：${operation.id}`)
  if (!payload.assetRef || !/^[0-9a-f]{64}$/.test(payload.assetHash)) throw new MediaAssetSwapError(`asset-swap payload 缺少合法 assetRef/assetHash：${operation.id}`)
  for (const variant of payload.variants ?? []) {
    if (!variant.assetRef || !/^[0-9a-f]{64}$/.test(variant.assetHash)) throw new MediaAssetSwapError(`variant 缺少合法 assetRef/assetHash：${operation.id}`)
  }
}

/** 在目标源码切片中替换带引号字符串的内容，返回新切片；找不到唯一字符串字面量则拒绝。 */
function swapQuotedUrl(sourceSlice: string, operationId: string, newUrl: string): string {
  const match = /^(?<prefix>[^"']*["'])(?<url>[^"']*)(?<suffix>["'].*)$/s.exec(sourceSlice)
  if (!match?.groups) throw new MediaAssetSwapError(`目标切片不是可替换的带引号字符串：${operationId}`)
  return `${match.groups.prefix}${newUrl}${match.groups.suffix}`
}

interface JsxAttributeSpan { name: string; start: number; end: number }

/** 在文件 AST 中找到包含 [start,end) 字符串字面量的 JSX 属性及其所在开始标签的属性区间。 */
function findJsxAttribute(source: ts.SourceFile, file: string, start: number, end: number): { attributes: JsxAttributeSpan[]; selfClosing: boolean; elementStart: number; elementEnd: number } | undefined {
  let found: { element: ts.JsxOpeningLikeElement; attribute: ts.JsxAttribute } | undefined
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const lit = node.initializer
      if (lit.getStart(source) <= start && lit.getEnd() >= end) {
        const parent = node.parent.parent
        if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) found = { element: parent, attribute: node }
      }
    }
    node.forEachChild(visit)
  }
  visit(source)
  if (!found) return undefined
  const attributes: JsxAttributeSpan[] = found.element.attributes.properties
    .filter((item): item is ts.JsxAttribute => ts.isJsxAttribute(item))
    .map(attribute => ({ name: attribute.name.getText(source), start: attribute.getStart(source), end: attribute.getEnd(source) }))
  return { attributes, selfClosing: ts.isJsxSelfClosingElement(found.element), elementStart: found.element.getStart(source), elementEnd: found.element.getEnd(source) }
}

/** 计算单个 asset-swap 操作的源码编辑与暂存清单（不落盘，便于测试与预检）。 */
export function planMediaAssetSwap(operation: EditOperation, node: SourceNode, context: MediaAssetSwapContext): MediaSwapFileResult {
  assertSwapOperation(operation)
  if (node.kind !== 'media' || !node.location?.path || node.location.start === undefined || node.location.end === undefined) {
    throw new MediaAssetSwapError(`asset-swap 目标缺少媒体 AST 源位置：${operation.targetRef}`)
  }
  const file = node.location.path
  if (path.isAbsolute(file) || file.split('/').includes('..')) throw new MediaAssetSwapError(`目标文件路径越界：${file}`)
  const absolute = path.resolve(context.candidateRoot, file)
  if (path.relative(context.candidateRoot, absolute).startsWith('..')) throw new MediaAssetSwapError(`目标文件路径越界：${file}`)
  const sourceText = fs.readFileSync(absolute, 'utf8')
  const slice = sourceText.slice(node.location.start, node.location.end)
  if (slice !== operation.before) throw new MediaAssetSwapError(`源内容已变化，拒绝应用操作：${operation.id}`)

  const payload = operation.payload
  for (const variant of payload.variants ?? []) {
    if (variant.mechanism !== 'srcset') throw new MediaAssetSwapError(`暂不支持的 variant mechanism：${variant.mechanism}（操作 ${operation.id}）`)
  }

  const replacement = swapQuotedUrl(slice, operation.id, payload.assetRef)
  if (replacement === operation.before) throw new MediaAssetSwapError(`操作没有修改内容：${operation.id}`)
  if (operation.after && operation.after !== replacement) {
    throw new MediaAssetSwapError(`operation.after 与执行器计算结果不一致：${operation.id}`)
  }
  const edits: MediaSwapFileResult['edits'] = [{ start: node.location.start, end: node.location.end, replacement, operationId: operation.id }]
  const staged: StagedMediaAsset[] = []

  const stageOne = (assetRef: string, assetHash: string): StagedMediaAsset => {
    const sourceBytes = context.assetBytes[assetRef]
    if (!sourceBytes) throw new MediaAssetSwapError(`缺少资产字节源：${assetRef}（操作 ${operation.id}）`)
    const relativePath = resolveAssetRefToRelativePath(assetRef, file, { publicDir: context.publicDir })
    const result = stageMediaAsset(context.candidateRoot, relativePath, sourceBytes, assetHash)
    return { ...result, assetRef }
  }
  staged.push(stageOne(payload.assetRef, payload.assetHash))

  const srcsetVariants = payload.variants ?? []
  if (srcsetVariants.length) {
    const kind = /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : /\.ts$/i.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind)
    const located = findJsxAttribute(source, file, node.location.start, node.location.end)
    if (!located) throw new MediaAssetSwapError(`找不到 src 属性所在的 JSX 元素，无法设置 srcSet：${operation.id}`)
    for (const variant of srcsetVariants) staged.push(stageOne(variant.assetRef, variant.assetHash))
    const srcsetValue = srcsetVariants.map(variant => `${variant.assetRef} ${variant.condition}`).join(', ')
    const existing = located.attributes.find(attribute => attribute.name === 'srcSet')
    if (existing) {
      edits.push({ start: existing.start, end: existing.end, replacement: `srcSet=${JSON.stringify(srcsetValue)}`, operationId: `${operation.id}:srcset` })
    } else {
      // 在开始标签 name 之后插入，保持自闭合标签合法
      const tagEnd = sourceText.lastIndexOf(located.selfClosing ? '/>' : '>', located.elementEnd)
      if (tagEnd < 0 || tagEnd < node.location.end) throw new MediaAssetSwapError(`无法定位 JSX 开始标签结尾：${operation.id}`)
      edits.push({ start: tagEnd, end: tagEnd, replacement: ` srcSet=${JSON.stringify(srcsetValue)}`, operationId: `${operation.id}:srcset` })
    }
  }
  return { edits, staged }
}

/** 将同一文件上的编辑倒序应用（与候选核心同一策略），并做语法检查。 */
export function applyEditsToFile(absolutePath: string, file: string, edits: Array<{ start: number; end: number; replacement: string }>): void {
  const sourceText = fs.readFileSync(absolutePath, 'utf8')
  const ordered = [...edits].sort((a, b) => b.start - a.start)
  let priorStart = sourceText.length + 1
  let next = sourceText
  for (const edit of ordered) {
    if (edit.end > priorStart || edit.start < 0 || edit.end < edit.start || edit.end > sourceText.length) {
      throw new MediaAssetSwapError(`同一文件的操作区间重叠或无效：${file}`)
    }
    next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end)
    priorStart = edit.start
  }
  if (/\.(tsx?|jsx?)$/i.test(file)) {
    const kind = /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : /\.ts$/i.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX
    const parsed = ts.createSourceFile(file, next, ts.ScriptTarget.Latest, true, kind)
    if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) {
      throw new MediaAssetSwapError(`源码编辑产生语法错误：${file}`)
    }
  }
  fs.writeFileSync(absolutePath, next, 'utf8')
}

/**
 * 在候选 worktree 上执行全部 MEDIA asset-swap 操作。
 * 返回修改/新增的项目相对路径（源码文件 + 暂存资产），供候选核心纳入 patch 与树摘要。
 */
export function applyMediaAssetSwapOperations(context: MediaAssetSwapContext, operations: EditOperation[]): string[] {
  const byFile = new Map<string, MediaSwapFileResult>()
  for (const operation of operations) {
    assertSwapOperation(operation)
    const node = context.nodes.get(operation.targetRef)
    if (!node) throw new MediaAssetSwapError(`目标不在当前源码图中：${operation.targetRef}`)
    const result = planMediaAssetSwap(operation, node, context)
    const file = node.location!.path
    const merged = byFile.get(file) ?? { edits: [], staged: [] }
    merged.edits.push(...result.edits)
    merged.staged.push(...result.staged)
    byFile.set(file, merged)
  }
  const modified = new Set<string>()
  for (const [file, result] of byFile) {
    applyEditsToFile(path.resolve(context.candidateRoot, file), file, result.edits)
    modified.add(file)
    for (const staged of result.staged) modified.add(staged.relativePath)
  }
  return [...modified].sort()
}
