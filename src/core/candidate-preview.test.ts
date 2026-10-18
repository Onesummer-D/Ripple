import { describe, expect, it } from 'vitest'
import { addressOnPreviewNetwork, trustedOriginsFromSources } from './candidate-preview'

describe('candidate preview network address', () => {
  it('uses only the address assigned on the candidate internal network', () => {
    expect(addressOnPreviewNetwork(JSON.stringify({
      'ripple-preview-net-candidate': { IPAddress: '172.24.0.3' },
      bridge: { IPAddress: '172.17.0.4' },
    }), 'ripple-preview-net-candidate')).toBe('172.24.0.3')
  })

  it('rejects missing networks and unusable addresses', () => {
    expect(() => addressOnPreviewNetwork('{}', 'ripple-preview-net-candidate')).toThrow(/未加入预期/)
    expect(() => addressOnPreviewNetwork(JSON.stringify({
      'ripple-preview-net-candidate': { IPAddress: '' },
    }), 'ripple-preview-net-candidate')).toThrow(/未加入预期/)
  })
})

describe('candidate preview resource policy', () => {
  it('allows only HTTPS origins already present in tracked project source', () => {
    expect(trustedOriginsFromSources([
      `/* image: https://assets.example.test/path/image.webp */ @import url('https://fonts.googleapis.com/css?family=Inter');`,
      `const external = 'https://untrusted.invalid/'; const local = 'http://insecure.example.test/a.png';`,
    ])).toEqual([
      'https://assets.example.test',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://untrusted.invalid',
    ])
  })
})
