// @vitest-environment node
// Contract tests for the preview Content-Security-Policy built from the
// project-approved resource URL list. Run #12 root cause: the authorized list
// named a Google Fonts stylesheet, the snapshot pipeline hash-verified its
// fonts.gstatic.com dependencies, but the page CSP blocked every font load
// (22,624 console errors) because fonts.gstatic.com was never in font-src.
//
// The fix is two-shaped and request-scoped: interactive workbench previews get
// the strict policy (font-src = approved URLs only); only the isolated
// runner's document navigations (which carry x-ripple-verification-fonts and
// enforce per-URL snapshot authorization at the route layer) get the widened
// font-src. A real-browser test at the bottom pins the interactive boundary.
import { afterAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import * as http from 'node:http'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { buildPreviewCsp, previewCspForRequest, VERIFICATION_FONT_HEADER } from './preview-csp.mjs'

const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300..700&display=swap'
const IMAGE = 'https://images.pexels.com/photos/12277020/pexels-photo-12277020.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'

describe('buildPreviewCsp', () => {
  it('builds the pinned directive set with no approved resources', () => {
    const csp = buildPreviewCsp([])
    expect(csp).toContain("default-src 'self' data: blob:")
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("font-src 'self' data:")
    expect(csp).not.toContain('fonts.gstatic.com')
    expect(csp).not.toContain('font-src *')
  })

  it('never emits a wildcard font source, with or without a stylesheet', () => {
    expect(buildPreviewCsp([FONTS_CSS, IMAGE])).not.toContain('*')
    expect(buildPreviewCsp([FONTS_CSS], { includeVerifiedFontDependencies: true })).not.toMatch(/font-src[^;]*\*/)
  })

  it('keeps the strict interactive shape even when a stylesheet is authorized', () => {
    const strict = buildPreviewCsp([IMAGE, FONTS_CSS])
    expect(strict).not.toContain('fonts.gstatic.com')
    expect(strict).toContain('font-src')
  })

  it('adds the snapshot-authorized font origin only for the verification shape', () => {
    const verification = buildPreviewCsp([IMAGE, FONTS_CSS], { includeVerifiedFontDependencies: true })
    expect(verification).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/)
    // The font origin must not leak into directives that do not serve fonts.
    expect(verification).toMatch(/img-src[^;]*https:\/\/images\.pexels\.com\/photos\/12277020\/pexels-photo-12277020\.jpeg/)
    expect(verification).not.toMatch(/img-src[^;]*fonts\.gstatic\.com/)
    expect(verification).not.toMatch(/style-src[^;]*fonts\.gstatic\.com/)
  })

  it('does not widen font-src for image-only approvals even in the verification shape', () => {
    const csp = buildPreviewCsp([IMAGE], { includeVerifiedFontDependencies: true })
    expect(csp).not.toContain('fonts.gstatic.com')
  })

  it('lists each approved resource by origin and pathname in its serving directives', () => {
    const csp = buildPreviewCsp([FONTS_CSS, IMAGE])
    const styleSrc = csp.match(/style-src ([^;]*)/)![1]
    expect(styleSrc).toContain('https://fonts.googleapis.com/css2')
    expect(styleSrc).toContain('https://images.pexels.com/photos/12277020/pexels-photo-12277020.jpeg')
    // Query strings stay out of the CSP (they may carry signed parameters).
    expect(csp).not.toContain('auto=compress')
  })

  it('previewCspForRequest selects the shape strictly on the runner header', () => {
    const approved = [FONTS_CSS]
    const strict = previewCspForRequest({ accept: 'text/html' }, approved)
    const verification = previewCspForRequest({ [VERIFICATION_FONT_HEADER]: 'verified-font-dependencies' }, approved)
    expect(strict).not.toContain('fonts.gstatic.com')
    expect(verification).toContain('https://fonts.gstatic.com')
    // A wrong or missing value never widens the policy.
    expect(previewCspForRequest({ [VERIFICATION_FONT_HEADER]: '1' }, approved)).toBe(strict)
    expect(previewCspForRequest({}, approved)).toBe(strict)
  })

  it('throws on an entry that is not a valid URL', () => {
    expect(() => buildPreviewCsp(['not-a-url'])).toThrow()
  })
})

// Real-browser boundary check (reviewer round 2): with an authorized Google
// Fonts stylesheet, the STRICT shape must stop an arbitrary (never authorized)
// fonts.gstatic.com font from leaving the browser, while the verification
// shape lets the request reach the network layer — where the runner's route
// layer decides per URL against the snapshot set.
describe('preview CSP font boundary in a real browser', () => {
  const servers: http.Server[] = []
  let browser: Browser | undefined

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  })

  const fontUrl = 'https://fonts.gstatic.com/s/notosanssc/v41/unauthorized-boundary-check.woff2'
  const pageHtml = `<!doctype html><html><head>
    <link rel="stylesheet" href="${FONTS_CSS}">
    <style>@font-face{font-family:'Boundary';src:url('${fontUrl}') format('woff2')} p{font-family:'Boundary'}</style>
  </head><body><p>边界检查文本</p></body></html>`

  async function serve(approved: string[]) {
    const fontRequests: string[] = []
    const cspViolations: string[] = []
    const server = http.createServer((request, response) => {
      const headers = previewCspForRequest(request.headers, approved)
      response.setHeader('content-security-policy', headers)
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(pageHtml)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    return { server, fontRequests, cspViolations }
  }

  async function probe(withVerificationHeader: boolean, approved: string[]) {
    const { server, fontRequests, cspViolations } = await serve(approved)
    browser ??= await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
    const page = await browser.newPage()
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security Policy')) cspViolations.push(message.text()) })
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url === fontUrl) { fontRequests.push(url); return route.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('wOF2') }) }
      // Fulfill the authorized stylesheet at once: a stalled render-blocking
      // CSS link would otherwise delay text layout (and font loading) for
      // unrelated reasons.
      if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ status: 200, contentType: 'text/css', body: '/* authorized stylesheet */' })
      return route.continue()
    })
    if (withVerificationHeader) await page.setExtraHTTPHeaders({ [VERIFICATION_FONT_HEADER]: 'verified-font-dependencies' })
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    await page.close()
    return { fontRequests, cspViolations }
  }

  it('interactive preview (strict shape) blocks a fonts.gstatic.com URL that is not in the authorized set', async () => {
    const { fontRequests, cspViolations } = await probe(false, [FONTS_CSS])
    // The request never reaches the network layer: CSP refused it in the renderer.
    expect(fontRequests).toEqual([])
    expect(cspViolations.some(text => text.includes('font-src'))).toBe(true)
  }, 60_000)

  it('verification shape allows the font request out to the route layer, which still authorizes per URL', async () => {
    const { fontRequests } = await probe(true, [FONTS_CSS])
    expect(fontRequests).toEqual([fontUrl])
  }, 60_000)

  it('blocks the font in both shapes when no stylesheet was ever authorized', async () => {
    const strict = await probe(false, [])
    const verification = await probe(true, [])
    expect(strict.fontRequests).toEqual([])
    expect(verification.fontRequests).toEqual([])
  }, 60_000)
})
