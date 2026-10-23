import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

// F 第二阶段第一批真实链路浏览器验收（独立审查第四项）。
// 主流程：真实打开工程 → iframe 内实际点选文字 → /project/source-selection（真实 sourceRef）
// → 修改 + 显式 Scope 决策 → /candidate 真实生成 CandidateRecord → /candidate/preview 真实预演
// → 补丁/候选 ID/源文件未改动/会话清理核对。负例：来源不完整、过期会话、缺页 Scope、
// shared Scope 携带 localPageRef（P0 合同回归）。全部走真实 A 后端，无任何 mock。

const sandbox = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.tmp', 'ripple-xp-flow-'))
const projectRoot = path.join(sandbox, 'site')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence-real-flow')
const API = 'http://127.0.0.1:4173/__ripple/api'
fs.mkdirSync(evidenceRoot, { recursive: true })

test.beforeAll(() => {
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'ripple-xp-flow-fixture', private: true, type: 'module' }))
  // 必须是合法 HTML 文档：A 核心的点选桥脚本经 transformIndexHtml 替换 </body> 注入，
  // 缺少 body 标签的片段会导致桥缺失（标注仍在、点选握手永不激活）。
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Ripple XP Flow Fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>')
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.jsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<App />)\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.jsx'), "import { useState } from 'react'; import { HomePage } from './pages/HomePage.jsx'; import { AboutPage } from './pages/AboutPage.jsx'; export function App(){const [page,setPage]=useState('home'); return <><nav><button onClick={()=>setPage('home')}>Home</button><button onClick={()=>setPage('about')}>About</button></nav>{page==='home' ? <HomePage/> : <AboutPage/>}</>}\n")
  // 固定来源：JSX 文本节点，静态分析可完全证明页面影响
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), "export function HomePage(){return <main><h1>Acme 真实首页标题</h1><p>真实首页文案内容。</p></main>}\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'AboutPage.jsx'), "export function AboutPage(){return <main><h1>关于我们真实文案</h1></main>}\n")
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'xp-flow@example.invalid'); git('config', 'user.name', 'XP flow test'); git('add', '.'); git('commit', '-qm', 'baseline')
})

test.afterAll(async () => {
  // 尽力清理：丢弃活动候选并停止预演（幂等）
  try {
    const history = await (await fetch(`${API}/history`)).json() as { history?: Array<{ candidateId: string; lifecycle: string }> }
    for (const item of history.history ?? []) {
      if (item.lifecycle === 'active') await fetch(`${API}/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: item.candidateId }) }).catch(() => undefined)
    }
  } catch { /* 尽力清理 */ }
  // Windows 中文工作区下临时目录删除偶发 EPERM（已知本机环境限制）；尽力清理
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); break } catch { /* 重试 */ }
  }
})

async function analyzeFixture() {
  const response = await fetch(`${API}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectRoot }) })
  // 注意：响应体只能读一次——失败时读文本，成功时读 JSON
  if (!response.ok) throw new Error(`analyze 失败：${await response.text()}`)
  return (await response.json()) as {
    revision: { projectId: string; sourceDigest: string }
    routes: Array<{ id: string }>
    targets: Array<{ id: string; label: string; impact: { pageRefs: string[]; certainty: string } }>
  }
}

test('真实链路：iframe 点选 → source-selection → Scope 决策 → 候选创建 → 候选预演 → 会话清理', async ({ page }) => {
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const analysis = await analyzeFixture()
  const titleTarget = analysis.targets.find(item => item.label.includes('Acme 真实首页标题'))
  expect(titleTarget, '首页标题必须是已分析目标').toBeTruthy()
  expect(titleTarget!.impact.certainty).toBe('source-proven')

  await page.goto(`/experience.html?adapter=real&project=${encodeURIComponent(projectRoot)}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('real-badge')).toContainText('真实工程')

  // 预演两态：本机无 Docker 时如实跳过主链路（CI 具备 Docker，必须全链路执行）
  const frame = page.getByTestId('real-preview-frame')
  const pending = page.getByTestId('real-preview-pending')
  await expect(frame.or(pending).first()).toBeVisible({ timeout: 150_000 })
  if (!(await frame.isVisible().catch(() => false))) {
    if (process.env.CI) throw new Error('CI 必须具备 Docker 隔离预演：真实点选链路不可跳过')
    test.skip(true, '本机无 Docker：隔离项目预演不可用，真实链路在 CI（ubuntu + Docker）执行')
  }

  // 1-2. 进入画布点选 → 在 iframe 内实际点击标题文字
  await expect(page.getByTestId('picker-toggle')).toBeEnabled()
  await page.getByTestId('picker-toggle').click()
  await expect(page.getByTestId('picker-hint')).toBeVisible()
  const projectFrame = page.frameLocator('[data-testid="real-preview-frame"]')
  await expect(projectFrame.getByRole('heading', { name: 'Acme 真实首页标题' })).toBeVisible({ timeout: 90_000 })

  // 2b. 预演标注与点选模式握手核查（D 桥注入 + ripple:selection-mode 送达）：
  // h1 必须带 data-ripple-source；桥激活时 documentElement 光标变为 crosshair。
  const previewFrame = page.frames().find(candidate => candidate !== page.mainFrame())!
  const sourceRef = await previewFrame.locator('h1').getAttribute('data-ripple-source')
  expect(sourceRef, '预演必须把 h1 标注到 JSX 源码').toMatch(/^jsx:src\/pages\/HomePage\.jsx#\d+$/)
  // 送达探针：记录预演文档收到的全部 postMessage（区分 F 侧未发出 / 桥未激活）
  await previewFrame.evaluate(() => {
    const w = window as unknown as { __rippleProbe: unknown[] }
    w.__rippleProbe = []
    window.addEventListener('message', event => {
      const data = event.data as { type?: string; enabled?: boolean } | null
      w.__rippleProbe.push({ type: data?.type ?? null, enabled: data?.enabled ?? null, fromParent: event.source === window.parent })
    })
  })
  const readProbe = () => previewFrame.evaluate(() => JSON.stringify((window as unknown as { __rippleProbe: unknown[] }).__rippleProbe))
  // 退出再重进：验证 enabled:false 送达（不残留旧点选模式）+ nonce 轮换
  await page.getByTestId('picker-toggle').click() // 关闭（第 80 行已开启）
  await expect(page.getByTestId('picker-hint')).toHaveCount(0)
  await page.getByTestId('picker-toggle').click() // 重新进入
  await expect(page.getByTestId('picker-hint')).toBeVisible()
  let probeLog = '[]'
  await expect
    .poll(async () => { probeLog = await readProbe(); return probeLog }, { timeout: 10_000, message: '预演 iframe 未收到 ripple:selection-mode（F 侧 postMessage 未送达）' })
    .toContain('"type":"ripple:selection-mode"')
  // 消息必须来自父页（D 桥同样校验 event.source === window.parent）
  expect(probeLog, 'selection-mode 必须来自父页窗口').toContain('"fromParent":true')
  await expect
    .poll(() => previewFrame.evaluate(() => document.documentElement.style.cursor), { timeout: 10_000 })
    .toBe('crosshair')
    .catch((error: unknown) => {
      throw new Error(`D 桥未进入点选模式（桥脚本未注入或信封被拒）。探针=${probeLog}`, { cause: error })
    })
  const cursorAfterHandshake = await previewFrame.evaluate(() => document.documentElement.style.cursor)
  if (cursorAfterHandshake !== 'crosshair') {
    throw new Error(`D 桥未进入点选模式。探针=${await readProbe()} cursor=${cursorAfterHandshake}`)
  }

  // 3. 真实 sourceRef：D 桥信封 → 服务端 /project/source-selection 授权
  // 先等任意状态的响应（4xx 也会被捕获并带正文报错，避免整体超时无诊断）
  const selectionResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/project/source-selection'), { timeout: 60_000 })
  await projectFrame.getByRole('heading', { name: 'Acme 真实首页标题' }).click()
  const selectionHttp = await selectionResponse
  expect(selectionHttp.ok(), `source-selection 未成功：${await selectionHttp.text()}`).toBe(true)
  const selection = await selectionHttp.json() as { element: { id: string } }
  expect(selection.element.id).toBe(sourceRef)
  await expect(page.getByTestId('selection-summary')).toBeVisible()
  await expect(page.getByTestId('runtime-identity')).toBeVisible()
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-flow-picked-1440.png'), fullPage: true })

  // 4. 修改文字 + 显式 Scope 决策：非锁定页面全部显式排除（不臆造包含）
  await page.getByTestId('draft-text-input').fill('Acme 旗舰店标题')
  const excludeButtons = page.locator('button[data-testid^="scope-exclude-"]:not([disabled])')
  for (let index = 0; index < await excludeButtons.count(); index += 1) await excludeButtons.nth(index).click()
  await expect(page.getByTestId('scope-summary')).toContainText('未决定 0')

  // 5. POST /candidate：真实生成 CandidateRecord（响应即服务端持久化结果）
  const candidateResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate') && response.status() === 200)
  await page.getByTestId('create-candidate').click()
  const candidatePayload = await (await candidateResponse).json() as {
    sessionId: string
    candidate: { id: string; patchHash?: string }
    workflow: { lifecycle: string }
  }
  await expect(page.getByTestId('candidate-box')).toBeVisible()
  expect(candidatePayload.workflow.lifecycle).toBe('active')

  // 项目预演已在候选创建时停止：画布如实呈现，点选已退出
  await expect(page.getByTestId('real-preview-pending')).toContainText('项目预演已在候选创建时停止')

  // 6. POST /candidate/preview：画布显示真实候选（补丁后的文字）
  await page.getByTestId('candidate-preview-toggle').click()
  const candidateFrame = page.frameLocator('[data-testid="candidate-preview-frame"]')
  await expect(candidateFrame.getByRole('heading', { name: 'Acme 旗舰店标题' })).toBeVisible({ timeout: 120_000 })
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-flow-candidate-1440.png'), fullPage: true })

  // 6b. POST /candidate/verify：真实四视口验证（消费服务端 VerificationRun，F 不自行生成结论）
  const verifyResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/verify') && response.status() === 200, { timeout: 180_000 })
  await page.getByTestId('run-verification').click()
  const verifyPayload = await (await verifyResponse).json() as {
    candidateId: string
    verification: { state: string; runId?: string; recordHash?: string; evidence?: Array<{ artifactUrl?: string }> }
  }
  expect(verifyPayload.candidateId).toBe(candidatePayload.candidate.id)
  expect(verifyPayload.verification.runId, '正式验证运行记录必须存在').toBeTruthy()
  expect(['passed', 'risks', 'incomplete', 'stale']).toContain(verifyPayload.verification.state)
  // 界面如实展示验证运行：状态、运行 ID、四视口截图
  const verificationStatus = page.getByTestId('verification-status')
  await expect(verificationStatus).toBeVisible()
  await expect(verificationStatus).toContainText(verifyPayload.verification.runId!.slice(0, 12))
  await expect(page.getByTestId('verification-shots')).toBeVisible()
  const shotCount = await page.getByTestId('verification-shots').locator('img').count()
  expect(shotCount, '四视口验证应产出真实截图').toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-flow-verified-1440.png'), fullPage: true })

  // 6c. 异步切换路径（Docker E2E 覆盖要求）：刷新重建预演 → 点选第二个目标 → 新候选不得残留旧验证
  await page.getByTestId('refresh-project').click()
  await expect(page.getByTestId('real-preview-frame')).toBeVisible({ timeout: 150_000 })
  // 刷新如实关闭候选预演入口状态（旧候选预演地址不再假定可用）
  await expect(page.getByTestId('candidate-preview-toggle')).toContainText('打开候选预演')
  // 点选第二目标（正文段落）
  await page.getByTestId('picker-toggle').click()
  await expect(page.getByTestId('picker-hint')).toBeVisible()
  await projectFrame.getByText('真实首页文案内容。').click()
  await expect(page.getByTestId('selection-summary')).toBeVisible()
  await page.getByTestId('picker-toggle').click() // 退出点选模式
  await page.getByTestId('draft-text-input').fill('Acme 旗舰店文案。')
  const excludeButtons2 = page.locator('button[data-testid^="scope-exclude-"]:not([disabled])')
  for (let index = 0; index < await excludeButtons2.count(); index += 1) await excludeButtons2.nth(index).click()
  await expect(page.getByTestId('scope-summary')).toContainText('未决定 0')
  const candidate2Response = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate') && response.status() === 200)
  await page.getByTestId('create-candidate').click()
  const candidate2Payload = await (await candidate2Response).json() as { candidate: { id: string } }
  expect(candidate2Payload.candidate.id).not.toBe(candidatePayload.candidate.id)
  // 复核点 1（真实浏览器）：新候选不得展示上一个候选的验证运行
  await expect(page.getByTestId('verification-status')).toHaveCount(0)
  // 新候选再次运行验证：真实 VerificationRun
  const verify2Response = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/verify') && response.status() === 200, { timeout: 180_000 })
  await page.getByTestId('run-verification').click()
  const verify2Payload = await (await verify2Response).json() as { verification: { state: string; runId?: string } }
  expect(verify2Payload.verification.runId, '第二个候选的验证运行记录必须存在').toBeTruthy()
  expect(['passed', 'risks', 'incomplete', 'stale']).toContain(verify2Payload.verification.state)
  await expect(page.getByTestId('verification-status')).toContainText(verify2Payload.verification.runId!.slice(0, 12))
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-flow-switched-1440.png'), fullPage: true })

  // 7a. 候选 ID 与补丁以服务端历史为权威（候选-1 已被候选-2 取代退役）
  const history = await (await fetch(`${API}/history?projectId=${analysis.revision.projectId}`)).json() as {
    history: Array<{ candidateId: string; lifecycle: string; patchHash?: string; baseSourceDigest: string }>
  }
  const stored = history.history.find(item => item.candidateId === candidatePayload.candidate.id)
  expect(stored, '候选必须已持久化到服务端历史').toBeTruthy()
  expect(stored!.lifecycle).toBe('discarded')
  expect(stored!.patchHash).toBe(candidatePayload.candidate.patchHash)
  expect(stored!.baseSourceDigest).toBe(analysis.revision.sourceDigest)
  const stored2 = history.history.find(item => item.candidateId === candidate2Payload.candidate.id)
  expect(stored2?.lifecycle).toBe('active')

  // 7b. 源文件未被改动：候选是隔离 worktree 上的补丁，原工程保持干净
  const sourceOnDisk = fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), 'utf8')
  expect(sourceOnDisk).toContain('Acme 真实首页标题')
  expect(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')

  // 7c. 会话清理：打开候选-2 预演后关闭（服务端真实停止）
  await page.getByTestId('candidate-preview-toggle').click()
  await expect(page.frameLocator('[data-testid="candidate-preview-frame"]').getByText('Acme 旗舰店文案。')).toBeVisible({ timeout: 120_000 })
  const stopResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/preview/stop') && response.status() === 200)
  await page.getByTestId('candidate-preview-toggle').click()
  await stopResponse
  await expect(page.getByTestId('candidate-box')).toBeVisible()
})

test.describe('A 核心合同负例（真实后端，无 Docker 依赖）', () => {
  test('过期/伪造预演会话的 source-selection 一律拒绝', async ({ request }) => {
    const analysis = await analyzeFixture()
    const response = await request.post(`${API}/project/source-selection`, { data: {
      projectId: analysis.revision.projectId,
      previewId: 'preview-not-exists',
      sourceDigest: analysis.revision.sourceDigest,
      sourceRef: 'jsx:src/pages/HomePage.jsx#1',
    } })
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(await response.text()).toContain('已关闭或已替换的项目预览')
  })

  test('来源不完整：Scope 引用图中不存在的对象被拒绝', async ({ request }) => {
    const analysis = await analyzeFixture()
    const response = await request.post(`${API}/candidate`, { data: {
      projectId: analysis.revision.projectId,
      rawIntent: '负例：不存在的目标',
      operations: [{ id: 'op-neg-1', kind: 'TEXT', targetRef: 'jsx:src/pages/Nope.jsx#1', before: 'a', after: 'b' }],
      scope: {
        id: 'scope-neg-1', version: 1, strategy: 'shared',
        includedRefs: ['jsx:src/pages/Nope.jsx#1'], excludedRefs: [], protectedRefs: [],
        decidedBy: 'local-user', decidedAt: new Date().toISOString(),
      },
    } })
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(await response.text()).toContain('不存在的对象')
  })

  test('缺页 Scope：目标证明页被排除/缺失时候选被拒绝', async ({ request }) => {
    const analysis = await analyzeFixture()
    const titleTarget = analysis.targets.find(item => item.label.includes('Acme 真实首页标题'))!
    // includedRefs 只含目标、不含其证明页 → evaluateOperationPageScope 冲突
    const response = await request.post(`${API}/candidate`, { data: {
      projectId: analysis.revision.projectId,
      rawIntent: '负例：缺页 Scope',
      operations: [{ id: 'op-neg-2', kind: 'TEXT', targetRef: titleTarget.id, before: 'Acme 真实首页标题', after: 'Acme 缺页标题' }],
      scope: {
        id: 'scope-neg-2', version: 1, strategy: 'shared',
        includedRefs: [titleTarget.id], excludedRefs: [], protectedRefs: [],
        decidedBy: 'local-user', decidedAt: new Date().toISOString(),
      },
    } })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('P0 合同回归：shared Scope 携带 localPageRef 被 A 核心拒绝；includedRefs 缺 targetRef 同样拒绝', async ({ request }) => {
    const analysis = await analyzeFixture()
    const titleTarget = analysis.targets.find(item => item.label.includes('Acme 真实首页标题'))!
    const pageRef = titleTarget.impact.pageRefs[0]
    expect(pageRef, '标题必须有已证明页面').toBeTruthy()
    const base = {
      projectId: analysis.revision.projectId,
      rawIntent: 'P0 合同负例',
      operations: [{ id: 'op-p0-1', kind: 'TEXT', targetRef: titleTarget.id, before: 'Acme 真实首页标题', after: 'Acme P0 标题' }],
    }
    // 问题 A：shared + localPageRef
    const sharedWithLocal = await request.post(`${API}/candidate`, { data: {
      ...base,
      scope: {
        id: 'scope-p0-a', version: 1, strategy: 'shared', localPageRef: pageRef,
        includedRefs: [titleTarget.id, pageRef], excludedRefs: [], protectedRefs: [],
        decidedBy: 'local-user', decidedAt: new Date().toISOString(),
      },
    } })
    expect(sharedWithLocal.status()).toBeGreaterThanOrEqual(400)
    expect(await sharedWithLocal.text()).toContain('不能携带局部页面引用')
    // 问题 B：includedRefs 缺 targetRef
    const missingTarget = await request.post(`${API}/candidate`, { data: {
      ...base,
      scope: {
        id: 'scope-p0-b', version: 1, strategy: 'shared',
        includedRefs: [pageRef], excludedRefs: [], protectedRefs: [],
        decidedBy: 'local-user', decidedAt: new Date().toISOString(),
      },
    } })
    expect(missingTarget.status()).toBeGreaterThanOrEqual(400)
    // 真实 A 核心在 stageOperations 阶段即以 invariant 拒绝（未被 Scope 授权的目标）
    expect(await missingTarget.text()).toContain('unscoped target')
  })

  test('验证失败路径：工作树被改动后 verify 如实拒绝，候选退役为 stale（真实后端）', async ({ request }) => {
    const analysis = await analyzeFixture()
    const titleTarget = analysis.targets.find(item => item.label.includes('Acme 真实首页标题'))!
    const pageRef = titleTarget.impact.pageRefs[0]
    const created = await request.post(`${API}/candidate`, { data: {
      projectId: analysis.revision.projectId,
      rawIntent: '验证失败路径负例',
      operations: [{ id: 'op-fail-1', kind: 'TEXT', targetRef: titleTarget.id, before: 'Acme 真实首页标题', after: 'Acme 失败路径标题' }],
      scope: {
        id: 'scope-fail-1', version: 1, strategy: 'shared',
        includedRefs: [titleTarget.id, pageRef], excludedRefs: [], protectedRefs: [],
        decidedBy: 'local-user', decidedAt: new Date().toISOString(),
      },
    } })
    expect(created.status(), await created.text()).toBe(200)
    const { candidate } = await created.json() as { candidate: { id: string } }
    // 候选创建后改动工作树：候选基线过期（assertCurrentOrRetire 在启动验证【之前】拦截）
    fs.appendFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), '\n// dirty-tree: verify failure path\n')
    try {
      const verify = await request.post(`${API}/candidate/verify`, { data: { candidateId: candidate.id } })
      expect(verify.status(), await verify.text()).toBeGreaterThanOrEqual(400)
      // 服务端把候选退役为 stale：历史如实反映（F 失败路径回读历史后如实展示）
      const history = await (await request.get(`${API}/history?projectId=${analysis.revision.projectId}`)).json() as {
        history: Array<{ candidateId: string; lifecycle: string }>
      }
      const stored = history.history.find(item => item.candidateId === candidate.id)
      expect(stored?.lifecycle).toBe('stale')
    } finally {
      // 还原工作树：后续测试与 afterAll 清理依赖干净基线
      execFileSync('git', ['-C', projectRoot, 'checkout', '--', 'src/pages/HomePage.jsx'])
    }
  })
})
