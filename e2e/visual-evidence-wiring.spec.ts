import { expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// 第一批真实接线验收：analyze → candidate → verify 全链路中，
// 容器采集 → manifest v4 → host 视觉分析 → run.visualEvidences →
// verificationView 只读输出 必须真实发生，且不得改变正式审批门控。
// Docker 隔离浏览器仅在 Linux CI 可用；Windows 本地自动跳过。

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-visual-wiring-'))
const projectRoot = path.join(sandbox, 'site')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence')
const dockerAvailable = process.platform === 'linux' && spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0
const api = 'http://127.0.0.1:4173/__ripple/api'
let candidateId = ''
fs.mkdirSync(evidenceRoot, { recursive: true })

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
  const created = await post('candidate', {
    projectId: analysis.revision.projectId,
    rawIntent: 'Change only the home title and verify visual evidence wiring.',
    scope,
    operations: [{ id: 'title-op', kind: 'TEXT', targetRef: title.id, before: title.value, after: 'Visual wiring candidate title' }],
    verificationContract: { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Visual wiring baseline title' }], interactions: [] },
  })
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

  // 6. 保存真实交付工件
  fs.writeFileSync(path.join(evidenceRoot, 'visual-evidence-wiring-verification.json'), JSON.stringify(verified, null, 2))
  fs.writeFileSync(path.join(evidenceRoot, 'visual-evidence-wiring-views.json'), JSON.stringify(visualEvidences.map((entry: { view: unknown }) => entry.view), null, 2))

  // 7. 清理候选
  const discarded = await page.request.post(`${api}/discard`, { data: { candidateId }, headers: { origin: 'http://127.0.0.1:4173' } })
  expect(discarded.ok()).toBeTruthy()
  candidateId = ''
})
