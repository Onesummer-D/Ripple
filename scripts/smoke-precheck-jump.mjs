// 冒烟：修改前检查清单 → 数字编号 + 未完成感叹号 + 点击跳转对应步骤
import { chromium } from 'playwright'

const OUT_DIR = 'D:/文件/比赛/全国数媒/Ripple/scripts'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.goto('http://127.0.0.1:4173/experience.html?adapter=demo', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(1200)

// 直接进第 4 步：什么都还没做，三项都应未完成
await page.getByTestId('step-tab-4').click()
await page.waitForTimeout(300)

const icons = await page.$$eval('.ripple-xp-precheck-icon', els => els.map(e => e.textContent.trim()))
console.log('leading numbers:', JSON.stringify(icons))
const misses = await page.$$eval('.ripple-xp-precheck-miss', els => els.map(e => e.textContent.trim()))
console.log('miss badges:', JSON.stringify(misses))
const jumps = await page.$$eval('.ripple-xp-precheck-jump', els => els.map(e => e.getAttribute('data-testid')))
console.log('jump buttons:', JSON.stringify(jumps))
await page.screenshot({ path: `${OUT_DIR}/smoke-precheck-pending.png` })

// 点「确认影响范围」的未完成项 → 应回到第 3 步
await page.getByTestId('precheck-jump-scope').click()
await page.waitForTimeout(300)
const onStep3 = await page.getByTestId('scope-progress').isVisible().catch(() => false)
console.log('jump scope -> step3 visible:', onStep3 ? 'PASS' : 'FAIL')
await page.screenshot({ path: `${OUT_DIR}/smoke-precheck-jumped-scope.png` })

// 回第 4 步，点「选择要修改的元素」→ 应回第 1 步
await page.getByTestId('step-tab-4').click()
await page.getByTestId('precheck-jump-select').click()
await page.waitForTimeout(300)
const step1Count = await page.getByTestId('step-tab-1').getAttribute('aria-selected')
console.log('jump select -> step1 selected:', step1Count === 'true' ? 'PASS' : 'FAIL')

// 补完前两项：选中元素 + 填草稿，再回第 4 步看部分完成态
await page.getByTestId('canvas-el-el:hero-title').click()
await page.getByTestId('draft-text-input').fill('冬日茶器市集')
await page.getByTestId('step-tab-4').click()
await page.waitForTimeout(300)
const icons2 = await page.$$eval('.ripple-xp-precheck-icon', els => els.map(e => e.textContent.trim()))
const misses2 = await page.$$eval('.ripple-xp-precheck-miss', els => els.map(e => e.textContent.trim()))
const dones = await page.$$eval('.ripple-xp-precheck-done', els => els.length)
console.log('after fix — numbers:', JSON.stringify(icons2), '| misses:', JSON.stringify(misses2), '| done checks:', dones)
await page.screenshot({ path: `${OUT_DIR}/smoke-precheck-partial.png` })

console.log('console/page errors:', errors.length ? errors.join(' | ') : '0')
await browser.close()
