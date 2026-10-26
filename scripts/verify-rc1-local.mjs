// RC1 补正浏览器级验证（本地静态预览，不触碰公网）。
// 覆盖：布局双视口、Demo/Real 标识、历史键盘操作、无嵌套交互、门控状态可见性。
// 用法：node scripts/verify-rc1-local.mjs [baseUrl] [outDir]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4310'
const OUT = process.argv[3] ?? 'scripts/smoke-out/rc1'
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const errors = []
async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', e => errors.push(`pageerror: ${e}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return page
}

// ── 桌面 1440×900 ──────────────────────────────────────────────
const desktop = await newPage(1440, 900)
let resp = await desktop.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
check('桌面：页面加载 200', resp.status() === 200)

// P1-3：演示来源说明（正向断言）
await desktop.getByTestId('demo-note').waitFor()
check('桌面：演示来源说明可见（演示预览，内容为模拟数据）',
  (await desktop.getByTestId('demo-note').textContent()).includes('模拟数据'))
check('桌面：无 DEMO 徽章', (await desktop.getByTestId('demo-badge').count()) === 0)
check('桌面：无真实工程徽章', (await desktop.getByTestId('real-badge').count()) === 0)

// P1-1：历史条目无嵌套交互 + 键盘操作
await desktop.getByTestId('open-history').click()
const card = desktop.getByTestId('version-card-v:3')
check('桌面：历史卡片为 article', (await card.evaluate(el => el.tagName)) === 'ARTICLE')
const nested = await card.evaluate(el => el.querySelectorAll('button [role="button"], button button').length)
check('桌面：无 role=button 嵌套 / button 套 button', nested === 0, `嵌套数=${nested}`)

const toggle = desktop.getByTestId('evidence-toggle-v:3')
await toggle.focus()
check('桌面：证据按钮可 Tab 聚焦', await desktop.evaluate(() => document.activeElement?.getAttribute('data-testid')))
await desktop.keyboard.press('Enter')
check('桌面：Enter 展开证据明细', (await toggle.getAttribute('aria-expanded')) === 'true')
await desktop.keyboard.press('Space')
check('桌面：Space 收起证据明细', (await toggle.getAttribute('aria-expanded')) === 'false')
await toggle.click()
check('桌面：鼠标点击再次展开', (await toggle.getAttribute('aria-expanded')) === 'true')
// 点证据按钮不得触发版本选中
check('桌面：点证据按钮不触发版本选中', (await desktop.getByTestId('version-v:3').getAttribute('aria-current')) === 'false')

await desktop.waitForTimeout(600)
await desktop.screenshot({ path: path.join(OUT, 'rc1-desktop-1440x900-history.png'), fullPage: false })

// 门控状态可见性：第 4 步检查清单与未决项
await desktop.getByTestId('tab-evidence').click().catch(() => {})
await desktop.getByTestId('step-tab-4').click()
const precheckVisible = await desktop.getByTestId('precheck-miss-scope').count()
check('桌面：未完成门控项（precheck-miss）可见，不隐藏', precheckVisible > 0, `未决项=${precheckVisible}`)
const genDisabled = await desktop.getByTestId('demo-approve').isDisabled().catch(() => null)
check('桌面：门控禁止时「确定生成」不可点', genDisabled === true, `disabled=${genDisabled}`)
await desktop.screenshot({ path: path.join(OUT, 'rc1-desktop-1440x900-step4-gate.png') })

// 缺失/失败/过期状态可见性（历史里的已失效/无证据）
await desktop.getByTestId('open-history').click()
check('桌面：已失效状态可见', (await desktop.getByTestId('version-v:1').textContent()).includes('已失效'))
check('桌面：无证据状态可见', (await desktop.getByTestId('version-card-v:1').textContent()).includes('无证据'))

// ?adapter=real 屏蔽：不得出现真实徽章
resp = await desktop.goto(`${BASE}/experience.html?adapter=real`, { waitUntil: 'networkidle', timeout: 45_000 })
check('桌面：?adapter=real 被屏蔽为演示（无 real-badge）',
  resp.status() === 200 && (await desktop.getByTestId('real-badge').count()) === 0)
check('桌面：屏蔽后演示来源说明仍可见', (await desktop.getByTestId('demo-note').count()) === 1)
await desktop.close()

// ── 窄屏 390×844 ──────────────────────────────────────────────
const mobile = await newPage(390, 844)
resp = await mobile.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
check('窄屏：页面加载 200', resp.status() === 200)
await mobile.getByTestId('demo-note').waitFor()
check('窄屏：演示来源说明可见', (await mobile.getByTestId('demo-note').count()) === 1)
check('窄屏：无横向滚动溢出', await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  `scrollWidth=${await mobile.evaluate(() => document.documentElement.scrollWidth)}`)
await mobile.getByTestId('open-history').tap().catch(() => mobile.getByTestId('open-history').click())
await mobile.waitForTimeout(600)
await mobile.screenshot({ path: path.join(OUT, 'rc1-mobile-390x844-history.png'), fullPage: false })
check('窄屏：历史面板可操作', (await mobile.getByTestId('version-v:3').count()) === 1)
await mobile.close()

await browser.close()

check('全程：0 console/page 错误', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean')

const failed = results.filter(r => !r.ok)
console.log(`\n=== RC1 本地验证：${results.length - failed.length}/${results.length} PASS，${failed.length} FAIL ===`)
process.exit(failed.length ? 1 : 0)
