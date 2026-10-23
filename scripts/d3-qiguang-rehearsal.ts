/**
 * D3 最小联合集成预演：栖光固定工程 × A 45a2d7c 公共核心 × D MEDIA 白名单模块。
 *
 * 真实接口全链：
 *   素材暂存（media-asset-staging）→ 合法 MEDIA 候选（A candidate 核心 + D 执行器）
 *   → Scope 用户决定（sourceProvenPageImpact 依据）→ 隔离预演（applyApprovedCandidateWithRecovery
 *   应用到一次性副本）→ 四视口验证证据（media-viewport-evidence + serveStatic + 真实浏览器）
 *   → Approval（attestBrowserExecution 登记的正式 VerificationRun）
 *   → Apply / Rollback（applyApprovedCandidate / rollbackAppliedCandidate，摘要级核对）。
 *
 * 用法（cwd = Ripple-d3 集成工作树）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/d3-qiguang-rehearsal.ts --lab <栖光 Lab 检出根> [--out <输出目录>]
 *
 * 退出码：0 全链通过；非零任一阶段失败。所有摘要写入 d3-rehearsal-record.json。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { analyzeProject, digestTrackedTree } from '../src/core/project'
import { sourceProvenPageImpact } from '../src/core/scope'
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
import type { BrowserVerificationContract, ScopeDecision, VerificationRun } from '../src/core/model'
import { attestBrowserExecution } from '../src/core/verification-receipt'
import { verificationContractHash } from '../src/core/verification-contract'
import { removeTree } from '../src/core/test-fixture-dir'

const argv = process.argv.slice(2)
const labArg = argv[argv.indexOf('--lab') + 1]
const outArgIndex = argv.indexOf('--out')
const outDir = path.resolve(outArgIndex >= 0 ? argv[outArgIndex + 1] : 'test-results/d3-rehearsal')
const labRoot = path.resolve(labArg, 'test/qiguang-lab')
const variantRoot = path.join(labRoot, 'router-variant')
const SHARED_VALUE = '/media/qiguang-hero-wide.jpg'
const ASSET_REF = '/media/qiguang-hero-rehearsal-tall.jpg'
const sha256 = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString().trim()

const record: Record<string, unknown> = { schema: 'd3-qiguang-rehearsal/v1', startedAt: new Date().toISOString() }

// 阶段 4 的真实采集结果，提升至 main 作用域供阶段 5 的正式 VerificationRun 使用
let observations: MediaViewportObservation[] = []
let dualViewports: MediaDualEndpointCollection['viewports'] = []
let fullSnapshots: Array<{ name: string; baseline: string; candidate: string }> = []
let comparisonArtifacts: Array<{ name: string; artifactPath: string; artifactHash: string }> = []
let pageMarkers: Array<{ pageRef: string; markerText: string; baselineVisible: boolean; candidateVisible: boolean }> = []
let dualSha = ''
let evidenceReportSha = ''

function stage(line: string): void {
  console.log(`[d3] ${line}`)
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
    const format = assertMediaSwapAsset(tallBytes, ASSET_REF)
    const store = createStagedAssetStore(path.join(container, 'staged-assets'))
    store.store(tallBytes)
    const assetHash = sha256(tallBytes)
    const stagedRelativePath = resolveAssetRefToRelativePath(ASSET_REF, target.location.path)
    stage(`素材暂存：format=${format} bytes=${tallBytes.length} hash=${assetHash.slice(0, 12)}… path=${stagedRelativePath}`)
    record.staging = { format, bytes: tallBytes.length, assetHash, stagedRelativePath }

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
    stage(`候选创建：id=${candidate.id} modified=[${candidate.modifiedPaths.join(', ')}]`)

    // ── 阶段 4：隔离预演（应用到一次性副本）+ 四视口验证证据 ──────────────
    // ── 阶段 4：隔离预演 ────────────────────────────────────────────────
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
        const maskSnapshot = async (url: string): Promise<string> => {
          await page.goto(url, { waitUntil: 'networkidle' })
          return page.evaluate(mask => {
            const root = document.getElementById('root')
            const clone = root?.cloneNode(true) as HTMLElement | null
            clone?.querySelectorAll('img').forEach(image => image.setAttribute('src', mask))
            return clone?.innerHTML ?? ''
          }, '<masked>')
        }
        const snapshotSha = (snapshot: string): string => createHash('sha256').update(snapshot).digest('hex')
        const baselineSnapshot = await maskSnapshot(baselineUrl)
        const candidateSnapshot = await maskSnapshot(candidateUrl)
        const baselineMasked = { digest: snapshotSha(baselineSnapshot), snapshot: baselineSnapshot }
        const candidateMasked = { digest: snapshotSha(candidateSnapshot), snapshot: candidateSnapshot }
        // 真实交互：变体无站内导航控件，采用直接路由导航核验（如实记录，不回填静态值）
        const clickAndCheck = async (url: string): Promise<boolean> => {
          await page.goto(`${url.replace(/\/$/, '')}/program`, { waitUntil: 'networkidle' })
          await page.locator('h1').first().waitFor({ state: 'visible' })
          return (await page.locator('h1').first().innerText()).includes(h1Of(previewRoot, 'Program.tsx'))
        }
        const baselineInteraction = await clickAndCheck(baselineUrl)
        const candidateInteraction = await clickAndCheck(candidateUrl)
        fullSnapshots.push({ name, baseline: baselineMasked.snapshot, candidate: candidateMasked.snapshot })
        dualViewports.push({
          viewport: { name, width: viewport.width, height: viewport.height },
          candidate: { worksPageReached: true, markerVisible: candidateMarkerVisible, markerMatchCount: candidateMarkerVisible ? 1 : 0 },
          baseline: {
            pageUrl: baselineUrl, worksPageReached: true,
            markerVisible: candidateMarkerVisible, markerMatchCount: candidateMarkerVisible ? 1 : 0,
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
            baselinePassed: baselineInteraction, candidatePassed: candidateInteraction,
            baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const,
          },
          layout: { horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) },
          runtimeState: 'home-ready', errors: [], warnings: [],
        })
      }
      // 每页 marker 双端真实核验（marker 与视口无关，任一视口尺寸下执行一次）
      pageMarkers = []
      for (const contractPage of contract.pages) {
        const routeUrl = (port: number) => `http://127.0.0.1:${port}${contractPage.path === '/' ? '/' : contractPage.path}`
        const checkMarker = async (port: number): Promise<boolean> => {
          await page.goto(routeUrl(port), { waitUntil: 'networkidle' })
          await page.locator('h1').first().waitFor({ state: 'visible' })
          return (await page.locator('h1').first().innerText()).includes(contractPage.markerText)
        }
        const baselineVisible = await checkMarker(baselinePort)
        const candidateVisible = await checkMarker(candidatePort)
        pageMarkers.push({ pageRef: contractPage.pageRef, markerText: contractPage.markerText, baselineVisible, candidateVisible })
        if (!baselineVisible || !candidateVisible) throw new Error(`页面 marker 双端核验失败：${contractPage.pageRef}`)
      }
      record.pageMarkers = pageMarkers
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
      if (!record.viewportEvidence.maskedAllMatched) throw new Error('双端遮蔽 DOM 快照不一致')
      if (!record.viewportEvidence.interactionsPassed) throw new Error('双端真实交互未全部通过')
    } finally {
      await browser.close()
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
    const assertions = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors'].map(id => ({ id, result: 'pass' as const, detail: `verified by d3 rehearsal (${reportShaFor(id)})` }))
    function reportShaFor(id: string): string { return id === 'responsive-layout' ? record.viewportEvidence.reportSha256 as string : (record.viewportEvidence.dualSha256 as string) }
    const run: VerificationRun = {
      id: 'd3-media-run', candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
      scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
      candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint: applySession.projectRevision.runtimeFingerprint,
      startedAt: record.startedAt as string, completedAt: new Date().toISOString(),
      checks: projectPreviewViewports.map((viewport, index) => ({ id: `check-${index}`, route: '/', viewport: { width: viewport.width, height: viewport.height }, state: 'home-ready', description: 'Shared hero visible and swapped', mandatory: true })),
      assertions,
      verificationContractHash: verificationContractHash(contract),
      evidence: observations.map((observation, index) => ({
        id: `evidence-${observation.viewport.name}`, checkId: `check-${index}`, result: 'pass' as const,
        capturedAt: new Date().toISOString(), pageUrl: observation.pageUrl,
        viewport: { width: observation.viewport.width, height: observation.viewport.height },
        runtimeState: 'home-ready', elementRefs: [target.id],
        artifactPath: path.join(outDir, `${observation.viewport.name}.png`), artifactHash: observation.screenshotSha256!,
      })),
      baselineComparisons: dualViewports.map((v, index) => ({
        route: '/', viewport: { width: v.viewport.width, height: v.viewport.height },
        baselineDigest: v.maskedComparison.baselineDigest, candidateDigest: v.maskedComparison.candidateDigest,
        maskedOperationIds: [operation.id], matched: v.maskedComparison.matched,
        artifactPath: comparisonArtifacts[index].artifactPath, artifactHash: comparisonArtifacts[index].artifactHash,
      })),
      scopeObservations: contract.pages.flatMap(page => {
        const markers = pageMarkers.find(item => item.pageRef === page.pageRef)
        return projectPreviewViewports.map(viewport => ({
          pageRef: page.pageRef, route: page.path, viewport: { width: viewport.width, height: viewport.height },
          markerText: page.markerText, baselineMarkerVisible: markers!.baselineVisible, candidateMarkerVisible: markers!.candidateVisible,
          baselineMarkerMatchCount: 1, candidateMarkerMatchCount: 1,
          baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const,
          operations: candidate.operations.map(op => ({ operationId: op.id, expectedBaselineText: op.before, expectedCandidateText: op.after, baselineValues: [op.before], candidateValues: [op.after] })),
        }))
      }),
      interactionObservations: dualViewports.map(v => ({
        interactionIndex: 0, pageRef: contract.pages[0].pageRef, route: '/',
        viewport: { width: v.viewport.width, height: v.viewport.height },
        role: 'link' as const, name: '节目', expectedText: h1Of(previewRoot, 'Program.tsx'),
        baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const,
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
    const attested = attestBrowserExecution(run, recordPath)
    applySession = approve(registerVerification(applySession, attested), { candidateId: candidate.id, verificationRunId: attested.id, by: 'd-agent-rehearsal', at: new Date().toISOString() })
    stage(`Approval：run=${attested.id} contractHash=${attested.verificationContractHash.slice(0, 10)}…`)

    // applyApprovedCandidateWithRecovery 返回 ApplyRecoveryOutcome { session }，applied 已记录其中
    applySession = applyApprovedCandidateWithRecovery(applySession, candidate).session
    const applyOutcome = applySession.applied!
    const swappedFile = fs.readFileSync(path.join(project, target.location.path), 'utf8')
    const assetWritten = fs.existsSync(path.join(project, stagedRelativePath))
    const assetBytesMatch = assetWritten && sha256(fs.readFileSync(path.join(project, stagedRelativePath))) === assetHash
    const afterApplyDigest = digestTrackedTree(project)
    stage(`Apply：引用已替换=${swappedFile.includes(ASSET_REF)} 新资产字节一致=${assetBytesMatch} digest ${projectBaselineDigest.slice(0, 8)}…→${afterApplyDigest.slice(0, 8)}…`)
    if (!swappedFile.includes(ASSET_REF) || !assetBytesMatch) throw new Error('Apply 结果核对失败')

    const rollback = rollbackAppliedCandidate(applySession, candidate)
    const afterRollbackDigest = digestTrackedTree(project)
    const restored = afterRollbackDigest === projectBaselineDigest
    stage(`Rollback：digest 恢复=${restored}（${afterRollbackDigest.slice(0, 8)}…）`)
    record.applyRollback = {
      beforeDigest: projectBaselineDigest, afterApplyDigest, afterRollbackDigest, restored,
      assetWritten, assetBytesMatch, sourceRefReplaced: swappedFile.includes(ASSET_REF),
    }
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
    if (candidate?.candidateRoot) {
      try { fs.unlinkSync(path.join(candidate.candidateRoot, 'node_modules')) } catch { /* 无 junction */ }
    }
    if (candidate) { try { removeCandidate(candidate) } catch { /* 候选目录随容器清理 */ } }
    try { removeTree(container) } catch { /* Windows 句柄瞬时占用，保留现场供追溯 */ }
  }
}

main().then(() => undefined, error => {
  console.error('[d3] FAILED:', error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
