/**
 * 四视口媒体 Evidence 采集运行器（B 侧）。
 *
 * 用法：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/media-viewport-evidence.ts <input.json> <outputDir>
 *
 * input.json:
 * {
 *   "previewUrl": "http://127.0.0.1:5173/",
 *   "candidate": { "candidateId", "baseSourceDigest", "patchHash", "candidateTreeDigest" },
 *   "targetRef": "media:hero",
 *   "assetRef": "/media/hero-new.webp",
 *   "selector": "main img[alt=\"hero\"]",        // 缺省时按 assetRef 推导
 *   "focalPoint": { "x": 0.5, "y": 0.5 },        // 可选
 *   "containerHint": { "selector", "aspect" },   // 可选
 *   "navigateBy": { "role": "button", "name": "商品专题" }, // 多页应用先点导航
 *   "browser": { "headless": true }
 * }
 *
 * 输出 outputDir/evidence.json（报告 + sha256）与每视口截图（observation.evidenceArtifact）。
 * 退出码：summary pass=0，risks=2，failed=3，运行错误=1。
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import {
  buildMediaViewportEvidenceReport,
  mediaEvidenceSummary,
  mediaViewportEvidenceSha256,
  MediaViewportEvidenceError,
  type MediaViewportObservation,
} from '../src/core/media-viewport-evidence'
import { projectPreviewViewports } from '../src/core/project-viewports'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface RunnerInput {
  previewUrl: string
  candidate: { candidateId: string; baseSourceDigest: string; patchHash: string; candidateTreeDigest: string }
  targetRef: string
  assetRef: string
  selector?: string
  focalPoint?: { x: number; y: number }
  containerHint?: { selector: string; aspect: number }
  /** 多页应用先点击导航再采集（如青野点"商品专题"进入作品页） */
  navigateBy?: { role: 'button' | 'link'; name: string }
  browser?: { headless?: boolean }
}

function readInput(argv: string[]): RunnerInput {
  if (argv.length < 4) throw new MediaViewportEvidenceError('用法: media-viewport-evidence.ts <input.json> <outputDir>')
  const input = JSON.parse(fs.readFileSync(argv[2], 'utf8')) as RunnerInput
  if (!input.previewUrl || !input.candidate?.patchHash || !input.assetRef || !input.targetRef) {
    throw new MediaViewportEvidenceError('input 缺少 previewUrl / candidate / assetRef / targetRef')
  }
  if (input.focalPoint && (!Number.isFinite(input.focalPoint.x) || !Number.isFinite(input.focalPoint.y))) {
    throw new MediaViewportEvidenceError('focalPoint 必须是有限数值')
  }
  return input
}

async function collectObservation(browser: import('playwright').Browser, input: RunnerInput, viewport: { name: string; width: number; height: number }, outputDir: string): Promise<MediaViewportObservation> {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
  const errors: string[] = []
  try {
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
    page.on('requestfailed', request => {
      if (request.url().includes(input.assetRef)) errors.push(`asset request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`)
    })
    await page.goto(input.previewUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    if (input.navigateBy) {
      // 桌面导航直接点；移动端折叠菜单先尝试打开（aria-label 含"菜单"/"menu"的按钮），再点目标
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
        if (!opened) throw new MediaViewportEvidenceError(`视口 ${viewport.name} 找不到导航入口「${input.navigateBy.name}」`)
        await clickNav()
      }
      await page.waitForLoadState('networkidle').catch(() => undefined)
    }

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

    // 等待新资源真实解码（naturalWidth 由解码结果决定）
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
      loaded: decoded.complete && decoded.naturalWidth > 0,
      naturalWidth: decoded.naturalWidth,
      naturalHeight: decoded.naturalHeight,
      renderedBox: info.box,
      objectFit: info.objectFit,
      objectPosition: info.objectPosition,
      errors,
    }
  } finally {
    await page.close().catch(() => undefined)
  }
}

async function main(): Promise<number> {
  const input = readInput(process.argv)
  const outputDir = path.resolve(process.argv[3])
  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({ headless: input.browser?.headless ?? true })
  try {
    const observations: MediaViewportObservation[] = []
    for (const viewport of projectPreviewViewports) {
      observations.push(await collectObservation(browser, input, viewport, outputDir))
    }
    const report = buildMediaViewportEvidenceReport({
      browser: { name: 'chromium' },
      candidate: input.candidate,
      targetRef: input.targetRef,
      focalPoint: input.focalPoint,
      containerHint: input.containerHint,
      observations,
    })
    const reportHash = mediaViewportEvidenceSha256(report)
    fs.writeFileSync(path.join(outputDir, 'evidence.json'), JSON.stringify({ report, sha256: reportHash }, null, 2))
    const summary = mediaEvidenceSummary(report)
    for (const observation of report.observations) {
      console.log(`${observation.viewport.name}: loaded=${observation.loaded} fit=${observation.objectFit} geometry=${observation.geometry.scaleMode} assertions=${observation.assertions.map(assertion => `${assertion.id}:${assertion.result}`).join(' ')}`)
    }
    console.log(`media viewport evidence: ${summary} sha256=${reportHash}`)
    return summary === 'pass' ? 0 : summary === 'risks' ? 2 : 3
  } finally {
    await browser.close().catch(() => undefined)
  }
}

main().then(code => { process.exitCode = code }, error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
