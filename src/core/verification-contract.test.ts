import { describe, expect, it } from 'vitest'
import { normalizeVerificationContract, verificationContractHash } from './verification-contract'

const value = {
  pages: [
    { pageRef: 'page:home', path: '/', markerText: 'Home page' },
    { pageRef: 'page:autumn', path: '/#autumn', markerText: 'Autumn page', navigateBy: { role: 'button', name: 'Autumn route' } },
  ],
  interactions: [{ pageRef: 'page:home', role: 'button', name: 'Add to basket', expectedText: 'Added' }],
}

describe('user-declared browser verification contract', () => {
  it('normalizes a same-origin route, visible page markers, and accessible controls without executable code', () => {
    const normalized = normalizeVerificationContract(value, ['page:home', 'page:autumn'])!
    expect(normalized.pages).toHaveLength(2)
    expect(normalized.interactions[0]).toMatchObject({ pageRef: 'page:home', role: 'button', name: 'Add to basket', expectedText: 'Added' })
    expect(verificationContractHash(normalized)).toMatch(/^[a-f0-9]{64}$/)
    expect(verificationContractHash(normalized)).toBe(verificationContractHash(normalizeVerificationContract(value, ['page:home', 'page:autumn'])))
  })

  it.each(['https://other.invalid/', '//other.invalid/', '/%2e%2e/private'])('rejects non-local or traversing page path %s', path => {
    expect(() => normalizeVerificationContract({ ...value, pages: [{ ...value.pages[0], path }] }, ['page:home'])).toThrow(/same-origin|traverse/)
  })

  it('rejects undeclared routes, duplicate pages, and scriptable interaction types', () => {
    expect(() => normalizeVerificationContract(value, ['page:home'])).toThrow(/not present/)
    expect(() => normalizeVerificationContract({ ...value, pages: [value.pages[0], value.pages[0]] }, ['page:home'])).toThrow(/unique/)
    expect(() => normalizeVerificationContract({ ...value, interactions: [{ ...value.interactions[0], role: 'textbox' }] }, ['page:home', 'page:autumn'])).toThrow(/buttons or links/)
  })
})
