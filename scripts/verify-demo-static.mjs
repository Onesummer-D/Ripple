import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

// 公网静态体验版本地验收：启动纯静态服务器（无任何 API），桌面 + 手机视口
// 验证默认入口、DEMO 标识、四大交互（关系/范围/对照/历史）与真实入口屏蔽。
const root = path.resolve(process.cwd(), 'dist-demo')
const outDir = path.resolve(process.cwd(), 'docs', 'experience', 'public-demo')
const port = 4188
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

const server = http.createServer((request, response) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname) } catch { response.writeHead(400); response.end(); return }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end('Forbidden'); return }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end('Not found'); return }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(content)
  })
})

await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
fs.mkdirSync(outDir, { recursive: true })
const consoleErrors = []

async function verifyFlow(page, label) {
  const errorsBefore = consoleErrors.length
  // 默认访问直接进入体验页（无重定向、无后端）
  const response = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  check(`${label}：默认 / 直接进入体验工作台`, response.status() === 200 && new URL(page.url()).pathname === '/')
  await page.getByTestId('xp-topbar').waitFor()
  // DEMO 标识保留
  await check(`${label}：DEMO 标识（演示数据徽章）`, await page.getByTestId('demo-badge').isVisible())
  // 关系图：编辑目标与页面关系可操作
  await page.getByTestId('canvas-el-el:hero-title').click()
  check(`${label}：点选元素（关系图选中）`, (await page.getByTestId('canvas-el-el:hero-title').getAttribute('aria-pressed')) === 'true')
  check(`${label}：页面关系呈现（同源关联）`, (await page.getByTestId('page-item-page:products').textContent()).includes('同源关联'))
  // 范围决策可操作
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.getByTestId('scope-exclude-page:seasonal').click()
  check(`${label}：范围决策（排除时令页）`, (await page.getByTestId('scope-row-page:seasonal').textContent()).includes('排除'))
  // 前后对照同步
  check(`${label}：前后对照（候选值同步）`, (await page.getByTestId('compare-candidate').textContent()).includes('冬日茶器市集'))
  // 版本历史可操作
  await page.getByTestId('open-history').click()
  check(`${label}：版本胶片（生命周期标注）`, (await page.getByTestId('version-v:3').textContent()).includes('已回滚'))
  // 图片资源验收：HTTP 实际状态 + 内容类型 + 浏览器解码（naturalWidth/Height），
  // 防止资源 404 但 Console 无报错时静默通过；路径相对 document.baseURI，子路径部署同样生效
  const assets = await page.evaluate(async () => {
    const urls = ['demo-assets/hero-market.jpg', 'demo-assets/workshop.jpg', 'demo-assets/vessels.jpg', 'demo-assets/seasonal.jpg']
    const http = []
    for (const u of urls) {
      const response = await fetch(new URL(u, document.baseURI), { cache: 'no-store' })
      http.push({ url: u, status: response.status, type: response.headers.get('content-type') ?? '' })
    }
    const hero = document.querySelector('.ripple-xp-demo-hero-media')
    const film = document.querySelector('.ripple-xp-film-img')
    const dims = img => (img ? { w: img.naturalWidth, h: img.naturalHeight } : null)
    return { http, hero: dims(hero), film: dims(film) }
  })
  check(`${label}：图片资源 HTTP 200 且内容类型正确`,
    assets.http.every(a => a.status === 200 && a.type.includes('image')),
    assets.http.map(a => `${a.url} ${a.status} ${a.type || 'no-content-type'}`).join('；'))
  check(`${label}：hero 与版本图片实际解码（naturalWidth/Height）`,
    Boolean(assets.hero?.w && assets.film?.w),
    `hero ${assets.hero ? `${assets.hero.w}x${assets.hero.h}` : '缺失'}，film ${assets.film ? `${assets.film.w}x${assets.film.h}` : '缺失'}`)
  await page.getByTestId('version-v:3').click()
  check(`${label}：历史定位页面`, (await page.getByTestId('page-item-page:products').getAttribute('aria-current')) === 'page')
  await page.getByTestId('close-filmstrip').click()
  await page.getByTestId('page-item-page:home').click()
  // 演示审批：处理完全部未决定页后出现，反馈明确标注未执行真实应用
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  if (await page.getByTestId('scope-exclude-page:contact').count()) await page.getByTestId('scope-exclude-page:contact').click()
  if (await page.getByTestId('scope-exclude-page:seasonal').count()) await page.getByTestId('scope-exclude-page:seasonal').click()
  await page.getByTestId('demo-approve').click()
  check(`${label}：演示审批（明确标注未执行真实应用）`, (await page.getByTestId('approve-feedback').textContent()).includes('未执行真实应用'))
  // 无真实后端入口
  check(`${label}：无打开真实工程入口`, (await page.getByTestId('open-project-form').count()) === 0)
  // 真实后端 URL 参数在静态版被屏蔽
  await page.goto(`http://127.0.0.1:${port}/?adapter=real`, { waitUntil: 'networkidle' })
  check(`${label}：?adapter=real 被强制演示模式`, await page.getByTestId('demo-badge').isVisible())
  check(`${label}：?adapter=real 无真实工程入口`, (await page.getByTestId('open-project-form').count()) === 0)
  check(`${label}：控制台无错误`, consoleErrors.length === errorsBefore, consoleErrors.slice(errorsBefore).join(' | ') || 'clean')
}

const browser = await chromium.launch()
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  desktop.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  desktop.on('pageerror', e => consoleErrors.push(String(e)))
  await verifyFlow(desktop, '桌面 1440')
  await desktop.screenshot({ path: path.join(outDir, 'demo-desktop-full.png'), fullPage: true })

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  mobile.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  mobile.on('pageerror', e => consoleErrors.push(String(e)))
  await verifyFlow(mobile, '手机 390')
  await mobile.screenshot({ path: path.join(outDir, 'demo-mobile-full.png'), fullPage: true })
} finally {
  await browser.close()
  server.close()
}

console.log(`\n${results.filter(r => r.ok).length}/${results.length} 项通过；截图输出：${outDir}`)
