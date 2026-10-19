import { describe, expect, it } from 'vitest'
import { isPublicPreviewResourceAddress, replaceFontWithData } from './preview-resource-snapshot'

describe('isolated preview resource snapshots', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.4', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '2001:db8::1'])('rejects non-public resource address %s', address => {
    expect(isPublicPreviewResourceAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::1'])('accepts a public resource address %s', address => {
    expect(isPublicPreviewResourceAddress(address)).toBe(true)
  })

  it('inlines only the exact approved stylesheet font dependency into a data URI', () => {
    const fontUrl = 'https://fonts.gstatic.com/s/ripple/v1/font.woff2'
    const otherUrl = 'https://fonts.gstatic.com/s/ripple/v1/other.woff2'
    const css = '@font-face{src:url("' + fontUrl + '")} @font-face{src:url(' + otherUrl + ')}'
    const rewritten = replaceFontWithData(css, fontUrl, 'font/woff2', Buffer.from('font-bytes'))
    expect(rewritten).toContain('url(data:font/woff2;base64,Zm9udC1ieXRlcw==)')
    expect(rewritten).toContain(otherUrl)
    expect(rewritten).not.toContain(fontUrl)
  })
})
