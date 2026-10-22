/**
 * 横版→竖版素材替换四视口可复现场景驱动（D 侧集成准备交付）。
 *
 * 职责：
 * 1. 用 MEDIA 验收同款受限静态服务（media-acceptance-server）同时提供基线与候选站点；
 * 2. 驱动 B 的四视口证据采集器（scripts/media-viewport-evidence.ts，子进程，字节未改）；
 * 3. 追加三容器 × 四视口 × 双端的真实浏览器几何测量（首页 Hero / 活动图区 / 商品卡片），
 *    输出 comparison.json：natural 尺寸、renderedBox、object-fit、object-position、
 *    推导的可见源窗口（与 media-viewport-evidence 同一几何语义），
 *    以及容器尺寸变化（基线 vs 候选）。
 *
 * 运行（仓库根）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     test/fixtures/media-orientation-swap/run-scenario.ts <outputDir>
 *
 * 注意：本场景是独立模块验证 Fixture，不依赖真实工程的 SourceGraph 消费证明；
 * 不得把本场景结果当作 C+D 联合实测或真实 MEDIA 验收 PASS。
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serveStatic } from '../../../src/core/media-acceptance-server'
import { projectPreviewViewports } from '../../../src/core/project-viewports'

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(fixtureDir, '../../..')
const outputDir = path.resolve(process.argv[2] ?? path.join(fixtureDir, 'evidence'))

interface ContainerObservation {
  container: string
  viewport: string
  end: 'baseline' | 'candidate'
  src: string | null
  naturalWidth: number
  naturalHeight: number
  renderedBox: { width: number; height: number; x: number; y: number }
  objectFit: string
  objectPosition: string
}

async function measureEnd(browser: import('playwright').Browser, url: string, end: 'baseline' | 'candidate'): Promise<ContainerObservation[]> {
  const observations: ContainerObservation[] = []
  for (const viewport of projectPreviewViewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
      const pageObservations = await page.evaluate(() => {
        const results: Array<Record<string, unknown>> = []
        for (const section of document.querySelectorAll('[data-container]')) {
          const img = section.querySelector('img')
          if (!img) continue
          const rect = img.getBoundingClientRect()
          const style = getComputedStyle(img)
          results.push({
            container: section.getAttribute('data-container'),
            src: img.getAttribute('src'),
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            renderedBox: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
            objectFit: style.objectFit,
            objectPosition: style.objectPosition,
          })
        }
        return results
      })
      for (const observation of pageObservations) {
        observations.push({ ...observation, viewport: viewport.name, end } as ContainerObservation)
      }
    } finally {
      await page.close()
    }
  }
  return observations
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true })
  const baseline = await serveStatic(path.join(fixtureDir, 'baseline'), 4631)
  const candidate = await serveStatic(path.join(fixtureDir, 'candidate'), 4632)
  let runnerExit = 0
  try {
    console.log('[scenario] 静态服务就绪：baseline=4631 candidate=4632')
    const runner = spawn(
      process.execPath,
      ['--experimental-transform-types', '--loader', './scripts/ts-extension-loader.mjs',
        'scripts/media-viewport-evidence.ts',
        path.join(fixtureDir, 'input.json'), outputDir],
      { cwd: repoRoot, stdio: 'inherit' },
    )
    runnerExit = await new Promise<number>((resolve, reject) => {
      runner.once('error', reject)
      runner.once('close', code => resolve(code ?? 1))
    })
    console.log(`[scenario] 四视口证据采集退出码=${runnerExit}`)

    const browser = await chromium.launch({ headless: true })
    try {
      const [baselineObs, candidateObs] = await Promise.all([
        measureEnd(browser, 'http://127.0.0.1:4631/', 'baseline'),
        measureEnd(browser, 'http://127.0.0.1:4632/', 'candidate'),
      ])
      const comparison = {
        generatedAt: new Date().toISOString(),
        viewports: projectPreviewViewports,
        note: '独立模块验证 Fixture：不依赖真实工程 SourceGraph 消费证明，不代表 C+D 联合实测或真实 MEDIA 验收 PASS。',
        observations: [...baselineObs, ...candidateObs],
      }
      fs.writeFileSync(path.join(outputDir, 'comparison.json'), JSON.stringify(comparison, null, 2))
      console.log(`[scenario] 三容器双端几何测量完成：${baselineObs.length + candidateObs.length} 条观测 → comparison.json`)
    } finally {
      await browser.close()
    }
  } finally {
    baseline.close()
    candidate.close()
  }
  if (runnerExit !== 0) {
    console.error(`[scenario] 四视口证据采集未通过（退出码 ${runnerExit}），请检查 evidence.json 断言`)
    process.exitCode = runnerExit
  } else {
    console.log('[scenario] 完成。')
  }
}

main().then(() => undefined, error => {
  console.error(error)
  process.exitCode = 1
})
