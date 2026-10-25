import { describe, expect, it } from 'vitest'
import { assessPickerDisplayIdentity, isCurrentPickerEnvelope, type PickerEnvelope } from './runtime-selection-bridge'

const version = 'a'.repeat(64)
const iframe = {}
const v2Id = (page: { pathname: string; search: string; hash: string }, sourceRef: string) =>
  `ripple-page-v2:${encodeURIComponent(JSON.stringify([page.pathname, page.search, page.hash]))}:_:${sourceRef}:key-a`
const message: PickerEnvelope = {
  type: 'ripple:element-selected', protocol: 'ripple-runtime-identity/v1',
  previewId: 'candidate-1', token: 'nonce-1', sourceRef: 'jsx:src/pages/HomePage.tsx#177',
  runtimeInstanceId: '/:_r_2_:jsx:src/pages/HomePage.tsx#177',
  identityCertainty: 'stable-react-instance', sourceVersion: version,
  pageContext: { pathname: '/', search: '', hash: '' },
  reasons: [], sameSourceCount: 1, tagName: 'h1', text: 'Candidate title',
}
const trusted = { sourceRef: message.sourceRef, sourceVersion: version, expectedPathname: '/' }
const scope = { eventSource: iframe, iframeSource: iframe, previewId: 'candidate-1', token: 'nonce-1' }

describe('candidate runtime picker refusal boundary', () => {
  it('passes a matching title only as navigation metadata, never instance-edit authorization', () => {
    expect(isCurrentPickerEnvelope(message, scope)).toBe(true)
    expect(assessPickerDisplayIdentity(message, trusted)).toMatchObject({
      certainty: 'stable-react-instance', permission: 'navigation-only', runtimeInstanceId: message.runtimeInstanceId,
      reasons: [],
    })
  })
  it('rejects a message from a different iframe', () => {
    expect(isCurrentPickerEnvelope(message, { ...scope, eventSource: {} })).toBe(false)
  })
  it('rejects an old preview id', () => {
    expect(isCurrentPickerEnvelope(message, { ...scope, previewId: 'replacement' })).toBe(false)
  })
  it('rejects an old selection nonce', () => {
    expect(isCurrentPickerEnvelope(message, { ...scope, token: 'other-nonce' })).toBe(false)
  })
  it('rejects unsupported or forged protocols', () => {
    expect(isCurrentPickerEnvelope({ ...message, protocol: 'untrusted/v1' }, scope)).toBe(false)
  })
  it('downgrades an unresolved keyed host placeholder', () => {
    expect(assessPickerDisplayIdentity({ ...message, runtimeInstanceId: '/:_r_2_:jsx:x#1:~' }, trusted))
      .toMatchObject({ certainty: 'unknown', permission: 'navigation-only' })
  })
  it('downgrades stale source versions', () => {
    expect(assessPickerDisplayIdentity({ ...message, sourceVersion: 'b'.repeat(64) }, trusted))
      .toMatchObject({ certainty: 'unknown', reasons: ['source-version-mismatch'] })
  })
  it('downgrades wrong page context', () => {
    expect(assessPickerDisplayIdentity({ ...message, pageContext: { pathname: '/old', search: '', hash: '' } }, trusted))
      .toMatchObject({ certainty: 'unknown' })
  })
  it('accepts a canonical v2 render namespace only for its exact full page tuple and source anchor', () => {
    const pageContext = { pathname: '/home', search: '?tab=a', hash: '#/products' }
    const v2 = { ...message, runtimeInstanceId: v2Id(pageContext, message.sourceRef), pageContext }
    const trustedV2 = { ...trusted, expectedPathname: pageContext.pathname }
    expect(assessPickerDisplayIdentity(v2, trustedV2)).toMatchObject({ certainty: 'stable-react-instance', reasons: [], runtimeInstanceId: v2.runtimeInstanceId })
    expect(assessPickerDisplayIdentity({ ...v2, pageContext: { ...pageContext, hash: '#/other' } }, trustedV2)).toMatchObject({ certainty: 'unknown', reasons: expect.arrayContaining(['route-namespace-stale']) })
    expect(assessPickerDisplayIdentity({ ...v2, runtimeInstanceId: v2Id(pageContext, 'jsx:elsewhere#9') }, trustedV2)).toMatchObject({ certainty: 'unknown', reasons: expect.arrayContaining(['route-namespace-stale']) })
  })
  it('downgrades duplicate identities without promoting declared certainty', () => {
    expect(assessPickerDisplayIdentity({ ...message, reasons: ['duplicate-runtime-instance'] }, trusted))
      .toMatchObject({ certainty: 'unknown', reasons: ['duplicate-runtime-instance'] })
  })
  it('never promotes position-dependent or unknown identities to stable', () => {
    for (const identityCertainty of ['position-dependent', 'unknown'] as const) {
      expect(assessPickerDisplayIdentity({ ...message, identityCertainty }, trusted).certainty).toBe('unknown')
    }
  })
  it('rejects missing trusted digest and missing page context', () => {
    expect(assessPickerDisplayIdentity(message, { ...trusted, sourceVersion: undefined }).certainty).toBe('unknown')
    expect(assessPickerDisplayIdentity({ ...message, pageContext: undefined }, trusted).certainty).toBe('unknown')
  })
})
