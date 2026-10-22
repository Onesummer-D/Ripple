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
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serveStatic } from '../../../src/core/media-acceptance-server'
import { mediaDualEndpointSha256, mediaEvidenceSummary, mediaViewportEvidenceSha256 } from '../../../src/core/media-viewport-evidence'
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

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 回归加固（D 最终复审 P1）：采集产物完整性核验——哈希回验、四视口齐全、截图存在且确为 PNG、比较报告 24 条观测。 */
function verifyArtifacts(dir: string): void {
  const evidenceFile = JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8')) as { report: Parameters<typeof mediaViewportEvidenceSha256>[0]; sha256: string }
  if (mediaViewportEvidenceSha256(evidenceFile.report) !== evidenceFile.sha256) throw new Error('evidence.json 内容哈希不匹配')
  if (mediaEvidenceSummary(evidenceFile.report) !== 'pass') throw new Error('evidence.json 汇总不是 pass')
  if (evidenceFile.report.observations.length !== projectPreviewViewports.length) throw new Error(`evidence.json 视口数 ${evidenceFile.report.observations.length} != ${projectPreviewViewports.length}`)
  const dualFile = JSON.parse(fs.readFileSync(path.join(dir, 'dual.json'), 'utf8')) as { collection: Parameters<typeof mediaDualEndpointSha256>[0]; sha256: string }
  if (mediaDualEndpointSha256(dualFile.collection) !== dualFile.sha256) throw new Error('dual.json 内容哈希不匹配')
  if (dualFile.collection.viewports.length !== projectPreviewViewports.length) throw new Error('dual.json 视口不全')
  for (const viewport of projectPreviewViewports) {
    for (const suffix of [`${viewport.name}.png`, `${viewport.name}-baseline.png`]) {
      const file = path.join(dir, suffix)
      if (!fs.existsSync(file)) throw new Error(`缺少截图：${suffix}`)
      if (!fs.readFileSync(file).subarray(0, 8).equals(PNG_MAGIC)) throw new Error(`截图不是 PNG：${suffix}`)
    }
  }
  const comparison = JSON.parse(fs.readFileSync(path.join(dir, 'comparison.json'), 'utf8')) as { observations: unknown[] }
  const expected = 3 * projectPreviewViewports.length * 2
  if (comparison.observations.length !== expected) throw new Error(`comparison.json 观测数 ${comparison.observations.length} != ${expected}（3 容器 × ${projectPreviewViewports.length} 视口 × 双端）`)
  console.log(`[scenario] 产物完整性核验通过：evidence/dual 哈希一致、${projectPreviewViewports.length} 视口截图成对且为 PNG、${expected} 条几何观测`)
}

function runEvidenceRunner(input: string, dir: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const runner = spawn(
      process.execPath,
      ['--experimental-transform-types', '--loader', './scripts/ts-extension-loader.mjs',
        'scripts/media-viewport-evidence.ts', input, dir],
      { cwd: repoRoot, stdio: 'inherit' },
    )
    runner.once('error', reject)
    runner.once('close', code => resolve(code ?? 1))
  })
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true })
  const baseline = await serveStatic(path.join(fixtureDir, 'baseline'), 4631)
  const candidate = await serveStatic(path.join(fixtureDir, 'candidate'), 4632)
  let runnerExit = 0
  try {
    console.log('[scenario] 静态服务就绪：baseline=4631 candidate=4632')
    runnerExit = await runEvidenceRunner(path.join(fixtureDir, 'input.json'), outputDir)
    console.log(`[scenario] 四视口证据采集退出码=${runnerExit}`)
    if (runnerExit === 0) verifyArtifacts(outputDir)

    // 失败路径负例（D 最终复审 P1）：assetRef 指向不存在资源时，采集器必须非零退出——
    // 若意外通过，说明四视口断言/截图/比较报告检查失效，本场景整体判失败。
    const tamperedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-orientation-negative-'))
    try {
      const tampered = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'input.json'), 'utf8')) as Record<string, unknown>
      tampered.assetRef = '/media/does-not-exist.jpg'
      const tamperedInput = path.join(tamperedDir, 'input.json')
      fs.writeFileSync(tamperedInput, JSON.stringify(tampered))
      const negativeExit = await runEvidenceRunner(tamperedInput, path.join(tamperedDir, 'out'))
      if (negativeExit === 0) throw new Error('负例未生效：缺失资源的 assetRef 竟然采集通过，断言链失效')
      console.log(`[scenario] 失败路径负例符合预期：缺失资源采集非零退出（exit ${negativeExit}）`)
    } finally {
      fs.rmSync(tamperedDir, { recursive: true, force: true })
    }

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
