/**
 * D3 最小联合集成预演：栖光固定工程 × A 45a2d7c 公共核心 × D MEDIA 白名单模块。
 *
 * 真实接口全链：
 *   素材暂存（media-asset-staging）→ 合法 MEDIA 候选（A candidate 核心 + D 执行器）
 *   → Scope 用户决定（sourceProvenPageImpact 依据）→ 隔离预演（candidateRoot 构建服务）
 *   → 四视口验证证据（media-viewport-evidence + serveStatic + 真实浏览器）
 *   → Approval（attestBrowserExecution 登记的正式 VerificationRun）
 *   → Apply / Rollback（applyApprovedCandidateWithRecovery / rollbackAppliedCandidate）。
 *
 * 证据可信度约定（返工后）：
 *   - 七项 REQUIRED 断言全部由真实浏览器观测计算得出，任何一项不能充分证明即保持
 *     合同允许的非 pass 状态（risk/not-run），并导致审批被拒（fail-closed）。
 *   - 交互证据为真实点击合同声明的链接（getByRole link 节目），不使用 goto 代替。
 *   - scopeObservations 逐页×逐视口分别从基线/候选浏览器采集真实 marker 计数与
 *     真实 img src，不复制观测、不预设计数。
 *   - 遮蔽仅覆盖本次操作的目标媒体；其余图片保持真实 src 参与双端比较。
 *   - 负例模式（--negative wrong-interaction / tamper-evidence / non-target-image）：
 *     故意破坏一项浏览器观测，验证对应门控按预期拒绝；NEGATIVE-PASS 要求拒绝原因
 *     精确匹配（错误模式 + 对应断言非 pass），不得凭任意异常通过。
 *
 * 用法（cwd = Ripple-d3 集成工作树）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/d3-qiguang-rehearsal.ts --lab <栖光 Lab 检出根> [--out <输出目录>] \
 *     [--negative wrong-interaction|tamper-evidence|non-target-image]
 *
 * 退出码：0 全链通过（或负例按预期被拒）；非零任一阶段失败。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { analyzeProject, digestTrackedTree } from '../src/core/project'
import { expectedTextForScope, sourceProvenPageImpact } from '../src/core/scope'
import { assertMediaSwapAsset, createStagedAssetStore, resolveAssetRefToRelativePath } from '../src/core/media-asset-staging'
import { assertCandidateCurrent, createCandidate, removeCandidate } from '../src/core/candidate'
import { mediaAssetSwapExecutor, type MediaAssetSwapOperation } from '../src/core/media-asset-swap'
import { rollbackAppliedCandidate } from '../src/core/apply'
import { applyApprovedCandidateWithRecovery } from '../src/core/media-acceptance-apply'
import { serveStatic } from '../src/core/media-acceptance-server'
import {
  buildMediaViewportEvidenceReport,
  mediaDualEndpointSha256,
  mediaEvidenceSummary,
  mediaViewportEvidenceSha256,
  type MediaDualEndpointCollection,
  type MediaViewportObservation,
} from '../src/core/media-viewport-evidence'
import { projectPreviewViewports } from '../src/core/project-viewports'
import { approve, chooseScope, openSession, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from '../src/core/session'
import type { BrowserVerificationContract, EvidenceResult, ScopeDecision, VerificationRun } from '../src/core/model'
import { attestBrowserExecution } from '../src/core/verification-receipt'
import { verificationContractHash } from '../src/core/verification-contract'
import { removeTree } from '../src/core/test-fixture-dir'

const argv = process.argv.slice(2)
const labArg = argv[argv.indexOf('--lab') + 1]
const outArgIndex = argv.indexOf('--out')
const negativeArg = argv.indexOf('--negative')
type NegativeMode = 'wrong-interaction' | 'tamper-evidence' | 'non-target-image'
const negative = negativeArg >= 0 ? argv[negativeArg + 1] as NegativeMode : undefined
/** 负例判定：拒绝必须命中精确错误模式，且对应断言确实非 pass（不得凭任意异常通过）。 */
const NEGATIVE_PATTERNS: Record<NegativeMode, RegExp> = {
  'wrong-interaction': /Only a verified candidate can be approved/,
  'tamper-evidence': /hash mismatch/i,
  'non-target-image': /Only a verified candidate can be approved/,
}
if (negativeArg >= 0 && !['wrong-interaction', 'tamper-evidence', 'non-target-image'].includes(negative)) throw new Error(`未知负例模式：${negative}`)
const outDir = path.resolve(outArgIndex >= 0 ? argv[outArgIndex + 1] : 'test-results/d3-rehearsal')
const labRoot = path.resolve(labArg, 'test/qiguang-lab')
const variantRoot = path.join(labRoot, 'router-variant')
const SHARED_VALUE = '/media/qiguang-hero-wide.jpg'
const ASSET_REF = '/media/qiguang-hero-rehearsal-tall.jpg'
const sha256 = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString().trim()

const record: Record<string, unknown> = { schema: 'd3-qiguang-rehearsal/v2', negative: negative ?? null, startedAt: new Date().toISOString() }

// 阶段 4 的真实采集结果，提升至 main 作用域供阶段 5 的正式 VerificationRun 使用
let observations: MediaViewportObservation[] = []
let dualViewports: MediaDualEndpointCollection['viewports'] = []
let fullSnapshots: Array<{ name: string; baseline: string; candidate: string }> = []
let comparisonArtifacts: Array<{ name: string; artifactPath: string; artifactHash: string }> = []
let scopeProbes: Array<{
  pageRef: string
  viewport: { name: string; width: number; height: number }
  baseline: { markerCount: number; heroSrc: string; layout: LayoutProbe }
  candidate: { markerCount: number; heroSrc: string; layout: LayoutProbe }
}> = []

interface LayoutProbe {
  scrollWidth: number
  clientWidth: number
  horizontalOverflow: boolean
  heroVisible: boolean
  heroInViewport: boolean
  containerInViewport: boolean
}
let tallDims: { width: number; height: number } | undefined
let dualSha = ''
let evidenceReportSha = ''
const interactionLog: Array<{ linkName: string; url: string; landedH1: string }> = []

function stage(line: string): void {
  console.log(`[d3] ${line}`)
}

/** 从 JPEG 字节解析 SOF 段的真实像素尺寸（用于 source-mapping 断言绑定暂存资产）。 */
function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('非 JPEG 输入')
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  throw new Error('JPEG 中未找到 SOF 段')
}

/** 复制固定栖光 data-router 变体（来源可证明形态；排除构建产物与脚本），建 git 基线。
 *  MPA 形态在 A 45a2d7c 上共享媒体 PageImpact fail-closed 为 unknown（无可证明页面消费者），
 *  故候选生命周期预演采用已证明的路由表形态；该限制如实写入交付记录。 */
function materializeProject(container: string): string {
  const project = path.join(container, 'project')
  fs.cpSync(variantRoot, project, {
    recursive: true,
    filter: source => !source.includes(`${path.sep}dist-`) && !source.includes(`${path.sep}scripts`) && !source.includes(`${path.sep}node_modules`),
  })
  git(project, 'init', '-q')
  git(project, 'config', 'user.email', 'd-agent@ripple.local')
  git(project, 'config', 'user.name', 'D Agent Rehearsal')
  // 行尾规范化：本机全局 autocrlf=true 会使 CRLF 工作树与 autocrlf=false 检出 digest 错位；
  // 预演夹具统一为 LF 并关闭本地 autocrlf（仅夹具层面，如实记录）。
  const TEXT_EXT = new Set(['.ts', '.tsx', '.html', '.css', '.json', '.md', '.mjs', '.js'])
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!TEXT_EXT.has(path.extname(entry.name))) continue
      const content = fs.readFileSync(full, 'utf8')
      if (content.includes('\r\n')) fs.writeFileSync(full, content.replace(/\r\n/g, '\n'))
    }
  }
  walk(project)
  git(project, 'config', 'core.autocrlf', 'false')
  git(project, 'add', '-A')
  git(project, 'commit', '-qm', 'qiguang router variant pinned baseline (LF normalized)')
  return project
}

/** vite 构建依赖经 junction 提供；仅在所有 git 树敏感性操作完成后调用。 */
function linkDeps(project: string): void {
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(project, 'node_modules'), 'junction')
}

function h1Of(project: string, componentFile: string): string {
  const source = fs.readFileSync(path.join(project, 'src', 'pages', componentFile), 'utf8')
  const match = source.match(/<h1[^>]*>([^<]+)<\/h1>/)
  if (!match) throw new Error(`页面 ${componentFile} 缺少 <h1> marker`)
  return match[1].trim()
}

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true })
  // 容器放工作区 .ripple-fixtures（仓库外）——若放 node_modules 内，
  // project 的 node_modules junction 会指向容器祖先，cpSync 判定路径关系异常而静默不产出
  const tmpParent = path.resolve(process.cwd(), '..', '.ripple-fixtures')
  fs.mkdirSync(tmpParent, { recursive: true })
  const container = fs.mkdtempSync(path.join(tmpParent, 'd3-rehearsal-'))
  const servers: Array<{ close: () => Promise<unknown> }> = []
  let candidate: ReturnType<typeof createCandidate> | undefined
  try {
    // ── 阶段 1：固定工程 + 来源证明 ──────────────────────────────────────
    const project = materializeProject(container)
    const projectBaselineDigest = digestTrackedTree(project)
    const graph = analyzeProject(project)
    const target = graph.nodes.find(node => node.kind === 'media' && node.value === SHARED_VALUE && node.location)
    if (!target?.location) throw new Error(`共享媒体节点未命中：${SHARED_VALUE}`)
    const impact = sourceProvenPageImpact(graph, target.id)
    record.provenance = { targetId: target.id, pageRefs: impact.pageRefs, certainty: impact.certainty, unresolved: impact.unresolved }
    stage(`来源证明：target=${target.id} pages=[${impact.pageRefs.join(', ')}] certainty=${impact.certainty}`)
    if (impact.certainty !== 'source-proven') throw new Error('共享媒体来源证明未达 source-proven')
    if (impact.unresolved.length) throw new Error(`共享媒体 unresolved 非空：${impact.unresolved.join(' | ')}`)
    const archiveLeak = impact.pageRefs.filter(ref => ref.includes('archive'))
    if (archiveLeak.length) throw new Error(`档案页被误加入共享媒体影响：${archiveLeak.join(', ')}`)
    const archiveNode = graph.nodes.find(node => node.kind === 'media' && node.value === '/media/qiguang-archive.jpg')
    if (!archiveNode) throw new Error('档案媒体节点未命中')
    const archiveImpact = sourceProvenPageImpact(graph, archiveNode.id)
    record.archiveProvenance = { pageRefs: archiveImpact.pageRefs, certainty: archiveImpact.certainty }
    stage(`档案媒体隔离：pages=[${archiveImpact.pageRefs.join(', ')}]（不含首页/节目/购票=${!archiveImpact.pageRefs.some(ref => ['index', 'program', 'tickets'].some(p => ref.includes(p)))}）`)

    // ── 阶段 2：素材暂存（D 白名单真实接口）─────────────────────────────
    const tallBytes = fs.readFileSync(path.join(project, 'public', 'media', 'qiguang-hero-tall.jpg'))
    tallDims = jpegDimensions(tallBytes)
    const format = assertMediaSwapAsset(tallBytes, ASSET_REF)
    const store = createStagedAssetStore(path.join(container, 'staged-assets'))
    store.store(tallBytes)
    const assetHash = sha256(tallBytes)
    const stagedRelativePath = resolveAssetRefToRelativePath(ASSET_REF, target.location.path)
    stage(`素材暂存：format=${format} bytes=${tallBytes.length} hash=${assetHash.slice(0, 12)}… dims=${tallDims.width}x${tallDims.height} path=${stagedRelativePath}`)
    record.staging = { format, bytes: tallBytes.length, assetHash, dims: tallDims, stagedRelativePath }

    // ── 阶段 3：合法 MEDIA 候选（A 核心 + D 执行器）──────────────────────
    const sourceSlice = fs.readFileSync(path.join(project, target.location.path), 'utf8').slice(target.location.start, target.location.end)
    if (sourceSlice !== SHARED_VALUE) throw new Error(`媒体节点区间与值不一致：${JSON.stringify(sourceSlice)}`)
    const operation: MediaAssetSwapOperation = {
      id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
      before: sourceSlice, after: ASSET_REF,
      payload: { assetRef: ASSET_REF, assetHash },
    }
    const scope: ScopeDecision = {
      id: 'media-scope', version: 1,
      includedRefs: [target.id, ...impact.pageRefs],
      excludedRefs: [], protectedRefs: [],
      decidedBy: 'd-agent-rehearsal', decidedAt: new Date().toISOString(),
    }
    const pagePath = (ref: string) => ref.replace(/^page:/, '')
    const componentFor = (ref: string) => {
      const base = pagePath(ref).replace(/^\//, '')
      return base === '' ? 'Home.tsx' : `${base[0].toUpperCase()}${base.slice(1)}.tsx`
    }
    const contract: BrowserVerificationContract = {
      pages: impact.pageRefs.map(ref => ({ pageRef: ref, path: pagePath(ref), markerText: h1Of(project, componentFor(ref)) })),
      interactions: [{ pageRef: impact.pageRefs[0], role: 'link', name: '节目', expectedText: h1Of(project, 'Program.tsx') }],
    }
    candidate = createCandidate({
      projectRoot: project,
      candidateRoot: path.join(container, 'candidate'),
      artifactRoot: path.join(container, 'artifacts'),
      graph, scope, operations: [operation],
      executors: [mediaAssetSwapExecutor],
      readStagedAsset: store.readStagedAsset,
    })
    assertCandidateCurrent(candidate)
    record.candidate = {
      id: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
      candidateTreeDigest: candidate.candidateTreeDigest, modifiedPaths: candidate.modifiedPaths,
      artifactHash: sha256(fs.readFileSync(candidate.artifactPath!)),
    }
    record.scope = scope
    stage(`候选创建：id=${candidate.id} modified=[${candidate.modifiedPaths.join(', ')}]`)

    // ── 阶段 4：隔离预演（candidateRoot 构建服务）+ 四视口真实证据采集 ───
    // A 契约：apply 仅限「已验证并获批」的候选；预演隔离体 = createCandidate 产出的
    // candidateRoot（补丁已应用的隔离 worktree），直接构建服务，无需提前 apply。
    const previewRoot = candidate.candidateRoot!
    stage(`隔离预演：candidateRoot（补丁已应用）modified=[${candidate.modifiedPaths.join(', ')}] candidateTreeDigest=${candidate.candidateTreeDigest.slice(0, 10)}…`)

    // Vite 工程须先构建再静态服务（serveStatic 不做 TSX 转换）
    const viteJs = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
    const build = (cwd: string, outDirArg: string) => {
      const result = spawnSync(process.execPath, [viteJs, 'build', '--outDir', outDirArg, '--emptyOutDir'], { cwd, stdio: 'pipe', env: { ...process.env, NO_COLOR: '1' } })
      if (result.status !== 0) throw new Error(`vite build 失败（${cwd}）：${(result.stderr ?? result.stdout)?.toString().slice(0, 600)}`)
    }
    const distBaseline = path.join(container, 'dist-baseline')
    const distCandidate = path.join(container, 'dist-candidate')
    // 基线构建在一次性副本中进行：apply 的目标就是 candidate.projectRoot（原工程），
    // 原工程必须保持干净（junction node_modules 会成为 untracked 污染）
    const baselineSrc = path.join(container, 'baseline-src')
    fs.cpSync(project, baselineSrc, { recursive: true, filter: source => !source.includes(`${path.sep}node_modules`) })
    linkDeps(baselineSrc)
    linkDeps(previewRoot)
    build(baselineSrc, distBaseline)
    // candidateRoot 无 public 之外的差异；构建其自身源码（引用已指向替换资产）
    build(previewRoot, distCandidate)
    // 负例 non-target-image：真实修改候选产物中一个非目标图片的引用，
    // 验证「仅遮蔽目标媒体」的双端对照能发现非目标变更并拒绝审批
    if (negative === 'non-target-image') {
      let patched = 0
      const walkDist = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { walkDist(full); continue }
          if (!/\.(html|js|css)$/.test(entry.name)) continue
          const content = fs.readFileSync(full, 'utf8')
          if (content.includes('/media/qiguang-home-local.jpg')) {
            fs.writeFileSync(full, content.replaceAll('/media/qiguang-home-local.jpg', '/media/qiguang-archive.jpg'))
            patched += 1
          }
        }
      }
      walkDist(distCandidate)
      stage(`负例 non-target-image：候选 dist 非目标图片引用已改（${patched} 个文件，home-local→archive）`)
    }
    const baselineServer = await serveStatic(distBaseline, 0)
    const candidateServer = await serveStatic(distCandidate, 0)
    servers.push(baselineServer, candidateServer)
    const baselinePort = (baselineServer.address() as { port: number }).port
    const candidatePort = (candidateServer.address() as { port: number }).port
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      let errorSink: string[] = []
      page.on('pageerror', error => errorSink.push(String(error)))
      for (const viewport of projectPreviewViewports) {
        const name = viewport.name ?? `${viewport.width}x${viewport.height}`
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        // 候选端观测
        const candidateUrl = `http://127.0.0.1:${candidatePort}/`
        const candidateErrors: string[] = []
        errorSink = candidateErrors
        await page.goto(candidateUrl, { waitUntil: 'networkidle' })
        const img = page.locator('img[data-consumer="shared-hero"]')
        await img.waitFor({ state: 'visible' })
        const obs = await img.evaluate(element => {
          const image = element as HTMLImageElement
          const rect = image.getBoundingClientRect()
          const style = getComputedStyle(image)
          return {
            currentSrc: image.currentSrc, srcAttr: image.getAttribute('src') ?? '',
            loaded: image.complete && image.naturalWidth > 0,
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
            renderedBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            objectFit: style.objectFit, objectPosition: style.objectPosition,
          }
        })
        const pngPath = path.join(outDir, `${name}.png`)
        await img.screenshot({ path: pngPath })
        const candidateMatchCount = await page.locator(`img[src="${ASSET_REF}"]`).count()
        const candidateMarker = h1Of(previewRoot, 'Home.tsx')
        const candidateMarkerVisible = (await page.locator('h1').first().innerText()).includes(candidateMarker)
        observations.push({
          viewport: { name, width: viewport.width, height: viewport.height },
          pageUrl: candidateUrl, selector: 'img[data-consumer="shared-hero"]', assetRef: ASSET_REF,
          currentSrc: obs.currentSrc, matchCount: candidateMatchCount, loaded: obs.loaded,
          naturalWidth: obs.naturalWidth, naturalHeight: obs.naturalHeight,
          renderedBox: obs.renderedBox, objectFit: obs.objectFit, objectPosition: obs.objectPosition,
          screenshotSha256: sha256(fs.readFileSync(pngPath)), errors: candidateErrors,
        })
        // 基线端观测 + 双端对照
        const baselineUrl = `http://127.0.0.1:${baselinePort}/`
        const baselineErrors: string[] = []
        errorSink = baselineErrors
        await page.goto(baselineUrl, { waitUntil: 'networkidle' })
        const baselineImg = page.locator('img[data-consumer="shared-hero"]')
        await baselineImg.waitFor({ state: 'visible' })
        const baselineObs = await baselineImg.evaluate(element => {
          const image = element as HTMLImageElement
          return { currentSrc: image.currentSrc, loaded: image.complete && image.naturalWidth > 0 }
        })
        const baselinePng = path.join(outDir, `${name}-baseline.png`)
        await baselineImg.screenshot({ path: baselinePng })
        const baselineMatchCount = await page.locator(`img[src="${SHARED_VALUE}"]`).count()
        // 双端遮蔽 DOM 快照（mask 掉 img src 后整树 innerHTML 的 sha256）
        // 仅遮蔽本次操作涉及的目标媒体；其余图片保持真实 src 参与双端比较，
        // 使非目标图片的真实变更必然导致快照摘要不一致
        const maskSnapshot = async (url: string): Promise<string> => {
          await page.goto(url, { waitUntil: 'networkidle' })
          return page.evaluate(([mask, targetPaths]) => {
            const root = document.getElementById('root')
            const clone = root?.cloneNode(true) as HTMLElement | null
            clone?.querySelectorAll('img').forEach(image => {
              const src = image.getAttribute('src') ?? ''
              if (targetPaths.some(target => src.includes(target))) image.setAttribute('src', mask)
            })
            return clone?.innerHTML ?? ''
          }, ['<masked>', [SHARED_VALUE, ASSET_REF]] as const)
        }
        const snapshotSha = (snapshot: string): string => createHash('sha256').update(snapshot).digest('hex')
        const baselineSnapshot = await maskSnapshot(baselineUrl)
        const candidateSnapshot = await maskSnapshot(candidateUrl)
        const baselineMasked = { digest: snapshotSha(baselineSnapshot), snapshot: baselineSnapshot }
        const candidateMasked = { digest: snapshotSha(candidateSnapshot), snapshot: candidateSnapshot }
        fullSnapshots.push({ name, baseline: baselineSnapshot, candidate: candidateSnapshot })
        // 真实交互：真实点击合同声明的「节目」链接（负例模式改为真实点击「购票」，
        // 观测仍来自浏览器实际结果，如实记录、不回填）
        const clickAndCheck = async (baseUrl: string): Promise<{ passed: boolean; landedH1: string }> => {
          await page.goto(baseUrl, { waitUntil: 'networkidle' })
          const linkName = negative === 'wrong-interaction' ? '购票' : contract.interactions[0].name
          await page.getByRole(contract.interactions[0].role, { name: linkName, exact: true }).click()
          // 等待 h1 内容离开源页 marker（SPA 路由切换 + 目标页渲染完成的可判定信号）；
          // 负例（点击错误链接）同样会落到真实页面，观测值如实记录
          await page.waitForFunction(marker => {
            const text = document.querySelector('h1')?.textContent ?? ''
            return text.trim().length > 0 && !text.includes(marker)
          }, contract.pages[0].markerText, { timeout: 10_000 }).catch(() => undefined)
          const landedH1 = (await page.locator('h1').first().innerText().catch(() => '')).trim()
          interactionLog.push({ linkName, url: page.url(), landedH1 })
          return { passed: landedH1.includes(contract.interactions[0].expectedText), landedH1 }
        }
        const baselineInteraction = await clickAndCheck(baselineUrl)
        const candidateInteraction = await clickAndCheck(candidateUrl)
        // Scope 观测：逐页从基线/候选浏览器分别采集真实 marker 计数、真实 img src
        // 与真实布局状态（横向溢出 / 目标图片可见性 / 容器边界）
        let homeBaselineProbe: { markerCount: number; heroSrc: string } | undefined
        let homeCandidateProbe: { markerCount: number; heroSrc: string } | undefined
        for (const contractPage of contract.pages) {
          const probe = async (port: number) => {
            await page.goto(`http://127.0.0.1:${port}${contractPage.path === '/' ? '/' : contractPage.path}`, { waitUntil: 'networkidle' })
            const markerCount = await page.locator('h1', { hasText: contractPage.markerText }).count()
            const heroSrc = await page.locator('img[data-consumer="shared-hero"]').first().getAttribute('src').catch(() => null) ?? ''
            const layout = await page.evaluate(() => {
              const doc = document.documentElement
              const hero = document.querySelector('img[data-consumer="shared-hero"]')
              const rect = hero?.getBoundingClientRect()
              const container = (hero?.closest('[data-container]') ?? hero?.parentElement)?.getBoundingClientRect() ?? null
              return {
                scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
                horizontalOverflow: doc.scrollWidth > doc.clientWidth,
                heroVisible: !!rect && rect.width > 0 && rect.height > 0,
                heroInViewport: !!rect && rect.left >= 0 && rect.right <= doc.clientWidth,
                containerInViewport: !!container && container.left >= 0 && container.right <= doc.clientWidth,
              }
            })
            return { markerCount, heroSrc, layout }
          }
          const baseline = await probe(baselinePort)
          const candidate = await probe(candidatePort)
          if (contractPage.pageRef === contract.pages[0].pageRef) { homeBaselineProbe = baseline; homeCandidateProbe = candidate }
          scopeProbes.push({ pageRef: contractPage.pageRef, viewport: { name, width: viewport.width, height: viewport.height }, baseline, candidate })
        }
        dualViewports.push({
          viewport: { name, width: viewport.width, height: viewport.height },
          candidate: {
            // 全部来自本视口真实观测：首页 marker 计数 + hero 已加载可见
            worksPageReached: obs.loaded && candidateMarkerVisible, markerVisible: candidateMarkerVisible,
            markerMatchCount: homeCandidateProbe?.markerCount ?? 0,
          },
          baseline: {
            // 全部来自基线浏览器真实观测（不复用候选值）
            pageUrl: baselineUrl, worksPageReached: baselineObs.loaded && (homeBaselineProbe?.markerCount ?? 0) >= 1,
            markerVisible: (homeBaselineProbe?.markerCount ?? 0) >= 1, markerMatchCount: homeBaselineProbe?.markerCount ?? 0,
            imageFound: baselineObs.loaded, imageMatchCount: baselineMatchCount,
            currentSrc: baselineObs.currentSrc, screenshotSha256: sha256(fs.readFileSync(baselinePng)),
            errors: baselineErrors,
          },
          maskedComparison: {
            matched: baselineMasked.digest === candidateMasked.digest,
            baselineDigest: baselineMasked.digest, candidateDigest: candidateMasked.digest,
            baselineSnapshot: baselineMasked.snapshot.slice(0, 4000), candidateSnapshot: candidateMasked.snapshot.slice(0, 4000),
            maskedOperationIds: [operation.id],
          },
          interaction: {
            baselinePassed: baselineInteraction.passed, candidatePassed: candidateInteraction.passed,
            // 路由身份只由该侧真实落点观测支撑：到达期望 marker → verified，否则 wrong-route
            baselineRouteIdentity: (baselineInteraction.passed ? 'verified' : 'wrong-route') as 'verified' | 'wrong-route',
            candidateRouteIdentity: (candidateInteraction.passed ? 'verified' : 'wrong-route') as 'verified' | 'wrong-route',
          },
          layout: { horizontalOverflow: homeCandidateProbe?.layout.horizontalOverflow ?? false },
          runtimeState: 'home-ready', errors: [], warnings: [],
        })
      }
      const report = buildMediaViewportEvidenceReport({
        browser: { name: 'chromium' },
        candidate: { candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest },
        targetRef: target.id,
        observations,
      })
      const summary = mediaEvidenceSummary(report)
      evidenceReportSha = mediaViewportEvidenceSha256(report)
      const dual: MediaDualEndpointCollection = { capturedAt: new Date().toISOString(), viewports: dualViewports }
      dualSha = mediaDualEndpointSha256(dual)
      fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify({ report, sha256: evidenceReportSha, summary }, null, 2))
      fs.writeFileSync(path.join(outDir, 'dual.json'), JSON.stringify({ collection: dual, sha256: dualSha }, null, 2))
      fs.writeFileSync(path.join(outDir, 'scope-probes.json'), JSON.stringify({ probes: scopeProbes }, null, 2))
      record.interactions = interactionLog
      // per-viewport baseline comparison artifacts（attestBrowserExecution 要求 schemaVersion:1 + 全量快照可复算 sha256）
      comparisonArtifacts = dualViewports.map((view, index) => {
        const artifact = {
          schemaVersion: 1, route: '/',
          viewport: { width: view.viewport.width, height: view.viewport.height },
          baselineSnapshot: fullSnapshots[index].baseline,
          candidateSnapshot: fullSnapshots[index].candidate,
          maskedOperationIds: view.maskedComparison.maskedOperationIds,
        }
        const artifactPath = path.join(outDir, `comparison-${view.viewport.name}.json`)
        fs.writeFileSync(artifactPath, JSON.stringify(artifact))
        return { name: view.viewport.name, artifactPath, artifactHash: sha256(fs.readFileSync(artifactPath)) }
      })
      record.viewportEvidence = {
        summary, reportSha256: evidenceReportSha, dualSha256: dualSha,
        viewports: observations.map(o => `${o.viewport.name}:${o.naturalWidth}x${o.naturalHeight}@${o.objectFit}`),
        maskedAllMatched: dualViewports.every(v => v.maskedComparison.matched),
        interactionsPassed: dualViewports.every(v => v.interaction.baselinePassed && v.interaction.candidatePassed),
      }
      stage(`四视口证据：summary=${summary} reportSha=${evidenceReportSha.slice(0, 12)}… dualSha=${dualSha.slice(0, 12)}…`)
      if (summary !== 'pass') throw new Error(`四视口证据 summary=${summary}，拒绝进入 Approval`)
    } finally {
      await browser.close()
    }

    // ── 阶段 4b：七项断言由真实观测计算（任何一项不能充分证明即 fail-closed）──
    const probeFailures = scopeProbes.flatMap(probe => {
      const failures: string[] = []
      if (probe.baseline.markerCount < 1) failures.push(`${probe.pageRef}@${probe.viewport.name} 基线 marker 缺失`)
      if (probe.candidate.markerCount < 1) failures.push(`${probe.pageRef}@${probe.viewport.name} 候选 marker 缺失`)
      if (!probe.baseline.heroSrc.includes(SHARED_VALUE)) failures.push(`${probe.pageRef}@${probe.viewport.name} 基线 hero 未指向原媒体（实际 ${probe.baseline.heroSrc}）`)
      if (!probe.candidate.heroSrc.includes(ASSET_REF)) failures.push(`${probe.pageRef}@${probe.viewport.name} 候选 hero 未指向替换媒体（实际 ${probe.candidate.heroSrc}）`)
      return failures
    })
    // responsive-layout：3 页 × 4 视口候选端真实布局，逐条保留具体失败位置
    const layoutFailures: string[] = []
    for (const probe of scopeProbes) {
      const layout = probe.candidate.layout
      const at = `${probe.pageRef}@${probe.viewport.name}`
      if (layout.horizontalOverflow) layoutFailures.push(`${at} 横向溢出（scrollWidth=${layout.scrollWidth} > clientWidth=${layout.clientWidth}）`)
      if (!layout.heroVisible) layoutFailures.push(`${at} 目标图片不可见（渲染盒为空）`)
      if (!layout.heroInViewport) layoutFailures.push(`${at} 目标图片越出视口横向边界`)
      if (!layout.containerInViewport) layoutFailures.push(`${at} 图片容器越出视口横向边界`)
    }
    const assert = (id: string, ok: boolean | undefined, detail: string): { id: string; result: EvidenceResult; detail: string } => ({
      id, result: ok === undefined ? 'not-run' : ok ? 'pass' : 'risk', detail,
    })
    const assertions = [
      assert('target-change',
        observations.length === projectPreviewViewports.length && observations.every(o => o.loaded && o.matchCount === 1 && new URL(o.currentSrc).pathname === ASSET_REF)
          && dualViewports.every(v => v.baseline.imageFound && v.baseline.imageMatchCount >= 1),
        `4/4 视口候选 img 已加载且唯一命中 ${ASSET_REF}，基端仍命中原媒体；负例观测数=${observations.filter(o => !(o.loaded && o.matchCount === 1)).length}`),
      assert('non-target-preserved',
        dualViewports.length === projectPreviewViewports.length && dualViewports.every(v => v.maskedComparison.matched),
        `双端 DOM 快照 4/4 视口 sha256 一致（仅遮蔽目标媒体 ${SHARED_VALUE}/${ASSET_REF}，其余图片真实 src 参与比较）；不一致视口=${dualViewports.filter(v => !v.maskedComparison.matched).map(v => v.viewport.name).join(',') || '无'}`),
      assert('scope-propagation',
        scopeProbes.length === contract.pages.length * projectPreviewViewports.length && probeFailures.length === 0,
        `逐页×逐视口双端真实采集 ${scopeProbes.length} 条（3 页×4 视口），基线=原媒体/候选=替换媒体/marker≥1；违规=${probeFailures.length} 条${probeFailures.length ? '：' + probeFailures.join('；') : ''}`),
      assert('interaction',
        dualViewports.length === projectPreviewViewports.length && dualViewports.every(v => v.interaction.baselinePassed && v.interaction.candidatePassed),
        `真实点击「${contract.interactions[0].name}」链接 4/4 视口双端到达「${contract.interactions[0].expectedText}」；失败视口=${dualViewports.filter(v => !v.interaction.baselinePassed || !v.interaction.candidatePassed).map(v => v.viewport.name).join(',') || '无'}`),
      assert('responsive-layout',
        scopeProbes.length === contract.pages.length * projectPreviewViewports.length && layoutFailures.length === 0,
        `3 页×4 视口候选端真实布局采集 ${scopeProbes.length} 条（横向溢出/目标图可见性/图片与容器边界）；失败 ${layoutFailures.length} 处${layoutFailures.length ? '：' + layoutFailures.join('；') : ''}`),
      assert('source-mapping',
        observations.length === projectPreviewViewports.length && tallDims !== undefined
          && observations.every(o => new URL(o.currentSrc).pathname === ASSET_REF && o.naturalWidth === tallDims!.width && o.naturalHeight === tallDims!.height),
        `候选 currentSrc pathname=${ASSET_REF} 且 4/4 视口 natural=${tallDims?.width}x${tallDims?.height} 与暂存资产 JPEG SOF 一致（sha256 ${assetHash.slice(0, 12)}…）`),
      assert('browser-errors',
        observations.every(o => (o.errors?.length ?? 0) === 0) && dualViewports.every(v => v.baseline.errors.length === 0),
        `双端 4/4 视口 pageerror=0；候选错误=${observations.reduce((n, o) => n + (o.errors?.length ?? 0), 0)} 基线错误=${dualViewports.reduce((n, v) => n + v.baseline.errors.length, 0)}`),
    ]
    record.assertions = assertions
    stage(`断言明细：${assertions.map(a => `${a.id}=${a.result}`).join(' ')}`)
    if (!negative) {
      const notPass = assertions.filter(a => a.result !== 'pass')
      if (notPass.length) throw new Error(`断言未全部充分证明，fail-closed 拒绝进入 Approval：${notPass.map(a => `${a.id}=${a.result}（${a.detail}）`).join('；')}`)
    }

    // ── 阶段 5：Approval + Apply + Rollback（A 公共生命周期真实接口）──────
    // 预演用的 node_modules junction 属于候选树"未经记录的文件变更"，apply 完整性校验前摘除
    const candidateNodeModules = path.join(candidate.candidateRoot!, 'node_modules')
    if (fs.existsSync(candidateNodeModules)) fs.unlinkSync(candidateNodeModules)
    // applyApprovedCandidate 的写入目标是 candidate.projectRoot（原工程本身）；
    // apply 前 readProjectSnapshot 要求工作树干净，因此 stage 4 未在原工程挂 node_modules。
    const applyGraph = analyzeProject(project)
    let applySession = recordSourceGraph(openSession('d3-apply', applyGraph.revision, 'Replace shared hero with portrait rehearsal asset', [], contract), applyGraph.id, applyGraph.revision.sourceDigest)
    applySession = stageCandidate(stageOperations(chooseScope(applySession, scope), [operation], [mediaAssetSwapExecutor]), candidate)
    // 用真实四视口结果登记正式 VerificationRun（attested，双端 sha 可追溯）
    // completedAt 与全部证据 capturedAt 使用同一时间戳：registerVerification 要求
    // capturedAt <= completedAt，逐条 new Date() 存在毫秒级竞态（pre-existing flake）
    const completedAt = new Date().toISOString()
    const evidence = observations.map((observation, index) => ({
      id: `evidence-${observation.viewport.name}`, checkId: `check-${index}`, result: 'pass' as const,
      capturedAt: completedAt, pageUrl: observation.pageUrl,
      viewport: { width: observation.viewport.width, height: observation.viewport.height },
      runtimeState: 'home-ready', elementRefs: [target.id],
      artifactPath: path.join(outDir, `${observation.viewport.name}.png`), artifactHash: observation.screenshotSha256!,
    }))
    const run: VerificationRun = {
      id: 'd3-media-run', candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
      scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
      candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint: applySession.projectRevision.runtimeFingerprint,
      startedAt: record.startedAt as string, completedAt,
      checks: projectPreviewViewports.map((viewport, index) => ({ id: `check-${index}`, route: '/', viewport: { width: viewport.width, height: viewport.height }, state: 'home-ready', description: 'Shared hero visible and swapped', mandatory: true })),
      assertions,
      verificationContractHash: verificationContractHash(contract),
      evidence,
      baselineComparisons: dualViewports.map((v, index) => ({
        route: '/', viewport: { width: v.viewport.width, height: v.viewport.height },
        baselineDigest: v.maskedComparison.baselineDigest, candidateDigest: v.maskedComparison.candidateDigest,
        maskedOperationIds: [operation.id], matched: v.maskedComparison.matched,
        artifactPath: comparisonArtifacts[index].artifactPath, artifactHash: comparisonArtifacts[index].artifactHash,
      })),
      scopeObservations: contract.pages.flatMap(page =>
        projectPreviewViewports.map(viewport => {
          const probe = scopeProbes.find(item => item.pageRef === page.pageRef && item.viewport.width === viewport.width && item.viewport.height === viewport.height)!
          return {
            pageRef: page.pageRef, route: page.path, viewport: { width: viewport.width, height: viewport.height },
            markerText: page.markerText, baselineMarkerVisible: probe.baseline.markerCount >= 1, candidateMarkerVisible: probe.candidate.markerCount >= 1,
            baselineMarkerMatchCount: probe.baseline.markerCount, candidateMarkerMatchCount: probe.candidate.markerCount,
            // 路由身份只由该侧真实 marker 观测支撑
            baselineRouteIdentity: (probe.baseline.markerCount >= 1 ? 'verified' : 'missing') as 'verified' | 'missing',
            candidateRouteIdentity: (probe.candidate.markerCount >= 1 ? 'verified' : 'missing') as 'verified' | 'missing',
            operations: candidate.operations.map(op => {
              const expectation = expectedTextForScope(scope, page.pageRef, op.before, op.after)
              return {
                operationId: op.id, expectedBaselineText: op.before, expectedCandidateText: expectation.candidateText,
                baselineValues: [probe.baseline.heroSrc], candidateValues: [probe.candidate.heroSrc],
              }
            }),
          }
        })),
      interactionObservations: dualViewports.map(v => ({
        interactionIndex: 0, pageRef: contract.pages[0].pageRef, route: '/',
        viewport: { width: v.viewport.width, height: v.viewport.height },
        role: 'link' as const, name: contract.interactions[0].name, expectedText: contract.interactions[0].expectedText,
        baselineRouteIdentity: (v.interaction.baselinePassed ? 'verified' : 'wrong-route') as 'verified' | 'wrong-route',
        candidateRouteIdentity: (v.interaction.candidatePassed ? 'verified' : 'wrong-route') as 'verified' | 'wrong-route',
        baselinePassed: v.interaction.baselinePassed, candidatePassed: v.interaction.candidatePassed,
      })),
      status: 'incomplete',
    }
    const recordPath = path.join(outDir, 'browser-execution.json')
    fs.writeFileSync(recordPath, JSON.stringify({
      schemaVersion: 4, executor: 'playwright', completed: true, runId: run.id, candidateId: candidate.id,
      scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
      baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
      runtimeFingerprint: run.runtimeFingerprint, verificationContractHash: run.verificationContractHash,
      viewports: projectPreviewViewports.map(v => ({ name: v.name, width: v.width, height: v.height })),
      checks: run.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: true })),
      baselineComparisons: run.baselineComparisons.map((item, index) => ({ ...item, artifactPath: path.basename(comparisonArtifacts[index].artifactPath) })), scopeObservations: run.scopeObservations,
      interactionObservations: run.interactionObservations, assertions: run.assertions,
      evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })),
      artifacts: run.evidence.map(item => ({ checkId: item.checkId, path: path.basename(item.artifactPath!), sha256: item.artifactHash })),
    }))
    // 负例 2：篡改对照工件后 attestBrowserExecution 必须拒绝
    if (negative === 'tamper-evidence') {
      fs.appendFileSync(comparisonArtifacts[0].artifactPath, '\n/* d3 tamper probe */')
      stage(`负例 tamper-evidence：已篡改 ${path.basename(comparisonArtifacts[0].artifactPath)}`)
    }
    let attested: ReturnType<typeof attestBrowserExecution>
    try {
      attested = attestBrowserExecution(run, recordPath)
    } catch (attestError) {
      if (negative === 'tamper-evidence') {
        const observedError = String(attestError instanceof Error ? attestError.message : attestError)
        if (!NEGATIVE_PATTERNS['tamper-evidence'].test(observedError)) throw new Error(`负例拒绝原因不符合预期：${observedError}`)
        record.negativeResult = { mode: negative, expectedRejection: 'attestBrowserExecution 拒绝被篡改的对照工件（hash mismatch）', observedError }
        record.verdict = 'NEGATIVE-PASS'
        record.completedAt = new Date().toISOString()
        fs.writeFileSync(path.join(outDir, 'd3-rehearsal-record.json'), JSON.stringify(record, null, 2))
        stage(`NEGATIVE-PASS：篡改后 attest 被拒（${observedError}）`)
        return
      }
      throw attestError
    }
    if (negative === 'tamper-evidence') throw new Error('负例未生效：篡改 comparison artifact 后 attest 竟通过')
    stage(`attest：run=${attested.id} contractHash=${attested.verificationContractHash.slice(0, 10)}…`)
    // 负例 1：真实点击「购票」链接导致 interaction 断言非 pass，正式审批必须被拒
    try {
      applySession = approve(registerVerification(applySession, attested), { candidateId: candidate.id, verificationRunId: attested.id, by: 'd-agent-rehearsal', at: new Date().toISOString() })
    } catch (approvalError) {
      if (negative === 'wrong-interaction' || negative === 'non-target-image') {
        const observedError = String(approvalError instanceof Error ? approvalError.message : approvalError)
        const assertionId = negative === 'wrong-interaction' ? 'interaction' : 'non-target-preserved'
        const assertionResult = (record.assertions as Array<{ id: string, result: string }>).find(a => a.id === assertionId)?.result
        if (assertionResult === 'pass') throw new Error(`负例断言校验失败：${assertionId} 仍为 pass，拒绝原因不成立（${observedError}）`)
        if (!NEGATIVE_PATTERNS[negative].test(observedError)) throw new Error(`负例拒绝原因不符合预期：${observedError}`)
        record.negativeResult = { mode: negative, expectedRejection: `${assertionId} 断言非 pass（实际 ${assertionResult}）→ 审批拒绝`, observedError }
        record.verdict = 'NEGATIVE-PASS'
        record.completedAt = new Date().toISOString()
        fs.writeFileSync(path.join(outDir, 'd3-rehearsal-record.json'), JSON.stringify(record, null, 2))
        stage(`NEGATIVE-PASS：${assertionId}=${assertionResult} 导致审批被拒（${observedError}）`)
        return
      }
      throw approvalError
    }
    if (negative === 'wrong-interaction' || negative === 'non-target-image') throw new Error('负例未生效：浏览器观测被破坏后审批竟通过')
    stage(`Approval：run=${attested.id} 状态=${applySession.status}`)

    // applyApprovedCandidateWithRecovery 返回 ApplyRecoveryOutcome { session }，applied 已记录其中
    applySession = applyApprovedCandidateWithRecovery(applySession, candidate).session
    const swappedFile = fs.readFileSync(path.join(project, target.location.path), 'utf8')
    const assetWritten = fs.existsSync(path.join(project, stagedRelativePath))
    const assetBytesMatch = assetWritten && sha256(fs.readFileSync(path.join(project, stagedRelativePath))) === assetHash
    const afterApplyDigest = digestTrackedTree(project)
    record.applyRollback = {
      beforeDigest: projectBaselineDigest, afterApplyDigest,
      assetWritten, assetBytesMatch, sourceRefReplaced: swappedFile.includes(ASSET_REF),
      appliedCommit: applySession.applied?.commit,
    }
    stage(`Apply：引用已替换=${swappedFile.includes(ASSET_REF)} 新资产字节一致=${assetBytesMatch} digest ${projectBaselineDigest.slice(0, 8)}…→${afterApplyDigest.slice(0, 8)}…`)
    if (!swappedFile.includes(ASSET_REF) || !assetBytesMatch) throw new Error('Apply 结果核对失败')

    const rollback = rollbackAppliedCandidate(applySession, candidate)
    const afterRollbackDigest = digestTrackedTree(project)
    const restored = afterRollbackDigest === projectBaselineDigest
    Object.assign(record.applyRollback as Record<string, unknown>, { afterRollbackDigest, restored, rolledBackAt: rollback.rolledBackAt })
    stage(`Rollback：digest 恢复=${restored}（${afterRollbackDigest.slice(0, 8)}…）`)
    if (!restored) throw new Error('Rollback 未恢复原基线摘要')

    record.coreSha = git(process.cwd(), 'rev-parse', 'HEAD')
    record.labSha = git(labRoot, 'rev-parse', 'HEAD')
    record.outDir = outDir
    record.verdict = 'PASS'
    record.completedAt = new Date().toISOString()
    fs.writeFileSync(path.join(outDir, 'd3-rehearsal-record.json'), JSON.stringify(record, null, 2))
    stage(`verdict=PASS 记录→${path.join(outDir, 'd3-rehearsal-record.json')}`)
  } finally {
    for (const server of servers) {
      try { await new Promise<void>(resolve => (server as import('node:http').Server).close(() => resolve())) } catch { /* 已关闭 */ }
    }
    // 关键：Windows 下 rmSync(recursive) 会沿 junction 递归删除其目标——
    // 容器内所有指向本仓库 node_modules 的 junction 必须先摘除，否则依赖会被清空
    for (const tree of [path.join(container, 'project'), path.join(container, 'baseline-src'), candidate?.candidateRoot].filter((item): item is string => typeof item === 'string')) {
      try { fs.unlinkSync(path.join(tree, 'node_modules')) } catch { /* 无 junction */ }
    }
    if (candidate) { try { removeCandidate(candidate) } catch { /* 候选目录随容器清理 */ } }
    try { removeTree(container) } catch { /* Windows 句柄瞬时占用，保留现场供追溯 */ }
  }
}

main().then(() => undefined, error => {
  record.verdict = 'FAILED'
  record.failure = String(error instanceof Error ? (error.stack ?? error.message) : error)
  record.completedAt = new Date().toISOString()
  try { fs.writeFileSync(path.join(outDir, 'd3-rehearsal-record.json'), JSON.stringify(record, null, 2)) } catch { /* 诊断尽力落盘 */ }
  console.error('[d3] FAILED:', error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
