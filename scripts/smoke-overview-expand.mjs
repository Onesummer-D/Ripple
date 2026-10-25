// 冒烟：网站概览统计行可点开（线上 demo）
// 用法: node scripts/smoke-overview-expand.mjs <baseURL> <outDir>
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://81.70.40.146:8082'
const OUT_DIR = process.argv[3] ?? 'scripts/smoke-out'
fs.mkdirSync(OUT_DIR, { recursive: true })

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

await page.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
await page.getByTestId('page-rail').waitFor()

// 默认收起
check('默认收起：无明细列表', (await page.getByTestId('overview-list-source-proven').count()) === 0)

// 点开「来源已证实」
await page.getByTestId('overview-toggle-source-proven').click()
await page.getByTestId('overview-list-source-proven').waitFor()
const provenText = await page.getByTestId('overview-list-source-proven').textContent()
check('来源已证实明细：包含页面与关系', provenText.includes('首页') && provenText.includes('商品专题') && provenText.includes('同源关联'), provenText)
await page.screenshot({ path: path.join(OUT_DIR, 'smoke-overview-expanded.png') })

// 互斥展开
await page.getByTestId('overview-toggle-unknown').click()
await page.getByTestId('overview-list-unknown').waitFor()
check('互斥展开：来源已证发明细收起', (await page.getByTestId('overview-list-source-proven').count()) === 0)

// 再点收起
await page.getByTestId('overview-toggle-unknown').click()
await page.waitForTimeout(200)
check('再点同一行收起', (await page.getByTestId('overview-list-unknown').count()) === 0)

check('控制台无错误', errors.length === 0, errors.join(' | ') || 'clean')
await browser.close()
const failed = results.filter(r => !r.ok).length
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
