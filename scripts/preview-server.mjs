import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const port = Number(process.env.RIPPLE_PREVIEW_PORT ?? 4174)
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const resolveRequestPath = (requestUrl) => {
  try {
    const pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname)
    const relative = pathname === '/' ? 'preview.html' : pathname.replace(/^\/+/, '')
    const candidate = path.resolve(root, relative)
    return candidate.startsWith(root + path.sep) ? candidate : undefined
  } catch {
    return undefined
  }
}

const server = http.createServer((request, response) => {
  const filePath = resolveRequestPath(request.url ?? '/')
  if (!filePath) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500)
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read preview')
      return
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream' })
    response.end(content)
  })
})

server.on('error', (error) => {
  console.error(`Ripple preview server failed: ${error.message}`)
  process.exitCode = 1
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Ripple static preview: http://127.0.0.1:${port}/preview.html`)
})

const close = () => server.close(() => process.exit(0))
process.once('SIGINT', close)
process.once('SIGTERM', close)
