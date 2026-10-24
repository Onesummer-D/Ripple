import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeProject, readProjectSnapshot } from './project'
import type { SourceGraph } from './model'
import { assertCandidateCurrent, createCandidate, removeCandidate } from './candidate'
import { createStagedAssetStore } from './media-asset-staging'
import { mediaAssetSwapExecutor } from './media-asset-swap'
import type { MediaAssetSwapOperation } from './media-asset-swap'
import { applyApprovedCandidateWithRecovery, classifyRecoveryOutcome, MediaAcceptanceRecoveryError } from './media-acceptance-apply'
import { rollbackAppliedCandidate } from './apply'
import { approve, chooseScope, openSession, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from './session'
import type { BrowserVerificationContract, ScopeDecision } from './model'
import { attestBrowserExecution } from './verification-receipt'
import { verificationContractHash } from './verification-contract'
import { expectedTextForPage } from './scope'
import { removeTree } from './test-fixture-dir'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-apply-recovery-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
afterEach(() => {
  // git 夹具的只读对象文件在 Windows 上触发 rmSync EPERM；统一走 test-fixture-dir 的
  // chmod-first + 重试清理（Linux 行为不变）。
  for (const root of temporaryRoots.splice(0)) removeTree(root)
})

function contractFor(scope: ScopeDecision): BrowserVerificationContract {
  const pageRefs = [...scope.includedRefs, ...scope.excludedRefs, ...scope.protectedRefs].filter(ref => ref.startsWith('page:'))
  const pages = [...new Set(pageRefs)].map(pageRef => ({ pageRef, path: '/', markerText: 'Home page' }))
  return { pages, interactions: [{ pageRef: 'page:home', role: 'button' as const, name: 'Home route', expectedText: 'Home page' }] }
}

/** 与 media-asset-swap.test.ts 同一约定的最小真实 Git 工程。 */
function sampleMediaProject() {
  const container = temp()
  const root = path.join(container, 'site')
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-media', scripts: { build: 'vite build' } }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { HomePage } from './pages/HomePage';\nimport { AutumnPage } from './pages/AutumnPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <><button aria-label="Home route" onClick={() => setCurrentPage('home')} /><button aria-label="Autumn route" onClick={() => setCurrentPage('autumn')} />{currentPage === 'home' && <HomePage />}{currentPage === 'autumn' && <AutumnPage />}</>; }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage() { return <main><h1>Home title</h1><img src="/images/hero.webp" alt="hero" /></main> }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), `export function AutumnPage() { return <main><h1>Autumn title</h1><img src="/images/autumn.webp" alt="autumn" /></main> }`)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return { container, root }
}

interface ApprovedFixture {
  container: string
  root: string
  graph: SourceGraph
  candidate: ReturnType<typeof createCandidate>
  session: ReturnType<typeof approve>
  stagedRelativePath: string
  assetRef: string
  bytes: Uint8Array
}

/** 走到「已审批」状态的最小真实生命周期（与 media-asset-swap.test.ts 的集成用例一致）。 */
function approvedFixture(): ApprovedFixture {
  const { container, root } = sampleMediaProject()
  const graph = analyzeProject(root)
  const target = graph.nodes.find(node => node.kind === 'media' && node.location?.path === 'src/pages/HomePage.tsx' && node.value === '/images/hero.webp')
  if (!target?.location) throw new Error('fixture 需要 analyzer 产出带位置的媒体节点')
  const targetValue = target.value
  if (typeof targetValue !== 'string') throw new Error('fixture 媒体节点缺少值')
  // 统一素材校验（D 最终复审 P1）：最小 WebP 头（RIFF....WEBP）使 staged 字节通过执行器格式头识别
  const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 1, 2, 3])
  const assetHash = sha256(bytes)
  const assetRef = '/media/hero-new.webp'
  const stagedRelativePath = 'public/media/hero-new.webp'
  const store = createStagedAssetStore(path.join(temp(), 'staged-assets'))
  store.store(bytes)
  const operation: MediaAssetSwapOperation = {
    id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
    before: targetValue, after: assetRef,
    payload: { assetRef, assetHash },
  }
  const scope: ScopeDecision = {
    id: 'media-scope', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [],
    decidedBy: 'test-user', decidedAt: new Date().toISOString(),
  }
  const candidate = createCandidate({
    projectRoot: root, candidateRoot: path.join(container, 'candidate'), artifactRoot: path.join(container, 'artifacts'),
    graph, scope, operations: [operation],
    executors: [mediaAssetSwapExecutor], readStagedAsset: store.readStagedAsset,
  })
  const contract = contractFor(scope)
  const viewport = { width: 1280, height: 800 }
  const check = { id: 'home', route: '/', viewport, state: 'home-ready', description: 'Heading is visible', mandatory: true }
  const assertions = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors'].map(id => ({ id, result: 'pass' as const, detail: `verified ${id}` }))
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
  const artifactRoot = path.join(container, 'evidence')
  fs.mkdirSync(artifactRoot, { recursive: true })
  const artifactPath = path.join(artifactRoot, 'home.png')
  fs.writeFileSync(artifactPath, screenshot)
  const baselineSnapshot = `<main>${target.id}</main>`
  const comparisonPath = path.join(artifactRoot, 'comparison.json')
  const comparisonBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, route: '/', viewport, baselineSnapshot, candidateSnapshot: baselineSnapshot, maskedOperationIds: ['media-swap'] }))
  fs.writeFileSync(comparisonPath, comparisonBytes)
  const comparisonDigest = sha256(Buffer.from(baselineSnapshot))
  const scopeObservations = contract.pages.map(page => ({
    pageRef: page.pageRef, route: page.path, viewport, markerText: page.markerText,
    baselineMarkerVisible: true, candidateMarkerVisible: true, baselineMarkerMatchCount: 1, candidateMarkerMatchCount: 1,
    baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const,
    operations: [{
      operationId: operation.id, expectedBaselineText: operation.before,
      expectedCandidateText: expectedTextForPage({ value: operation.before }, operation, scope, page.pageRef).candidateText,
      baselineValues: [operation.before], candidateValues: [operation.after],
    }],
  }))
  const interactionObservations = [{ interactionIndex: 0, pageRef: 'page:home', route: '/', viewport, role: 'button' as const, name: 'Home route', expectedText: 'Home page', baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const, baselinePassed: true, candidatePassed: true }]
  const run = {
    id: 'apply-run', candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint: graph.revision.runtimeFingerprint,
    startedAt: '2026-10-21T00:00:00Z', completedAt: '2026-10-21T00:01:00Z',
    checks: [check], assertions, verificationContractHash: verificationContractHash(contract),
    evidence: [{ id: 'evidence-home', checkId: check.id, result: 'pass' as const, capturedAt: '2026-10-21T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport, runtimeState: check.state, elementRefs: [target.id], artifactPath, artifactHash: sha256(screenshot) }],
    baselineComparisons: [{ route: '/', viewport, baselineDigest: comparisonDigest, candidateDigest: comparisonDigest, maskedOperationIds: ['media-swap'], matched: true, artifactPath: comparisonPath, artifactHash: sha256(comparisonBytes) }],
    scopeObservations, interactionObservations, status: 'incomplete' as const,
  }
  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 4, executor: 'playwright', completed: true, runId: run.id, candidateId: candidate.id,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint: run.runtimeFingerprint, verificationContractHash: run.verificationContractHash,
    viewports: [{ name: 'desktop', width: viewport.width, height: viewport.height }],
    checks: [{ id: check.id, route: '/', viewport, state: check.state, passed: true }],
    baselineComparisons: [{ ...run.baselineComparisons[0], artifactPath: path.basename(comparisonPath) }],
    scopeObservations, interactionObservations, assertions,
    evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath) })),
    artifacts: [{ checkId: check.id, path: 'home.png', sha256: sha256(screenshot) }],
  }))
  const trusted = attestBrowserExecution(run, recordPath)

  let session = recordSourceGraph(openSession('apply-recovery-session', graph.revision, 'Replace the hero image', [], contract), graph.id, graph.revision.sourceDigest)
  session = stageOperations(chooseScope(session, scope), [operation], [mediaAssetSwapExecutor])
  session = stageCandidate(session, candidate)
  session = approve(registerVerification(session, trusted), { candidateId: candidate.id, verificationRunId: trusted.id, by: 'test-user', at: '2026-10-21T00:02:00Z' })
  return { container, root, graph, candidate, session, stagedRelativePath, assetRef, bytes }
}

const baselineRestored = (root: string, graph: SourceGraph) => {
  expect(readProjectSnapshot(root).revision.sourceDigest).toBe(graph.revision.sourceDigest)
}

describe('applyApprovedCandidateWithRecovery（MEDIA 验收恢复保证）', () => {
  it('正常成功：返回应用态 session，显式回滚后恢复原基线', () => {
    const fx = approvedFixture()
    try {
      assertCandidateCurrent(fx.candidate)
      const { session: applied, recovery } = applyApprovedCandidateWithRecovery(fx.session, fx.candidate)
      expect(recovery).toBeUndefined()
      expect(fs.readFileSync(path.join(fx.root, fx.stagedRelativePath))).toEqual(fx.bytes)
      rollbackAppliedCandidate(applied, fx.candidate)
      expect(fs.existsSync(path.join(fx.root, fx.stagedRelativePath))).toBe(false)
      baselineRestored(fx.root, fx.graph)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)

  it('注入：应用成功后立即故障 → 自动回滚恢复原基线并向外抛错（不吞异常、不写成功）', () => {
    const fx = approvedFixture()
    try {
      expect(() => applyApprovedCandidateWithRecovery(fx.session, fx.candidate, {
        afterApply: () => { throw new Error('模拟应用后瞬时故障') },
      })).toThrowError(MediaAcceptanceRecoveryError)
      // 恢复后基线与磁盘一致：补丁被逆向，暂存资产文件消失
      expect(fs.existsSync(path.join(fx.root, fx.stagedRelativePath))).toBe(false)
      expect(fs.readFileSync(path.join(fx.root, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('/images/hero.webp')
      baselineRestored(fx.root, fx.graph)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)

  it('注入：应用后摘要校验失败 → 同样走自动回滚恢复', () => {
    const fx = approvedFixture()
    try {
      expect(() => applyApprovedCandidateWithRecovery(fx.session, fx.candidate, {
        verifyApplied: () => { throw new Error('模拟树摘要校验失败') },
      })).toThrowError(/已自动回滚恢复原基线/)
      baselineRestored(fx.root, fx.graph)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)

  it('注入：回滚本身失败 → 抛错携带双重错误且现场保留（调用方按可丢弃副本处理，不强制重置）', () => {
    const fx = approvedFixture()
    try {
      let thrown: unknown
      try {
        applyApprovedCandidateWithRecovery(fx.session, fx.candidate, {
          afterApply: () => { throw new Error('应用后故障') },
          beforeRollback: () => { throw new Error('回滚故障') },
        })
      } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(MediaAcceptanceRecoveryError)
      expect((thrown as MediaAcceptanceRecoveryError).rollbackError).toBeDefined()
      expect((thrown as Error).message).toMatch(/自动回滚也失败/)
      // 现场保留：补丁仍在可丢弃目标上，由调用方决定处置；本模块不做强制重置
      expect(fs.existsSync(path.join(fx.root, fx.stagedRelativePath))).toBe(true)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)
})

describe('classifyRecoveryOutcome（恢复状态如实记录，独立审查 P1-1）', () => {
  it('回滚成功且摘要复核一致 → restored，不保留现场', () => {
    const classified = classifyRecoveryOutcome(
      new MediaAcceptanceRecoveryError('应用后校验失败，已自动回滚恢复原基线（abc…）。原始错误：x'),
      () => true,
    )
    expect(classified.state).toBe('restored')
    expect(classified.preserveScene).toBe(false)
  })

  it('回滚成功但摘要复核不一致 → recovery-failed（绝不记 recovered），现场保留', () => {
    const classified = classifyRecoveryOutcome(
      new MediaAcceptanceRecoveryError('应用后校验失败，已自动回滚恢复原基线（abc…）。原始错误：x'),
      () => false,
    )
    expect(classified.state).toBe('recovery-failed')
    expect(classified.preserveScene).toBe(true)
  })

  it('回滚结果无法复核（磁盘异常）→ unknown，按未恢复保守处理并保留现场', () => {
    const classified = classifyRecoveryOutcome(
      new MediaAcceptanceRecoveryError('应用后校验失败，已自动回滚恢复原基线（abc…）。原始错误：x'),
      () => { throw new Error('磁盘读取失败') },
    )
    expect(classified.state).toBe('unknown')
    expect(classified.preserveScene).toBe(true)
  })

  it('双故障（rollbackError 存在）→ recovery-failed，现场保留', () => {
    const classified = classifyRecoveryOutcome(
      new MediaAcceptanceRecoveryError('自动回滚也失败', new Error('回滚故障')),
      () => true,
    )
    expect(classified.state).toBe('recovery-failed')
    expect(classified.preserveScene).toBe(true)
  })

  it('显式 rollback-failure 注入（AcceptanceError，非恢复封装类型）→ recovery-failed，绝不 recovered，现场保留', () => {
    const classified = classifyRecoveryOutcome(new Error('故障注入：rollback-failure'), () => true)
    expect(classified.state).toBe('recovery-failed')
    expect(classified.preserveScene).toBe(true)
    expect(classified.note).toMatch(/显式回滚抛错/)
  })

  it('应用阶段抛错且工程未发生写入 → 无需回滚（rollbackError 为空）', () => {
    const fx = approvedFixture()
    try {
      // 删除补丁工件使 readPatch 抛错：此时 assertCandidateCurrent 已通过（树干净）、补丁尚未写入
      if (!fx.candidate.artifactPath) throw new Error('fixture 缺少补丁工件')
      fs.rmSync(fx.candidate.artifactPath)
      let thrown: unknown
      try {
        applyApprovedCandidateWithRecovery(fx.session, fx.candidate, {})
      } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(MediaAcceptanceRecoveryError)
      expect((thrown as MediaAcceptanceRecoveryError).rollbackError).toBeUndefined()
      expect((thrown as Error).message).toMatch(/未发生写入/)
      const classified = classifyRecoveryOutcome(thrown, () => readProjectSnapshot(fx.root).revision.sourceDigest === fx.candidate.baseSourceDigest)
      expect(classified.state).toBe('restored')
      expect(classified.preserveScene).toBe(false)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)

  it('应用阶段抛错且工程已偏离基线（无法确认未写入）→ 保守按可能写入处理，现场保留', () => {
    const fx = approvedFixture()
    try {
      // 破坏原工程（与补丁无关的改动），使 apply 在 assertCandidateCurrent 处抛错且摘要偏离——
      // treePossiblyWritten 无法区分"补丁写入"与"其他改动"，必须保守按可能写入处理
      fs.writeFileSync(path.join(fx.root, 'src', 'pages', 'AutumnPage.tsx'), `export function AutumnPage() { return <main><h1>Tampered</h1></main> }`)
      let thrown: unknown
      try {
        applyApprovedCandidateWithRecovery(fx.session, fx.candidate, {})
      } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(MediaAcceptanceRecoveryError)
      expect((thrown as MediaAcceptanceRecoveryError).rollbackError).toBeDefined()
      expect((thrown as Error).message).toMatch(/已偏离基线/)
      const classified = classifyRecoveryOutcome(thrown, () => readProjectSnapshot(fx.root).revision.sourceDigest === fx.candidate.baseSourceDigest)
      expect(classified.state).toBe('recovery-failed')
      expect(classified.preserveScene).toBe(true)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)

  it('应用阶段抛错且未写入时，分类如实反映"无需回滚即处基线"（摘要一致 → restored）', () => {
    const fx = approvedFixture()
    try {
      // 不触碰磁盘，直接验证分类语义：未写入时摘要复核为真 → restored，不保留现场
      const classified = classifyRecoveryOutcome(
        new MediaAcceptanceRecoveryError('应用阶段抛错，工程未偏离基线（未发生写入），无需回滚。原始错误：x'),
        () => true,
      )
      expect(classified.state).toBe('restored')
      expect(classified.preserveScene).toBe(false)
    } finally { removeCandidate(fx.candidate) }
  }, 90_000)
})
