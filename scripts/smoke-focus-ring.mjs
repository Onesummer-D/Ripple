// 冒烟：前后对照「修改位置」标注去按钮化（线上 demo，实测无边框、不可点击）
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://81.70.40.146:8082'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
// 选中首页活动标题 → 前后对照出现「修改位置」标注
await page.getByTestId('canvas-el-el:hero-title').click()
await page.getByTestId('tab-compare').click().catch(() => {})
const ring = page.locator('.ripple-xp-focus-ring').first()
await ring.waitFor({ timeout: 10_000 })
const txt = (await ring.textContent())?.trim()
const style = await ring.evaluate(el => {
  const s = getComputedStyle(el)
  return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, tag: el.tagName }
})
const hidden = await ring.getAttribute('aria-hidden')
// 点击它不应产生任何导航/状态变化（它只是标注）
await ring.click({ force: true }).catch(() => {})
const stillThere = await ring.count()
await page.waitForTimeout(900) // 等滚动浮现动画结束再截图

console.log(`标注文案 = ${txt}`)
console.log(`${txt.includes('修改位置') ? 'PASS' : 'FAIL'} 文案带「修改位置」前缀`)
console.log(`${parseFloat(style.border) === 0 ? 'PASS' : 'FAIL'} 无边框（非按钮样式） border=${style.border}`)
console.log(`${style.tag === 'SPAN' ? 'PASS' : 'FAIL'} 元素为 span 而非 button tag=${style.tag}`)
console.log(`${hidden === 'true' ? 'PASS' : 'FAIL'} 对读屏隐藏（装饰性）aria-hidden=${hidden}`)
console.log(`${stillThere === 1 ? 'PASS' : 'FAIL'} 点击后仍为静态标注 count=${stillThere}`)
console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'} 控制台无错误 ${errors.join(' | ') || 'clean'}`)
await page.screenshot({ path: 'scripts/smoke-out/smoke-focus-ring.png', clip: { x: 0, y: 300, width: 1440, height: 560 } })
await ring.scrollIntoViewIfNeeded()
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/smoke-out/smoke-focus-ring-candidate.png', clip: { x: 0, y: 260, width: 1440, height: 640 } })
await browser.close()
process.exit(txt.includes('修改位置') && parseFloat(style.border) === 0 && errors.length === 0 ? 0 : 1)
