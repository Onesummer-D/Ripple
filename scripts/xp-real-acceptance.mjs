// Real Adapter 第一阶段浏览器验收 + 截图：
// 1) 启动 vite dev（含 /__ripple/api 插件）；2) 创建临时真实 React/Vite 工程并 analyze；
// 3) 打开 /experience.html?adapter=real&project=… 验证真实映射状态；
// 4) 输出截图到 docs/experience/xp-real-*.png。
// 用法：node scripts/xp-real-acceptance.mjs
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const port = 4199
const base = `http://127.0.0.1:${port}`
const outDir = process.env.XP_OUT ?? 'docs/experience'
mkdirSync(outDir, { recursive: true })

const stateDir = mkdtempSync(path.join('node_modules', '.tmp', 'xp-real-state-'))
const server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, RIPPLE_WORKBENCH_STATE_DIR: path.resolve(stateDir) },
  stdio: 'ignore',
})
const stopServer = () => { try { server.kill() } catch { /* 已退出 */ } }
process.on('exit', stopServer)

// 等待 dev server 就绪
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { const res = await fetch(base); if (res.status < 500) break } catch { /* 尚未就绪 */ }
  await new Promise(resolve => setTimeout(resolve, 500))
}

// 临时真实工程（与 e2e REAL 用例同构）
const sandbox = mkdtempSync(path.join('node_modules', '.tmp', 'xp-real-site-'))
const projectRoot = path.join(sandbox, 'site')
mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n')
writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'xp-real-acceptance-site', private: true, type: 'module' }))
writeFileSync(path.join(projectRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.jsx"></script>')
writeFileSync(path.join(projectRoot, 'src', 'main.jsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<App />)\n")
writeFileSync(path.join(projectRoot, 'src', 'App.jsx'), "import { useState } from 'react'; import { HomePage } from './pages/HomePage.jsx'; import { AboutPage } from './pages/AboutPage.jsx'; export function App(){const [page,setPage]=useState('home');return <><nav><button onClick={()=>setPage('home')}>Home</button><button onClick={()=>setPage('about')}>About</button></nav>{page==='home'?<HomePage/>:<AboutPage/>}</>}\n")
writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), "export function HomePage(){return <main><h1>Acme 真实首页标题</h1><p>真实首页文案内容。</p></main>}\n")
writeFileSync(path.join(projectRoot, 'src', 'pages', 'AboutPage.jsx'), "export function AboutPage(){return <main><h1>关于我们真实文案</h1></main>}\n")
const fixtureModules = path.resolve('test/fixtures/react-vite-tailwind/node_modules')
if (existsSync(fixtureModules)) symlinkSync(fixtureModules, path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const git = (...args) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
git('init', '-q'); git('config', 'user.email', 'xp-real@example.invalid'); git('config', 'user.name', 'XP real acceptance'); git('add', '.'); git('commit', '-qm', 'baseline')

const analyze = await fetch(`${base}/__ripple/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectRoot }) })
if (!analyze.ok) throw new Error(`analyze 失败：${await analyze.text()}`)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1.5 })
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', error => consoleErrors.push(String(error)))
  await page.goto(`${base}/experience.html?adapter=real&project=${encodeURIComponent(projectRoot)}`, { waitUntil: 'networkidle' })

  const assert = async (name, locator, text) => {
    const value = (await locator.textContent().catch(() => null)) ?? ''
    if (!value.includes(text)) throw new Error(`验收失败 ${name}：期望包含「${text}」，实际「${value.slice(0, 120)}」`)
    console.log(`ok ${name}`)
  }

  await assert('真实工程标记', page.getByTestId('real-badge'), '真实工程')
  await assert('工程状态', page.getByTestId('project-status'), '工程就绪')
  if (await page.getByTestId('demo-badge').count()) throw new Error('验收失败：真实模式出现演示标记')
  await assert('真实页面', page.getByTestId('page-item-page:home'), 'home')
  await assert('验证未运行如实呈现', page.getByTestId('evidence-ev:verification'), '尚未运行')
  await assert('真实审批未接入', page.getByTestId('real-approval-pending'), '真实审批尚未接入')
  // 画布两态：Docker 可用出 iframe，不可用出准确原因；均不得出现演示 DOM
  if (await page.getByTestId('demo-canvas').count()) throw new Error('验收失败：真实模式渲染了演示画布')
  if (await page.getByTestId('real-preview-frame').isVisible().catch(() => false)) {
    console.log('ok 预演 iframe（Docker 可用）')
  } else {
    await assert('预演不可用原因', page.getByTestId('real-preview-pending'), '真实预览不可用')
  }
  await page.screenshot({ path: `${outDir}/xp-real-1-loaded.png`, fullPage: true })

  // 选中真实目标 + 本地草稿
  await page.getByTestId('target-strip').getByRole('button', { name: /Acme 真实首页标题/ }).click()
  await assert('选中摘要（真实源码路径）', page.getByTestId('selection-summary'), 'src/pages/HomePage.jsx')
  await page.getByTestId('draft-text-input').fill('Acme 新首页标题')
  await assert('本地草稿意向', page.getByTestId('evidence-ev:intent'), 'Acme 新首页标题')
  await assert('候选生命周期不被本地动作改写', page.getByTestId('candidate-status'), '尚无候选')
  await page.screenshot({ path: `${outDir}/xp-real-2-target-drafted.png`, fullPage: true })

  // 范围决策 + 版本历史（真实历史为空，如实展示）
  await page.getByTestId('open-history').click()
  await page.screenshot({ path: `${outDir}/xp-real-3-history.png`, fullPage: true })

  // 503 = 项目预演在 Docker 不可用时的如实服务端响应（已在画布阻断原因中呈现），不计为缺陷
  const unexpected = consoleErrors.filter(message => !message.includes('503'))
  if (unexpected.length) throw new Error(`控制台错误：${unexpected.join(' | ')}`)
  console.log('real acceptance passed, screenshots ->', outDir)
} finally {
  await browser.close()
  stopServer()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { rmSync(sandbox, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true }); break } catch { /* Windows 句柄释放延迟 */ }
  }
}
