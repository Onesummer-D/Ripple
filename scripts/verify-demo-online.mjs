import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

// 公网线上验收：默认腾讯云主地址，可用 DEMO_BASE 环境变量切换（如 Cloudflare 备用地址）。
// 桌面 + 手机双视口：交互、?adapter=real 屏蔽、Console/Network 审计、公网截图。
const BASE = (process.env.DEMO_BASE ?? 'http://81.70.40.146:8082').replace(/\/$/, '')
const TAG = process.env.DEMO_TAG ?? 'cn'
const outDir = path.resolve(process.cwd(), 'docs', 'experience', 'public-demo')
fs.mkdirSync(outDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

const browser = await chromium.launch()
try {
  // ---------- 桌面端 ----------
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const dConsole = []
  const dApi = []
  desktop.on('console', m => { if (m.type() === 'error') dConsole.push(m.text()) })
  desktop.on('pageerror', e => dConsole.push(String(e)))
  desktop.on('request', r => { if (r.url().includes('/__ripple/api/')) dApi.push(r.url()) })

  let resp = await desktop.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 45_000 })
  check('桌面：公网 / 直达体验工作台', resp.status() === 200 && new URL(desktop.url()).pathname === '/')
  await desktop.getByTestId('xp-topbar').waitFor()
  check('桌面：演示模式（DEMO 徽章已移除、无真实工程徽章）', (await desktop.getByTestId('real-badge').count()) === 0)

  await desktop.getByTestId('canvas-el-el:hero-title').click()
  check('桌面：目标选择（画布点选）', (await desktop.getByTestId('canvas-el-el:hero-title').getAttribute('aria-pressed')) === 'true')
  check('桌面：关系呈现（同源关联）', (await desktop.getByTestId('page-item-page:products').textContent()).includes('同源关联'))
  await desktop.getByTestId('draft-text-input').fill('冬日茶器市集')
  await desktop.getByTestId('scope-exclude-page:seasonal').click()
  check('桌面：范围决策', (await desktop.getByTestId('scope-row-page:seasonal').textContent()).includes('排除'))
  check('桌面：前后对照同步', (await desktop.getByTestId('compare-candidate').textContent()).includes('冬日茶器市集'))
  await desktop.getByTestId('open-history').click()
  check('桌面：版本历史（生命周期）', (await desktop.getByTestId('version-v:3').textContent()).includes('已回滚'))
  await desktop.screenshot({ path: path.join(outDir, `${TAG}-desktop-history.png`) })
  // 离开历史面板改用底部标签栏切换（「收起」按钮已移除）
  await desktop.getByTestId('tab-compare').click()
  await desktop.getByTestId('page-item-page:home').click()
  await desktop.getByTestId('canvas-el-el:hero-title').click()
  await desktop.getByTestId('draft-text-input').fill('冬日茶器市集')
  if (await desktop.getByTestId('scope-exclude-page:contact').count()) await desktop.getByTestId('scope-exclude-page:contact').click()
  if (await desktop.getByTestId('scope-exclude-page:seasonal').count()) await desktop.getByTestId('scope-exclude-page:seasonal').click()
  await desktop.getByTestId('demo-approve').click()
  check('桌面：演示审批（未执行真实应用）', (await desktop.getByTestId('approve-feedback').textContent()).includes('未执行真实应用'))
  await desktop.screenshot({ path: path.join(outDir, `${TAG}-desktop-approved.png`) })
  check('桌面：无打开真实工程入口', (await desktop.getByTestId('open-project-form').count()) === 0)
  check('桌面：Console 无错误', dConsole.length === 0, dConsole.join(' | ') || 'clean')
  check('桌面：无 /__ripple/api 请求', dApi.length === 0, dApi.join(',') || 'none')

  // ?adapter=real 屏蔽
  resp = await desktop.goto(`${BASE}/?adapter=real`, { waitUntil: 'networkidle', timeout: 45_000 })
  check('桌面：?adapter=real 仍强制演示（无真实工程徽章）', resp.status() === 200 && (await desktop.getByTestId('real-badge').count()) === 0)
  check('桌面：?adapter=real 无真实工程入口', (await desktop.getByTestId('open-project-form').count()) === 0)
  await desktop.screenshot({ path: path.join(outDir, `${TAG}-desktop-adapter-real-blocked.png`) })

  // ---------- 移动端 ----------
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const mConsole = []
  const mApi = []
  mobile.on('console', m => { if (m.type() === 'error') mConsole.push(m.text()) })
  mobile.on('pageerror', e => mConsole.push(String(e)))
  mobile.on('request', r => { if (r.url().includes('/__ripple/api/')) mApi.push(r.url()) })

  resp = await mobile.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 45_000 })
  check('手机：公网 / 直达体验工作台', resp.status() === 200 && new URL(mobile.url()).pathname === '/')
  await mobile.getByTestId('xp-topbar').waitFor()
  check('手机：演示模式（无真实工程徽章）', (await mobile.getByTestId('real-badge').count()) === 0)
  await mobile.getByTestId('canvas-el-el:hero-title').tap()
  check('手机：目标选择（触摸点选）', (await mobile.getByTestId('canvas-el-el:hero-title').getAttribute('aria-pressed')) === 'true')
  check('手机：范围决策面板可见', await mobile.getByTestId('scope-panel').isVisible())
  await mobile.getByTestId('draft-text-input').fill('冬日茶器市集')
  check('手机：前后对照同步', (await mobile.getByTestId('compare-candidate').textContent()).includes('冬日茶器市集'))
  await mobile.getByTestId('open-history').tap()
  check('手机：版本历史可操作', (await mobile.getByTestId('version-v:3').textContent()).includes('已回滚'))
  await mobile.screenshot({ path: path.join(outDir, `${TAG}-mobile-full.png`), fullPage: true })
  check('手机：无打开真实工程入口', (await mobile.getByTestId('open-project-form').count()) === 0)
  check('手机：Console 无错误', mConsole.length === 0, mConsole.join(' | ') || 'clean')
  check('手机：无 /__ripple/api 请求', mApi.length === 0, mApi.join(',') || 'none')
} finally {
  await browser.close()
}

console.log(`\n${results.filter(r => r.ok).length}/${results.length} 项通过；截图输出：${outDir}`)
