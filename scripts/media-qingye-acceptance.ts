/**
 * 青野真实 MEDIA asset-swap 纵向闭环验收（B 侧）。
 *
 * 用法（在 Ripple 仓库根目录）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/media-qingye-acceptance.ts <qingyeRoot> <workDir>
 * 环境：
 *   MEDIA_SWAP_IMAGE_URL — 替换用真实图片 URL（默认取青野 p002 的 pexels 原图）
 *
 * 验收链（全部真实，无预设 Fixture）：
 *   青野源码 analyzeProject 定位媒体节点（动态筛选商品图 fail-closed 不可证明，
 *   选择可证明到作品页的分类图目标，确定性/未解析关系如实记录）
 *   → 新图字节进内容寻址暂存 → B 执行器 plan → A 候选核心 createCandidate
 *   → 候选 worktree 构建（vite build）+ 原工程基线 worktree 构建（真实双端）
 *   → 双静态服务 → 四视口 Playwright 双端真实采集（候选端：加载/几何/截图；
 *      基线端：同一导航/marker/原图 currentSrc；双端：DOM 快照对照、真实点击交互）
 *   → VerificationRun 由双端真实观测构建（assertion 逐条真实计算，禁止硬编码 PASS）
 *   → 审批（真实证据门控）→ applyApprovedCandidate 应用同一补丁 → 校验树摘要 → rollback 恢复
 * 输出：<workDir>/acceptance.json（含双方 SHA、候选身份、证据哈希、每步结果）。
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProject, digestTrackedTree, readProjectSnapshot, trackedProjectFiles } from '../src/core/project'
import { assertCandidateCurrent, createCandidate, removeCandidate, type CandidateRecord } from '../src/core/candidate'
import { createStagedAssetStore } from '../src/core/media-asset-staging'
import { mediaAssetSwapExecutors } from '../src/core/media-asset-swap'
import { applyApprovedCandidate, rollbackAppliedCandidate } from '../src/core/apply'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from '../src/core/session'
import { expectedTextForPage, sourceProvenPageImpact } from '../src/core/scope'
import type { BrowserVerificationContract, EvidenceResult, ScopeDecision, VerificationAssertion, VerificationRun } from '../src/core/model'
import { attestBrowserExecution } from '../src/core/verification-receipt'
import { verificationContractHash } from '../src/core/verification-contract'
import {
  assetUrlMatches,
  mediaDualEndpointSha256,
  mediaEvidenceSummary,
  type MediaDualEndpointCollection,
  type MediaDualEndpointViewport,
  type MediaViewportEvidenceReport,
} from '../src/core/media-viewport-evidence'

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const rippleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) =>
  execFileSync(command, args, { cwd: options.cwd, stdio: 'pipe', timeout: options.timeoutMs ?? 600_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...(path.basename(command).endsWith('.cmd') ? { shell: true } : {}) }) as string

class AcceptanceError extends Error {
  constructor(message: string) { super(message); this.name = 'AcceptanceError' }
}

function serveStatic(rootDir: string, port: number): Promise<http.Server> {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (relative.split(/[\\/]/).includes('..')) { response.writeHead(404); response.end('not found'); return }
    if (!relative) relative = 'index.html'
    let absolute = path.join(rootDir, relative)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) absolute = path.join(rootDir, 'index.html')
    if (!fs.existsSync(absolute)) { response.writeHead(404); response.end('not found'); return }
    response.writeHead(200, { 'content-type': types[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream' })
    fs.createReadStream(absolute).pipe(response)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  // 本机冒烟支持 file:// 离线字节（CI 默认仍走真实 HTTP 下载）
  if (url.startsWith('file://')) {
    console.error('提示：使用 file:// 本地字节（非 CI 验收路径）')
    const bytes = new Uint8Array(fs.readFileSync(new URL(url)))
    if (!bytes.byteLength) throw new AcceptanceError('替换图片为空')
    return bytes
  }
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new AcceptanceError(`下载替换图片失败：HTTP ${response.status} ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength) throw new AcceptanceError('替换图片为空')
  return bytes
}

/** 真实页面契约：作品页唯一 marker「器物全集」，导航控件「商品专题」；
 *  页内真实交互：点击「茶器」筛选，期望「柴烧茶壶」出现且「素白陶碗」消失。 */
function contractFor(pageRef: string): BrowserVerificationContract {
  return {
    pages: [{ pageRef, path: '/', markerText: '器物全集', navigateBy: { role: 'button', name: '商品专题' } }],
    interactions: [{ pageRef, role: 'button', name: '茶器', expectedText: '柴烧茶壶' }],
  }
}

/**
 * 受信运行：VerificationRun 完全由双端真实采集数据（dual.json）驱动。
 * - checks/evidence：候选端真实运行态（渲染/溢出/加载），截图工件带 PNG 魔数校验；
 * - baselineComparisons：双端真实 DOM 快照（各自 digest），不复制同一摘要；
 * - scopeObservations / interactionObservations：双端真实 marker 与点击结果；
 * - assertions：七项逐条由真实数据计算，未验证项保持 unknown，禁止硬编码 PASS。
 */
function trustedRun(
  candidate: CandidateRecord,
  scope: ScopeDecision,
  pageRef: string,
  runtimeFingerprint: string,
  artifactRoot: string,
  mediaEvidence: { sha256: string; summary: string; dir: string; dualSha256: string },
  report: MediaViewportEvidenceReport,
  dual: MediaDualEndpointCollection,
): VerificationRun {
  fs.mkdirSync(artifactRoot, { recursive: true })
  if (mediaEvidence.summary !== 'pass') throw new AcceptanceError(`媒体 Evidence 未通过（${mediaEvidence.summary}），拒绝进入审批`)
  const contract = contractFor(pageRef)
  const operation = candidate.operations[0]
  if (!operation) throw new AcceptanceError('候选缺少操作记录')
  const checkName = (name: string) => `products-media-${name}`

  // 截图工件：候选端真实 PNG 复制进 artifactRoot 并校验魔数
  const screenshotArtifacts = report.observations.map(observation => {
    const source = path.join(mediaEvidence.dir, `${observation.viewport.name}.png`)
    if (!fs.existsSync(source)) throw new AcceptanceError(`缺少视口截图：${source}`)
    const target = path.join(artifactRoot, `${observation.viewport.name}.png`)
    fs.copyFileSync(source, target)
    const bytes = fs.readFileSync(target)
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AcceptanceError(`视口截图不是 PNG：${source}`)
    return { observation, path: target, sha256: sha256(bytes) }
  })

  const dualByName = new Map(dual.viewports.map(item => [item.viewport.name, item]))
  const viewportResult = (name: string): { result: 'pass' | 'risk' | 'failed-to-run'; state: string; overflow: boolean } => {
    const item = dualByName.get(name)
    if (!item) return { result: 'failed-to-run', state: 'navigation-failed', overflow: false }
    const loaded = item.runtimeState === 'rendered' && item.candidate.worksPageReached
    if (!loaded) return { result: 'failed-to-run', state: item.runtimeState, overflow: item.layout.horizontalOverflow }
    return item.layout.horizontalOverflow
      ? { result: 'risk', state: 'horizontal-overflow', overflow: true }
      : { result: 'pass', state: 'rendered', overflow: false }
  }

  const checks = screenshotArtifacts.map(({ observation }) => ({
    id: checkName(observation.viewport.name), route: '/', viewport: { width: observation.viewport.width, height: observation.viewport.height },
    state: viewportResult(observation.viewport.name).state,
    description: `Swapped category image loads at ${observation.viewport.width}x${observation.viewport.height}`,
    mandatory: true as const,
  }))

  // 双端 DOM 对照：artifact 内快照字符串与 digest 必须对应（attest 强校验）
  const baselineComparisons = dual.viewports.map(item => {
    const comparison = item.maskedComparison
    const viewport = { width: item.viewport.width, height: item.viewport.height }
    if (!comparison.baselineDigest || !comparison.candidateDigest) {
      return { route: '/', viewport, maskedOperationIds: comparison.maskedOperationIds, matched: false, reason: comparison.reason }
    }
    const comparisonPath = path.join(artifactRoot, `${checkName(item.viewport.name)}-baseline.json`)
    const comparisonBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1, route: '/', viewport,
      baselineSnapshot: comparison.baselineSnapshot, candidateSnapshot: comparison.candidateSnapshot,
      maskedOperationIds: comparison.maskedOperationIds,
    }, null, 2))
    if (comparisonBytes.length > 4 * 1024 * 1024) {
      return { route: '/', viewport, maskedOperationIds: comparison.maskedOperationIds, matched: false, reason: 'Serialized DOM comparison exceeded the 4 MiB evidence limit.' }
    }
    fs.writeFileSync(comparisonPath, comparisonBytes)
    return {
      route: '/', viewport,
      baselineDigest: comparison.baselineDigest, candidateDigest: comparison.candidateDigest,
      maskedOperationIds: comparison.maskedOperationIds, matched: comparison.matched,
      artifactPath: comparisonPath, artifactHash: sha256(comparisonBytes),
    }
  })

  const routeIdentity = (visible: boolean, count: number): 'verified' | 'ambiguous' | 'missing' =>
    count === 0 ? 'missing' : count > 1 || !visible ? 'ambiguous' : 'verified'

  const scopeObservations = contract.pages.flatMap(page =>
    dual.viewports.map(item => ({
      pageRef: page.pageRef, route: page.path,
      viewport: { width: item.viewport.width, height: item.viewport.height }, markerText: page.markerText,
      baselineMarkerVisible: item.baseline.markerVisible, candidateMarkerVisible: item.candidate.markerVisible,
      baselineMarkerMatchCount: item.baseline.markerMatchCount, candidateMarkerMatchCount: item.candidate.markerMatchCount,
      baselineRouteIdentity: routeIdentity(item.baseline.markerVisible, item.baseline.markerMatchCount),
      candidateRouteIdentity: routeIdentity(item.candidate.markerVisible, item.candidate.markerMatchCount),
      operations: [{
        operationId: operation.id,
        expectedBaselineText: operation.before,
        expectedCandidateText: expectedTextForPage({ value: operation.before }, operation, scope, page.pageRef).candidateText,
        baselineValues: item.baseline.imageFound ? [item.baseline.currentSrc] : [],
        candidateValues: [report.observations.find(o => o.viewport.name === item.viewport.name)?.currentSrc ?? ''],
      }],
    })))

  const interactionObservations = dual.viewports.map(item => ({
    interactionIndex: 0, pageRef, route: '/',
    viewport: { width: item.viewport.width, height: item.viewport.height },
    role: 'button' as const, name: contract.interactions[0]!.name, expectedText: contract.interactions[0]!.expectedText,
    baselineRouteIdentity: item.interaction.baselineRouteIdentity, candidateRouteIdentity: item.interaction.candidateRouteIdentity,
    baselinePassed: item.interaction.baselinePassed, candidatePassed: item.interaction.candidatePassed,
  }))

  const allRendered = dual.viewports.every(item => item.runtimeState === 'rendered')
  const viewportResults = dual.viewports.map(item => viewportResult(item.viewport.name))
  const everyViewportPassed = viewportResults.every(item => item.result === 'pass')
  const overflowObserved = dual.viewports.some(item => item.layout.horizontalOverflow)
  const totalErrors = dual.viewports.reduce((sum, item) => sum + item.errors.length, 0)

  const candidateSwaps = report.observations.map(observation => assetUrlMatches(observation.currentSrc, observation.assetRef))
  const comparisonsWithDigest = baselineComparisons.filter(comparison => comparison.baselineDigest && comparison.candidateDigest)
  const allComparisonsMatched = comparisonsWithDigest.length === dual.viewports.length && comparisonsWithDigest.every(comparison => comparison.matched)
  const someComparisonDiffered = comparisonsWithDigest.some(comparison => !comparison.matched)

  const scopeVerified = (item: MediaDualEndpointViewport) =>
    item.baseline.markerVisible && item.candidate.markerVisible &&
    item.baseline.markerMatchCount === 1 && item.candidate.markerMatchCount === 1 &&
    item.baseline.imageFound && assetUrlMatches(item.baseline.currentSrc, operation.before) &&
    report.observations.some(o => o.viewport.name === item.viewport.name && assetUrlMatches(o.currentSrc, operation.after))
  const scopeContradicted = (item: MediaDualEndpointViewport) =>
    (item.baseline.markerVisible && item.baseline.markerMatchCount === 1 && item.baseline.imageFound && !assetUrlMatches(item.baseline.currentSrc, operation.before)) ||
    (item.candidate.markerVisible && item.candidate.markerMatchCount === 1 && !report.observations.some(o => o.viewport.name === item.viewport.name && assetUrlMatches(o.currentSrc, operation.after)))
  const scopeAllVerified = dual.viewports.every(scopeVerified)
  const scopeAnyContradicted = dual.viewports.some(scopeContradicted)

  const interactionsVerified = dual.viewports.every(item =>
    item.interaction.baselineRouteIdentity === 'verified' && item.interaction.candidateRouteIdentity === 'verified')
  const interactionsAllPassed = interactionsVerified && dual.viewports.every(item => item.interaction.baselinePassed && item.interaction.candidatePassed)
  const interactionsAnyFailed = interactionsVerified && dual.viewports.some(item => !item.interaction.baselinePassed || !item.interaction.candidatePassed)

  const assertions: VerificationAssertion[] = [
    {
      id: 'target-change',
      result: allRendered && everyViewportPassed && candidateSwaps.every(Boolean) ? 'pass'
        : candidateSwaps.some(Boolean) ? 'risk' : 'unknown',
      detail: allRendered
        ? candidateSwaps.every(Boolean)
          ? `替换后的图片在全部 ${dual.viewports.length} 个视口真实加载且 currentSrc 规范化匹配 ${operation.after}。`
          : '部分视口的 currentSrc 未命中替换资源。'
        : '并非所有视口完成真实渲染，target-change 覆盖不完整。',
    },
    {
      id: 'non-target-preserved',
      result: allComparisonsMatched ? 'pass' : someComparisonDiffered ? 'risk' : 'unknown',
      detail: allComparisonsMatched
        ? `双端 DOM 快照在遮蔽目标图后于全部 ${comparisonsWithDigest.length} 个视口 digest 一致（对照来自真实双端浏览器状态）。`
        : someComparisonDiffered
          ? '至少一个视口双端 DOM 快照（遮蔽目标图后）不一致。'
          : `双端 DOM 对照不完整：${baselineComparisons.find(c => c.reason)?.reason ?? '未知原因'}。`,
    },
    {
      id: 'scope-propagation',
      result: scopeAllVerified ? 'pass' : scopeAnyContradicted ? 'risk' : 'unknown',
      detail: scopeAllVerified
        ? `作品页 marker「器物全集」双端唯一可见，基线端保持原图、候选端呈现替换图，覆盖 ${dual.viewports.length} 个视口。`
        : scopeAnyContradicted
          ? '已验证路由上的基线/候选图观测与 Scope 决策矛盾。'
          : '部分视口的 marker 或基线/候选图观测未能唯一验证，Scope 传播保持未知。',
    },
    {
      id: 'interaction',
      result: interactionsAllPassed ? 'pass' : interactionsAnyFailed ? 'risk' : 'unknown',
      detail: interactionsAllPassed
        ? `「${contract.interactions[0]!.name}」交互在双端全部视口真实点击成功并到达期望文本。`
        : interactionsAnyFailed
          ? '至少一个视口的双端交互未通过。'
          : '交互路由身份未能唯一验证，交互结果保持未知。',
    },
    {
      id: 'responsive-layout',
      result: overflowObserved ? 'risk' : allRendered && everyViewportPassed ? 'pass' : 'unknown',
      detail: overflowObserved
        ? '至少一个视口出现横向文档溢出。'
        : allRendered && everyViewportPassed
          ? `候选在 ${dual.viewports.length} 个视口真实渲染且无横向溢出。`
          : '并非所有视口完成真实渲染，响应式覆盖不完整。',
    },
    {
      id: 'source-mapping',
      result: allRendered && everyViewportPassed && candidateSwaps.every(Boolean) ? 'pass' : 'unknown',
      detail: allRendered && candidateSwaps.every(Boolean)
        ? '来源分析定位的媒体节点在每个视口唯一映射到真实渲染的替换图（SourceGraph 定位 + 候选源码 + 浏览器渲染三者一致）。'
        : '并非所有视口完成渲染或替换图未加载，source-mapping 覆盖不完整。',
    },
    {
      id: 'browser-errors',
      result: totalErrors === 0 ? (allRendered ? 'pass' : 'unknown') : 'risk',
      detail: (() => {
        const warningCount = dual.viewports.reduce((sum, item) => sum + (item.warnings?.length ?? 0), 0)
        const warningNote = warningCount ? `；另有 ${warningCount} 条环境性资源警告（第三方 CDN/字体，见 dual.json warnings，不阻断媒体断言）` : ''
        return totalErrors === 0
          ? (allRendered ? `双端 ${dual.viewports.length} 个视口均无未捕获页面/控制台错误${warningNote}。` : `渲染不完整，错误覆盖不完整${warningNote}。`)
          : `双端共观察到 ${totalErrors} 条页面/控制台错误（见 dual.json 各视口 errors）。`
      })(),
    },
  ]

  const capturedAt = dual.capturedAt
  const evidence = screenshotArtifacts.map(({ observation, path: artifactPath, sha256: artifactHash }) => {
    const result = viewportResult(observation.viewport.name).result
    return {
      id: `evidence-media-${observation.viewport.name}`, checkId: checkName(observation.viewport.name),
      result: result as EvidenceResult, capturedAt,
      pageUrl: observation.pageUrl, viewport: { width: observation.viewport.width, height: observation.viewport.height },
      runtimeState: viewportResult(observation.viewport.name).state,
      elementRefs: [operation.targetRef], artifactPath, artifactHash,
    }
  })

  const assertionPassed = assertions.every(assertion => assertion.result === 'pass')
  const run: VerificationRun = {
    id: 'qingye-media-run', candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint, startedAt: capturedAt, completedAt: new Date().toISOString(),
    checks, assertions, verificationContractHash: verificationContractHash(contract),
    evidence,
    baselineComparisons, scopeObservations, interactionObservations,
    status: allRendered ? (assertionPassed ? 'passed' : 'risks') : 'incomplete',
  }

  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 4, executor: 'playwright', completed: true, runId: run.id, candidateId: candidate.id,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint, verificationContractHash: verificationContractHash(contract),
    viewports: report.observations.map(item => ({ name: item.viewport.name, width: item.viewport.width, height: item.viewport.height })),
    checks: checks.map(item => {
      const executed = viewportResult(item.id.replace('products-media-', ''))
      return { id: item.id, route: item.route, viewport: item.viewport, state: item.state, passed: executed.result === 'pass' }
    }),
    baselineComparisons: baselineComparisons.map(item => ({ ...item, artifactPath: item.artifactPath ? path.basename(item.artifactPath) : undefined })),
    scopeObservations, interactionObservations, assertions,
    evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })),
    artifacts: screenshotArtifacts.map(({ observation, path: artifactPath, sha256: artifactHash }) => ({ checkId: checkName(observation.viewport.name), path: path.basename(artifactPath), sha256: artifactHash })),
  }))
  return attestBrowserExecution(run, recordPath)
}

async function main(): Promise<void> {
  const qingyeRoot = path.resolve(process.argv[2] ?? '')
  const workDir = path.resolve(process.argv[3] ?? '')
  if (!qingyeRoot || !fs.existsSync(path.join(qingyeRoot, 'src', 'data', 'products.ts'))) throw new AcceptanceError('用法: media-qingye-acceptance.ts <qingyeRoot> <workDir>（qingyeRoot 需含 src/data/products.ts）')
  fs.mkdirSync(workDir, { recursive: true })
  // 清理被中断运行遗留的 worktree 注册（正常路径 no-op）
  try { execFileSync('git', ['-C', qingyeRoot, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* 原工程非 git 时由后续步骤报错 */ }

  const steps: Record<string, unknown> = {}
  let evidenceSha = ''
  let evidenceSummaryState: 'pass' | 'risks' | 'failed' = 'failed'
  let dualSha = ''
  const qingyeCommit = run('git', ['-C', qingyeRoot, 'rev-parse', 'HEAD']).trim()
  const rippleHead = run('git', ['-C', rippleRoot, 'rev-parse', 'HEAD']).trim()

  // 1. 真实来源定位
  // 青野商品图全部经过"类别筛选三元表达式 + 共享 ProductCard"，按约定 fail-closed
  // 语义无法静态证明到作品页（见 PR #4 负例）；categories[].image 经 categories.map
  // 直接消费可证明。这里动态选择"能证明到作品页"的媒体节点，确定性如实记录。
  const graph = analyzeProject(qingyeRoot)
  const productsRoute = graph.nodes.find(node => node.kind === 'route' && (node.label === 'products' || node.page === 'products'))
  if (!productsRoute) throw new AcceptanceError('未定位到 products 路由节点')
  const certaintyRank = { 'source-proven': 0, partial: 1, unknown: 2 } as const
  const attributable = graph.nodes
    .filter(node => node.kind === 'media' && node.location)
    .map(node => ({ node, impact: sourceProvenPageImpact(graph, node.id) }))
    .filter(entry => entry.impact.pageRefs.includes(productsRoute.id))
    .sort((a, b) => certaintyRank[a.impact.certainty] - certaintyRank[b.impact.certainty] || a.node.id.localeCompare(b.node.id))
  const chosen = attributable[0]
  if (!chosen) throw new AcceptanceError('没有任何媒体节点可证明到作品页（来源分析 fail-closed 结果异常）')
  const target = chosen.node
  const targetLocation = target.location
  if (!targetLocation) throw new AcceptanceError('目标媒体节点缺少源码位置')
  const impact = chosen.impact
  steps.sourceLocation = {
    targetRef: target.id, path: targetLocation.path, value: target.value,
    pageRefs: impact.pageRefs, certainty: impact.certainty, unresolved: impact.unresolved,
    note: '青野商品图经动态类别筛选，静态不可证明到页面；本目标为直接 map 消费的分类图，未解析关系如实保留',
  }

  // 2. 新图字节（真实下载）进暂存
  const imageUrl = process.env.MEDIA_SWAP_IMAGE_URL ?? 'https://images.pexels.com/photos/8952094/pexels-photo-8952094.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'
  const bytes = await downloadBytes(imageUrl)
  const store = createStagedAssetStore(path.join(workDir, 'staged-assets'))
  const assetHash = store.store(bytes)
  const extension = path.extname(new URL(imageUrl).pathname) || '.jpeg'
  const assetRef = `/media/qingye-category-swap${extension}`
  steps.assetStaging = { imageUrl, sha256: assetHash, bytes: bytes.byteLength, assetRef }

  // 3. Scope + 操作 + A 核心候选
  const scope: ScopeDecision = {
    id: 'qingye-media-scope', version: 1, includedRefs: [target.id, productsRoute.id], excludedRefs: [], protectedRefs: [],
    decidedBy: 'media-acceptance', decidedAt: new Date().toISOString(),
  }
  const operation = {
    id: 'qingye-media-swap', kind: 'MEDIA' as const, action: 'asset-swap' as const, targetRef: target.id,
    before: target.value!, after: assetRef,
    payload: { assetRef, assetHash, focalPoint: { x: 0.5, y: 0.45 }, containerHint: { selector: `img[src="${assetRef}"]`, aspect: 3 / 4 } },
  }
  const candidate = createCandidate({
    projectRoot: qingyeRoot, candidateRoot: path.join(workDir, 'candidate'), artifactRoot: path.join(workDir, 'artifacts'),
    graph, scope, operations: [operation],
    executors: mediaAssetSwapExecutors(), readStagedAsset: store.readStagedAsset,
  })
  const baselineSrc = path.join(workDir, 'baseline-src')
  try {
    assertCandidateCurrent(candidate)
    const candidateSource = fs.readFileSync(path.join(candidate.candidateRoot!, targetLocation.path), 'utf8')
    if (!candidateSource.includes(assetRef)) throw new AcceptanceError('候选源码未包含新引用')
    if (!candidateSource.includes('pexels-photo-8952094')) throw new AcceptanceError('候选源码丢失了其他商品图引用（消费者被误改）')
    const stagedPath = path.join(candidate.candidateRoot!, 'public', assetRef.replace(/^\//, ''))
    if (sha256(fs.readFileSync(stagedPath)) !== assetHash) throw new AcceptanceError('候选内暂存资产字节与 SHA-256 不符')
    if (fs.readFileSync(path.join(qingyeRoot, targetLocation.path), 'utf8').includes(assetRef)) throw new AcceptanceError('原工程被修改，隔离失效')
    steps.candidate = { candidateId: candidate.id, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest }

    // 4a. 候选构建（vite build）+ 静态服务
    run(npmCommand, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: candidate.candidateRoot!, timeoutMs: 900_000 })
    run(npmCommand, ['run', 'build'], { cwd: candidate.candidateRoot!, timeoutMs: 900_000 })
    const dist = path.join(candidate.candidateRoot!, 'dist')
    if (!fs.existsSync(path.join(dist, assetRef.replace(/^\//, '')))) throw new AcceptanceError('构建产物缺少新资产（public 目录未拷贝）')

    // 4b. 原工程基线构建（真实双端对照的前提；worktree 隔离，不污染原工程）
    // 独立审查 P2-2：进程被强杀时 finally 不执行会残留 baseline-src 目录并阻断
    // 下次 worktree add，这里先强制清空实现自愈。
    fs.rmSync(baselineSrc, { recursive: true, force: true })
    run('git', ['-C', qingyeRoot, 'worktree', 'add', '--detach', baselineSrc, qingyeCommit])
    try {
      run(npmCommand, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: baselineSrc, timeoutMs: 900_000 })
      run(npmCommand, ['run', 'build'], { cwd: baselineSrc, timeoutMs: 900_000 })
    } catch (error) {
      throw new AcceptanceError(`基线工程构建失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const baselineDist = path.join(baselineSrc, 'dist')
    if (!fs.existsSync(path.join(baselineDist, 'index.html'))) throw new AcceptanceError('基线构建缺少 index.html')
    steps.baselineBuild = { worktree: baselineSrc, dist: baselineDist, qingyeCommit }

    const evidenceDir = path.join(workDir, 'evidence')
    const candidateServer = await serveStatic(dist, 4619)
    const baselineServer = await serveStatic(baselineDist, 4620)

    try {
      // 5. 四视口双端真实浏览器采集（子进程运行器）
      const runnerInput = path.join(workDir, 'runner-input.json')
      fs.writeFileSync(runnerInput, JSON.stringify({
        previewUrl: 'http://127.0.0.1:4619/',
        baselineUrl: 'http://127.0.0.1:4620/',
        candidate: { candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest },
        targetRef: target.id, operationId: operation.id, assetRef,
        originalValue: operation.before,
        markerText: contractFor(productsRoute.id).pages[0]!.markerText,
        selector: `img[src="${assetRef}"]`,
        navigateBy: { role: 'button', name: '商品专题' },
        interaction: { role: 'button', name: '茶器', expectedText: '柴烧茶壶' },
        interactionAbsentText: '素白陶碗',
        focalPoint: operation.payload.focalPoint,
        containerHint: operation.payload.containerHint,
      }, null, 2))
      const runner = spawn(process.execPath, ['--experimental-transform-types', '--loader', './scripts/ts-extension-loader.mjs', 'scripts/media-viewport-evidence.ts', runnerInput, evidenceDir], { cwd: rippleRoot, stdio: 'inherit' })
      const exitCode = await new Promise<number>((resolve, reject) => {
        runner.once('error', reject)
        runner.once('close', code => resolve(code ?? 1))
      })
      if (exitCode !== 0) throw new AcceptanceError(`四视口 Evidence 采集未通过（exit ${exitCode}）`)
      const evidenceFile = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'evidence.json'), 'utf8')) as { report: MediaViewportEvidenceReport; sha256: string }
      const evidenceSummary = mediaEvidenceSummary(evidenceFile.report)
      if (evidenceSummary !== 'pass') throw new AcceptanceError(`媒体 Evidence 汇总为 ${evidenceSummary}，拒绝进入审批`)
      evidenceSummaryState = evidenceSummary
      steps.mediaEvidence = { sha256: evidenceFile.sha256, dir: evidenceDir, summary: evidenceSummary }
      evidenceSha = evidenceFile.sha256
      const dualFile = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'dual.json'), 'utf8')) as { collection: MediaDualEndpointCollection; sha256: string }
      // 独立审查 P2-3：哈希回验，防止篡改 dual.json 操纵断言输入
      if (mediaDualEndpointSha256(dualFile.collection) !== dualFile.sha256) throw new AcceptanceError('dual.json 内容哈希不匹配，采集数据可能被篡改，拒绝继续')
      dualSha = dualFile.sha256
      steps.dualEndpoint = {
        sha256: dualFile.sha256,
        viewports: dualFile.collection.viewports.map(item => ({
          viewport: item.viewport.name,
          matched: item.maskedComparison.matched,
          baselinePassed: item.interaction.baselinePassed,
          candidatePassed: item.interaction.candidatePassed,
          overflow: item.layout.horizontalOverflow,
          errors: item.errors.length,
        })),
        note: '双端对照全部来自真实浏览器状态（基线构建 ' + qingyeCommit.slice(0, 8) + '），详见 dual.json',
      }
    } finally {
      await new Promise(resolve => candidateServer.close(resolve))
      await new Promise(resolve => baselineServer.close(resolve))
    }

    // 6. 审批门控（真实双端证据）→ 应用 → 回滚
    const verificationRun = trustedRun(candidate, scope, productsRoute.id, graph.revision.runtimeFingerprint, path.join(workDir, 'verification'), {
      sha256: evidenceSha, summary: evidenceSummaryState, dir: evidenceDir, dualSha256: dualSha,
    }, (JSON.parse(fs.readFileSync(path.join(evidenceDir, 'evidence.json'), 'utf8')) as { report: MediaViewportEvidenceReport }).report,
       (JSON.parse(fs.readFileSync(path.join(evidenceDir, 'dual.json'), 'utf8')) as { collection: MediaDualEndpointCollection }).collection)
    if (verificationRun.status !== 'passed') throw new AcceptanceError(`VerificationRun 状态为 ${verificationRun.status}，存在未通过断言，拒绝进入审批（见 verification/browser-execution.json）`)
    const executors = mediaAssetSwapExecutors()
    let session = recordSourceGraph(openSession('qingye-media-session', graph.revision, 'Replace products-page category image with staged asset', [], contractFor(productsRoute.id)), graph.id, graph.revision.sourceDigest)
    session = stageOperations(chooseScope(session, scope), [operation], executors)
    session = stageCandidate(session, candidate)
    session = approve(registerVerification(session, verificationRun), { candidateId: candidate.id, verificationRunId: verificationRun.id, by: 'media-acceptance', at: new Date().toISOString() })
    session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))
    const appliedDigest = digestTrackedTree(qingyeRoot, [...trackedProjectFiles(qingyeRoot), `public${assetRef}`])
    if (appliedDigest !== candidate.candidateTreeDigest) throw new AcceptanceError(`应用后树摘要不匹配：${appliedDigest} != ${candidate.candidateTreeDigest}`)
    const appliedSource = fs.readFileSync(path.join(qingyeRoot, targetLocation.path), 'utf8')
    if (!appliedSource.includes(assetRef)) throw new AcceptanceError('应用后原工程未包含新引用')
    steps.apply = { appliedPatchHash: session.applied!.appliedPatchHash, treeDigestMatch: true }

    rollbackAppliedCandidate(session, candidate)
    const restored = readProjectSnapshot(qingyeRoot).revision.sourceDigest
    if (restored !== graph.revision.sourceDigest) throw new AcceptanceError('回滚后未恢复基线摘要')
    if (fs.readFileSync(path.join(qingyeRoot, targetLocation.path), 'utf8').includes(assetRef)) throw new AcceptanceError('回滚后原工程仍含新引用')
    steps.rollback = { restoredSourceDigest: restored, restored: true }
  } finally {
    removeCandidate(candidate)
    // 清理基线 worktree（含 node_modules/dist，--force 允许脏树移除）
    try { run('git', ['-C', qingyeRoot, 'worktree', 'remove', '--force', baselineSrc]) } catch { try { execFileSync('git', ['-C', qingyeRoot, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* 尽力清理 */ } }
  }

  const acceptance = {
    schemaVersion: 'ripple-media-qingye-acceptance/v1',
    completedAt: new Date().toISOString(),
    rippleHead, qingyeCommit,
    steps,
  }
  fs.writeFileSync(path.join(workDir, 'acceptance.json'), JSON.stringify(acceptance, null, 2))
  console.log(`QINGYE MEDIA ACCEPTANCE PASS ripple=${rippleHead.slice(0, 8)} qingye=${qingyeCommit.slice(0, 8)} patch=${(steps.candidate as { patchHash: string }).patchHash.slice(0, 12)} evidence=${(steps.mediaEvidence as { sha256: string }).sha256.slice(0, 12)} dual=${dualSha.slice(0, 12)}`)
}

main().then(() => { process.exitCode = 0 }, error => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error)
  process.exitCode = 1
})
