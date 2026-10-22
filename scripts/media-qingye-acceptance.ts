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
 *   → 审批（真实证据门控）→ 在**可丢弃副本**上应用同一补丁 → 校验树摘要 → 回滚恢复
 *      （应用/回滚绝不触碰传入的私有原工程；原工程全程只读，结尾做摘要自比对证明未被触碰）
 * 输出：<workRoot>/run-<时间戳>-<随机>/acceptance.json（含双方 SHA、候选身份、证据哈希、
 * 每步结果）。每次验收独占一个运行目录；历史目录（含保留现场）永不被后续运行触碰（P1-2）。
 *
 * 恢复语义（三类场景，src/core/media-acceptance-apply.ts 有注入测试覆盖）：
 * 1. 正常成功：应用 → 校验 → 显式回滚 → 恢复原基线摘要。
 * 2. 运行失败（应用后校验不过）：自动回滚；恢复状态如实三态记录
 *    （restored / recovery-failed / unknown，classifyRecoveryOutcome 按摘要复核判定，
 *    绝不按异常类型推导 recovered）；需要保留现场时写 SCENE-PRESERVED.json 清单
 *    （Candidate ID / patchHash / 基线摘要 / 操作 / 失败状态），候选审计工件一并保留
 *    （removeCandidate preserveAudit），现场副本留待人工处置。
 * 3. 进程中断（SIGKILL 等）：finally 尽力清理 worktree；残留副本由下次运行在
 *    新目录中进行而不触碰；原工程始终未受影响。
 *
 * 故障注入（仅测试/演练，正常验收勿设）：
 *   RIPPLE_MEDIA_ACCEPTANCE_FAULT=post-apply          应用成功后立即故障
 *   RIPPLE_MEDIA_ACCEPTANCE_FAULT=tree-digest-mismatch 应用后摘要校验失败
 *   RIPPLE_MEDIA_ACCEPTANCE_FAULT=rollback-failure     显式回滚本身失败（现场保留于可丢弃副本）
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProject, digestTrackedTree, readProjectSnapshot, trackedProjectFiles } from '../src/core/project'
import { assertCandidateCurrent, createCandidate, removeCandidate, type CandidateRecord } from '../src/core/candidate'
import { assertImageBytes, assertMediaSwapAsset, canonicalImageExtension, createStagedAssetStore } from '../src/core/media-asset-staging'
import { mediaAssetSwapExecutors } from '../src/core/media-asset-swap'
import { rollbackAppliedCandidate } from '../src/core/apply'
import { approve, chooseScope, openSession, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from '../src/core/session'
import { expectedTextForPage, sourceProvenPageImpact } from '../src/core/scope'
import type { BrowserVerificationContract, EvidenceResult, ScopeDecision, VerificationAssertion, VerificationRun } from '../src/core/model'
import { attestBrowserExecution } from '../src/core/verification-receipt'
import { verificationContractHash } from '../src/core/verification-contract'
import {
  assetUrlMatches,
  mediaDualEndpointSha256,
  mediaEvidenceSummary,
  mediaViewportEvidenceSha256,
  resolveSourceMappingAssertion,
  type MediaDualEndpointCollection,
  type MediaDualEndpointViewport,
  type MediaViewportEvidenceReport,
} from '../src/core/media-viewport-evidence'
import { serveStatic } from '../src/core/media-acceptance-server'
import { applyApprovedCandidateWithRecovery, classifyRecoveryOutcome } from '../src/core/media-acceptance-apply'
import { allocateRunDir } from '../src/core/media-acceptance-run-dir'

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const rippleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) =>
  execFileSync(command, args, { cwd: options.cwd, stdio: 'pipe', timeout: options.timeoutMs ?? 600_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...(path.basename(command).endsWith('.cmd') ? { shell: true } : {}) }) as string

class AcceptanceError extends Error {
  constructor(message: string) { super(message); this.name = 'AcceptanceError' }
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
      ...resolveSourceMappingAssertion(report.observations, dual),
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
  const workRoot = path.resolve(process.argv[3] ?? '')
  if (!qingyeRoot || !fs.existsSync(path.join(qingyeRoot, 'src', 'data', 'products.ts'))) throw new AcceptanceError('用法: media-qingye-acceptance.ts <qingyeRoot> <workRoot>（qingyeRoot 需含 src/data/products.ts）')
  // 每次验收独占运行目录（P1-2）：历史保留现场只警告、绝不自动覆盖
  const { workDir, preservedScenes } = allocateRunDir(workRoot)
  console.error(`本次运行目录：${workDir}`)
  if (preservedScenes.length) {
    console.error(`警告：检测到 ${preservedScenes.length} 处历史保留现场，本次运行不会触碰；处置完毕后请人工清理：`)
    for (const scene of preservedScenes) {
      console.error(`  - ${scene.location}${scene.recoveryState ? `（${scene.recoveryState}${scene.candidateId ? `，候选 ${scene.candidateId}` : ''}）` : ''}`)
    }
  }
  // 清理被中断运行遗留的 worktree 注册（正常路径 no-op）
  try { execFileSync('git', ['-C', qingyeRoot, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* 原工程非 git 时由后续步骤报错 */ }

  const steps: Record<string, unknown> = {}
  let evidenceSha = ''
  let evidenceSummaryState: 'pass' | 'risks' | 'failed' = 'failed'
  let dualSha = ''
  let mediaReport: MediaViewportEvidenceReport | undefined
  let dualCollection: MediaDualEndpointCollection | undefined
  const qingyeCommit = run('git', ['-C', qingyeRoot, 'rev-parse', 'HEAD']).trim()
  const rippleHead = run('git', ['-C', rippleRoot, 'rev-parse', 'HEAD']).trim()
  // 故障注入（仅测试/演练）：RIPPLE_MEDIA_ACCEPTANCE_FAULT=post-apply,tree-digest-mismatch,rollback-failure
  const faults = new Set((process.env.RIPPLE_MEDIA_ACCEPTANCE_FAULT ?? '').split(',').map(item => item.trim()).filter(Boolean))
  const fault = (name: string) => { if (faults.has(name)) throw new AcceptanceError(`故障注入：${name}`) }

  // 应用/回滚目标：独立、可丢弃的工程副本（独立审查 P1：应用失败也不会污染私有原工程）。
  // 私有原工程全程只读；结束时用摘要自比对证明未被触碰。
  // 本运行独占 workDir（见 allocateRunDir），同名残留只可能来自中断的本次运行，可安全清空。
  const projectSrc = path.join(workDir, 'project-src')
  fs.rmSync(projectSrc, { recursive: true, force: true })
  // 与候选核心同一约定：autocrlf=false 保证与隔离候选的 digest 口径一致（Windows 兼容）
  run('git', ['-c', 'core.autocrlf=false', '-C', qingyeRoot, 'worktree', 'add', '--detach', projectSrc, qingyeCommit])
  const originalSourceDigest = readProjectSnapshot(qingyeRoot).revision.sourceDigest
  let preserveScene = false

  // 1. 真实来源定位
  // 青野商品图全部经过"类别筛选三元表达式 + 共享 ProductCard"，按约定 fail-closed
  // 语义无法静态证明到作品页（见 PR #4 负例）；categories[].image 经 categories.map
  // 直接消费可证明。这里动态选择"能证明到作品页"的媒体节点，确定性如实记录。
  const graph = analyzeProject(projectSrc)
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
  // 验收目标确定性门（负责人二阶段要求）：只有 source-proven 的目标允许进入替换验收；
  // partial/unknown 仅说明分类图影响可归属，不代表可安全替换——低于门槛直接拒绝，
  // 避免把"分类图影响可证明"误写成"商品图片修改能力已完整支持"。
  if (chosen.impact.certainty !== 'source-proven') {
    throw new AcceptanceError(`最佳可归因媒体确定性为 ${chosen.impact.certainty}，低于 source-proven 验收门槛，拒绝继续`)
  }
  const target = chosen.node
  const targetLocation = target.location
  if (!targetLocation) throw new AcceptanceError('目标媒体节点缺少源码位置')
  const impact = chosen.impact
  steps.sourceLocation = {
    targetRef: target.id, path: targetLocation.path, value: target.value,
    pageRefs: impact.pageRefs, certainty: impact.certainty, unresolved: impact.unresolved,
    allowedCertainty: 'source-proven only（partial/unknown 只证明分类图影响归属，不授权替换验收）',
    scopeBoundary: `Scope 授权：${target.id} + ${productsRoute.id}；未授权页面与媒体由双端 DOM 对照与字节哈希兜底`,
    note: '青野商品图经动态类别筛选，静态不可证明到页面；本目标为直接 map 消费的分类图，未解析关系如实保留',
  }

  // 2. 新图字节（真实下载）进暂存
  const imageUrl = process.env.MEDIA_SWAP_IMAGE_URL ?? 'https://images.pexels.com/photos/8952094/pexels-photo-8952094.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'
  const bytes = await downloadBytes(imageUrl)
  // 统一素材校验入口（D 最终复审 P1）：格式头识别 + 扩展名一致性；URL 无扩展名时按实际字节格式命名
  const imageFormat = assertImageBytes(bytes, '替换图片')
  const urlExtension = path.extname(new URL(imageUrl).pathname).toLowerCase()
  const extension = urlExtension || canonicalImageExtension(imageFormat)
  const assetRef = `/media/qingye-category-swap${extension}`
  assertMediaSwapAsset(bytes, assetRef, '替换图片') // 终检：URL 扩展名与实际字节格式不符即拒绝
  const store = createStagedAssetStore(path.join(workDir, 'staged-assets'))
  const assetHash = store.store(bytes)
  steps.assetStaging = { imageUrl, sha256: assetHash, bytes: bytes.byteLength, assetRef, format: imageFormat, validation: '格式头识别（非完整解码证明）+ 扩展名一致性' }

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
    projectRoot: projectSrc, candidateRoot: path.join(workDir, 'candidate'), artifactRoot: path.join(workDir, 'artifacts'),
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
    if (fs.readFileSync(path.join(qingyeRoot, targetLocation.path), 'utf8').includes(assetRef)) throw new AcceptanceError('私有原工程被修改，隔离失效')
    if (fs.readFileSync(path.join(projectSrc, targetLocation.path), 'utf8').includes(assetRef)) throw new AcceptanceError('可丢弃副本在应用前已被修改，隔离失效')
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
      // D 复审返工：evidence.json 与 dual.json 同样做内容哈希回验（对称 P2-3），
      // 防止篡改采集输出操纵断言输入；解析一次后全链复用，不再重复读盘。
      // 信任边界（D 最终复审 P2）：哈希一致性只证明"采集后未被改动"，不证明来源真实性——
      // 能同时改写报告与哈希的攻击者可伪造一致对；真正绑定证据与候选版本的是报告内嵌的
      // candidateId/patchHash/candidateTreeDigest/baseSourceDigest 四元组，由审批侧
      // A 的 attestBrowserExecution / Receipt 门控复核。哈希回验防的是采集链路内的
      // 意外损坏与单点篡改，不得夸大为来源真实性证明。
      const evidenceFile = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'evidence.json'), 'utf8')) as { report: MediaViewportEvidenceReport; sha256: string }
      if (mediaViewportEvidenceSha256(evidenceFile.report) !== evidenceFile.sha256) throw new AcceptanceError('evidence.json 内容哈希不匹配，采集数据可能被篡改，拒绝继续')
      mediaReport = evidenceFile.report
      const evidenceSummary = mediaEvidenceSummary(evidenceFile.report)
      if (evidenceSummary !== 'pass') throw new AcceptanceError(`媒体 Evidence 汇总为 ${evidenceSummary}，拒绝进入审批`)
      evidenceSummaryState = evidenceSummary
      steps.mediaEvidence = { sha256: evidenceFile.sha256, dir: evidenceDir, summary: evidenceSummary }
      evidenceSha = evidenceFile.sha256
      const dualFile = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'dual.json'), 'utf8')) as { collection: MediaDualEndpointCollection; sha256: string }
      // 独立审查 P2-3：哈希回验，防止篡改 dual.json 操纵断言输入
      if (mediaDualEndpointSha256(dualFile.collection) !== dualFile.sha256) throw new AcceptanceError('dual.json 内容哈希不匹配，采集数据可能被篡改，拒绝继续')
      dualCollection = dualFile.collection
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
    if (!mediaReport || !dualCollection) throw new AcceptanceError('四视口采集结果缺失（evidence/dual 未通过哈希回验），拒绝进入审批')
    const verificationRun = trustedRun(candidate, scope, productsRoute.id, graph.revision.runtimeFingerprint, path.join(workDir, 'verification'), {
      sha256: evidenceSha, summary: evidenceSummaryState, dir: evidenceDir, dualSha256: dualSha,
    }, mediaReport, dualCollection)
    if (verificationRun.status !== 'passed') throw new AcceptanceError(`VerificationRun 状态为 ${verificationRun.status}，存在未通过断言，拒绝进入审批（见 verification/browser-execution.json）`)
    const executors = mediaAssetSwapExecutors()
    let session = recordSourceGraph(openSession('qingye-media-session', graph.revision, 'Replace products-page category image with staged asset', [], contractFor(productsRoute.id)), graph.id, graph.revision.sourceDigest)
    session = stageOperations(chooseScope(session, scope), [operation], executors)
    session = stageCandidate(session, candidate)
    session = approve(registerVerification(session, verificationRun), { candidateId: candidate.id, verificationRunId: verificationRun.id, by: 'media-acceptance', at: new Date().toISOString() })
    // 应用 + 应用后校验 +（失败时）自动回滚，全部发生在可丢弃副本 projectSrc 上。
    // 恢复语义见 src/core/media-acceptance-apply.ts：任何失败都向外抛错，绝不写成 PASS。
    let appliedSession: typeof session
    try {
      ;({ session: appliedSession } = applyApprovedCandidateWithRecovery(session, candidate, {
        afterApply: () => fault('post-apply'),
        verifyApplied: () => {
          if (faults.has('tree-digest-mismatch')) throw new AcceptanceError('故障注入：tree-digest-mismatch')
          const appliedDigest = digestTrackedTree(projectSrc, [...trackedProjectFiles(projectSrc), `public${assetRef}`])
          if (appliedDigest !== candidate.candidateTreeDigest) throw new AcceptanceError(`应用后树摘要不匹配：${appliedDigest} != ${candidate.candidateTreeDigest}`)
          const appliedSource = fs.readFileSync(path.join(projectSrc, targetLocation.path), 'utf8')
          if (!appliedSource.includes(assetRef)) throw new AcceptanceError('应用后可丢弃副本未包含新引用')
        },
        beforeRollback: () => fault('rollback-failure'),
      }))
      steps.apply = { appliedPatchHash: appliedSession.applied!.appliedPatchHash, treeDigestMatch: true, target: 'disposable project-src' }

      try {
        fault('rollback-failure')
        rollbackAppliedCandidate(appliedSession, candidate)
      } catch (rollbackError) {
        // 显式回滚失败（含注入）：副本处于应用后状态，保留现场供人工处理（副本在 workDir 内，不影响原工程）
        preserveScene = true
        throw new AcceptanceError(`显式回滚失败，现场已保留于可丢弃副本 ${projectSrc}：${rollbackError instanceof Error ? rollbackError.message : rollbackError}`)
      }
      const restored = readProjectSnapshot(projectSrc).revision.sourceDigest
      if (restored !== graph.revision.sourceDigest) throw new AcceptanceError('回滚后可丢弃副本未恢复基线摘要')
      if (fs.readFileSync(path.join(projectSrc, targetLocation.path), 'utf8').includes(assetRef)) throw new AcceptanceError('回滚后可丢弃副本仍含新引用')
      steps.rollback = { restoredSourceDigest: restored, restored: true }
    } catch (error) {
      // 恢复状态如实三态记录（P1-1）：classify 按摘要复核判定，绝不按异常类型推导 recovered
      const classified = classifyRecoveryOutcome(error, () =>
        readProjectSnapshot(projectSrc).revision.sourceDigest === graph.revision.sourceDigest)
      if (classified.preserveScene) preserveScene = true // 保留可丢弃副本现场供人工处理（副本在本运行目录内，不影响原工程）
      steps.applyRecovery = {
        recoveryState: classified.state,
        preserveScene,
        failure: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        note: `${classified.note} 应用目标为可丢弃副本（${projectSrc}），私有原工程全程只读；失败不会被写成验收 PASS。`,
      }
      if (preserveScene) {
        // 现场清单（P1-2）：足以追溯 Candidate ID / patchHash / 基线摘要 / 操作描述 / 失败状态
        fs.writeFileSync(path.join(workDir, 'SCENE-PRESERVED.json'), JSON.stringify({
          schemaVersion: 'ripple-media-scene-preserved/v1',
          preservedAt: new Date().toISOString(),
          recoveryState: classified.state,
          failure: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
          rippleHead, qingyeCommit,
          projectSrc,
          sceneState: '副本处于应用后状态（回滚未完成）；处置完毕后手动清理：git -C <qingyeRoot> worktree remove --force <projectSrc>',
          candidate: {
            id: candidate.id, patchHash: candidate.patchHash,
            baseSourceDigest: candidate.baseSourceDigest, candidateTreeDigest: candidate.candidateTreeDigest,
            artifactPath: candidate.artifactPath,
          },
          operation: {
            id: operation.id, kind: operation.kind, action: operation.action,
            targetRef: operation.targetRef, before: operation.before, after: operation.after,
          },
          baselineSourceDigest: graph.revision.sourceDigest,
        }, null, 2))
      }
      throw error
    }
    // 私有原工程未被触碰的证据：应用/回滚都只发生在可丢弃副本上，对原工程做只读自比对
    const untouchedDigest = readProjectSnapshot(qingyeRoot).revision.sourceDigest
    if (untouchedDigest !== originalSourceDigest) throw new AcceptanceError('私有原工程在验收期间发生变化，只读隔离失效')
    steps.originalUntouched = { sourceDigest: untouchedDigest, note: '应用/回滚均发生在可丢弃副本上，原工程只读且未被触碰' }
  } finally {
    // 候选清理：保留现场时保留审计工件（候选身份/补丁/验证证据可追溯，P1-2），否则全清
    try { removeCandidate(candidate, preserveScene ? { preserveAudit: true } : {}) } catch { try { execFileSync('git', ['-C', qingyeRoot, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* 尽力清理 */ } }
    // 清理基线 worktree（含 node_modules/dist，--force 允许脏树移除）
    try { run('git', ['-C', qingyeRoot, 'worktree', 'remove', '--force', baselineSrc]) } catch { try { execFileSync('git', ['-C', qingyeRoot, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* 尽力清理 */ } }
    if (preserveScene) {
      const state = (steps.applyRecovery as { recoveryState?: string } | undefined)?.recoveryState ?? 'unknown'
      console.error(`现场保留（${state}，副本处于应用后状态）：${projectSrc}`)
      console.error(`现场清单：${path.join(workDir, 'SCENE-PRESERVED.json')}（含 Candidate ID / patchHash / 基线摘要 / 操作 / 失败状态）`)
    } else {
      try { run('git', ['-C', qingyeRoot, 'worktree', 'remove', '--force', projectSrc]) } catch { try { execFileSync('git', ['-C', qingyeRoot, 'worktree', 'prune'], { stdio: 'pipe' }) } catch { /* 尽力清理 */ } }
      // 成功/已恢复路径正常清理重工件：暂存字节可由哈希重建，副本可由 qingyeCommit 重建
      try { fs.rmSync(path.join(workDir, 'staged-assets'), { recursive: true, force: true }) } catch { /* 尽力清理 */ }
    }
  }

  const acceptance = {
    schemaVersion: 'ripple-media-qingye-acceptance/v1',
    completedAt: new Date().toISOString(),
    rippleHead, qingyeCommit,
    runDir: workDir,
    steps,
  }
  fs.writeFileSync(path.join(workDir, 'acceptance.json'), JSON.stringify(acceptance, null, 2))
  console.log(`acceptance artifact: ${path.join(workDir, 'acceptance.json')}`)
  console.log(`QINGYE MEDIA ACCEPTANCE PASS ripple=${rippleHead.slice(0, 8)} qingye=${qingyeCommit.slice(0, 8)} patch=${(steps.candidate as { patchHash: string }).patchHash.slice(0, 12)} evidence=${(steps.mediaEvidence as { sha256: string }).sha256.slice(0, 12)} dual=${dualSha.slice(0, 12)}`)
}

main().then(() => { process.exitCode = 0 }, error => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error)
  process.exitCode = 1
})
