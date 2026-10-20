import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPublicPreviewResourceAddress, snapshotAuthorizedPreviewResources, type DownloadedResource } from './preview-resource-snapshot'

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
  })
})
