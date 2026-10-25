// 冒烟：顶栏「演示数据 DEMO」徽章已移除（线上 demo）
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://81.70.40.146:8082'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
await page.getByTestId('xp-topbar').waitFor()

const demoCount = await page.getByTestId('demo-badge').count()
const realCount = await page.getByTestId('real-badge').count()
const topbarText = await page.getByTestId('xp-topbar').textContent()
console.log(`${demoCount === 0 ? 'PASS' : 'FAIL'} 顶栏无 DEMO 徽章 (count=${demoCount})`)
console.log(`${realCount === 0 ? 'PASS' : 'FAIL'} 演示模式无真实工程徽章 (count=${realCount})`)
console.log(`${!topbarText.includes('演示数据') ? 'PASS' : 'FAIL'} 顶栏文案无「演示数据」`)
console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'} 控制台无错误 ${errors.join(' | ') || 'clean'}`)

await page.screenshot({ path: 'scripts/smoke-out/smoke-badge-removed.png', clip: { x: 0, y: 0, width: 1440, height: 220 } })
await browser.close()
const ok = demoCount === 0 && realCount === 0 && !topbarText.includes('演示数据') && errors.length === 0
console.log(ok ? 'ALL PASS' : 'FAILED')
process.exit(ok ? 0 : 1)
