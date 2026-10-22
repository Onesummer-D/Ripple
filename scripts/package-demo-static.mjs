import fs from 'node:fs'
import path from 'node:path'

// 公网静态体验版打包：默认访问直接进入演示工作台。
// 1) experience.html → index.html（站点根即体验页，无需后端）
// 2) 注入 <meta name="robots" content="noindex"> 与 DEMO 说明（仅构建产物，不改源码）
// 3) 生成 Cloudflare Pages _headers（安全响应头；纯静态站点无 API，禁掉一切调试入口）
const root = process.cwd()
const dist = path.join(root, 'dist-demo')
const experience = path.join(dist, 'experience.html')
const index = path.join(dist, 'index.html')

if (!fs.existsSync(experience)) {
  console.error('缺少 dist-demo/experience.html：请先运行 npm run build:demo-static')
  process.exit(1)
}

let html = fs.readFileSync(experience, 'utf8')
if (!html.includes('name="viewport"')) {
  console.error('experience.html 缺少 viewport，拒绝打包')
  process.exit(1)
}
html = html.replace('</head>', '  <meta name="robots" content="noindex">\n    <meta name="description" content="Ripple 演示体验版（DEMO）：模拟数据，仅供评委体验交互流程，未连接真实后端。">\n  </head>')
fs.writeFileSync(index, html)

fs.writeFileSync(path.join(dist, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`)

// 体验页同时保留 experience.html，便于 /experience.html 直达（与本地路径一致）
fs.copyFileSync(index, experience)
console.log('demo-static 打包完成：dist-demo/index.html（默认入口）+ _headers')
