// 冒烟：打开体验工作台 → 历史记录 → 截图验证三张版本卡片等高
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = 'D:/文件/比赛/全国数媒/Ripple/scripts/smoke-film-equal-height.png'
mkdirSync('D:/文件/比赛/全国数媒/Ripple/scripts', { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto('http://127.0.0.1:4173/experience.html?adapter=demo', { waitUntil: 'networkidle' })
await page.getByTestId('open-history').click()
await page.waitForTimeout(600)

const boxes = await page.$$eval('.ripple-xp-film-item', els => els.map(el => {
  const r = el.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height) }
}))
console.log('film cards:', JSON.stringify(boxes))
const heights = new Set(boxes.map(b => b.h))
console.log(heights.size === 1 ? 'EQUAL-HEIGHT: PASS' : `EQUAL-HEIGHT: FAIL (heights=${[...heights].join(',')})`)

await page.screenshot({ path: OUT, fullPage: false })
console.log('screenshot ->', OUT)
console.log('console/page errors:', errors.length === 0 ? '0' : errors.join(' | '))
await browser.close()
