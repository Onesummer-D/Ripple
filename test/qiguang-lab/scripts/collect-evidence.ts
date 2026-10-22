/**
 * 栖光艺术节 Lab 证据采集驱动。
 *
 * 职责：
 * 1. 用 MEDIA 验收同款受限静态服务（media-acceptance-server）同时提供
 *    dist-wide（基线端 :4641）与 dist-tall（候选端 :4642）；
 * 2. 对三个共享媒体消费页（首页 Hero / 节目页展墙 / 购票卡片）分别驱动 B 的四视口
 *    证据采集器（scripts/media-viewport-evidence.ts，子进程，字节未改），
 *    产物写入 evidence/<page>/；
 * 3. 不受共享媒体替换影响的资源（档案页 HTML + 档案图、首页本地图）做双端 HTTP
 *    字节相等断言，写入 evidence/unaffected-bytes.json——证明替换范围被正确收窄，
 *    非目标资源在两端逐字节一致。
 *
 * 运行（仓库根）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     test/qiguang-lab/scripts/collect-evidence.ts
 *
 * 定位声明：本 Lab 的消费关系（三页共享同一媒体源）由工程结构显式声明，
 * 不依赖真实工程的 SourceGraph 消费证明；结果不得作为 C+D 联合实测或
 * 真实 MEDIA 验收 PASS 引用。
 */
import { spawn } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serveStatic } from '../../../src/core/media-acceptance-server'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const labDir = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(labDir, '../..')
const evidenceRoot = path.join(labDir, 'evidence')

const BASELINE_PORT = 4641
const CANDIDATE_PORT = 4642

interface LabPage {
  page: 'home' | 'program' | 'tickets'
  html: string
  markerText: string
}

const labPages: LabPage[] = [
  { page: 'home', html: 'index.html', markerText: '第六届栖光艺术节' },
  { page: 'program', html: 'program.html', markerText: '节目单' },
  { page: 'tickets', html: 'tickets.html', markerText: '购票' },
]

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function runEvidenceRunner(inputFile: string, outputDir: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const runner = spawn(
      process.execPath,
      ['--experimental-transform-types', '--loader', './scripts/ts-extension-loader.mjs',
        'scripts/media-viewport-evidence.ts', inputFile, outputDir],
      { cwd: repoRoot, stdio: 'inherit' },
    )
    runner.once('error', reject)
    runner.once('close', code => resolve(code ?? 1))
  })
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

interface ByteCheck {
  resource: string
  baselineSha256: string
  candidateSha256: string
  baselineBytes: number
  equal: boolean
}

interface RenderCheck {
  page: string
  end: 'baseline' | 'candidate'
  markerText: string
  archiveImgSrc: string
  archiveImgNatural: { width: number; height: number }
  sharedHeroImgCount: number
}

/**
 * 非目标资源不受影响断言（两层）：
 * 1. 字节层——真实媒体资产在两端逐字节相等（档案图、首页本地图）；
 * 2. 渲染层——档案页不消费共享媒体：两端 DOM 中 shared-hero 消费数必须为 0，
 *    档案图自然尺寸与 marker 一致。archive.html 外壳本身不做字节断言：
 *    它引用的共享 JS bundle 必然包含共享媒体编辑点（多页共享 chunk 架构），
 *    对 HTML 外壳比字节是错误不变量。
 */
async function verifyUnaffectedResources(): Promise<void> {
  const byteChecks: ByteCheck[] = []
  const resources = [
    { name: 'media/qiguang-archive.jpg', urlPath: '/media/qiguang-archive.jpg' },
    { name: 'media/qiguang-home-local.jpg', urlPath: '/media/qiguang-home-local.jpg' },
  ]
  for (const resource of resources) {
    const baseline = await fetchBytes(`http://127.0.0.1:${BASELINE_PORT}${resource.urlPath}`)
    const candidate = await fetchBytes(`http://127.0.0.1:${CANDIDATE_PORT}${resource.urlPath}`)
    byteChecks.push({
      resource: resource.name,
      baselineSha256: sha256(baseline),
      candidateSha256: sha256(candidate),
      baselineBytes: baseline.length,
      equal: baseline.equals(candidate),
    })
  }
  const violated = byteChecks.filter(check => !check.equal)
  if (violated.length > 0) {
    throw new Error(`非目标媒体资产在两端字节不一致：${violated.map(v => v.resource).join(', ')}`)
  }

  const renderChecks: RenderCheck[] = []
  const browser = await chromium.launch({ headless: true })
  try {
    for (const end of ['baseline', 'candidate'] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      try {
        const url = `http://127.0.0.1:${end === 'baseline' ? BASELINE_PORT : CANDIDATE_PORT}/archive.html`
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
        const observation = await page.evaluate(() => {
          const archiveImg = document.querySelector<HTMLImageElement>('img[data-consumer="archive"]')
          const marker = document.querySelector('h1')
          return {
            markerText: marker?.textContent ?? '',
            archiveImgSrc: archiveImg?.getAttribute('src') ?? null,
            archiveImgNatural: archiveImg ? { width: archiveImg.naturalWidth, height: archiveImg.naturalHeight } : null,
            sharedHeroImgCount: document.querySelectorAll('img[data-consumer="shared-hero"]').length,
          }
        })
        if (observation.archiveImgSrc !== '/media/qiguang-archive.jpg') {
          throw new Error(`${end} 端档案图 src=${observation.archiveImgSrc}，期望 /media/qiguang-archive.jpg`)
        }
        if (!observation.archiveImgNatural || observation.archiveImgNatural.width !== 1600 || observation.archiveImgNatural.height !== 900) {
          throw new Error(`${end} 端档案图自然尺寸异常：${JSON.stringify(observation.archiveImgNatural)}`)
        }
        if (observation.markerText !== '往届档案') throw new Error(`${end} 端档案页 marker 不符：${observation.markerText}`)
        if (observation.sharedHeroImgCount !== 0) {
          throw new Error(`${end} 端档案页出现 ${observation.sharedHeroImgCount} 个共享媒体消费点，替换范围泄漏`)
        }
        renderChecks.push({
          page: 'archive.html', end,
          markerText: observation.markerText,
          archiveImgSrc: observation.archiveImgSrc,
          archiveImgNatural: observation.archiveImgNatural,
          sharedHeroImgCount: observation.sharedHeroImgCount,
        })
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }

  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.writeFileSync(path.join(evidenceRoot, 'unaffected-checks.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: '非目标资源不受影响断言：字节层（媒体资产双端相等）+ 渲染层（档案页零共享媒体消费、档案图尺寸/marker 一致）。archive.html 外壳因共享 bundle 差异不做字节断言。',
    byteChecks,
    renderChecks,
  }, null, 2))
  console.log(`[qiguang-lab] 非目标资源未受影响：${byteChecks.length} 项字节一致 + 档案页双端渲染一致（零共享消费）`)
}

async function main(): Promise<void> {
  for (const dist of ['dist-wide', 'dist-tall']) {
    if (!fs.existsSync(path.join(labDir, dist))) {
      throw new Error(`缺少 ${dist}/，请先运行 node test/qiguang-lab/scripts/build-variants.mjs`)
    }
  }
  fs.rmSync(evidenceRoot, { recursive: true, force: true })
  fs.mkdirSync(evidenceRoot, { recursive: true })

  const baseline = await serveStatic(path.join(labDir, 'dist-wide'), BASELINE_PORT)
  const candidate = await serveStatic(path.join(labDir, 'dist-tall'), CANDIDATE_PORT)
  const failures: string[] = []
  try {
    console.log(`[qiguang-lab] 静态服务就绪：baseline=${BASELINE_PORT}(wide) candidate=${CANDIDATE_PORT}(tall)`)
    for (const labPage of labPages) {
      const outputDir = path.join(evidenceRoot, labPage.page)
      fs.mkdirSync(outputDir, { recursive: true })
      const input = {
        previewUrl: `http://127.0.0.1:${CANDIDATE_PORT}/${labPage.html}`,
        baselineUrl: `http://127.0.0.1:${BASELINE_PORT}/${labPage.html}`,
        candidate: {
          candidateId: 'qiguang-lab-hero-tall',
          baseSourceDigest: 'qiguang-lab-digest-not-a-real-candidate',
          patchHash: 'qiguang-lab-patch-not-a-real-candidate',
          candidateTreeDigest: 'qiguang-lab-tree-not-a-real-candidate',
        },
        targetRef: `media:qiguang/${labPage.page}#qiguang-hero-wide.jpg`,
        operationId: `qiguang-hero-swap-${labPage.page}`,
        assetRef: '/media/qiguang-hero-tall.jpg',
        originalValue: '/media/qiguang-hero-wide.jpg',
        markerText: labPage.markerText,
        selector: 'img[data-consumer="shared-hero"]',
        browser: { headless: true },
      }
      const inputFile = path.join(outputDir, 'input.json')
      fs.writeFileSync(inputFile, JSON.stringify(input, null, 2))
      const exitCode = await runEvidenceRunner(inputFile, outputDir)
      console.log(`[qiguang-lab] ${labPage.page} 四视口采集退出码=${exitCode}`)
      if (exitCode !== 0) failures.push(`${labPage.page}（exit ${exitCode}）`)
    }
    await verifyUnaffectedResources()
  } finally {
    baseline.close()
    candidate.close()
  }
  if (failures.length > 0) {
    console.error(`[qiguang-lab] 采集未通过：${failures.join('、')}`)
    process.exitCode = 1
    return
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    pages: labPages.map(p => p.page),
    sharedMedia: { baseline: '/media/qiguang-hero-wide.jpg', candidate: '/media/qiguang-hero-tall.jpg' },
    containers: [
      'home-hero（16:9 · cover center）',
      'program-wall（4:3 · cover 50% 20%）',
      'ticket-card（3:4 · cover top）',
    ],
    unaffected: ['media/qiguang-archive.jpg（字节层）', 'media/qiguang-home-local.jpg（字节层）', 'archive.html（渲染层：零共享消费）'],
    note: 'Lab 消费关系由工程结构显式声明，非 SourceGraph 证明；不构成 C+D 联合实测或真实 MEDIA 验收 PASS。',
  }
  fs.writeFileSync(path.join(evidenceRoot, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('[qiguang-lab] 完成：三页四视口证据 + 非目标资源字节断言全部通过。')
}

main().then(() => undefined, error => {
  console.error(error)
  process.exitCode = 1
})
