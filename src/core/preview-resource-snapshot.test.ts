import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPublicPreviewResourceAddress, pinnedPublicLookup, SnapshotFetchError, snapshotAuthorizedPreviewResources, type DownloadedResource } from './preview-resource-snapshot'

const tempDirs: string[] = []
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-snapshot-'))
  tempDirs.push(dir)
  return dir
}

function fontCss(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    `@font-face{font-family:f${index};src:url("https://fonts.gstatic.com/s/f${index}/v1/f${index}.woff2") format("woff2")}`).join('\n')
}

function ok(body: Buffer | string, contentType: string): DownloadedResource {
  return { status: 200, contentType, body: typeof body === 'string' ? Buffer.from(body) : body }
}

describe('isolated preview resource snapshots', () => {
  // Run #9 regression: Node's connection layer calls a custom lookup with
  // { all: true }, so the callback MUST return an array. The classic
  // (address, family) signature made Node read addresses[0].address from a
  // string and fail every URL with "Invalid IP address: undefined" — all 19
  // authorized resources lost in 62 ms. This test pins the callback shape the
  // connection layer actually consumes.
  it('pinnedPublicLookup returns an array of address entries to the connection layer', () => {
    const lookup = pinnedPublicLookup({ address: '142.250.72.46', family: 4 })
    let received: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(lookup as any)('example.com', { all: true }, (_error: unknown, addresses: unknown) => { received = addresses })
    expect(received).toEqual([{ address: '142.250.72.46', family: 4 }])
  })

  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.4', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '2001:db8::1'])('rejects non-public resource address %s', address => {
    expect(isPublicPreviewResourceAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::1'])('accepts a public resource address %s', address => {
    expect(isPublicPreviewResourceAddress(address)).toBe(true)
  })

  // Run #8 regression: inlining the whole CJK stack as base64 data URLs turns
  // the stylesheet into ~24 MiB that every verification page load must parse,
  // which exceeded the 180 s executor budget. Fonts must instead be snapshotted
  // as individual artifacts that the runner fulfills per request, keeping the
  // served stylesheet at its original ~900 KiB.
  it('snapshots a CJK-scale stylesheet as original CSS plus per-font artifacts', async () => {
    const cssUrl = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400&display=swap'
    const fetcher = async (input: string): Promise<DownloadedResource> => {
      if (input === cssUrl) return ok(fontCss(202), 'text/css')
      return ok(Buffer.from('woff2-bytes-' + input), 'font/woff2')
    }
    const dir = tempDir()
    const out = await snapshotAuthorizedPreviewResources([cssUrl], dir, fetcher)
    expect(out.unavailable).toEqual([])
    const fonts = out.snapshots.filter(s => s.source === 'authorized-stylesheet-dependency')
    expect(fonts).toHaveLength(202)
    const stylesheet = out.snapshots.find(s => s.url === cssUrl && s.source === 'authorized-url')
    expect(stylesheet).toBeDefined()
    expect(stylesheet!.upstreamSha256).toBeUndefined()
    const servedCss = fs.readFileSync(path.join(dir, stylesheet!.artifactPath), 'utf8')
    expect(servedCss).toContain('fonts.gstatic.com')
    expect(servedCss).not.toContain('url(data:font/')
    expect(stylesheet!.sizeBytes).toBe(Buffer.byteLength(fontCss(202)))
    // Every font URL the served CSS references resolves to a snapshot the
    // verification runner can fulfill.
    const fontUrls = [...servedCss.matchAll(/url\("?(https:\/\/fonts\.gstatic\.com\/[^")\s]+)"?\)/g)].map(match => match[1])
    const snapshottedUrls = new Set(out.snapshots.map(s => s.url))
    expect(fontUrls.every(url => snapshottedUrls.has(url))).toBe(true)
  })

  // Negative case: an absurdly wide stylesheet degrades THIS resource to
  // unavailable instead of aborting the whole snapshot phase. Run #7 proved the
  // abort path hides failures: when the fetch itself failed the run continued
  // and surfaced a diagnosable risk, which is strictly better than a dead runner.
  it('degrades an over-wide stylesheet to unavailable instead of throwing', async () => {
    const cssUrl = 'https://fonts.googleapis.com/css2?family=Huge:wght@400&display=swap'
    const imageUrl = 'https://images.pexels.com/photos/1/p.jpeg'
    const fetcher = async (input: string): Promise<DownloadedResource> => {
      if (input === cssUrl) return ok(fontCss(257), 'text/css')
      if (input === imageUrl) return ok(Buffer.from('jpeg-bytes'), 'image/jpeg')
      return ok(Buffer.from('font'), 'font/woff2')
    }
    const out = await snapshotAuthorizedPreviewResources([cssUrl, imageUrl], tempDir(), fetcher)
    expect(out.snapshots.map(s => s.url)).toEqual([imageUrl])
    expect(out.unavailable).toEqual([{ url: cssUrl, reason: 'Authorized stylesheet exceeds the 256 font-resource limit.' }])
  })

  it('records a fetch failure as unavailable while snapshotting the remaining resources', async () => {
    const failing = 'https://images.pexels.com/photos/2/p.jpeg'
    const working = 'https://images.pexels.com/photos/3/p.jpeg'
    const fetcher = async (input: string): Promise<DownloadedResource> => {
      if (input === failing) throw new Error('Authorized resource request timed out.')
      return ok(Buffer.from('jpeg-bytes'), 'image/jpeg')
    }
    const out = await snapshotAuthorizedPreviewResources([failing, working], tempDir(), fetcher)
    expect(out.snapshots.map(s => s.url)).toEqual([working])
    expect(out.unavailable).toEqual([{ url: failing, reason: 'Authorized resource request timed out.' }])
  })

  it('degrades a stylesheet whose font dependency fails to snapshot', async () => {
    const cssUrl = 'https://fonts.googleapis.com/css2?family=Broken:wght@400&display=swap'
    const fetcher = async (input: string): Promise<DownloadedResource> => {
      if (input === cssUrl) return ok(fontCss(2), 'text/css')
      throw new Error('Authorized resource request timed out.')
    }
    const out = await snapshotAuthorizedPreviewResources([cssUrl], tempDir(), fetcher)
    expect(out.snapshots).toEqual([])
    // The specific failing font is reported first, then the stylesheet itself
    // is degraded to unavailable.
    expect(out.unavailable).toEqual([
      { url: 'https://fonts.gstatic.com/s/f0/v1/f0.woff2', reason: 'Authorized resource request timed out.' },
      { url: cssUrl, reason: 'A font dependency of the approved stylesheet could not be snapshotted.' },
    ])
    // Both failures carry a structured diagnostic: the font fetch failure and
    // the stylesheet-level dependency degradation.
    const stages = out.diagnostics.filter(d => !d.ok).map(d => [d.url === cssUrl ? 'css' : 'font', d.stage])
    expect(stages).toEqual([['font', 'connection'], ['css', 'dependency']])
  })

  it('records staged diagnostics with status, bytes and duration for every fetch', async () => {
    const good = 'https://images.pexels.com/photos/9/p.jpeg'
    const bad = 'https://images.pexels.com/photos/10/p.jpeg'
    const denied = 'https://images.pexels.com/photos/11/p.jpeg'
    const fetcher = async (input: string): Promise<DownloadedResource> => {
      if (input === good) return ok(Buffer.from('jpeg-bytes'), 'image/jpeg')
      if (input === bad) throw new SnapshotFetchError('timeout', 'Authorized resource request timed out.')
      throw new SnapshotFetchError('ip-check', 'Resource host does not resolve exclusively to public IP addresses.')
    }
    const out = await snapshotAuthorizedPreviewResources([good, bad, denied], tempDir(), fetcher)
    expect(out.snapshots.map(s => s.url)).toEqual([good])
    expect(out.diagnostics).toHaveLength(3)
    const okEntry = out.diagnostics.find(d => d.url === good)!
    expect(okEntry).toMatchObject({ stage: 'ok', ok: true, status: 200, contentType: 'image/jpeg', bytes: 10 })
    expect(okEntry.durationMs).toBeGreaterThanOrEqual(0)
    const timeoutEntry = out.diagnostics.find(d => d.url === bad)!
    expect(timeoutEntry).toMatchObject({ stage: 'timeout', ok: false })
    expect(timeoutEntry.message).toContain('timed out')
    const deniedEntry = out.diagnostics.find(d => d.url === denied)!
    expect(deniedEntry).toMatchObject({ stage: 'ip-check', ok: false })
    expect(deniedEntry.message).toContain('public IP')
  })
})

// Real-egress probe: gated behind RIPPLE_LIVE_RESOURCE_TEST so it runs on CI
// (where the snapshotter's true network path exists) and stays inert on
// developer machines with restricted DNS. It snapshots one small public
// stylesheet through the REAL downloader — DNS pinning, public-IP
// validation, TLS and HTTP handling included — and prints the full
// diagnostic entry, so a runner-environment failure (the Run #9 class: all
// resources lost in ~62 ms) is attributable from the unit-test log alone.
describe.skipIf(process.env.RIPPLE_LIVE_RESOURCE_TEST !== '1')('live resource snapshot probe (CI egress)', () => {
  it('snapshots a small public stylesheet through the real downloader', async () => {
    const cssUrl = 'https://fonts.googleapis.com/css2?family=Roboto&display=swap'
    const out = await snapshotAuthorizedPreviewResources([cssUrl], tempDir())
    console.log('live snapshot diagnostics:', JSON.stringify(out.diagnostics, null, 2))
    console.log('live snapshot unavailable:', JSON.stringify(out.unavailable, null, 2))
    expect(out.unavailable).toEqual([])
    const stylesheet = out.snapshots.find(s => s.url === cssUrl)
    expect(stylesheet).toBeDefined()
    expect(stylesheet!.sizeBytes).toBeGreaterThan(0)
    const entry = out.diagnostics.find(d => d.url === cssUrl)!
    expect(entry).toMatchObject({ stage: 'ok', ok: true, status: 200 })
    expect(entry.durationMs).toBeGreaterThan(0)
  }, 60_000)
})
