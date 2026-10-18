import { describe, expect, it } from 'vitest'
import { addressOnPreviewNetwork } from './candidate-preview'

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
