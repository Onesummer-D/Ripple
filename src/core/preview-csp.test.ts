// @vitest-environment node
// Contract tests for the preview Content-Security-Policy built from the
// project-approved resource URL list. Run #12 root cause: the authorized list
// named a Google Fonts stylesheet, the snapshot pipeline hash-verified its
// fonts.gstatic.com dependencies, but the page CSP blocked every font load
// (22,624 console errors) because fonts.gstatic.com was never in font-src.
import { describe, expect, it } from 'vitest'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { buildPreviewCsp } from './preview-csp.mjs'

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
    expect(buildPreviewCsp([FONTS_CSS])).not.toMatch(/font-src[^;]*\*/)
  })

  it('adds the snapshot-authorized font origin only when a stylesheet was approved', () => {
    const withStylesheet = buildPreviewCsp([IMAGE, FONTS_CSS])
    expect(withStylesheet).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/)
    // The font origin must not leak into directives that do not serve fonts.
    expect(withStylesheet).toMatch(/img-src[^;]*https:\/\/images\.pexels\.com\/photos\/12277020\/pexels-photo-12277020\.jpeg/)
    expect(withStylesheet).not.toMatch(/img-src[^;]*fonts\.gstatic\.com/)
    expect(withStylesheet).not.toMatch(/style-src[^;]*fonts\.gstatic\.com/)
  })

  it('does not widen font-src for image-only approvals', () => {
    const csp = buildPreviewCsp([IMAGE])
    expect(csp).not.toContain('fonts.gstatic.com')
    expect(csp).toContain('font-src')
  })

  it('lists each approved resource by origin and pathname in its serving directives', () => {
    const csp = buildPreviewCsp([FONTS_CSS, IMAGE])
    const styleSrc = csp.match(/style-src ([^;]*)/)![1]
    expect(styleSrc).toContain('https://fonts.googleapis.com/css2')
    expect(styleSrc).toContain('https://images.pexels.com/photos/12277020/pexels-photo-12277020.jpeg')
    // Query strings stay out of the CSP (they may carry signed parameters).
    expect(csp).not.toContain('auto=compress')
  })

  it('throws on an entry that is not a valid URL', () => {
    expect(() => buildPreviewCsp(['not-a-url'])).toThrow()
  })
})
