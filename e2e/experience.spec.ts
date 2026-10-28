import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

// F 体验工作台浏览器验收（PR #14 第一轮独立审查整改）。
// 覆盖：初始页面、选中与编辑、来源未知元素、Scope 阻断、无选中/无修改不得审批、
// 视口切换、模拟内容不得进入 real 模式、历史切换、桌面与窄窗口布局、控制台错误。

const consoleErrors: string[] = []

async function openExperience(page: Page, url = '/experience.html') {
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(String(error)))
  await page.goto(url, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('xp-topbar')).toBeVisible()
}

test.beforeEach(() => { consoleErrors.length = 0 })

test('初始页面：工程状态、页面导航、画布与演示来源说明', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('project-status')).toContainText('工程就绪')
  await expect(page.getByTestId('demo-note')).toContainText('演示预览')
  await expect(page.getByTestId('demo-note')).not.toContainText('DEMO')
  await expect(page.getByTestId('page-item-page:home')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('demo-canvas')).toBeVisible()
  await expect(page.getByTestId('evidence-drawer')).toBeVisible()
})

test('网站概览按来源确定性分组，页面明细可展开与收起', async ({ page }) => {
  await openExperience(page)
  const provenToggle = page.getByTestId('overview-toggle-source-proven')
  const provenPages = page.getByTestId('overview-list-source-proven')
  await expect(provenPages).toBeVisible()
  await expect(page.getByTestId('overview-toggle-partial')).toContainText('部分证明')
  await expect(page.getByTestId('overview-toggle-unknown')).toContainText('来源未知')
  await provenToggle.click()
  await expect(provenPages).toBeHidden()
  await provenToggle.click()
  await expect(provenPages).toBeVisible()
  await expect(page.getByTestId('page-item-page:home')).toBeVisible()
})

test('UI-RC2 四页可浏览：共享 TEXT 在三页联动，Contact 保留 UNKNOWN', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.getByTestId('demo-layer').selectOption('candidate')

  for (const pageRef of ['page:home', 'page:products', 'page:seasonal'] as const) {
    await page.getByTestId(`page-item-${pageRef}`).click()
    await expect(page.getByTestId(`page-item-${pageRef}`)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('demo-canvas')).toHaveAttribute('data-demo-page', pageRef)
    await expect(page.getByTestId('demo-canvas')).toContainText('冬日茶器市集')
    await expect(page.getByTestId('demo-provenance')).toContainText('DEMO')
  }

  await page.getByTestId('page-item-page:contact').click()
  await expect(page.getByTestId('demo-canvas')).toHaveAttribute('data-demo-page', 'page:contact')
  await expect(page.getByTestId('demo-page-note')).toContainText('来源未证明')
  await expect(page.getByTestId('canvas-el-el:hero-title')).toHaveCount(0)
  await expect(page.getByTestId('draft-text-input')).toBeVisible()
  await expect(page.getByTestId('compare-candidate')).toContainText('冬日茶器市集')
})

test('UI-RC2 PageRail 支持 Enter/Space 键盘导航并同步 aria-current', async ({ page }) => {
  await openExperience(page)
  const products = page.getByTestId('page-item-page:products')
  await products.focus()
  await products.press('Enter')
  await expect(products).toHaveAttribute('aria-current', 'page')
  const seasonal = page.getByTestId('page-item-page:seasonal')
  await seasonal.focus()
  await seasonal.press('Space')
  await expect(seasonal).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('demo-page-title')).toContainText('活动页')
})

test('选中与编辑：标题更新、候选状态推进、前后对照同步', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('selection-summary')).toContainText('活动标题')
  await expect(page.getByTestId('step-tab-2')).toHaveAttribute('aria-current', 'step')
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await expect(page.getByTestId('step-tab-3')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('candidate-status')).toContainText('候选已生成')
  await expect(page.getByTestId('compare-candidate')).toContainText('冬日茶器市集')
  await expect(page.getByTestId('compare-baseline')).toContainText('秋日茶器市集')
  await expect(page.getByTestId('canvas-el-el:hero-title')).toHaveAttribute('aria-pressed', 'true')
})

test('原文与草稿分离：逐字输入不改画布原文，切换元素清空草稿', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  const input = page.getByTestId('draft-text-input')
  await input.pressSequentially('冬日茶器市集')
  // 画布上的原文保持「秋日茶器市集」；候选值只出现在对照区
  await expect(page.getByTestId('canvas-el-el:hero-title')).toContainText('秋日茶器市集')
  await expect(page.getByTestId('compare-candidate')).toContainText('冬日茶器市集')
  await expect(page.getByTestId('evidence-ev:expect')).toContainText('把「秋日茶器市集」改为「冬日茶器市集」')
  // 切换元素：草稿清空，Evidence 换成新目标的原文
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(input).toHaveValue('')
  await expect(page.getByTestId('evidence-ev:expect')).toContainText('以茶会友，以器传心')
})

test('来源未知元素只能查看：无输入框、无编辑授权', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:promo-card').click()
  await expect(page.getByTestId('draft-text-input')).toHaveCount(0)
  await expect(page.getByText('来源未知：可以先查看，但不能承诺修改范围')).toBeVisible()
})

test('Scope 阻断：未证明页面包含/未决定时不得审批，排除后演示审批并给出可见反馈', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await expect(page.getByTestId('gate-reasons')).toContainText('未决定')
  await page.getByTestId('scope-include-page:contact').click()
  await expect(page.getByTestId('gate-reasons')).toContainText('无法完全证明')
  await page.getByTestId('scope-exclude-page:contact').click()
  await page.getByTestId('scope-exclude-page:seasonal').click()
  await expect(page.getByTestId('step-tab-4')).toHaveAttribute('aria-current', 'step')
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认，未执行真实应用')
})

test('无选中/无修改不得审批', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('gate-reasons')).toContainText('尚未选中')
  await expect(page.getByTestId('gate-reasons')).toContainText('修改内容为空')
  await expect(page.getByTestId('precheck-jump-target')).toBeVisible()
  await page.getByTestId('precheck-jump-draft').click()
  await expect(page.getByTestId('step-tab-2')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('demo-approve')).toHaveCount(0)
})

test('视口切换 1440/768/375 与 390 验证中标注', async ({ page }) => {
  await openExperience(page)
  for (const id of ['desktop', 'tablet', 'mobile-375']) {
    await page.getByTestId(`viewport-${id}`).click()
    await expect(page.getByTestId(`viewport-${id}`)).toHaveAttribute('aria-pressed', 'true')
  }
  await page.getByTestId('viewport-mobile-390').click()
  await expect(page.getByTestId('viewport-mobile-390')).toContainText('验证中')
  await expect(page.getByTestId('demo-canvas')).toBeVisible()
})

test('点击涟漪：圆环具备可见边框与有效动画，animationend 后清理', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  const ripple = page.locator('.ripple-xp-ripple')
  await expect(ripple).toHaveCount(1)
  // computed style 实测：边框真实渲染（作用域内 --xp-brand 生效）且动画有效，
  // 防止"节点创建了但圆环不可见"的假通过
  const computed = await ripple.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      borderWidth: style.borderTopWidth,
      borderColor: style.borderTopColor,
      borderStyle: style.borderTopStyle,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      inScope: element.closest('.ripple-xp-scope') !== null,
    }
  })
  expect(computed.inScope).toBe(true)
  expect(computed.borderWidth).not.toBe('0px')
  expect(computed.borderStyle).not.toBe('none')
  expect(computed.borderColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(computed.animationName).toBe('ripple-xp-drop')
  expect(parseFloat(computed.animationDuration)).toBeGreaterThan(0)
  // 动画结束后节点被清理（animationend 或 1s 兜底），绝不留残留
  await expect(ripple).toHaveCount(0, { timeout: 2500 })
})

test('模拟内容不得进入 real 模式：real 桩下无演示 DOM，显示未接入状态', async ({ page }) => {
  await openExperience(page, '/experience.html?adapter=real-stub')
  await expect(page.getByTestId('real-preview-pending')).toContainText('真实预览尚未接入')
  await expect(page.getByTestId('demo-canvas')).toHaveCount(0)
  await expect(page.getByText('尚无真实截图')).toHaveCount(2)
  await expect(page.getByTestId('demo-note')).toHaveCount(0)
  await expect(page.getByTestId('demo-approve')).toHaveCount(0)
  // real 模式没有可执行审批入口，明确提示未接入（不会点击后回演示确认）
  await expect(page.getByTestId('real-approval-pending')).toContainText('正式接口')
})

test('历史切换：胶片展示生命周期，点击定位页面', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('open-history').click()
  await expect(page.getByTestId('version-v:3')).toContainText('已回滚')
  await expect(page.getByTestId('version-v:1')).toContainText('已失效')
  await page.getByTestId('version-v:3').click()
  await expect(page.getByTestId('page-item-page:products')).toHaveAttribute('aria-current', 'page')
})

test('1440、768 与 390 宽度工作台都可操作并记录截图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExperience(page)
  await expect(page.getByTestId('scope-panel')).toBeVisible()
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('selection-summary')).toContainText('活动标题')
  await page.getByTestId('draft-text-input').fill('桌面验收标题')
  await expect(page.getByTestId('compare-candidate')).toContainText('桌面验收标题')
  await page.screenshot({ path: path.join(process.cwd(), 'test-results', 'rc2-demo-workbench-1440x900.png'), fullPage: true })

  await page.setViewportSize({ width: 768, height: 900 })
  await expect(page.getByTestId('scope-panel')).toBeVisible()
  await expect(page.getByTestId('canvas-stage')).toBeVisible()
  await expect(page.getByTestId('canvas-el-el:hero-title')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768)
  await page.screenshot({ path: path.join(process.cwd(), 'test-results', 'rc2-demo-workbench-768x900.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => window.innerWidth)).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(page.getByTestId('scope-panel')).toBeVisible()
  await expect(page.getByTestId('step-tab-1')).toBeVisible()
  await expect(page.getByTestId('canvas-el-el:hero-title')).toBeVisible()
  await page.getByTestId('draft-text-input').fill('窄屏验收标题')
  await expect(page.getByTestId('compare-candidate')).toContainText('窄屏验收标题')
  await page.getByTestId('scope-exclude-page:contact').click()
  await expect(page.getByTestId('scope-exclude-page:contact')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('selection-summary')).toContainText('活动标题')
  await page.screenshot({ path: path.join(process.cwd(), 'test-results', 'rc2-demo-workbench-390x844.png'), fullPage: true })
})

test('任务一：切换编辑目标重建页面关系与默认范围（标题→副标题→标题）', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('同源关联')
  await page.getByTestId('scope-protect-page:products').click()
  // 切换到副标题：商品专题不再虚假显示同源，旧 Scope 决定不残留
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('影响未证明')
  await expect(page.getByTestId('page-item-page:products')).not.toContainText('同源关联')
  await expect(page.getByTestId('scope-row-page:products')).toContainText('未决定')
  // 返回标题：默认影响关系与 Scope 恢复
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('同源关联')
  await expect(page.getByTestId('scope-include-page:products')).toHaveAttribute('aria-pressed', 'true')
})

test('任务一负例：partial 目标不产生已证明无关页，来源确定性不被提升', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:seasonal-banner').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('影响未证明')
  await expect(page.getByTestId('scope-row-page:products')).toContainText('未决定')
  // 整个页面导航中除当前编辑页外不允许出现"来源已证实"的页面关系
  await page.getByTestId('canvas-el-el:promo-card').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('影响未证明')
  await expect(page.getByTestId('page-item-page:seasonal')).toContainText('影响未证明')
})

test('任务二：对照区绑定当前目标，无选中/无草稿显示明确状态', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('compare-baseline')).toContainText('尚未选中要修改的位置')
  await expect(page.getByTestId('compare-candidate')).toContainText('尚未生成候选')
  await expect(page.getByTestId('compare-baseline')).not.toContainText('秋日茶器市集')
  // 副标题原文与草稿对照
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(page.getByTestId('compare-baseline')).toContainText('以茶会友，以器传心')
  await page.getByTestId('draft-text-input').fill('以器会友，以茶传心')
  await expect(page.getByTestId('compare-candidate')).toContainText('以器会友，以茶传心')
  // 清空草稿：候选侧恢复未生成状态，原文不被伪装成候选
  await page.getByTestId('draft-text-input').fill('')
  await expect(page.getByTestId('compare-candidate')).toContainText('尚未生成候选')
})

test('任务三：演示审批反馈随范围/草稿/目标修订失效', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.getByTestId('scope-exclude-page:contact').click()
  await page.getByTestId('scope-exclude-page:seasonal').click()
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认')
  // 修改范围决策 → 旧反馈消失，门控重新阻断且审批按钮不可用
  await page.getByTestId('scope-include-page:contact').click()
  await expect(page.getByTestId('approve-feedback')).toHaveCount(0)
  await expect(page.getByTestId('gate-reasons')).toContainText('无法完全证明')
  await expect(page.getByTestId('demo-approve')).toHaveCount(0)
  // 恢复范围 → 再次审批 → 修改草稿 → 旧反馈消失
  await page.getByTestId('scope-exclude-page:contact').click()
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认')
  await page.getByTestId('draft-text-input').fill('初冬茶器市集')
  await expect(page.getByTestId('approve-feedback')).toHaveCount(0)
  // 重新审批 → 切换目标 → 旧确认不得跨目标复用
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认')
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(page.getByTestId('approve-feedback')).toHaveCount(0)
})

test('控制台无错误', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.getByTestId('open-history').click()
  await page.getByTestId('version-v:2').click()
  expect(consoleErrors).toEqual([])
})

// ---- Real Adapter 第一阶段：真实后端连接（不依赖 Docker；预演两态均合法） ----

const tempRoot = path.join(process.cwd(), 'node_modules', '.tmp')
fs.mkdirSync(tempRoot, { recursive: true })
const realSandbox = fs.mkdtempSync(path.join(tempRoot, 'ripple-xp-real-'))
const realProjectRoot = path.join(realSandbox, 'site')
const fixtureNodeModules = path.resolve('test/fixtures/react-vite-tailwind/node_modules')

test.beforeAll(() => {
  fs.mkdirSync(path.join(realProjectRoot, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(realProjectRoot, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(realProjectRoot, 'package.json'), JSON.stringify({ name: 'ripple-xp-real-fixture', private: true, type: 'module' }))
  fs.writeFileSync(path.join(realProjectRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.jsx"></script>')
  fs.writeFileSync(path.join(realProjectRoot, 'src', 'main.jsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<App />)\n")
  fs.writeFileSync(path.join(realProjectRoot, 'src', 'App.jsx'), "import { useState } from 'react'; import { HomePage } from './pages/HomePage.jsx'; import { AboutPage } from './pages/AboutPage.jsx'; export function App(){const [page,setPage]=useState('home');return <><nav><button onClick={()=>setPage('home')}>Home</button><button onClick={()=>setPage('about')}>About</button></nav>{page==='home'?<HomePage/>:<AboutPage/>}</>}\n")
  fs.writeFileSync(path.join(realProjectRoot, 'src', 'pages', 'HomePage.jsx'), "export function HomePage(){return <main><h1>Acme 真实首页标题</h1><p>真实首页文案内容。</p></main>}\n")
  fs.writeFileSync(path.join(realProjectRoot, 'src', 'pages', 'AboutPage.jsx'), "export function AboutPage(){return <main><h1>关于我们真实文案</h1></main>}\n")
  if (fs.existsSync(fixtureNodeModules)) fs.symlinkSync(fixtureNodeModules, path.join(realProjectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', ['-C', realProjectRoot, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'xp-real@example.invalid'); git('config', 'user.name', 'XP real test'); git('add', '.'); git('commit', '-qm', 'baseline')
})

test.afterAll(() => {
  // Windows 中文工作区下临时目录删除偶发 EPERM（已知本机环境限制，见 HANDOFF 第 6 节）；尽力清理
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { fs.rmSync(realSandbox, { recursive: true, force: true }); break } catch { /* 重试 */ }
  }
})

test('REAL 模式：连接真实后端读取已分析工程（页面/目标/证据如实呈现）', async ({ page }) => {
  const analyze = await page.request.post('http://127.0.0.1:4173/__ripple/api/analyze', { data: { projectRoot: realProjectRoot } })
  expect(analyze.ok(), `analyze 失败：${await analyze.text()}`).toBeTruthy()
  await openExperience(page, `/experience.html?adapter=real&project=${encodeURIComponent(realProjectRoot)}`)
  // 真实工程身份与页面列表来自 analyze 响应
  await expect(page.getByTestId('real-badge')).toContainText('真实工程')
  await expect(page.getByTestId('project-status')).toContainText('工程就绪')
  await expect(page.getByTestId('demo-note')).toHaveCount(0)
  await expect(page.getByTestId('page-item-page:home')).toBeVisible()
  // 真实页面导航第一阶段明确未接入：按钮停用 + 说明，不误导用户以为画布已切页
  await expect(page.getByTestId('page-nav-pending')).toContainText('尚未接入')
  await expect(page.getByTestId('page-item-page:home')).toHaveAttribute('aria-current', 'page')
  // 编辑目标来自 targets，绝不出现演示 DOM
  await expect(page.getByTestId('target-strip')).toContainText('Acme 真实首页标题')
  await expect(page.getByTestId('demo-canvas')).toHaveCount(0)
  // 无真实候选：验证证据如实"尚未运行"，候选状态"尚无候选"
  await expect(page.getByTestId('evidence-ev:verification')).toContainText('尚未运行')
  await expect(page.getByTestId('candidate-status')).toContainText('尚无候选')
  // 真实审批未接入；对照区无真实截图时明确提示
  await expect(page.getByTestId('real-approval-pending')).toContainText('正式接口')
  await expect(page.getByText('尚无真实截图').first()).toBeVisible()
  // 选中真实目标：摘要显示真实源码路径；本地草稿不推进真实候选生命周期
  await page.getByTestId('target-strip').getByRole('button', { name: /Acme 真实首页标题/ }).click()
  await expect(page.getByTestId('selection-summary')).toBeVisible()
  await page.getByTestId('draft-text-input').fill('Acme 新首页标题')
  await expect(page.getByTestId('evidence-ev:intent')).toContainText('Acme 新首页标题')
  await expect(page.getByTestId('candidate-status')).toContainText('尚无候选')
})

test('REAL 模式：画布预演两态均合法（有 Docker 出 iframe，无 Docker 出准确阻断原因）', async ({ page }) => {
  await page.request.post('http://127.0.0.1:4173/__ripple/api/analyze', { data: { projectRoot: realProjectRoot } })
  await openExperience(page, `/experience.html?adapter=real&project=${encodeURIComponent(realProjectRoot)}`)
  const frame = page.getByTestId('real-preview-frame')
  const pending = page.getByTestId('real-preview-pending')
  await expect(frame.or(pending).first()).toBeVisible({ timeout: 150_000 })
  // iframe 只加载服务端核验的预演地址，隔离属性与 A 工作台一致
  if (await frame.isVisible().catch(() => false)) {
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    const src = await frame.getAttribute('src')
    expect(src).toContain('127.0.0.1')
  } else {
    await expect(pending).toContainText('真实预览不可用')
  }
  await expect(page.getByTestId('demo-canvas')).toHaveCount(0)
})

test('REAL 模式：未打开工程显示打开入口；分析失败给出准确原因，修正后可打开', async ({ page }) => {
  await openExperience(page, '/experience.html?adapter=real')
  await expect(page.getByTestId('open-project-form')).toBeVisible()
  await expect(page.getByTestId('blocked-reason')).toContainText('尚未选择工程')
  // 不存在的路径：服务端错误如实显示（ENOENT 原文透出，不粉饰为演示默认值）
  await page.getByTestId('open-project-path').fill(path.join(realSandbox, 'no-such-dir'))
  await page.getByTestId('open-project-submit').click()
  await expect(page.getByTestId('open-project-error')).toContainText('no-such-dir')
  // 修正为真实工程：分析成功，真实页面出现
  // 冷启动首次 analyze 在本机 Windows 环境可能超过默认 5s，放宽到 30s 防偶发超时
  await page.getByTestId('open-project-path').fill(realProjectRoot)
  await page.getByTestId('open-project-submit').click()
  await expect(page.getByTestId('project-status')).toContainText('工程就绪', { timeout: 30_000 })
  await expect(page.getByTestId('page-item-page:home')).toBeVisible()
  await expect(page.getByTestId('demo-canvas')).toHaveCount(0)
})
