import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { REQUIRED_VERIFICATION_ASSERTION_IDS } from '../src/core/model'
import { projectPreviewViewports } from '../src/core/project-viewports'
import { collectRuntimeIdentitySnapshot } from '../src/core/runtime-identity'
import { planRuntimeIdentityCaptures, readRuntimeIdentityArchives } from '../src/core/runtime-identity-archive'
// @ts-expect-error The isolated executor is intentionally plain ESM for the Node container.
import { captureVisualSide, visualViewportDir, writeRuntimeIdentityArtifact } from '../src/core/visual-capture-executor.mjs'

// 第一批真实接线验收：analyze → candidate → verify 全链路中，
// 容器采集 → manifest v4 → host 视觉分析 → run.visualEvidences →
// verificationView 只读输出 必须真实发生，且不得改变正式审批门控。
// Docker 隔离浏览器仅在 Linux CI 可用；Windows 本地自动跳过。

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-visual-wiring-'))
const projectRoot = path.join(sandbox, 'site')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence')
const workbenchRoot = path.resolve(process.env.RIPPLE_WORKBENCH_STATE_DIR ?? 'node_modules/.tmp/playwright-state')
const dockerAvailable = process.platform === 'linux' && spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0
const api = 'http://127.0.0.1:4173/__ripple/api'
let candidateId = ''
let sessionId = ''
fs.mkdirSync(evidenceRoot, { recursive: true })

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function readRegularArtifact(root: string, relativePath: string): Buffer {
  const absoluteRoot = path.resolve(root)
  const rootStat = fs.lstatSync(absoluteRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Artifact root is not a regular directory: ${root}`)
  const absolute = path.resolve(absoluteRoot, relativePath)
  const relative = path.relative(absoluteRoot, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escaped its root: ${relativePath}`)
  }
  let current = absoluteRoot
  const segments = relative.split(path.sep)
  segments.forEach((segment, index) => {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    const last = index === segments.length - 1
    if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory())) throw new Error(`Artifact is not a regular file: ${relativePath}`)
  })
  return fs.readFileSync(absolute)
}

test.beforeAll(() => {
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\ndist/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'ripple-visual-wiring', private: true, type: 'module' }))
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.tsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />)\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.tsx'), "import { useState } from 'react'; import { Navigation } from './components/Navigation'; import { HomePage } from './pages/HomePage'; export function App(){const [page]=useState('home'); return <>{page === 'home' && <><Navigation/><HomePage/></>}</>}\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'components', 'Navigation.tsx'), 'export function Navigation(){return <nav aria-label="Primary"><a>Visual wiring brand</a></nav>}\n')
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), "export function HomePage(){return <main><h1>Visual wiring baseline title</h1><p>stable paragraph</p></main>}\n")
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'visual-wiring@example.invalid'); git('config', 'user.name', 'Visual wiring test'); git('add', '.'); git('commit', '-qm', 'visual wiring baseline')
})

test.afterAll(async () => {
  if (candidateId) await fetch(`${api}/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }) }).catch(() => undefined)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); break } catch { /* Windows 临时目录偶发 EPERM，重试 */ }
  }
})

test('真实 VerificationRun 挂载视觉证据并以只读 View 输出，且不改变正式审批状态', async ({ page }) => {
  test.setTimeout(300_000)
  test.skip(!dockerAvailable, 'Docker-backed ProjectRunner and VerificationRunner are required')

  const post = async (route: string, body: unknown) => {
    const response = await page.request.post(`${api}/${route}`, { data: body, headers: { origin: 'http://127.0.0.1:4173' } })
    expect(response.ok(), `${route} 失败：${await response.text()}`).toBeTruthy()
    return response.json() as Promise<any>
  }

  // 1. 分析真实工程
  const analysis = await post('analyze', { projectRoot })
  expect(analysis.routes.map((route: { id: string }) => route.id)).toContain('page:home')
  const title = analysis.targets.find((target: { label: string }) => target.label === 'Visual wiring baseline title')
  expect(title, '目标标题必须被真实分析发现').toBeTruthy()

  // 2. 创建真实候选（TEXT 操作）
  const scope = {
    id: 'scope-visual-wiring', version: 1,
    includedRefs: ['page:home', title.id], excludedRefs: [], protectedRefs: [],
    decidedBy: 'visual-wiring-test', decidedAt: new Date().toISOString(),
  }
  const verificationContract = { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Visual wiring baseline title' }], interactions: [] }
  const created = await post('candidate', {
    projectId: analysis.revision.projectId,
    rawIntent: 'Change only the home title and verify visual evidence wiring.',
    scope,
    operations: [{ id: 'title-op', kind: 'TEXT', targetRef: title.id, before: title.value, after: 'Visual wiring candidate title' }],
    verificationContract,
  })
  sessionId = created.sessionId as string
  candidateId = created.candidate.id as string
  expect(created.verification.state).toBe('not-run')

  // 3. 运行真实浏览器验证（Docker 隔离容器采集 → manifest v4 → host 挂载）
  const verified = await post('candidate/verify', { candidateId })
  const verification = verified.verification
  expect(verification.runId, '正式运行记录必须存在').toBeTruthy()

  // 4. 正式审批门控不因视觉证据改变：状态仍由既有断言决定，且是合法状态之一
  expect(['passed', 'risks', 'incomplete', 'stale']).toContain(verification.state)

  // 5. 视觉证据必须真实挂载并只读输出
  const visualEvidences = verification.visualEvidences
  expect(Array.isArray(visualEvidences), 'verificationView 必须暴露 run.visualEvidences 只读投影').toBe(true)
  expect(visualEvidences.length, '真实浏览器执行后至少应有一条视觉证据').toBeGreaterThan(0)

  const VALID_RESULTS = ['risk', 'unknown', 'not-run', 'stale', 'failed-to-run']
  for (const entry of visualEvidences) {
    // 补充证据永远不能是 pass，不能参与通过判定
    expect(VALID_RESULTS).toContain(entry.result)
    expect(entry.result).not.toBe('pass')
    expect(entry.view.schema).toBe('ripple-visual-evidence-view/v1')
    expect(typeof entry.view.state).toBe('string')
    expect(entry.view.state).not.toBe('pass')
    expect(typeof entry.view.stateLabel).toBe('string')
    expect(entry.view.stateLabel.length).toBeGreaterThan(0)
    expect(entry.view.summary).toContain('不构成通过判定')
    expect(Array.isArray(entry.view.findings)).toBe(true)
    expect(Array.isArray(entry.view.limitations)).toBe(true)
    // 身份边界：若呈现跨版本配对，只能是候选配对，绝不能声称严格实例证明
    if (entry.view.crossVersion) {
      expect(entry.view.crossVersion.scope.level).toBe('annotation-pairing')
      expect(entry.view.crossVersion.scope.strictInstanceProofAvailable).toBe(false)
    }
    // 只读 View 不得泄露 host 侧工件绝对路径
    expect(JSON.stringify(entry.view)).not.toContain(sandbox)
    expect(entry.view.artifacts?.urls?.baseline ?? '').not.toContain(sandbox)
  }

  // 6. Inspect the actual Docker/Chromium execution record before candidate cleanup.
  const runRoot = path.join(workbenchRoot, sessionId, 'artifacts', 'verification', candidateId, verification.runId)
  const executionPath = path.join(runRoot, 'execution.json')
  expect(fs.existsSync(executionPath), '真实隔离执行 manifest 必须落盘').toBe(true)
  const manifest = JSON.parse(fs.readFileSync(executionPath, 'utf8')) as any
  expect(manifest.schemaVersion).toBe(4)
  expect(Array.isArray(manifest.visualCaptures)).toBe(true)
  expect(manifest.visualCaptures).toHaveLength(manifest.viewports.length)
  expect(manifest.viewports).toEqual(projectPreviewViewports.map(({ name, width, height }) => ({ name, width, height })))
  expect(Array.isArray(manifest.runtimeIdentityCaptures)).toBe(true)
  expect(manifest.runtimeIdentityCaptures).toHaveLength(manifest.visualCaptures.length * 2)
  const hostRead = readRuntimeIdentityArchives({
    runRoot,
    plannedCaptures: planRuntimeIdentityCaptures({
      runId: verification.runId,
      viewports: projectPreviewViewports,
      verificationContract,
    }),
    manifestEntries: manifest.runtimeIdentityCaptures,
  })
  expect(hostRead.diagnostics).toEqual([])
  expect(hostRead.entries).toHaveLength(manifest.visualCaptures.length * 2)
  expect(hostRead.entries.every(entry => entry.archive === 'stored')).toBe(true)
  expect(hostRead.entries.every(entry => entry.archive === 'stored' && entry.snapshotSha256 === entry.artifact.snapshot.sha256)).toBe(true)

  const assertionIds = manifest.assertions.map((assertion: { id: string }) => assertion.id)
  expect(assertionIds).toHaveLength(REQUIRED_VERIFICATION_ASSERTION_IDS.length)
  expect(new Set(assertionIds).size).toBe(REQUIRED_VERIFICATION_ASSERTION_IDS.length)
  expect([...assertionIds].sort()).toEqual([...REQUIRED_VERIFICATION_ASSERTION_IDS].sort())

  const hashChecks: Array<{ kind: string; checkId: string; route: string; viewport: { width: number; height: number }; state: string; side: string; path: string; declaredSha256: string; actualSha256: string; matches: boolean }> = []
  const artifactCopies: Array<{ path: string; bytes: Buffer }> = []
  const artifactPaths = new Set<string>()
  for (const capture of manifest.visualCaptures as Array<any>) {
    expect(capture.checkId).toBeTruthy()
    expect(capture.route).toBe('/')
    expect(capture.state).toBe('rendered')
    const plannedViewport = manifest.viewports.find((viewport: { width: number; height: number }) => viewport.width === capture.viewport.width && viewport.height === capture.viewport.height)
    expect(plannedViewport).toBeTruthy()
    expect(capture.checkId).toBe(`${manifest.runId}-${plannedViewport.name}`)
    const viewportDir = visualViewportDir(plannedViewport.name)
    for (const side of ['baseline', 'candidate'] as const) {
      const identityEntry = manifest.runtimeIdentityCaptures.find((entry: any) => entry.checkId === capture.checkId && entry.side === side)
      expect(identityEntry, `${capture.checkId}/${side} identity manifest entry`).toMatchObject({
        schema: 'ripple-runtime-identity-capture/v1',
        checkId: capture.checkId,
        route: capture.route,
        viewport: capture.viewport,
        state: capture.state,
        side,
        archive: 'stored',
      })
      expect(identityEntry.artifact?.snapshot?.path).toBeTruthy()
      const expectedIdentityPath = `identity/${viewportDir}/${side}-identity.json`
      expect(identityEntry.artifact.snapshot.path).toBe(expectedIdentityPath)
      expect(artifactPaths.has(expectedIdentityPath)).toBe(false)
      artifactPaths.add(expectedIdentityPath)
      const identityBytes = readRegularArtifact(runRoot, expectedIdentityPath)
      const identityActualSha256 = sha256(identityBytes)
      expect(identityActualSha256).toBe(identityEntry.artifact.snapshot.sha256)
      expect(identityActualSha256).toBe(identityEntry.snapshotSha256)
      const snapshot = JSON.parse(identityBytes.toString('utf8'))
      expect(snapshot.protocol).toBe('ripple-runtime-identity/v2')
      expect(snapshot.page).toMatchObject({ pathname: capture.route, search: '', hash: '' })
      expect(snapshot.records.length, `${capture.checkId}/${side} collector records`).toBeGreaterThan(0)
      artifactCopies.push({ path: expectedIdentityPath, bytes: identityBytes })
      hashChecks.push({
        kind: 'runtime-identity', checkId: capture.checkId, route: capture.route,
        viewport: capture.viewport, state: capture.state, side,
        path: expectedIdentityPath, declaredSha256: identityEntry.artifact.snapshot.sha256,
        actualSha256: identityActualSha256, matches: true,
      })

      const expectedGeometryPath = `visual/${viewportDir}/${side}-geometry.json`
      expect(capture[side].geometry.path).toBe(expectedGeometryPath)
      expect(artifactPaths.has(expectedGeometryPath)).toBe(false)
      artifactPaths.add(expectedGeometryPath)
      const geometryBytes = readRegularArtifact(runRoot, expectedGeometryPath)
      const geometrySha256 = sha256(geometryBytes)
      expect(geometrySha256).toBe(capture[side].geometry.sha256)
      const geometry = JSON.parse(geometryBytes.toString('utf8'))
      expect(geometry.runtimeIdentitySnapshot).toBeUndefined()
      expect(geometry.runtimeIdentityCollection).toBeUndefined()
      expect(geometry).toHaveProperty('sourceFileVersions')
      expect(geometry.pageContext).toEqual(snapshot.page)
      expect(geometry.interactionState).toBe(capture.state)
      expect(geometry.elements.map((element: { sourceRef: string | null }) => element.sourceRef)).toEqual(snapshot.records.map((record: { sourceRef: string }) => record.sourceRef))
      expect(snapshot.records.map((record: { label?: string }) => record.label)).toEqual(geometry.elements.map((_element: unknown, index: number) => `v${index}`))
      snapshot.records.forEach((record: { reasons: string[] }, index: number) => {
        const reasons = record.reasons.slice(0, 8).map(reason => String(reason).slice(0, 64)).filter(Boolean)
        expect(geometry.elements[index].identityReasons).toEqual(reasons)
      })
      artifactCopies.push({ path: expectedGeometryPath, bytes: geometryBytes })
      hashChecks.push({
        kind: 'geometry', checkId: capture.checkId, route: capture.route,
        viewport: capture.viewport, state: capture.state, side,
        path: expectedGeometryPath, declaredSha256: capture[side].geometry.sha256,
        actualSha256: geometrySha256, matches: true,
      })

      const expectedScreenshotPath = `visual/${viewportDir}/${side}.png`
      expect(capture[side].screenshot.path).toBe(expectedScreenshotPath)
      expect(artifactPaths.has(expectedScreenshotPath)).toBe(false)
      artifactPaths.add(expectedScreenshotPath)
      const screenshotBytes = readRegularArtifact(runRoot, expectedScreenshotPath)
      const screenshotSha256 = sha256(screenshotBytes)
      expect(screenshotSha256).toBe(capture[side].screenshot.sha256)
      artifactCopies.push({ path: expectedScreenshotPath, bytes: screenshotBytes })
      hashChecks.push({
        kind: 'screenshot', checkId: capture.checkId, route: capture.route,
        viewport: capture.viewport, state: capture.state, side,
        path: expectedScreenshotPath, declaredSha256: capture[side].screenshot.sha256,
        actualSha256: screenshotSha256, matches: true,
      })
    }
  }

  // Export the exact Docker artifacts under test-results so GitHub Actions retains them.
  const exportedRunRoot = path.join(evidenceRoot, 'a1-runtime-identity', verification.runId)
  fs.mkdirSync(exportedRunRoot, { recursive: true })
  const manifestBytes = readRegularArtifact(runRoot, 'execution.json')
  fs.writeFileSync(path.join(exportedRunRoot, 'execution.json'), manifestBytes, { flag: 'wx' })
  for (const artifact of artifactCopies) {
    const destination = path.resolve(exportedRunRoot, artifact.path)
    const relative = path.relative(exportedRunRoot, destination)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Export path escaped its evidence root: ${artifact.path}`)
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, artifact.bytes, { flag: 'wx' })
    expect(sha256(fs.readFileSync(destination))).toBe(sha256(artifact.bytes))
  }
  fs.writeFileSync(path.join(exportedRunRoot, 'sha256-verification.json'), JSON.stringify({
    schema: 'ripple-a1-identity-sha256-verification/v1',
    verifier: 'Playwright E2E process reading host filesystem artifacts',
    platform: process.platform,
    dockerBackedRun: dockerAvailable,
    trustedHostAssessment: false,
    manifest: {
      path: 'execution.json',
      sha256: sha256(manifestBytes),
      copiedSha256: sha256(fs.readFileSync(path.join(exportedRunRoot, 'execution.json'))),
    },
    files: hashChecks,
  }, null, 2))
  fs.writeFileSync(path.join(evidenceRoot, 'a1-runtime-identity-index.json'), JSON.stringify({
    schema: 'ripple-a1-identity-artifact-index/v1',
    runId: verification.runId,
    manifest: `a1-runtime-identity/${verification.runId}/execution.json`,
    sha256Verification: `a1-runtime-identity/${verification.runId}/sha256-verification.json`,
    captures: manifest.runtimeIdentityCaptures,
  }, null, 2))

  // 7. 保存真实交付工件
  fs.writeFileSync(path.join(evidenceRoot, 'visual-evidence-wiring-verification.json'), JSON.stringify(verified, null, 2))
  fs.writeFileSync(path.join(evidenceRoot, 'visual-evidence-wiring-views.json'), JSON.stringify(visualEvidences.map((entry: { view: unknown }) => entry.view), null, 2))

  // 8. 清理候选
  const discarded = await page.request.post(`${api}/discard`, { data: { candidateId }, headers: { origin: 'http://127.0.0.1:4173' } })
  expect(discarded.ok()).toBeTruthy()
  candidateId = ''
})

test('A① real Chromium records missing and throwing collector failures', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    document.body.innerHTML = '<main data-ripple-source="jsx:src/App.tsx#1" data-ripple-instance="/:jsx:src/App.tsx#1" data-ripple-identity-certainty="stable-react-instance"><span>identity failure fixture</span></main>'
  })

  const root = path.join(evidenceRoot, 'a1-runtime-identity-failures')
  fs.mkdirSync(root, { recursive: true })
  const viewport = page.viewportSize()
  expect(viewport).toBeTruthy()
  const checkId = 'a1-real-chromium-failure-fixture'
  const base = { checkId, route: '/', viewport, state: 'rendered' }
  const missing = await captureVisualSide(page, {
    side: 'baseline', route: '/', screenshot: 'none', awaitFonts: false,
  })
  const missingResult = writeRuntimeIdentityArtifact(root, 'desktop', 'baseline', missing)
  expect(missingResult).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', detail: 'collector source missing' })

  await page.evaluate(() => {
    const node = document.querySelector('[data-ripple-source]')!
    Object.defineProperty(node, 'getAttribute', {
      configurable: true,
      value(name: string) {
        if (name === 'data-ripple-visual-corr') throw new Error('collector failure token=private-value')
        return Element.prototype.getAttribute.call(this, name)
      },
    })
  })
  const throwing = await captureVisualSide(page, {
    side: 'candidate', route: '/', screenshot: 'none', awaitFonts: false,
    collectorSource: collectRuntimeIdentitySnapshot.toString(),
  })
  const throwingResult = writeRuntimeIdentityArtifact(root, 'desktop', 'candidate', throwing)
  expect(throwingResult).toMatchObject({ archive: 'failed', reason: 'collector-error', detail: 'collector failure token=<redacted>' })

  const failures = [
    { schema: 'ripple-runtime-identity-capture/v1', ...base, side: 'baseline', ...missingResult },
    { schema: 'ripple-runtime-identity-capture/v1', ...base, side: 'candidate', ...throwingResult },
  ]
  fs.writeFileSync(path.join(root, 'failure-captures.json'), JSON.stringify({ schema: 'ripple-a1-identity-failure-captures/v1', captures: failures }, null, 2))
  expect(fs.existsSync(path.join(root, 'identity', 'desktop', 'baseline-identity.json'))).toBe(false)
  expect(fs.existsSync(path.join(root, 'identity', 'desktop', 'candidate-identity.json'))).toBe(false)
})
