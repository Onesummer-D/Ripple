// 冒烟：页面一级标题放大（线上 demo，实测 computed font-size）
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://81.70.40.146:8082'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
await page.getByTestId('page-title').waitFor().catch(() => {})
const title = page.locator('.ripple-xp-page-title').first()
const size = await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
const text = (await title.textContent())?.trim()
console.log(`页面标题「${text}」font-size = ${size}px`)
console.log(`${size >= 28 ? 'PASS' : 'FAIL'} 标题不小于 28px`)
console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'} 控制台无错误 ${errors.join(' | ') || 'clean'}`)
await page.screenshot({ path: 'scripts/smoke-out/smoke-page-title.png', clip: { x: 200, y: 0, width: 900, height: 320 } })
await browser.close()
process.exit(size >= 28 && errors.length === 0 ? 0 : 1)
