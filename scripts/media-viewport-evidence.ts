/**
 * 四视口媒体 Evidence 双端采集运行器（B 侧）。
 *
 * 用法：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/media-viewport-evidence.ts <input.json> <outputDir>
 *
 * input.json:
 * {
 *   "previewUrl": "http://127.0.0.1:4619/",        // 候选构建
 *   "baselineUrl": "http://127.0.0.1:4620/",       // 原工程构建（真实基线）
 *   "candidate": { "candidateId", "baseSourceDigest", "patchHash", "candidateTreeDigest" },
 *   "targetRef": "media:...",
 *   "operationId": "qingye-media-swap",
 *   "assetRef": "/media/hero-new.webp",            // 候选替换后 src
 *   "originalValue": "https://.../old.jpeg",       // 原工程 src（基线端定位目标图）
 *   "markerText": "器物全集",                       // 作品页唯一真实 marker
 *   "selector": "main img[alt=\"hero\"]",          // 候选端选择器（缺省按 assetRef 推导）
 *   "focalPoint": { "x": 0.5, "y": 0.5 },          // 可选
 *   "containerHint": { "selector", "aspect" },     // 可选
 *   "navigateBy": { "role": "button", "name": "商品专题" },
 *   "interaction": { "role": "button", "name": "商品专题", "expectedText": "器物全集" },
 *   "browser": { "headless": true }
 * }
 *
 * 输出：
 *   outputDir/evidence.json   —— 候选端媒体 Evidence 报告 + sha256
 *   outputDir/dual.json       —— 双端真实采集（基线/候选各自导航、marker、DOM 快照、交互）+ sha256
 *   outputDir/<viewport>.png  —— 候选端目标图截图
 *
 * 所有对照数据（marker 可见性、DOM 快照 digest、交互结果、currentSrc）均来自
 * 真实浏览器双端状态；禁止在采集层回填静态预期值。
 * 退出码：summary pass=0，risks=2，failed=3，运行错误=1。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import {
  buildMediaViewportEvidenceReport,
  mediaDualEndpointSha256,
  mediaEvidenceSummary,
  mediaViewportEvidenceSha256,
  MediaViewportEvidenceError,
  type MediaDualEndpointCollection,
  type MediaDualEndpointViewport,
  type MediaViewportObservation,
} from '../src/core/media-viewport-evidence'
import type { RouteIdentityStatus } from '../src/core/model'
import { projectPreviewViewports } from '../src/core/project-viewports'

interface RunnerInput {
  previewUrl: string
  baselineUrl: string
  candidate: { candidateId: string; baseSourceDigest: string; patchHash: string; candidateTreeDigest: string }
  targetRef: string
  operationId: string
  assetRef: string
  originalValue: string
  markerText: string
  selector?: string
  focalPoint?: { x: number; y: number }
  containerHint?: { selector: string; aspect: number }
  navigateBy?: { role: 'button' | 'link'; name: string }
  interaction?: { role: 'button' | 'link'; name: string; expectedText: string }
  /** 交互负向验证：点击后该文本必须消失（如筛选后其他品类商品名），强化交互真实性 */
  interactionAbsentText?: string
  browser?: { headless?: boolean }
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

function readInput(argv: string[]): RunnerInput {
  if (argv.length < 4) throw new MediaViewportEvidenceError('用法: media-viewport-evidence.ts <input.json> <outputDir>')
  const input = JSON.parse(fs.readFileSync(argv[2], 'utf8')) as RunnerInput
  for (const key of ['previewUrl', 'baselineUrl', 'candidate', 'assetRef', 'targetRef', 'operationId', 'originalValue', 'markerText'] as const) {
    if (!input[key]) throw new MediaViewportEvidenceError(`input 缺少 ${key}`)
  }
  if (!input.candidate.patchHash) throw new MediaViewportEvidenceError('input 缺少 candidate.patchHash')
  if (input.focalPoint && (!Number.isFinite(input.focalPoint.x) || !Number.isFinite(input.focalPoint.y))) {
    throw new MediaViewportEvidenceError('focalPoint 必须是有限数值')
  }
  return input
}

/** 真实点击导航进入作品页（移动端先尝试打开折叠菜单），返回 marker 真实探测结果。 */
async function gotoWorksPage(page: import('playwright').Page, input: RunnerInput, url: string): Promise<{ worksPageReached: boolean; markerVisible: boolean; markerMatchCount: number }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (input.navigateBy) {
    const clickNav = () => page.getByRole(input.navigateBy!.role, { name: input.navigateBy!.name, exact: false }).first().click({ timeout: 5_000 })
    try {
      await clickNav()
    } catch {
      const opened = await page.locator('button[aria-label]').evaluateAll((buttons) => {
        const trigger = (buttons as HTMLButtonElement[]).find(button => /菜单|menu/i.test(button.getAttribute('aria-label') ?? '') && button.offsetParent !== null)
        if (!trigger) return false
        trigger.click()
        return true
      })
      if (!opened) return { worksPageReached: false, markerVisible: false, markerMatchCount: 0 }
      await clickNav()
    }
    await page.waitForLoadState('networkidle').catch(() => undefined)
  }
  const marker = page.getByText(input.markerText, { exact: true })
  const markerMatchCount = await marker.count()
  const markerVisible = markerMatchCount > 0 && await marker.first().isVisible().catch(() => false)
  return { worksPageReached: markerMatchCount > 0, markerVisible, markerMatchCount }
}

/** 克隆 #root 并遮蔽目标图 src（双端各自的被编辑值），返回遮蔽后快照。 */
async function maskedRootSnapshot(page: import('playwright').Page, targetSrcValue: string, operationId: string): Promise<{ ok: boolean; snapshot?: string; reason?: string }> {
  return page.evaluate(({ targetSrcValue, operationId }) => {
    const root = document.querySelector('#root')
    if (!root) return { ok: false, reason: 'The rendered application root is missing.' }
    const clone = root.cloneNode(true) as Element
    const images = Array.from(clone.querySelectorAll('img'))
    const targets = images.filter(image => image.getAttribute('src') === targetSrcValue)
    if (targets.length === 0) return { ok: false, reason: `目标图 src=${targetSrcValue.slice(0, 64)} 未在 DOM 中渲染` }
    for (const target of targets) {
      target.setAttribute('src', `__RIPPLE_TARGET_${operationId}__`)
      target.removeAttribute('srcset')
    }
    for (const element of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('data-ripple-')) element.removeAttribute(attribute.name)
      }
    }
    return { ok: true, snapshot: clone.outerHTML }
  }, { targetSrcValue, operationId })
}

/** 双端各自 fresh 访问 → 真实点击声明交互（页内筛选控件）→
 *  期望文本出现 + 负向文本消失（证明筛选真实生效）。 */
async function probeInteraction(browser: import('playwright').Browser, input: RunnerInput, viewport: { width: number; height: number }): Promise<MediaDualEndpointViewport['interaction']> {
  const run = async (url: string): Promise<{ passed: boolean; routeIdentity: RouteIdentityStatus }> => {
    const page = await browser.newPage({ viewport })
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (input.navigateBy) {
        const clickNav = () => page.getByRole(input.navigateBy!.role, { name: input.navigateBy!.name, exact: false }).first().click({ timeout: 5_000 })
        try {
          await clickNav()
        } catch {
          const opened = await page.locator('button[aria-label]').evaluateAll((buttons) => {
            const trigger = (buttons as HTMLButtonElement[]).find(button => /菜单|menu/i.test(button.getAttribute('aria-label') ?? '') && button.offsetParent !== null)
            if (!trigger) return false
            trigger.click()
            return true
          })
          if (!opened) return { passed: false, routeIdentity: 'missing' }
          await clickNav()
        }
      }
      // 页内真实交互：精确名点击筛选按钮，验证期望文本出现且负向文本消失
      await page.getByRole(input.interaction!.role, { name: input.interaction!.name, exact: true }).click({ timeout: 5_000 })
      const expected = page.getByText(input.interaction!.expectedText, { exact: true })
      const appeared = await expected.count() >= 1 && await expected.first().isVisible()
      let absentGone = true
      if (input.interactionAbsentText) {
        const absent = page.getByText(input.interactionAbsentText, { exact: true })
        absentGone = (await absent.count()) === 0
      }
      // 单页契约：marker 唯一出现即路由身份确认
      const marker = page.getByText(input.markerText, { exact: true })
      const routeIdentity: RouteIdentityStatus = await marker.count() === 1 ? 'verified' : 'ambiguous'
      return { passed: appeared && absentGone, routeIdentity }
    } catch {
      return { passed: false, routeIdentity: 'missing' }
    } finally {
      await page.close().catch(() => undefined)
    }
  }
  const [baseline, candidate] = await Promise.all([run(input.baselineUrl), run(input.previewUrl)])
  return {
    baselinePassed: baseline.passed, candidatePassed: candidate.passed,
    baselineRouteIdentity: baseline.routeIdentity, candidateRouteIdentity: candidate.routeIdentity,
  }
}

/** 候选端目标图观测（加载、几何、截图）——与单端版一致，真实浏览器读取。 */
async function collectCandidateObservation(page: import('playwright').Page, input: RunnerInput, viewport: { name: string; width: number; height: number }, errors: string[], outputDir: string): Promise<MediaViewportObservation> {
  const selector = input.selector ?? input.containerHint?.selector ?? `img[src="${input.assetRef}"]`
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'attached', timeout: 10_000 })
  const info = await locator.evaluate((image) => {
    const element = image as HTMLImageElement
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      currentSrc: element.currentSrc,
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  }).catch((error: unknown) => {
    throw new MediaViewportEvidenceError(`视口 ${viewport.name} 读取目标图片失败：${error instanceof Error ? error.message : String(error)}`)
  })
  try {
    await page.waitForFunction((asset) => {
      const image = document.querySelector<HTMLImageElement>(`img[src="${asset}"], img[srcset*="${asset}"]`)
      return image && image.complete && image.naturalWidth > 0
    }, input.assetRef, { timeout: 10_000 })
  } catch {
    errors.push(`asset did not decode within timeout: ${input.assetRef}`)
  }
  const decoded = await locator.evaluate((image) => {
    const element = image as HTMLImageElement
    return { naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, complete: element.complete }
  })
  // 来源映射唯一性：DOM 中 src 命中 assetRef 的 img 总数（>1 即歧义，进入 source-mapping 判定）
  const matchCount = await page.locator('img').evaluateAll((all, ref) =>
    (all as HTMLImageElement[]).filter(image => image.getAttribute('src') === ref).length, input.assetRef)
  const artifactPath = path.join(outputDir, `${viewport.name}.png`)
  await locator.screenshot({ path: artifactPath }).catch(() => {
    errors.push(`screenshot failed for ${selector}`)
  })
  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    pageUrl: input.previewUrl,
    selector,
    assetRef: input.assetRef,
    currentSrc: info.currentSrc,
    matchCount,
    loaded: decoded.complete && decoded.naturalWidth > 0,
    naturalWidth: decoded.naturalWidth,
    naturalHeight: decoded.naturalHeight,
    renderedBox: info.box,
    objectFit: info.objectFit,
    objectPosition: info.objectPosition,
    errors,
  }
}

/** 基线端目标图真实观测（原工程渲染出的被编辑图），并对称采集元素截图。 */
async function collectBaselineObservation(page: import('playwright').Page, input: RunnerInput, viewport: { name: string; width: number; height: number }, outputDir: string): Promise<MediaDualEndpointViewport['baseline']> {
  const errors: string[] = []
  const images = page.locator('img')
  const match = await images.evaluateAll((all, original) => {
    const matches = (all as HTMLImageElement[]).filter(image => image.getAttribute('src') === original)
    const element = matches[0]
    if (!element) return undefined
    return {
      matchCount: matches.length,
      currentSrc: element.currentSrc,
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
    }
  }, input.originalValue)
  if (!match) return { pageUrl: input.baselineUrl, worksPageReached: false, markerVisible: false, markerMatchCount: 0, imageFound: false, imageMatchCount: 0, currentSrc: '', errors: [`基线端未渲染 src=${input.originalValue.slice(0, 64)} 的目标图`] }
  try {
    await page.waitForFunction((original) => {
      const element = Array.from(document.querySelectorAll('img')).find(image => image.getAttribute('src') === original)
      return element && element.complete && element.naturalWidth > 0
    }, input.originalValue, { timeout: 10_000 })
  } catch {
    errors.push('baseline image did not decode within timeout')
  }
  const decoded = await images.evaluateAll((all, original) => {
    const element = (all as HTMLImageElement[]).find(image => image.getAttribute('src') === original)
    return element ? { currentSrc: element.currentSrc, complete: element.complete, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight } : undefined
  }, input.originalValue)
  // 对称采集：基线端同样截目标图（在 DOM 快照之后，避免滚动污染对照）
  const screenshotPath = path.join(outputDir, `${viewport.name}-baseline.png`)
  let screenshotSha256: string | undefined
  try {
    await page.locator(`img[src="${input.originalValue}"]`).first().screenshot({ path: screenshotPath })
    screenshotSha256 = sha256(fs.readFileSync(screenshotPath))
  } catch {
    errors.push('baseline screenshot failed')
  }
  return {
    pageUrl: input.baselineUrl,
    worksPageReached: true,
    markerVisible: false, markerMatchCount: 0, // 由调用方 gotoWorksPage 结果回填
    imageFound: true,
    imageMatchCount: match.matchCount,
    currentSrc: decoded?.currentSrc ?? match.currentSrc,
    screenshotSha256,
    errors,
  }
}

async function collectDualViewport(browser: import('playwright').Browser, input: RunnerInput, viewport: { name: string; width: number; height: number }, outputDir: string): Promise<{ observation: MediaViewportObservation; dual: MediaDualEndpointViewport }> {
  const errors: string[] = []
  const warnings: string[] = []
  // —— 候选端 ——
  const candidatePage = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
  const candidateErrors: string[] = []
  candidatePage.on('pageerror', error => candidateErrors.push(`pageerror: ${error.message}`))
  candidatePage.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    const url = message.location().url ?? ''
    // 与本目标无关的第三方资源加载失败（CDN 抖动/字体/广告）降级为警告：
    // 目标资产本身的加载由 media-loaded 断言与 requestfailed 钩子负责。
    if (text.startsWith('Failed to load resource') && !url.includes(input.assetRef)) {
      warnings.push(`candidate resource warning: ${text}${url ? ` (${url})` : ''}`)
      return
    }
    candidateErrors.push(`console: ${text}${url ? ` (${url})` : ''}`)
  })
  candidatePage.on('requestfailed', request => {
    if (request.url().includes(input.assetRef)) candidateErrors.push(`asset request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })
  let candidateNav = { worksPageReached: false, markerVisible: false, markerMatchCount: 0 }
  let observation: MediaViewportObservation | undefined
  let candidateMasked: { ok: boolean; snapshot?: string; reason?: string } = { ok: false, reason: 'candidate page was not visited' }
  let overflow = false
  let runtimeState = 'navigation-failed'
  try {
    candidateNav = await gotoWorksPage(candidatePage, input, input.previewUrl)
    if (candidateNav.markerMatchCount > 0) {
      // 顺序敏感：DOM 快照必须在元素截图之前采集——locator.screenshot 会滚动
      // 目标入视口，触发的滚动监听类名变化（如青野固定头部）会污染双端对照。
      candidateMasked = await maskedRootSnapshot(candidatePage, input.assetRef, input.operationId)
      overflow = await candidatePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      observation = await collectCandidateObservation(candidatePage, input, viewport, candidateErrors, outputDir)
      runtimeState = 'rendered'
    } else {
      candidateErrors.push(`candidate works-page marker「${input.markerText}」未出现`)
    }
  } catch (error) {
    candidateErrors.push(error instanceof Error ? error.message : String(error))
  }

  // —— 基线端 ——
  const baselinePage = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
  const baselineErrors: string[] = []
  baselinePage.on('pageerror', error => baselineErrors.push(`pageerror: ${error.message}`))
  baselinePage.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.startsWith('Failed to load resource')) {
      warnings.push(`baseline resource warning: ${text}${message.location().url ? ` (${message.location().url})` : ''}`)
      return
    }
    baselineErrors.push(`console: ${text}${message.location().url ? ` (${message.location().url})` : ''}`)
  })
  let baselineNav = { worksPageReached: false, markerVisible: false, markerMatchCount: 0 }
  let baseline: MediaDualEndpointViewport['baseline'] = { pageUrl: input.baselineUrl, worksPageReached: false, markerVisible: false, markerMatchCount: 0, imageFound: false, imageMatchCount: 0, currentSrc: '', errors: ['baseline page was not visited'] }
  let baselineMasked: { ok: boolean; snapshot?: string; reason?: string } = { ok: false, reason: 'baseline page was not visited' }
  try {
    baselineNav = await gotoWorksPage(baselinePage, input, input.baselineUrl)
    if (baselineNav.markerMatchCount > 0) {
      baselineMasked = await maskedRootSnapshot(baselinePage, input.originalValue, input.operationId)
      baseline = await collectBaselineObservation(baselinePage, input, viewport, outputDir)
      baseline.markerVisible = baselineNav.markerVisible
      baseline.markerMatchCount = baselineNav.markerMatchCount
    } else {
      baselineErrors.push(`baseline works-page marker「${input.markerText}」未出现`)
      baseline = { ...baseline, errors: [...baselineErrors] }
    }
  } catch (error) {
    baselineErrors.push(error instanceof Error ? error.message : String(error))
    baseline.errors.push(...baselineErrors)
  }

  // —— 双端 DOM 对照（digest 真实计算；超限与失败如实记录 reason） ——
  let comparison: MediaDualEndpointViewport['maskedComparison']
  const maskedOperationIds = [input.operationId]
  if (!baselineMasked.ok || !candidateMasked.ok) {
    comparison = {
      matched: false, baselineDigest: '', candidateDigest: '',
      baselineSnapshot: '', candidateSnapshot: '', maskedOperationIds,
      reason: !baselineMasked.ok ? `baseline: ${baselineMasked.reason}` : `candidate: ${candidateMasked.reason}`,
    }
  } else if (Buffer.byteLength(baselineMasked.snapshot!) > 2 * 1024 * 1024 || Buffer.byteLength(candidateMasked.snapshot!) > 2 * 1024 * 1024) {
    comparison = {
      matched: false, baselineDigest: '', candidateDigest: '',
      baselineSnapshot: '', candidateSnapshot: '', maskedOperationIds,
      reason: 'Masked DOM snapshot exceeded the 2 MiB evidence limit.',
    }
  } else {
    const baselineDigest = sha256(Buffer.from(baselineMasked.snapshot!))
    const candidateDigest = sha256(Buffer.from(candidateMasked.snapshot!))
    comparison = {
      matched: baselineDigest === candidateDigest,
      baselineDigest, candidateDigest,
      baselineSnapshot: baselineMasked.snapshot!, candidateSnapshot: candidateMasked.snapshot!,
      maskedOperationIds,
    }
  }

  // —— 真实交互（双端 fresh 页面各自点击） ——
  const interaction = input.interaction
    ? await probeInteraction(browser, input, { width: viewport.width, height: viewport.height })
    : { baselinePassed: false, candidatePassed: false, baselineRouteIdentity: 'missing' as RouteIdentityStatus, candidateRouteIdentity: 'missing' as RouteIdentityStatus }

  await candidatePage.close().catch(() => undefined)
  await baselinePage.close().catch(() => undefined)

  if (!observation) {
    throw new MediaViewportEvidenceError(`视口 ${viewport.name} 候选端采集失败：${candidateErrors.join('；') || '未知错误'}`)
  }
  errors.push(...candidateErrors, ...baselineErrors)
  const dual: MediaDualEndpointViewport = {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    candidate: { worksPageReached: candidateNav.worksPageReached, markerVisible: candidateNav.markerVisible, markerMatchCount: candidateNav.markerMatchCount },
    baseline: { ...baseline, errors: [...baseline.errors] },
    maskedComparison: comparison,
    interaction,
    layout: { horizontalOverflow: overflow },
    runtimeState,
    errors,
    warnings,
  }
  return { observation, dual }
}

async function main(): Promise<number> {
  const input = readInput(process.argv)
  const outputDir = path.resolve(process.argv[3])
  fs.mkdirSync(outputDir, { recursive: true })

  // Optional local smoke-test override (e.g. RIPPLE_PW_CHANNEL=msedge when the
  // Playwright browser download is unavailable on a dev machine, and
  // RIPPLE_PW_PROXY=http://127.0.0.1:7890 to route third-party CDN requests).
  // CI keeps the default bundled chromium and direct egress.
  const channel = process.env.RIPPLE_PW_CHANNEL
  const proxyServer = process.env.RIPPLE_PW_PROXY
  const browser = await chromium.launch({
    headless: input.browser?.headless ?? true,
    ...(channel ? { channel } : {}),
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  })
  try {
    const observations: MediaViewportObservation[] = []
    const duals: MediaDualEndpointViewport[] = []
    for (const viewport of projectPreviewViewports) {
      const { observation, dual } = await collectDualViewport(browser, input, viewport, outputDir)
      observations.push(observation)
      duals.push(dual)
      console.log(`${viewport.name}: candidate loaded=${observation.loaded} fit=${observation.objectFit} matched=${dual.maskedComparison.matched} baselinePassed=${dual.interaction.baselinePassed} candidatePassed=${dual.interaction.candidatePassed}`)
    }
    const report = buildMediaViewportEvidenceReport({
      browser: { name: channel ?? 'chromium' },
      candidate: input.candidate,
      targetRef: input.targetRef,
      focalPoint: input.focalPoint,
      containerHint: input.containerHint,
      observations,
    })
    const reportHash = mediaViewportEvidenceSha256(report)
    const dualCollection: MediaDualEndpointCollection = { capturedAt: new Date().toISOString(), viewports: duals }
    const dualHash = mediaDualEndpointSha256(dualCollection)
    fs.writeFileSync(path.join(outputDir, 'evidence.json'), JSON.stringify({ report, sha256: reportHash }, null, 2))
    fs.writeFileSync(path.join(outputDir, 'dual.json'), JSON.stringify({ collection: dualCollection, sha256: dualHash }, null, 2))
    const summary = mediaEvidenceSummary(report)
    for (const observation of report.observations) {
      console.log(`${observation.viewport.name}: assertions=${observation.assertions.map(assertion => `${assertion.id}:${assertion.result}`).join(' ')}`)
    }
    console.log(`media viewport evidence: ${summary} sha256=${reportHash}`)
    console.log(`dual-endpoint collection: viewports=${duals.length} sha256=${dualHash}`)
    return summary === 'pass' ? 0 : summary === 'risks' ? 2 : 3
  } finally {
    await browser.close().catch(() => undefined)
  }
}

main().then(code => { process.exitCode = code }, error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
