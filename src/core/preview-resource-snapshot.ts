import { lookup } from 'node:dns/promises'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { validatePreviewResourceUrls } from './preview-resource-policy'

export interface PreviewResourceSnapshot {
  url: string
  contentType: string
  sha256: string
  artifactPath: string
  sizeBytes: number
  source: 'authorized-url' | 'authorized-stylesheet-dependency'
  upstreamSha256?: string
}

export interface PreviewResourceSnapshotResult {
  snapshots: PreviewResourceSnapshot[]
  unavailable: Array<{ url: string; reason: string }>
  // One structured entry per fetch attempt (successes included). Run #9 lost
  // every failure reason: `unavailable` stayed in host memory, input.json is
  // deleted after the run, and only counts reached the artifact. The stage
  // labels let a post-mortem distinguish policy rejection, DNS, the public-IP
  // check, TLS/connect, HTTP status, content type, and size limits without
  // rerunning anything.
  diagnostics: ResourceFetchDiagnostic[]
}

export type ResourceFetchStage = 'url-policy' | 'dns' | 'ip-check' | 'redirect' | 'connection' | 'timeout' | 'http-status' | 'content-type' | 'size' | 'dependency' | 'ok'

export interface ResourceFetchDiagnostic {
  url: string
  stage: ResourceFetchStage
  ok: boolean
  durationMs: number
  code?: string
  message?: string
  status?: number
  contentType?: string
  bytes?: number
}

export class SnapshotFetchError extends Error {
  readonly stage: ResourceFetchStage
  constructor(stage: ResourceFetchStage, message: string) { super(message); this.name = 'SnapshotFetchError'; this.stage = stage }
}

export interface DownloadedResource {
  status: number
  location?: string
  contentType: string
  body: Buffer
}

const maxResourceBytes = 12 * 1024 * 1024
const maxTotalBytes = 48 * 1024 * 1024
// A full CJK family stack is far wider than a Latin one: the pinned Bolt
// revision's Google Fonts CSS references 202 font files (measured against the
// exact downloader UA). The bound below still caps snapshot work per
// stylesheet, and the total-bytes cap bounds the run as a whole.
const maxCssDependencies = 256
const fontContentTypes = new Set(['font/woff', 'font/woff2', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-opentype', 'application/vnd.ms-fontobject'])

export function isPublicPreviewResourceAddress(address: string): boolean {
  if (address.includes(':')) {
    const normalized = address.toLowerCase().split('%')[0]
    if (normalized.startsWith('::ffff:')) return isPublicPreviewResourceAddress(normalized.slice(7))
    if (!normalized.startsWith('2') && !normalized.startsWith('3')) return false
    if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0:') || normalized.startsWith('2002:')) return false
    return true
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const value = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0
  const inRange = (base: number, bits: number) => (value >>> (32 - bits)) === (base >>> (32 - bits))
  return ![
    [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
    [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
    [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
    [0xe0000000, 4], [0xf0000000, 4],
  ].some(([base, bits]) => inRange(base, bits))
}

async function downloadHttps(input: string): Promise<DownloadedResource> {
  const original = new URL(input)
  if (original.protocol !== 'https:' || original.username || original.password || original.hash) throw new SnapshotFetchError('url-policy', 'Resource snapshot URL is not a credential-free HTTPS URL.')
  let current = new URL(input)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let addresses: Array<{ address: string; family: number }>
    try {
      addresses = await lookup(current.hostname, { all: true, verbatim: true })
    } catch (error) {
      throw new SnapshotFetchError('dns', error instanceof Error ? error.message : String(error))
    }
    if (!addresses.length || addresses.some(({ address }) => !isPublicPreviewResourceAddress(address))) throw new SnapshotFetchError('ip-check', 'Resource host does not resolve exclusively to public IP addresses.')
    const selected = addresses[0]
    const pinnedLookup = ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
      callback(null, selected.address, selected.family)
    }) as RequestOptions['lookup']
    const result = await new Promise<DownloadedResource>((resolve, reject) => {
      const request = httpsRequest(current, {
        agent: false,
        lookup: pinnedLookup,
        headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Ripple-Resource-Snapshot/1.0', accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
      }, response => {
        const location = response.headers.location
        const contentType = (response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.resume()
          resolve({ status: response.statusCode ?? 0, location, contentType, body: Buffer.alloc(0) })
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.length
          if (size > maxResourceBytes) {
            request.destroy(new SnapshotFetchError('size', 'Authorized resource exceeds the 12 MiB limit.'))
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, contentType, body: Buffer.concat(chunks) }))
        response.on('error', reject)
      })
      request.setTimeout(15_000, () => request.destroy(new SnapshotFetchError('timeout', 'Authorized resource request timed out.')))
      request.on('error', error => {
        reject(error instanceof SnapshotFetchError ? error : new SnapshotFetchError('connection', error instanceof Error ? error.message : String(error)))
      })
      request.end()
    })
    if (![301, 302, 303, 307, 308].includes(result.status)) return result
    if (!result.location || redirects === 3) throw new SnapshotFetchError('redirect', 'Authorized resource redirect is missing or exceeds the limit.')
    const next = new URL(result.location, current)
    if (next.protocol !== 'https:' || next.origin !== original.origin || next.username || next.password || next.hash) throw new SnapshotFetchError('redirect', 'Cross-origin, credentialed or non-HTTPS resource redirects are not permitted.')
    current = next
  }
  throw new SnapshotFetchError('redirect', 'Authorized resource redirect limit exceeded.')
}

function acceptedContentType(contentType: string): boolean {
  return contentType.startsWith('image/') || contentType === 'text/css' || fontContentTypes.has(contentType)
}

function writeSnapshot(directory: string, url: string, contentType: string, body: Buffer, source: PreviewResourceSnapshot['source']): PreviewResourceSnapshot {
  const digest = createHash('sha256').update(body).digest('hex')
  const relativePath = 'resources/' + digest
  const absolutePath = path.join(directory, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 })
  if (!fs.existsSync(absolutePath)) fs.writeFileSync(absolutePath, body, { flag: 'wx', mode: 0o600 })
  const stat = fs.lstatSync(absolutePath)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== body.length || createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex') !== digest) {
    throw new Error('Preview resource snapshot failed its content-addressed file check.')
  }
  return { url, contentType, sha256: digest, artifactPath: relativePath, sizeBytes: body.length, source }
}

function fontUrls(css: string): string[] {
  const urls = new Set<string>()
  for (const match of css.matchAll(/url\(\s*(['"]?)(https:\/\/[^'")\s]+)\1\s*\)/gi)) {
    const url = new URL(match[2])
    if (url.protocol === 'https:' && url.hostname === 'fonts.gstatic.com' && !url.username && !url.password && !url.hash) urls.add(url.href)
  }
  if (urls.size > maxCssDependencies) throw new Error(`Authorized stylesheet exceeds the ${maxCssDependencies} font-resource limit.`)
  return [...urls]
}

export async function snapshotAuthorizedPreviewResources(urls: unknown, runDirectory: string, fetchResource: (input: string) => Promise<DownloadedResource> = downloadHttps): Promise<PreviewResourceSnapshotResult> {
  const authorized = validatePreviewResourceUrls(urls)
  const snapshots: PreviewResourceSnapshot[] = []
  const snapshotUrls = new Set<string>()
  const addSnapshot = (snapshot: PreviewResourceSnapshot) => { if (!snapshotUrls.has(snapshot.url)) { snapshotUrls.add(snapshot.url); snapshots.push(snapshot) } }
  const unavailable: PreviewResourceSnapshotResult['unavailable'] = []
  const diagnostics: ResourceFetchDiagnostic[] = []
  let totalBytes = 0

  const fetchAndStore = async (url: string, source: PreviewResourceSnapshot['source']) => {
    const started = Date.now()
    const record = (entry: Omit<ResourceFetchDiagnostic, 'url' | 'durationMs'>) =>
      diagnostics.push({ url, durationMs: Date.now() - started, ...entry })
    try {
      const downloaded = await fetchResource(url)
      if (downloaded.status !== 200 || !acceptedContentType(downloaded.contentType)) {
        record({ stage: downloaded.status !== 200 ? 'http-status' : 'content-type', ok: false, status: downloaded.status, contentType: downloaded.contentType, message: 'Unexpected resource response: HTTP ' + downloaded.status + ', ' + (downloaded.contentType || 'unknown content type') + '.' })
        throw new SnapshotFetchError(downloaded.status !== 200 ? 'http-status' : 'content-type', 'Unexpected resource response: HTTP ' + downloaded.status + ', ' + (downloaded.contentType || 'unknown content type') + '.')
      }
      if (downloaded.body.length === 0 || downloaded.body.length > maxResourceBytes) {
        record({ stage: 'size', ok: false, status: downloaded.status, contentType: downloaded.contentType, bytes: downloaded.body.length, message: 'Authorized resource is empty or too large.' })
        throw new SnapshotFetchError('size', 'Authorized resource is empty or too large.')
      }
      totalBytes += downloaded.body.length
      if (totalBytes > maxTotalBytes) {
        record({ stage: 'size', ok: false, status: downloaded.status, contentType: downloaded.contentType, bytes: downloaded.body.length, message: 'Authorized resources exceed the 48 MiB per-run snapshot limit.' })
        throw new SnapshotFetchError('size', 'Authorized resources exceed the 48 MiB per-run snapshot limit.')
      }
      const snapshot = writeSnapshot(runDirectory, url, downloaded.contentType, downloaded.body, source)
      record({ stage: 'ok', ok: true, status: downloaded.status, contentType: downloaded.contentType, bytes: downloaded.body.length })
      return { ...downloaded, snapshot }
    } catch (error) {
      const stage = error instanceof SnapshotFetchError ? error.stage : undefined
      const code = error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined
      if (!diagnostics.length || diagnostics[diagnostics.length - 1].url !== url || diagnostics[diagnostics.length - 1].ok) {
        record({ stage: stage ?? 'connection', ok: false, code, message: error instanceof Error ? error.message : String(error) })
      }
      unavailable.push({ url, reason: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  for (const url of authorized) {
    const resource = await fetchAndStore(url, 'authorized-url')
    if (!resource) continue
    if (resource.contentType === 'text/css') {
      if (resource.body.length > 1024 * 1024) {
        unavailable.push({ url, reason: 'Authorized stylesheet exceeds the 1 MiB limit.' })
        continue
      }
      const originalCss = resource.body.toString('utf8')
      // An over-wide stylesheet degrades this one resource to "unavailable"
      // instead of aborting the whole snapshot phase: the verification still
      // runs, blocks the stylesheet at runtime, and records a diagnosable risk.
      let fontList: string[]
      try {
        fontList = fontUrls(originalCss)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        diagnostics.push({ url, stage: 'dependency', ok: false, durationMs: 0, message })
        unavailable.push({ url, reason: message })
        continue
      }
      // Snapshot each font as its own content-addressed artifact; do NOT
      // rewrite the stylesheet into base64 data URLs. A full CJK stack
      // measures ~10 MiB across ~200 files (measured against the pinned Bolt
      // revision), which inflates the stylesheet to ~24 MiB and every
      // verification page load must parse it — Run #8 exceeded the 180 s
      // executor budget this way. The verification runner intercepts each
      // fonts.gstatic.com request and fulfills it from these snapshots, so
      // rendering keeps the real fonts at a fraction of the per-page cost.
      let dependenciesAvailable = true
      for (const dependencyUrl of fontList) {
        const dependency = await fetchAndStore(dependencyUrl, 'authorized-stylesheet-dependency')
        if (!dependency || !fontContentTypes.has(dependency.contentType)) {
          dependenciesAvailable = false
          if (dependency) unavailable.push({ url: dependencyUrl, reason: 'Unexpected font content type: ' + dependency.contentType })
          break
        }
        addSnapshot(dependency.snapshot)
      }
      if (!dependenciesAvailable) {
        diagnostics.push({ url, stage: 'dependency', ok: false, durationMs: 0, message: 'A font dependency of the approved stylesheet could not be snapshotted.' })
        unavailable.push({ url, reason: 'A font dependency of the approved stylesheet could not be snapshotted.' })
        continue
      }
      addSnapshot(resource.snapshot)
    } else addSnapshot(resource.snapshot)
  }

  return { snapshots, unavailable, diagnostics }
}
