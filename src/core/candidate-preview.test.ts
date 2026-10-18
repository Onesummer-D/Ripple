// @vitest-environment node
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { addressOnPreviewNetwork, previewRelayRejection, startHostRelay } from './candidate-preview'

const relays: Array<{ close: () => Promise<void> }> = []
afterEach(async () => { await Promise.all(relays.splice(0).map(relay => relay.close())) })

describe('candidate preview network address', () => {
  it('uses only the address assigned on the candidate internal network', () => {
    expect(addressOnPreviewNetwork(JSON.stringify({
      'ripple-preview-net-candidate': { IPAddress: '172.24.0.3' },
      bridge: { IPAddress: '172.17.0.4' },
    }), 'ripple-preview-net-candidate')).toBe('172.24.0.3')
  })

  it('rejects missing networks and unusable addresses', () => {
    expect(() => addressOnPreviewNetwork('{}', 'ripple-preview-net-candidate')).toThrow(/未加入预期/)
    expect(() => addressOnPreviewNetwork(JSON.stringify({ 'ripple-preview-net-candidate': { IPAddress: '' } }), 'ripple-preview-net-candidate')).toThrow(/未加入预期/)
  })
})

describe('candidate preview relay', () => {
  it('rejects foreign Host and Origin, mutation methods, and non-origin-form paths', () => {
    const host = '127.0.0.1:41777'
    expect(previewRelayRejection({ method: 'GET', url: '/', host: 'attacker.invalid' }, host)?.status).toBe(403)
    expect(previewRelayRejection({ method: 'GET', url: '/', host, origin: 'https://attacker.invalid' }, host)?.status).toBe(403)
    expect(previewRelayRejection({ method: 'POST', url: '/', host, origin: 'null' }, host)?.status).toBe(405)
    expect(previewRelayRejection({ method: 'GET', url: '//attacker.invalid/', host }, host)?.status).toBe(400)
    expect(previewRelayRejection({ method: 'GET', url: '/%2f%2fattacker.invalid/', host }, host)?.status).toBe(400)
    expect(previewRelayRejection({ method: 'GET', url: '/src/main.jsx', host, origin: 'null' }, host)).toBeUndefined()
  })

  it('forwards a normal GET but never forwards foreign requests or browser credentials', async () => {
    let upstreamPort = 0
    const upstream = createServer((request, response) => {
      if (request.url === '/internal-redirect') {
        response.writeHead(302, { location: `http://127.0.0.1:${upstreamPort}/next?view=2` })
        response.end()
        return
      }
      if (request.url === '/external-redirect') {
        response.writeHead(302, { location: 'https://attacker.invalid/collect?data=secret' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'candidate=1' })
      response.end(JSON.stringify({ path: request.url, method: request.method, origin: request.headers.origin, cookie: request.headers.cookie, authorization: request.headers.authorization }))
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    upstreamPort = (upstream.address() as AddressInfo).port
    const relay = await startHostRelay('127.0.0.1', upstreamPort)
    relays.push({ close: () => new Promise(resolve => { relay.server.closeAllConnections(); relay.server.close(() => resolve()) }) })
    const good = await fetch(new URL('assets/site.css', relay.url), { headers: { cookie: 'host=secret', authorization: 'Bearer secret' } })
    expect(good.status).toBe(200)
    expect(good.headers.get('set-cookie')).toBeNull()
    expect(await good.json()).toEqual({ path: '/assets/site.css', method: 'GET', origin: 'null' })
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(relay.url, { headers: { host: 'attacker.invalid' } }, response => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      request.once('error', reject)
      request.end()
    })
    expect(wrongHost).toBe(403)
    const wrongOrigin = await fetch(relay.url, { headers: { origin: 'https://attacker.invalid' } })
    expect(wrongOrigin.status).toBe(403)
    const post = await fetch(relay.url, { method: 'POST', body: 'unexpected' })
    expect(post.status).toBe(405)
    const internalRedirect = await fetch(new URL('internal-redirect', relay.url), { redirect: 'manual' })
    expect(internalRedirect.status).toBe(302)
    expect(internalRedirect.headers.get('location')).toBe('/next?view=2')
    const externalRedirect = await fetch(new URL('external-redirect', relay.url), { redirect: 'manual' })
    expect(externalRedirect.status).toBe(403)
    expect(externalRedirect.headers.get('location')).toBeNull()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })
})
