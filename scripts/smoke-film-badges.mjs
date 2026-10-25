// 冒烟：历史记录 → 角标 redesigned：折叠态截图 → 展开 v:3 证据明细 → 截图 → 高度/报错检查
import { chromium } from 'playwright'

const OUT_DIR = 'D:/文件/比赛/全国数媒/Ripple/scripts'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto('http://127.0.0.1:4173/experience.html?adapter=demo', { waitUntil: 'networkidle' })
await page.getByTestId('open-history').click()
await page.waitForTimeout(500)

// 折叠态：三卡等高
const boxes = await page.$$eval('.ripple-xp-film-item', els => els.map(el => {
  const r = el.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height) }
}))
console.log('collapsed cards:', JSON.stringify(boxes))
console.log(new Set(boxes.map(b => b.h)).size === 1 ? 'EQUAL-HEIGHT(collapsed): PASS' : 'EQUAL-HEIGHT(collapsed): FAIL')

// 截图前先滚动到胶片区
await page.getByTestId('version-filmstrip').scrollIntoViewIfNeeded()
await page.screenshot({ path: `${OUT_DIR}/smoke-film-badges-collapsed.png` })

// 展开 v:3 证据明细
await page.getByTestId('evidence-toggle-v:3').click()
await page.waitForTimeout(300)
const listText = await page.getByTestId('evidence-list-v:3').textContent()
console.log('evidence-list-v:3:', listText)
const ariaExpanded = await page.getByTestId('evidence-toggle-v:3').getAttribute('aria-expanded')
console.log('aria-expanded:', ariaExpanded)
await page.screenshot({ path: `${OUT_DIR}/smoke-film-badges-expanded.png` })

// 再点一次折叠证据明细
await page.getByTestId('evidence-toggle-v:3').click()
await page.waitForTimeout(200)
console.log('toggle collapse ok:', await page.getByTestId('evidence-toggle-v:3').getAttribute('aria-expanded') === 'false' ? 'PASS' : 'FAIL')

console.log('console/page errors:', errors.length === 0 ? '0' : errors.join(' | '))
await browser.close()
