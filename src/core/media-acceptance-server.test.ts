import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { serveStatic } from './media-acceptance-server'

describe('serveStatic 安全边界', () => {
  let root: string
  let outside: string
  let server: import('node:http').Server | undefined
  let port = 0

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-serve-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-serve-out-'))
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body>app</body></html>')
    fs.mkdirSync(path.join(root, 'media'), { recursive: true })
    fs.writeFileSync(path.join(root, 'media', 'a.jpeg'), 'fake-image-bytes')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top-secret')
  })

  afterEach(async () => {
    if (server) await new Promise(resolve => server!.close(resolve))
    server = undefined
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  async function start(): Promise<string> {
    // 端口 0 由 OS 分配，避免并发测试冲突
    const started = await serveStatic(root, 0)
    server = started
    const address = started.address()
    if (!address || typeof address === 'string') throw new Error('server has no port')
    port = address.port
    return `http://127.0.0.1:${port}`
  }

  it('正常服务根目录与静态资产', async () => {
    const base = await start()
    const index = await fetch(`${base}/`)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('app')
    const asset = await fetch(`${base}/media/a.jpeg`)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe('fake-image-bytes')
  })

  it('路径越界（含编码形式）一律 404', async () => {
    await start()
    // 用裸 HTTP 请求而非 fetch：fetch 客户端会把 /../ 规范化掉，到不了服务端
    const rawGet = (requestPath: string): Promise<number> => new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port, path: requestPath }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      })
      request.on('error', reject)
    })
    // 只有编码分隔符形式能抵达服务端防线：WHATWG URL 解析器会把裸 ../ 段和
    // %2e 编码的点段在解析期折叠（请求根本到不了越界形态），%2f/%5c 编码的分隔符才会保留。
    for (const payload of ['/..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/%2E%2E%2F%2E%2E%2Fsecret.txt']) {
      const status = await rawGet(payload)
      expect(status, payload).toBe(404)
    }
  })

  // 链接创建必须发生在测试体内（beforeEach 之后）：describe 求值期 root/outside 尚未赋值，
  // Windows 无开发者模式时创建失败 → 测试内显式 skip，而不是 collection 期静态跳过。
  function linkOrSkip(ctx: { skip: () => never }): void {
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'media', 'leak.txt'), 'file')
      fs.symlinkSync(path.join(root, 'media', 'a.jpeg'), path.join(root, 'media', 'internal.jpeg'), 'file')
    } catch {
      ctx.skip() // Windows 无开发者模式时无法建链接
    }
  }

  it('指向 rootDir 外部的符号链接被拒绝（且不落入 SPA 回退），内部链接允许', async (ctx) => {
    linkOrSkip(ctx)
    const base = await start()
    const leak = await fetch(`${base}/media/leak.txt`)
    expect(leak.status).toBe(404)
    // 负例加固：即使状态码被改，响应体也绝不能是 SPA index（否则等于泄露 200 通道）
    expect(await leak.text()).not.toContain('app')
    const internal = await fetch(`${base}/media/internal.jpeg`)
    expect(internal.status).toBe(200)
    expect(await internal.text()).toBe('fake-image-bytes')
  })

  it('带扩展名的缺失资产一律 404，不落入 SPA 回退', async () => {
    const base = await start()
    const missing = await fetch(`${base}/media/missing.jpeg`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).not.toContain('app')
  })

  it('SPA 回退到 index.html，且回退目标仍受越界约束', async () => {
    const base = await start()
    const fallback = await fetch(`${base}/some/spa/route`)
    expect(fallback.status).toBe(200)
    expect(await fallback.text()).toContain('app')
  })

  it('回退目标 index.html 若被替换为外部符号链接，回退一律 404', async (ctx) => {
    fs.rmSync(path.join(root, 'index.html'))
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'index.html'), 'file')
    } catch {
      ctx.skip() // Windows 无开发者模式时无法建链接
    }
    const base = await start()
    const response = await fetch(`${base}/any/spa/route`)
    expect(response.status).toBe(404)
    const rootResponse = await fetch(`${base}/`)
    expect(rootResponse.status).toBe(404)
  })
})
