import { createHash } from 'node:crypto'
import type { RouteIdentityStatus } from './model'
import { projectPreviewViewports } from './project-viewports'

/**
 * 四视口媒体 Evidence（B 侧模块）。
 *
 * 职责：消费 asset-swap payload 中的 focalPoint / containerHint，把真实浏览器采集到
 * 的图片加载与布局观测转换为可复核的 Evidence 数据：
 * - 图片真实加载（naturalWidth/Height、complete、currentSrc 命中新 assetRef）；
 * - 裁切几何：object-fit cover/contain 下可见源图窗口、焦点可见性；
 * - 报告绑定 candidateId / patchHash / candidateTreeDigest / baseSourceDigest，
 *   保证 Evidence 与候选版本一一对应。
 *
 * 采集侧（Playwright 页面遍历）保持薄：collectMediaViewportObservations(page, target)
 * 可在任意 Chromium 上下文执行；由验收脚本决定运行在本地还是 A 的 Docker 执行器内。
 * 不支持的 object-fit 值如实记录为 unknown，不猜测几何。
 */

export const MEDIA_VIEWPORT_EVIDENCE_SCHEMA = 'ripple-media-viewport-evidence/v1'

/**
 * 判断浏览器 currentSrc 是否确为给定 assetRef。
 * 规范化比较：相对 assetRef 只比 pathname+search（排除 origin 差异），
 * 绝对 assetRef 额外要求 origin 一致；禁止子串匹配，避免
 * /media/x.jpeg.bak 被误判为 /media/x.jpeg。
 */
export function assetUrlMatches(currentSrc: string, assetRef: string): boolean {
  const toUrl = (value: string, allowRelative: boolean): URL | undefined => {
    try { return new URL(value) } catch { /* fall through */ }
    if (!allowRelative) return undefined
    try { return new URL(value, 'http://ripple.asset.local') } catch { return undefined }
  }
  const src = toUrl(currentSrc, false)
  const ref = toUrl(assetRef, true)
  if (!src || !ref) return false
  if (src.pathname !== ref.pathname || src.search !== ref.search) return false
  // assetRef 为绝对 URL 时 origin 必须一致；相对 assetRef 已用占位 origin 解析，跳过
  return /^https?:\/\//i.test(assetRef) ? src.origin === ref.origin : true
}

export class MediaViewportEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaViewportEvidenceError' }
}

export interface MediaFocalPoint { x: number; y: number }

export interface MediaViewportBox { x: number; y: number; width: number; height: number }

/** 单个视口下目标图片的浏览器观测（由采集脚本填充，字段保持可序列化）。 */
export interface MediaViewportObservation {
  viewport: { name: string; width: number; height: number }
  pageUrl: string
  selector: string
  assetRef: string
  /** 实际加载的资源 URL（currentSrc），用于证明替换生效 */
  currentSrc: string
  /** 候选端 DOM 中 src 命中 assetRef 的 img 数量（来源映射唯一性证据；>1 即歧义） */
  matchCount: number
  /** 目标图片是否真实加载完成 */
  loaded: boolean
  naturalWidth: number
  naturalHeight: number
  renderedBox: MediaViewportBox
  objectFit: string
  objectPosition: string
  /** 浏览器报错/资源加载失败信息（无则空数组） */
  errors: string[]
}

export type MediaFitScaleMode = 'cover' | 'contain' | 'unsupported-fit' | 'not-loaded'

/** 裁切几何推导结果。 */
export interface MediaCropGeometry {
  scaleMode: MediaFitScaleMode
  /** 渲染倍率（源图单位 → CSS 像素） */
  scale: number
  /** 可见源图窗口（源图像素坐标系；cover 负溢出时可能超出 [0,natural]，为 CSS 定位的真实推导值，调用方按需判界） */
  visibleSourceRect: { x: number; y: number; width: number; height: number }
  /** 焦点（payload focalPoint，0..1 源图比例坐标）是否落在可见窗口内 */
  focalVisible: boolean | 'not-applied'
  /** 渲染盒纵横比与源图纵横比 */
  boxAspect: number
  sourceAspect: number
}

export interface MediaViewportEvidenceReport {
  schemaVersion: typeof MEDIA_VIEWPORT_EVIDENCE_SCHEMA
  capturedAt: string
  browser: { name: string; version?: string }
  candidate: {
    candidateId: string
    baseSourceDigest: string
    patchHash: string
    candidateTreeDigest: string
  }
  targetRef: string
  focalPoint?: MediaFocalPoint
  containerHint?: { selector: string; aspect: number }
  observations: Array<MediaViewportObservation & { geometry: MediaCropGeometry; assertions: MediaViewportAssertion[] }>
}

export interface MediaViewportAssertion { id: string; result: 'pass' | 'failed' | 'unknown'; detail: string }

/**
 * 由观测推导裁切几何。
 * - cover：scale = max(boxW/natW, boxH/natH)，可见窗口由 object-position（默认 50% 50%）定位；
 * - contain：scale = min(...)，整图可见；
 * - 其他 object-fit：unsupported-fit，不做几何猜测。
 */
export function computeCropGeometry(observation: MediaViewportObservation, focalPoint?: MediaFocalPoint): MediaCropGeometry {
  const { naturalWidth, naturalHeight, renderedBox, objectFit, objectPosition } = observation
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(renderedBox.width > 0) || !(renderedBox.height > 0)) {
    throw new MediaViewportEvidenceError(`无法从无效观测推导几何：natural ${naturalWidth}x${naturalHeight}, box ${renderedBox.width}x${renderedBox.height}`)
  }
  const sourceAspect = naturalWidth / naturalHeight
  const boxAspect = renderedBox.width / renderedBox.height
  if (objectFit !== 'cover' && objectFit !== 'contain') {
    return {
      scaleMode: 'unsupported-fit', scale: NaN,
      visibleSourceRect: { x: NaN, y: NaN, width: NaN, height: NaN },
      focalVisible: focalPoint ? 'not-applied' : 'not-applied',
      boxAspect, sourceAspect,
    }
  }
  const scale = objectFit === 'cover'
    ? Math.max(renderedBox.width / naturalWidth, renderedBox.height / naturalHeight)
    : Math.min(renderedBox.width / naturalWidth, renderedBox.height / naturalHeight)
  const scaledWidth = naturalWidth * scale
  const scaledHeight = naturalHeight * scale

  if (objectFit === 'contain') {
    // contain 整图可见（letterbox 区域不属于源图），窗口即完整源图，与 object-position 无关
    return {
      scaleMode: 'contain', scale,
      visibleSourceRect: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
      focalVisible: focalPoint ? true : 'not-applied',
      boxAspect, sourceAspect,
    }
  }

  const parsePosition = (value: string, scaled: number, overflow: number): number => {
    const trimmed = value.trim()
    if (trimmed.endsWith('%')) {
      const percent = Number(trimmed.slice(0, -1)) / 100
      if (Number.isFinite(percent)) return (overflow - scaled) * percent
    }
    // CSS object-position 的长度值语义与 background-position 一致：从左上角的绝对
    // 偏移，允许负值与溢出，不做钳制（CSS Images L3 §5.3）。之前 Math.min(px, overflow-scaled)
    // 的钳制会把正像素偏移错误地吸附到对侧，已与真实 Chromium 渲染核对修正。
    const px = Number.parseFloat(trimmed)
    if (Number.isFinite(px)) return px
    return (overflow - scaled) / 2
  }
  const [rawX = '50%', rawY = '50%'] = objectPosition.split(' ')
  const offsetX = parsePosition(rawX, scaledWidth, renderedBox.width)
  const offsetY = parsePosition(rawY, scaledHeight, renderedBox.height)

  const cleanZero = (value: number) => (Object.is(value, -0) ? 0 : value)
  const visibleSourceRect = {
    x: cleanZero(-offsetX / scale),
    y: cleanZero(-offsetY / scale),
    width: renderedBox.width / scale,
    height: renderedBox.height / scale,
  }
  let focalVisible: MediaCropGeometry['focalVisible'] = 'not-applied'
  if (focalPoint) {
    const fx = focalPoint.x * naturalWidth
    const fy = focalPoint.y * naturalHeight
    focalVisible = fx >= visibleSourceRect.x && fx <= visibleSourceRect.x + visibleSourceRect.width &&
      fy >= visibleSourceRect.y && fy <= visibleSourceRect.y + visibleSourceRect.height
  }
  return { scaleMode: 'cover', scale, visibleSourceRect, focalVisible, boxAspect, sourceAspect }
}

/** 观测级断言：加载、源引用替换、裁切几何一致性。 */
export function assertMediaViewportObservation(
  observation: MediaViewportObservation,
  geometry: MediaCropGeometry,
  focalPoint?: MediaFocalPoint,
): MediaViewportAssertion[] {
  const assertions: MediaViewportAssertion[] = []
  assertions.push(observation.loaded
    ? { id: 'media-loaded', result: 'pass', detail: `natural ${observation.naturalWidth}x${observation.naturalHeight}` }
    : { id: 'media-loaded', result: 'failed', detail: `图片未加载：${observation.errors.join('；') || 'complete=false 或 naturalWidth=0'}` })
  const swapped = assetUrlMatches(observation.currentSrc, observation.assetRef)
  assertions.push(swapped
    ? { id: 'media-source-swapped', result: 'pass', detail: `currentSrc ${observation.currentSrc} 规范化匹配 ${observation.assetRef}` }
    : { id: 'media-source-swapped', result: 'failed', detail: `currentSrc ${observation.currentSrc} 与 ${observation.assetRef} 规范化后不一致` })
  if (geometry.scaleMode === 'not-loaded') {
    assertions.push({ id: 'media-crop-geometry', result: 'failed', detail: '图片未加载或观测无效，无法推导几何' })
  } else if (geometry.scaleMode === 'unsupported-fit') {
    assertions.push({ id: 'media-crop-geometry', result: 'unknown', detail: `object-fit=${observation.objectFit} 暂不支持几何推导` })
  } else {
    const finite = Number.isFinite(geometry.visibleSourceRect.x) && geometry.visibleSourceRect.width > 0 && geometry.visibleSourceRect.height > 0
    assertions.push(finite
      ? { id: 'media-crop-geometry', result: 'pass', detail: `${geometry.scaleMode} scale=${geometry.scale.toFixed(4)} visible=${geometry.visibleSourceRect.width.toFixed(1)}x${geometry.visibleSourceRect.height.toFixed(1)}` }
      : { id: 'media-crop-geometry', result: 'failed', detail: '几何推导产生无效值' })
  }
  if (focalPoint) {
    if (geometry.focalVisible === true) assertions.push({ id: 'media-focal-visible', result: 'pass', detail: `焦点 (${focalPoint.x},${focalPoint.y}) 位于可见窗口内` })
    else if (geometry.focalVisible === false) assertions.push({ id: 'media-focal-visible', result: 'failed', detail: `焦点 (${focalPoint.x},${focalPoint.y}) 被裁切在可见窗口外` })
    else assertions.push({ id: 'media-focal-visible', result: 'unknown', detail: 'object-fit 不支持，无法判定焦点可见性' })
  }
  if (observation.errors.length) assertions.push({ id: 'media-browser-errors', result: 'failed', detail: observation.errors.join('；') })
  else assertions.push({ id: 'media-browser-errors', result: 'pass', detail: '无浏览器错误' })
  return assertions
}

/** 汇总报告状态。 */
export function mediaEvidenceSummary(report: MediaViewportEvidenceReport): 'pass' | 'risks' | 'failed' {
  let worst: 'pass' | 'risks' | 'failed' = 'pass'
  for (const observation of report.observations) {
    for (const assertion of observation.assertions) {
      if (assertion.result === 'failed') worst = 'failed'
      else if (assertion.result === 'unknown' && worst === 'pass') worst = 'risks'
    }
  }
  return worst
}

/**
 * 组装报告：绑定候选版本身份。四视口缺一即报错（缺视口的 Evidence 不得静默降级）。
 */
export function buildMediaViewportEvidenceReport(input: {
  capturedAt?: string
  browser: { name: string; version?: string }
  candidate: MediaViewportEvidenceReport['candidate']
  targetRef: string
  focalPoint?: MediaFocalPoint
  containerHint?: { selector: string; aspect: number }
  observations: MediaViewportObservation[]
}): MediaViewportEvidenceReport {
  const expected = projectPreviewViewports.map(viewport => `${viewport.width}x${viewport.height}`)
  const seen = new Set(input.observations.map(observation => `${observation.viewport.width}x${observation.viewport.height}`))
  const missing = expected.filter(size => !seen.has(size))
  if (missing.length) throw new MediaViewportEvidenceError(`缺少视口观测，拒绝生成 Evidence：${missing.join(', ')}`)
  const observations = input.observations.map(observation => {
    // 未加载的观测也要进入报告（media-loaded 会判 failed），几何如实记为 not-loaded
    let geometry: MediaCropGeometry
    try {
      geometry = computeCropGeometry(observation, input.focalPoint)
    } catch {
      geometry = {
        scaleMode: 'not-loaded', scale: NaN,
        visibleSourceRect: { x: NaN, y: NaN, width: NaN, height: NaN },
        focalVisible: 'not-applied', boxAspect: NaN, sourceAspect: NaN,
      }
    }
    return { ...observation, geometry, assertions: assertMediaViewportObservation(observation, geometry, input.focalPoint) }
  })
  return {
    schemaVersion: MEDIA_VIEWPORT_EVIDENCE_SCHEMA,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    browser: input.browser,
    candidate: input.candidate,
    targetRef: input.targetRef,
    focalPoint: input.focalPoint,
    containerHint: input.containerHint,
    observations,
  }
}

export const mediaViewportEvidenceSha256 = (report: MediaViewportEvidenceReport): string =>
  createHash('sha256').update(JSON.stringify(report)).digest('hex')

/**
 * 双端（原工程基线 / 候选）单视口真实浏览器采集结果。
 * 由 scripts/media-viewport-evidence.ts 在真实 Playwright 会话中填充，
 * 验收脚本据其构建 VerificationRun —— 每个字段都来自真实浏览器状态，
 * 禁止用静态预期值回填（对照必须来自真实双端渲染）。
 */
export interface MediaDualEndpointViewport {
  viewport: { name: string; width: number; height: number }
  /** 候选端：导航后作品页 marker（如青野「器物全集」）真实可见性与匹配数 */
  candidate: { worksPageReached: boolean; markerVisible: boolean; markerMatchCount: number }
  /** 基线端：同一导航在原工程构建中的真实结果与目标图当前 src */
  baseline: {
    pageUrl: string
    worksPageReached: boolean
    markerVisible: boolean
    markerMatchCount: number
    imageFound: boolean
    /** 基线端 DOM 中 src 命中 originalValue 的 img 数量（>1 时来源映射歧义） */
    imageMatchCount: number
    currentSrc: string
    /** 基线端目标图元素截图（outputDir/<viewport>-baseline.png）的内容哈希，可追溯 */
    screenshotSha256?: string
    errors: string[]
  }
  /** 双端 DOM 对照：目标图 src 被遮蔽后的 #root 快照，digest 真实计算 */
  maskedComparison: {
    matched: boolean
    baselineDigest: string
    candidateDigest: string
    baselineSnapshot: string
    candidateSnapshot: string
    maskedOperationIds: string[]
    reason?: string
  }
  /** 真实交互：双端各自点击声明控件并验证期望文本 */
  interaction: {
    baselinePassed: boolean
    candidatePassed: boolean
    baselineRouteIdentity: RouteIdentityStatus
    candidateRouteIdentity: RouteIdentityStatus
  }
  layout: { horizontalOverflow: boolean }
  runtimeState: string
  /** 致命错误（pageerror / 非资源类控制台错误），进入 browser-errors 断言计算 */
  errors: string[]
  /** 环境性警告（第三方资源加载失败等），保留供追溯但不阻断媒体断言 */
  warnings: string[]
}

export interface MediaDualEndpointCollection {
  capturedAt: string
  viewports: MediaDualEndpointViewport[]
}

export const mediaDualEndpointSha256 = (collection: MediaDualEndpointCollection): string =>
  createHash('sha256').update(JSON.stringify(collection)).digest('hex')

/**
 * source-mapping 断言的独立判定（与 target-change 解耦）：
 * 除候选图真实加载外，还要求双端 DOM 中目标资源的消费实例**唯一**——
 * 候选端恰好 1 个 img 命中 assetRef、基线端恰好 1 个 img 命中原值。
 * - 任一视口候选 matchCount > 1 或基线 imageMatchCount > 1：来源歧义 → risk（阻止 PASS）；
 * - 未完整渲染或替换未生效：覆盖不完整 → unknown（fail-closed，不猜测）。
 */
export function resolveSourceMappingAssertion(
  observations: MediaViewportEvidenceReport['observations'],
  dual: MediaDualEndpointCollection,
): { result: 'pass' | 'risk' | 'unknown'; detail: string } {
  const swapped = observations.map(observation => assetUrlMatches(observation.currentSrc, observation.assetRef))
  const rendered = dual.viewports.every(item => item.runtimeState === 'rendered' && item.candidate.worksPageReached)
  const loaded = observations.every(observation => observation.loaded)
  const candidateAmbiguous = observations.filter(observation => observation.matchCount > 1)
  const baselineAmbiguous = dual.viewports.filter(item => item.baseline.imageMatchCount > 1)
  if (candidateAmbiguous.length || baselineAmbiguous.length) {
    const detail = [
      candidateAmbiguous.length ? `候选端 ${candidateAmbiguous.length} 个视口存在多个消费实例（matchCount>1）` : '',
      baselineAmbiguous.length ? `基线端 ${baselineAmbiguous.length} 个视口存在多个消费实例（imageMatchCount>1）` : '',
    ].filter(Boolean).join('；')
    return { result: 'risk', detail: `目标资源来源映射不唯一，${detail}，禁止按唯一映射通过。` }
  }
  if (!(rendered && loaded && swapped.every(Boolean))) {
    return { result: 'unknown', detail: '并非所有视口完成渲染或替换图未加载，来源映射覆盖不完整，保持未知。' }
  }
  return {
    result: 'pass',
    detail: `SourceGraph 定位节点在每个视口唯一映射到真实渲染的替换图：候选端 ${observations.length} 个视口各恰好 1 个 img 命中新资源、基线端各恰好 1 个 img 保持原值（来源定位 + 候选源码 + 浏览器渲染三者一致且无歧义）。`,
  }
}
