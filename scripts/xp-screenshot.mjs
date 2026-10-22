// F 体验工作台截图脚本：打开演示页，截初始态 + 选中标题输入后的演示流中段。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.XP_BASE ?? 'http://127.0.0.1:7100/experience.html'
const outDir = process.env.XP_OUT ?? 'docs/experience'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: process.env.RIPPLE_PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1.5 })
await page.goto(base, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${outDir}/xp-1-initial.png`, fullPage: true })

// 演示流：选中活动标题 → 输入新标题
await page.getByTestId('canvas-el-el:hero-title').click()
await page.getByTestId('draft-text-input').fill('冬日茶器市集')
await page.screenshot({ path: `${outDir}/xp-2-title-drafted.png`, fullPage: true })

// 范围决策 + 证据面板（含前后对照）
await page.getByTestId('scope-exclude-page:contact').click()
await page.getByTestId('scope-exclude-page:seasonal').click()
await page.screenshot({ path: `${outDir}/xp-3-scoped.png`, fullPage: true })

// 版本历史 + 手机视口
await page.getByTestId('open-history').click()
await page.getByTestId('viewport-mobile-375').click()
await page.screenshot({ path: `${outDir}/xp-4-history-mobile.png`, fullPage: true })

await browser.close()
console.log('screenshots done')
