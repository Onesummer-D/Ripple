import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

/**
 * 验收用受限静态文件服务（B 侧）。
 *
 * 安全边界（有测试覆盖）：
 * - 路径必须解析到 rootDir 之内（含 %2e%2e 等编码越界）；
 * - 符号链接必须落在 rootDir 真实路径之内，链接到外部一律 404；
 * - 找不到的文件回退 index.html（SPA），回退目标同样受上述约束。
 */
export function serveStatic(rootDir: string, port: number): Promise<http.Server> {
  const rootReal = fs.realpathSync(rootDir)
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  const withinRoot = (candidate: string): string | undefined => {
    try {
      const real = fs.realpathSync(candidate)
      const relative = path.relative(rootReal, real)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
      return real
    } catch {
      return undefined
    }
  }
  const server = http.createServer((request, response) => {
    let relative: string
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      response.writeHead(400); response.end('bad request'); return
    }
    if (relative.split(/[\\/]/).includes('..')) { response.writeHead(404); response.end('not found'); return }
    if (!relative) relative = 'index.html'
    let absolute = path.join(rootDir, relative)
    let real = withinRoot(absolute)
    if (!real || !fs.statSync(real).isFile()) {
      // SPA 回退：index.html 同样必须经过符号链接/越界校验
      real = withinRoot(path.join(rootDir, 'index.html'))
      if (!real) { response.writeHead(404); response.end('not found'); return }
      absolute = path.join(rootDir, 'index.html')
    }
    response.writeHead(200, { 'content-type': types[path.extname(real).toLowerCase()] ?? 'application/octet-stream' })
    fs.createReadStream(real).pipe(response)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
