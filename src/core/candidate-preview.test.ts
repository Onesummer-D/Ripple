// @vitest-environment node
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addressOnPreviewNetwork,
  CandidatePreviewError,
  createPreviewRelayAccounting,
  removePreviewNetworkWithCleanup,
  parsePreviewContainerInspection,
  previewRelayRejection,
  recordPreviewRelayEvent,
  startHostRelay,
  summarizePreviewRelayAccounting,
  waitForPreviewNetworkAddress,
  waitForPreviewReadiness,
} from './candidate-preview'

function inspection(address: string, status = 'running') {
  return {
    status,
    exitCode: status === 'running' ? 0 : 137,
    error: '',
    oomKilled: false,
    networks: { 'ripple-preview-net': { IPAddress: address } },
  }
}

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

  it('waits for Docker to attach the container before resolving its internal IPv4 address', async () => {
    let inspections = 0
    const address = await waitForPreviewNetworkAddress('ripple-preview-net', 'ripple-candidate', async () => {
      inspections += 1
      return { status: 'running', exitCode: 0, error: '', oomKilled: false, networks: { 'ripple-preview-net': { IPAddress: inspections < 3 ? '' : '172.24.0.3' } } }
    }, 1000)
    expect(address).toBe('172.24.0.3')
    expect(inspections).toBe(3)
  })

  it('fails immediately when the container stopped instead of waiting for an address timeout', async () => {
    const inspect = async () => ({ status: 'exited', exitCode: 137, error: 'OOM', oomKilled: true, networks: {} })
    await expect(waitForPreviewNetworkAddress('ripple-preview-net', 'ripple-candidate', inspect, 15_000)).rejects.toThrow(/status=exited, exit=137, oom=true/)
  })

  it('parses Docker state and attached endpoints as one inspection', () => {
    expect(parsePreviewContainerInspection(JSON.stringify({ Status: 'running', ExitCode: 0, Error: '', OOMKilled: false }) + '|' + JSON.stringify({ preview: { IPAddress: '172.24.0.3' } })))
      .toEqual({ status: 'running', exitCode: 0, error: '', oomKilled: false, networks: { preview: { IPAddress: '172.24.0.3' } } })
  })
})

describe('preview network readiness gate', () => {
  it('hands the preview over only after the address is observed stable across consecutive checks', async () => {
    const readiness = await waitForPreviewReadiness('ripple-preview-net', 'ripple-source',
      async () => inspection('172.24.0.3'), async () => true, { intervalMs: 1 })
    expect(readiness).toMatchObject({ address: '172.24.0.3', stableInspections: 3, addressChanges: 0, probeFailures: 0 })
  })

  it('restarts the stability count when the container address changes underneath', async () => {
    const addresses = ['172.24.0.3', '172.24.0.3', '172.24.0.4', '172.24.0.4', '172.24.0.4']
    let calls = 0
    const readiness = await waitForPreviewReadiness('ripple-preview-net', 'ripple-source',
      async () => inspection(addresses[Math.min(calls++, addresses.length - 1)]), async () => true, { intervalMs: 1 })
    expect(readiness.address).toBe('172.24.0.4')
    expect(readiness.addressChanges).toBe(1)
    expect(readiness.stableInspections).toBe(3)
    // The two checks on the first address must not count toward stability.
    expect(readiness.inspections).toBeGreaterThan(3)
  })

  it('restarts the stability count when the endpoint probe fails', async () => {
    let probes = 0
    const readiness = await waitForPreviewReadiness('ripple-preview-net', 'ripple-source',
      async () => inspection('172.24.0.3'), async () => ++probes !== 2, { intervalMs: 1 })
    expect(readiness.probeFailures).toBe(1)
    expect(readiness.stableInspections).toBe(3)
  })

  it('does not count inspections taken before an address is attached', async () => {
    let calls = 0
    const readiness = await waitForPreviewReadiness('ripple-preview-net', 'ripple-source',
      async () => inspection(calls++ < 2 ? '' : '172.24.0.3'), async () => true, { intervalMs: 1 })
    expect(readiness.address).toBe('172.24.0.3')
    // Two inspections ran while no address was attached. They must not have fed the
    // stability count, or a container that takes a while to get an address would be
    // handed to the browser on the strength of checks that proved nothing.
    expect(readiness.probeFailures).toBe(2)
    expect(readiness.stableInspections).toBe(3)
    expect(readiness.inspections).toBe(5)
  })

  it('fails immediately when the container stops instead of waiting for stability', async () => {
    await expect(waitForPreviewReadiness('ripple-preview-net', 'ripple-source',
      async () => inspection('172.24.0.3', 'exited'), async () => true, { intervalMs: 1 })).rejects.toThrow(/网络稳定等待期间停止/)
  })

  it('reports the instability it observed when it never settles', async () => {
    let calls = 0
    const error = await waitForPreviewReadiness('ripple-preview-net', 'ripple-source',
      async () => inspection(calls++ % 2 ? '172.24.0.3' : '172.24.0.4'), async () => true,
      { intervalMs: 1, timeoutMs: 60 }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(CandidatePreviewError)
    const message = (error as Error).message
    expect(message).toMatch(/未观测到稳定/)
    // The failure text has to carry the evidence. If it only said "not stable", a Run 7
    // failure would not tell us whether the address was flapping or the probe was
    // failing, and the two have completely different fixes.
    expect(message).toMatch(/地址变更 [1-9]/)
    expect(message).toMatch(/需要连续 3 次/)
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

  it('keeps one upstream connection across module requests instead of a handshake per module', async () => {
    let upstreamConnections = 0
    const upstream = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end(`export const path = ${JSON.stringify(request.url)}`)
    })
    upstream.on('connection', () => { upstreamConnections += 1 })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamPort = (upstream.address() as AddressInfo).port
    const relay = await startHostRelay('127.0.0.1', upstreamPort)
    relays.push({ close: () => new Promise(resolve => { relay.server.closeAllConnections(); relay.server.close(() => resolve()) }) })
    for (const module of ['/src/main.tsx', '/src/App.tsx', '/src/pages/HomePage.tsx', '/@vite/client']) {
      const response = await fetch(new URL(module, relay.url))
      expect(response.status).toBe(200)
      await response.text()
    }
    expect(upstreamConnections).toBe(1)
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })

  it('separates requests the relay never settled from requests the preview answered', () => {
    const accounting = createPreviewRelayAccounting()
    accounting.started = 4
    recordPreviewRelayEvent(accounting, { sequence: 1, path: '/src/main.tsx', outcome: 'completed', status: 200, detail: '', durationMs: 5 })
    recordPreviewRelayEvent(accounting, { sequence: 2, path: '/src/pages/AutumnPage.tsx', outcome: 'client-aborted', status: 0, detail: 'browser closed the connection', durationMs: 120 })
    expect(summarizePreviewRelayAccounting(accounting)).toBe(
      'started=4 completed=1 denied=0 client-aborted=1 upstream-failed=0 unsettled=2',
    )
  })

  it('keeps the event history bounded so a long preview cannot grow without limit', () => {
    const accounting = createPreviewRelayAccounting()
    for (let index = 0; index < 200; index += 1) {
      accounting.started += 1
      recordPreviewRelayEvent(accounting, { sequence: index, path: `/m${index}`, outcome: 'completed', status: 200, detail: '', durationMs: 1 }, 16)
    }
    expect(accounting.events).toHaveLength(16)
    expect(accounting.events[accounting.events.length - 1].path).toBe('/m199')
  })

  it('reports event-history truncation so a long preview cannot look fully recorded', () => {
    const accounting = createPreviewRelayAccounting()
    accounting.started = 200
    for (let index = 0; index < 200; index += 1) {
      recordPreviewRelayEvent(accounting, { sequence: index, path: `/m${index}`, outcome: 'completed', status: 200, detail: '', durationMs: 1 }, 16)
    }
    expect(accounting.dropped).toBe(184)
    expect(summarizePreviewRelayAccounting(accounting)).toContain('events-truncated=184')
  })

  it('does not mention truncation when nothing was dropped', () => {
    const accounting = createPreviewRelayAccounting()
    recordPreviewRelayEvent(accounting, { sequence: 1, path: '/a', outcome: 'completed', status: 200, detail: '', durationMs: 1 }, 16)
    expect(summarizePreviewRelayAccounting(accounting)).not.toContain('events-truncated')
  })

  it('records a client abort when the browser abandons an in-flight module request', async () => {
    const upstream = createServer(() => { /* deliberately never responds */ })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamPort = (upstream.address() as AddressInfo).port
    const relay = await startHostRelay('127.0.0.1', upstreamPort)
    relays.push({ close: () => new Promise(resolve => { relay.server.closeAllConnections(); relay.server.close(() => resolve()) }) })
    const controller = new AbortController()
    const pending = fetch(new URL('/src/pages/AutumnPage.tsx', relay.url), { signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 60))
    controller.abort()
    await pending.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(relay.accounting.outcomes['client-aborted']).toBe(1)
    expect(relay.accounting.events[relay.accounting.events.length - 1].path).toBe('/src/pages/AutumnPage.tsx')
    await new Promise<void>(resolve => {
      upstream.closeAllConnections()
      upstream.close(() => resolve())
    })
  }, 15_000)

  it('records relay rejections as denied rather than as preview failures', async () => {
    const upstream = createServer((_request, response) => { response.writeHead(200); response.end('ok') })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamPort = (upstream.address() as AddressInfo).port
    const relay = await startHostRelay('127.0.0.1', upstreamPort)
    relays.push({ close: () => new Promise(resolve => { relay.server.closeAllConnections(); relay.server.close(() => resolve()) }) })
    const rejected = await fetch(relay.url, { method: 'POST', body: 'unexpected' })
    expect(rejected.status).toBe(405)
    expect(relay.accounting.outcomes.denied).toBe(1)
    expect(relay.accounting.outcomes['upstream-failed']).toBe(0)
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })

  it('does not forward a close connection header that would defeat upstream reuse', async () => {
    const seen: Array<string | undefined> = []
    const upstream = createServer((request, response) => {
      seen.push(request.headers.connection)
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamPort = (upstream.address() as AddressInfo).port
    const relay = await startHostRelay('127.0.0.1', upstreamPort)
    relays.push({ close: () => new Promise(resolve => { relay.server.closeAllConnections(); relay.server.close(() => resolve()) }) })
    await (await fetch(relay.url)).text()
    expect(seen[0]).not.toBe('close')
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })
})

describe('preview network pool teardown', () => {
  const inUseError = new CandidatePreviewError("Error response from daemon: network ripple-preview-pool-x has active endpoints")

  it('removes a free network without touching any container', async () => {
    const calls: string[][] = []
    const failure = await removePreviewNetworkWithCleanup('net-1', async args => { calls.push(args); return '' })
    expect(failure).toBeUndefined()
    expect(calls).toEqual([['network', 'rm', 'net-1']])
  })

  it('treats an already-removed network as gone', async () => {
    const failure = await removePreviewNetworkWithCleanup('net-1', async () => { throw new CandidatePreviewError('Error: No such network: net-1') })
    expect(failure).toBeUndefined()
  })

  it('removes Ripple-owned containers attached to an in-use network and retries', async () => {
    const calls: string[][] = []
    let rmAttempts = 0
    const failure = await removePreviewNetworkWithCleanup('net-1', async args => {
      calls.push(args)
      if (args[0] === 'network' && args[1] === 'rm') {
        rmAttempts += 1
        if (rmAttempts === 1) throw inUseError
        return ''
      }
      if (args[0] === 'ps') return 'c1\nc2\n'
      if (args[0] === 'rm') return 'c1\nc2'
      throw new Error('unexpected docker call: ' + args.join(' '))
    })
    expect(failure).toBeUndefined()
    expect(rmAttempts).toBe(2)
    expect(calls).toEqual([
      ['network', 'rm', 'net-1'],
      ['ps', '-aq', '--filter', 'network=net-1', '--filter', 'label=com.ripple.preview=true'],
      ['rm', '-f', 'c1', 'c2'],
      ['network', 'rm', 'net-1'],
    ])
  })

  it('reports an in-use network that only foreign containers are attached to, without throwing', async () => {
    const failure = await removePreviewNetworkWithCleanup('net-1', async args => {
      if (args[0] === 'network') throw inUseError
      if (args[0] === 'ps') return ''
      throw new Error('unexpected docker call: ' + args.join(' '))
    })
    expect(failure).toBe('network is still in use by containers Ripple does not own')
  })

  it('reports the retry error when cleanup did not free the network', async () => {
    const failure = await removePreviewNetworkWithCleanup('net-1', async args => {
      if (args[0] === 'network') throw inUseError
      if (args[0] === 'ps') return 'c1'
      if (args[0] === 'rm') return 'c1'
      throw new Error('unexpected docker call: ' + args.join(' '))
    })
    expect(failure).toContain('active endpoints')
  })

  it('still throws for removal errors that are neither not-found nor in-use', async () => {
    await expect(removePreviewNetworkWithCleanup('net-1', async () => { throw new CandidatePreviewError('permission denied') }))
      .rejects.toThrow('permission denied')
  })
})
