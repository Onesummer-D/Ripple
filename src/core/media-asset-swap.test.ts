import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeProject, digestTrackedTree, readProjectSnapshot, trackedProjectFiles } from './project'
import { assertCandidateCurrent, CandidateError, createCandidate, removeCandidate } from './candidate'
import { createStagedAssetStore, resolveAssetRefToRelativePath, MediaAssetStagingError, type StagedAssetStore } from './media-asset-staging'
import { createMediaAssetSwapExecutor, mediaAssetSwapExecutor, type MediaAssetSwapOperation } from './media-asset-swap'
import { applyApprovedCandidate, rollbackAppliedCandidate } from './apply'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from './session'
import { expectedTextForPage } from './scope'
import type { BrowserVerificationContract, EditOperation, ScopeDecision, SourceGraph, VerificationRun } from './model'
import { attestBrowserExecution } from './verification-receipt'
import { verificationContractHash } from './verification-contract'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-media-swap-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

afterEach(() => {
  // 与仓库既有测试同一约定；本机 Windows 对临时目录的 EPERM 清理失败为已知环境问题（Linux CI 为准）
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function contractFor(scope: ScopeDecision): BrowserVerificationContract {
  const pageRefs = [...scope.includedRefs, ...scope.excludedRefs, ...scope.protectedRefs].filter(ref => ref.startsWith('page:'))
  const pages = [...new Set(pageRefs)].map(pageRef => ({
    pageRef,
    path: '/',
    markerText: pageRef === 'page:autumn' ? 'Autumn page' : 'Home page',
    ...(pageRef === 'page:autumn' ? { navigateBy: { role: 'button' as const, name: 'Autumn route' } } : {}),
  }))
  return { pages, interactions: [{ pageRef: 'page:home', role: 'button', name: 'Home route', expectedText: 'Home page' }] }
}

/** 与 A 的 project.test.ts 同一 fixture 约定的最小真实 Git 工程（保持 analyzer 可识别结构）。 */
function sampleMediaProject() {
  const container = temp()
  const root = path.join(container, 'site')
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-media', scripts: { build: 'vite build' } }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { Navigation } from './components/Navigation';\nimport { HomePage } from './pages/HomePage';\nimport { AutumnPage } from './pages/AutumnPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <><button aria-label="Home route" onClick={() => setCurrentPage('home')} /><button aria-label="Autumn route" onClick={() => setCurrentPage('autumn')} />{currentPage === 'home' && <><Navigation /><HomePage /></>}{currentPage === 'autumn' && <><Navigation /><AutumnPage /></>}</>; }`)
  fs.writeFileSync(path.join(root, 'src', 'components', 'Navigation.tsx'), `export function Navigation() { return <nav><a>Home</a></nav> }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage() {
  return (
    <main>
      <h1 className="text-ink-900">Home title</h1>
      <img src="/images/hero.webp" alt="hero" />
    </main>
  );
}`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), `export function AutumnPage() { return <main><h1>Autumn title</h1><img src="/images/autumn.webp" alt="autumn" /></main> }`)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return { container, root }
}

interface MediaFixture {
  graph: SourceGraph
  target: NonNullable<ReturnType<typeof analyzeProject>['nodes'][number]>
  operation: MediaAssetSwapOperation
  scope: ScopeDecision
  store: StagedAssetStore
  bytes: Uint8Array
  assetHash: string
  assetRef: string
  stagedRelativePath: string
}

/** 用 B 的真实执行器 + 真实暂存服务组装 fixture；before 取自目标节点实际源码区间。 */
function mediaSwapFixture(root: string): MediaFixture {
  const graph = analyzeProject(root)
  const target = graph.nodes.find(node => node.kind === 'media' && node.location?.path === 'src/pages/HomePage.tsx' && node.value === '/images/hero.webp')
  if (!target?.location) throw new Error('fixture 需要 analyzer 产出带位置的媒体节点')
  const sourceSlice = fs.readFileSync(path.join(root, target.location.path), 'utf8').slice(target.location.start, target.location.end)
  if (sourceSlice !== target.value) throw new Error(`媒体节点区间与值不一致：${JSON.stringify(sourceSlice)} vs ${JSON.stringify(target.value)}`)

  const bytes = Buffer.from([0, 255, 17, 0, 128, 42, 9, 1, 2, 3])
  const assetHash = sha256(bytes)
  const assetRef = '/media/hero-new.webp'
  const store = createStagedAssetStore(path.join(temp(), 'staged-assets'))
  store.store(bytes)
  const operation: MediaAssetSwapOperation = {
    id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
    before: sourceSlice, after: assetRef,
    payload: { assetRef, assetHash },
  }
  const scope: ScopeDecision = {
    id: 'media-scope', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [],
    decidedBy: 'test-user', decidedAt: new Date().toISOString(),
  }
  return { graph, target, operation, scope, store, bytes, assetHash, assetRef, stagedRelativePath: 'public/media/hero-new.webp' }
}

/** 与 A 的 trustedRun 同约定的可信验证运行（单页契约，全部必需断言 pass）。 */
function trustedRun(candidate: ReturnType<typeof createCandidate>, runtimeFingerprint: string, targetRef: string, artifactRoot: string, scope: ScopeDecision): VerificationRun {
  fs.mkdirSync(artifactRoot, { recursive: true })
  const viewport = { width: 1280, height: 800 }
  const contract = contractFor(scope)
  const check = { id: 'home', route: '/', viewport, state: 'home-ready', description: 'Heading is visible', mandatory: true }
  const assertions = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors'].map(assertionId => ({ id: assertionId, result: 'pass' as const, detail: `verified ${assertionId}` }))
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=', 'base64')
  const artifactPath = path.join(artifactRoot, 'home.png')
  fs.writeFileSync(artifactPath, screenshot)
  const baselineSnapshot = `<main>${targetRef}</main>`
  const comparisonPath = path.join(artifactRoot, 'comparison.json')
  const comparisonBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, route: '/', viewport, baselineSnapshot, candidateSnapshot: baselineSnapshot, maskedOperationIds: ['media-swap'] }))
  fs.writeFileSync(comparisonPath, comparisonBytes)
  const comparisonDigest = createHash('sha256').update(baselineSnapshot).digest('hex')
  const baselineComparisons = [{ route: '/', viewport, baselineDigest: comparisonDigest, candidateDigest: comparisonDigest, maskedOperationIds: ['media-swap'], matched: true, artifactPath: comparisonPath, artifactHash: sha256(comparisonBytes) }]
  const scopeObservations = contract.pages.map(page => ({ pageRef: page.pageRef, route: page.path, viewport, markerText: page.markerText, baselineMarkerVisible: true, candidateMarkerVisible: true, baselineMarkerMatchCount: 1, candidateMarkerMatchCount: 1, baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const, operations: candidate.operations.map(operation => {
    const expectation = expectedTextForPage({ value: operation.before }, operation, scope, page.pageRef)
    return { operationId: operation.id, expectedBaselineText: expectation.baselineText, expectedCandidateText: expectation.candidateText, baselineValues: [expectation.baselineText], candidateValues: [expectation.candidateText] }
  }) }))
  const interactionObservations = [{ interactionIndex: 0, pageRef: 'page:home', route: '/', viewport, role: 'button' as const, name: 'Home route', expectedText: 'Home page', baselineRouteIdentity: 'verified' as const, candidateRouteIdentity: 'verified' as const, baselinePassed: true, candidatePassed: true }]
  const run: VerificationRun = {
    id: 'media-apply-run', candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    candidateTreeDigest: candidate.candidateTreeDigest, runtimeFingerprint, startedAt: '2026-10-19T00:00:00Z', completedAt: '2026-10-19T00:01:00Z',
    checks: [check], assertions, verificationContractHash: verificationContractHash(contract),
    evidence: [{ id: 'evidence-home', checkId: check.id, result: 'pass', capturedAt: '2026-10-19T00:00:30Z', pageUrl: 'http://127.0.0.1:4173/', viewport, runtimeState: check.state, elementRefs: [targetRef], artifactPath, artifactHash: sha256(screenshot) }],
    baselineComparisons, scopeObservations, interactionObservations, status: 'incomplete',
  }
  const recordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 4, executor: 'playwright', completed: true, runId: run.id, candidateId: candidate.id,
    scopeDecisionId: candidate.scopeDecisionId, scopeVersion: candidate.scopeVersion,
    baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint, verificationContractHash: verificationContractHash(contract), viewports: [{ name: 'desktop', width: viewport.width, height: viewport.height }],
    checks: [{ id: check.id, route: check.route, viewport, state: check.state, passed: true }],
    baselineComparisons: [{ ...baselineComparisons[0], artifactPath: path.basename(comparisonPath) }], scopeObservations, interactionObservations, assertions,
    evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath!) })),
    artifacts: [{ checkId: check.id, path: 'home.png', sha256: sha256(screenshot) }],
  }))
  return attestBrowserExecution(run, recordPath)
}

describe('media-asset-staging', () => {
  it('resolveAssetRefToRelativePath：/ 开头进 public，相对引用按消费文件解析，危险形式拒绝', () => {
    expect(resolveAssetRefToRelativePath('/images/a.jpg', 'src/components/Hero.tsx')).toBe('public/images/a.jpg')
    expect(resolveAssetRefToRelativePath('./a.jpg', 'src/components/Hero.tsx')).toBe('src/components/a.jpg')
    expect(resolveAssetRefToRelativePath('../assets/a.jpg', 'src/components/Hero.tsx')).toBe('src/assets/a.jpg')
    expect(resolveAssetRefToRelativePath('/images/a.jpg', 'src/Hero.tsx', { publicDir: 'static' })).toBe('static/images/a.jpg')
    expect(() => resolveAssetRefToRelativePath('https://cdn.example.com/a.jpg', 'src/x.tsx')).toThrow(MediaAssetStagingError)
    expect(() => resolveAssetRefToRelativePath('../../../etc/passwd.jpg', 'src/x.tsx')).toThrow(MediaAssetStagingError)
    expect(() => resolveAssetRefToRelativePath('/../src/App.tsx', 'src/x.tsx')).toThrow(/不允许包含 \.\. 段/)
  })

  it('staged asset store：存取一致、缺失与篡改 fail-closed、身份格式校验', () => {
    const store = createStagedAssetStore(path.join(temp(), 'assets'))
    const bytes = Buffer.from('real-image-bytes')
    const hash = store.store(bytes)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(store.store(Uint8Array.from(bytes))).toBe(hash)
    expect(Buffer.from(store.readStagedAsset(hash))).toEqual(bytes)
    expect(() => store.readStagedAsset('f'.repeat(64))).toThrow(/暂存资产不存在/)
    expect(() => store.readStagedAsset('BAD')).toThrow(/小写 SHA-256/)
    expect(() => store.store(new Uint8Array())).toThrow(/非空字节/)
    const target = path.join(store.root, hash.slice(0, 2), hash)
    fs.writeFileSync(target, 'tampered')
    expect(() => store.readStagedAsset(hash)).toThrow(/字节与身份不匹配/)
  })
})

describe('media-asset-swap executor', () => {
  const executor = createMediaAssetSwapExecutor()

  function planInput(fixture: MediaFixture, overrides: Partial<MediaAssetSwapOperation> = {}) {
    const operation = { ...fixture.operation, ...overrides } as MediaAssetSwapOperation
    return { operation, target: fixture.target, graph: fixture.graph, scope: fixture.scope, readStagedAsset: fixture.store.readStagedAsset }
  }

  it('validate：形状完整的操作通过，畸形输入全部拒绝', () => {
    const { root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    expect(executor.validate(fixture.operation)).toBe(true)
    const reject = (overrides: Record<string, unknown>) => {
      expect(executor.validate({ ...fixture.operation, ...overrides } as unknown), JSON.stringify(Object.keys(overrides))).toBe(false)
    }
    reject({ kind: 'TEXT' })
    reject({ action: 'unregistered' })
    reject({ action: undefined })
    reject({ before: '' })
    reject({ after: fixture.operation.before })
    reject({ payload: undefined })
    reject({ payload: { assetRef: fixture.assetRef, assetHash: 'bad' } })
    reject({ payload: { assetRef: 'https://evil.example.com/x.webp', assetHash: fixture.assetHash } })
    reject({ payload: { assetRef: '/x.webp" data-evil="1', assetHash: fixture.assetHash } })
    reject({ payload: { assetRef: '/../x.webp', assetHash: fixture.assetHash } })
    reject({ payload: { assetRef: fixture.assetRef, assetHash: fixture.assetHash, focalPoint: { x: 'a', y: 1 } } })
    reject({ payload: { assetRef: fixture.assetRef, assetHash: fixture.assetHash, variants: [{ mechanism: 'srcset', condition: 1, assetRef: '/v.webp', assetHash: fixture.assetHash }] } })
    reject({ payload: { assetRef: fixture.assetRef, assetHash: fixture.assetHash, containerHint: { selector: 1, aspect: 2 } } })
    expect(executor.validate(null)).toBe(false)
    expect(executor.validate('asset-swap')).toBe(false)
  })

  it('plan：sourceEdit 落在目标授权区间内，fileWrites 为新增资产路径与受控字节', () => {
    const { root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    const plan = executor.plan(planInput(fixture))
    expect(plan.sourceEdits).toEqual([{
      path: 'src/pages/HomePage.tsx',
      start: fixture.target.location!.start,
      end: fixture.target.location!.end,
      before: fixture.operation.before,
      after: fixture.assetRef,
    }])
    expect(plan.fileWrites).toHaveLength(1)
    expect(plan.fileWrites![0].path).toBe(fixture.stagedRelativePath)
    expect(Buffer.from(plan.fileWrites![0].bytes)).toEqual(Buffer.from(fixture.bytes))
  })

  it('plan：无副作用——不读工程文件、不写任何文件', () => {
    const { root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    const homePath = path.join(root, 'src', 'pages', 'HomePage.tsx')
    const beforeSource = fs.readFileSync(homePath, 'utf8')
    const beforeTracked = git(root, 'status', '--porcelain')
    executor.plan(planInput(fixture))
    expect(fs.readFileSync(homePath, 'utf8')).toBe(beforeSource)
    expect(git(root, 'status', '--porcelain')).toEqual(beforeTracked)
  })

  it('plan：variants 显式 unsupported（不悄悄降级），after 与 assetRef 不一致拒绝，目标缺位置拒绝', () => {
    const { root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    const withVariants = {
      ...fixture.operation,
      payload: { ...fixture.operation.payload, variants: [{ mechanism: 'srcset', condition: '768w', assetRef: '/media/hero-small.webp', assetHash: fixture.assetHash }] },
    } as MediaAssetSwapOperation
    expect(() => executor.plan(planInput(fixture, withVariants))).toThrow(/v1 不支持 variants/)
    expect(() => executor.plan(planInput(fixture, { after: '/media/other.webp' }))).toThrow(/必须与 payload\.assetRef 一致/)
    const noLocation = { ...fixture.target, location: undefined }
    expect(() => executor.plan({ ...planInput(fixture), target: noLocation })).toThrow(/缺少媒体 AST 源位置/)
  })
})

describe('media-asset-swap 与候选核心集成（A 的 seam，B 的执行器）', () => {
  it('真实候选：二进制补丁、完整性校验、原工程与未授权页面不受影响', () => {
    const { container, root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    const candidate = createCandidate({
      projectRoot: root, candidateRoot: path.join(container, 'media-candidate'), artifactRoot: path.join(container, 'media-artifacts'),
      graph: fixture.graph, scope: fixture.scope, operations: [fixture.operation],
      executors: [mediaAssetSwapExecutor], readStagedAsset: fixture.store.readStagedAsset,
    })
    try {
      expect(candidate.modifiedPaths).toContain(fixture.stagedRelativePath)
      expect(candidate.modifiedPaths).toContain('src/pages/HomePage.tsx')
      const patch = fs.readFileSync(candidate.artifactPath!, 'utf8')
      expect(patch).toContain('GIT binary patch')
      expect(patch).toContain(fixture.stagedRelativePath)
      expect(patch).toContain('src/pages/HomePage.tsx')
      expect(fs.readFileSync(path.join(candidate.candidateRoot!, fixture.stagedRelativePath))).toEqual(fixture.bytes)
      const candidateHome = fs.readFileSync(path.join(candidate.candidateRoot!, 'src', 'pages', 'HomePage.tsx'), 'utf8')
      expect(candidateHome).toContain(fixture.assetRef)
      const candidateAutumn = fs.readFileSync(path.join(candidate.candidateRoot!, 'src', 'pages', 'AutumnPage.tsx'), 'utf8')
      expect(candidateAutumn).toContain('/images/autumn.webp')
      assertCandidateCurrent(candidate)
      // 原工程未被触碰
      expect(fs.readFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('/images/hero.webp')
      expect(fs.existsSync(path.join(root, fixture.stagedRelativePath))).toBe(false)
    } finally { removeCandidate(candidate) }
  }, 30_000)

  it('fail-closed：未注册执行器、畸形 payload、受保护目标、page-override 下的结构化操作', () => {
    const { container, root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    const request = {
      projectRoot: root, candidateRoot: path.join(container, 'rejected-candidate'), artifactRoot: path.join(container, 'rejected-artifacts'),
      graph: fixture.graph, scope: fixture.scope, operations: [fixture.operation],
      executors: [mediaAssetSwapExecutor], readStagedAsset: fixture.store.readStagedAsset,
    }
    // 未注册：不提供 registry
    expect(() => createCandidate({ ...request, executors: [] })).toThrow(/拒绝按字面量替换降级执行/)
    // 执行器 validate 拒绝的畸形 payload
    const malformed = {
      ...fixture.operation,
      payload: { assetRef: fixture.assetRef, assetHash: 'not-hex' },
    } as unknown as EditOperation
    expect(() => createCandidate({ ...request, operations: [malformed] })).toThrow(CandidateError)
    // 受保护目标
    const protectedScope = { ...fixture.scope, protectedRefs: [fixture.target.id] }
    expect(() => createCandidate({ ...request, scope: protectedScope })).toThrow(CandidateError)
    // page-override 下结构化操作
    const pageOverrideScope: ScopeDecision = { ...fixture.scope, strategy: 'page-override', localPageRef: 'page:home' }
    expect(() => createCandidate({ ...request, scope: pageOverrideScope })).toThrow(/页面覆盖/)
    // 字节与 SHA-256 不匹配（受控读取器被调包）
    expect(() => createCandidate({ ...request, readStagedAsset: () => Buffer.from([9, 8, 7]) })).toThrow(/暂存资产字节与 SHA-256 不匹配/)
    expect(fs.existsSync(request.candidateRoot)).toBe(false)
    expect(fs.readFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('/images/hero.webp')
  }, 30_000)

  it('审批后应用同一补丁并可靠回滚，复用 A 的公共生命周期', () => {
    const { container, root } = sampleMediaProject()
    const fixture = mediaSwapFixture(root)
    const candidate = createCandidate({
      projectRoot: root, candidateRoot: path.join(container, 'apply-candidate'), artifactRoot: path.join(container, 'apply-artifacts'),
      graph: fixture.graph, scope: fixture.scope, operations: [fixture.operation],
      executors: [mediaAssetSwapExecutor], readStagedAsset: fixture.store.readStagedAsset,
    })
    try {
      const executors = [mediaAssetSwapExecutor]
      let session = recordSourceGraph(openSession('media-apply-session', fixture.graph.revision, 'Replace the hero image', [], contractFor(fixture.scope)), fixture.graph.id, fixture.graph.revision.sourceDigest)
      session = stageOperations(chooseScope(session, fixture.scope), [fixture.operation], executors)
      session = stageCandidate(session, candidate)
      const run = trustedRun(candidate, fixture.graph.revision.runtimeFingerprint, fixture.target.id, path.join(container, 'media-evidence'), fixture.scope)
      session = approve(registerVerification(session, run), { candidateId: candidate.id, verificationRunId: run.id, by: 'test-user', at: '2026-10-19T00:02:00Z' })
      session = recordAppliedRevision(session, applyApprovedCandidate(session, candidate))

      expect(fs.readFileSync(path.join(root, fixture.stagedRelativePath))).toEqual(fixture.bytes)
      expect(fs.readFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain(fixture.assetRef)
      expect(fs.readFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), 'utf8')).toContain('/images/autumn.webp')
      expect(digestTrackedTree(root, [...trackedProjectFiles(root), fixture.stagedRelativePath])).toBe(candidate.candidateTreeDigest)

      rollbackAppliedCandidate(session, candidate)
      expect(fs.existsSync(path.join(root, fixture.stagedRelativePath))).toBe(false)
      expect(fs.readFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), 'utf8')).toContain('/images/hero.webp')
      expect(readProjectSnapshot(root).revision.sourceDigest).toBe(fixture.graph.revision.sourceDigest)
    } finally { removeCandidate(candidate) }
  }, 30_000)
})
