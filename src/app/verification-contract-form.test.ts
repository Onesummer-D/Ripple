import { describe, expect, it } from 'vitest'
import { createVerificationContractDraft, incompleteVerificationDeclarations, suggestVerificationPageMarkers, toBrowserVerificationContract } from './verification-contract-form'

describe('workbench verification form', () => {
  it('builds a restricted contract from declared page and interaction fields, not executable JSON', () => {
    const draft = createVerificationContractDraft([{ id: 'page:home' }, { id: 'page:story' }])
    draft.pages[0].path = '/'
    draft.pages[0].markerText = 'Home heading'
    draft.pages[1].path = '/story'
    draft.pages[1].markerText = 'Story heading'
    draft.pages[1].navigationRole = 'link'
    draft.pages[1].navigationName = 'Brand story'
    draft.interactions.push({ id: 'cart', pageRef: 'page:home', role: 'button', name: 'Add to cart', expectedText: 'Added to cart' })

    expect(incompleteVerificationDeclarations(draft)).toBe(0)
    expect(toBrowserVerificationContract(draft)).toEqual({
      pages: [
        { pageRef: 'page:home', path: '/', markerText: 'Home heading' },
        { pageRef: 'page:story', path: '/story', markerText: 'Story heading', navigateBy: { role: 'link', name: 'Brand story' } },
      ],
      interactions: [{ pageRef: 'page:home', role: 'button', name: 'Add to cart', expectedText: 'Added to cart' }],
    })
  })

  it('keeps incomplete declarations out of the executable contract so their checks remain unknown', () => {
    const draft = createVerificationContractDraft([{ id: 'page:home' }])
    draft.pages[0].path = '/'
    draft.pages[0].markerText = 'Home'
    draft.interactions.push({ id: 'incomplete', pageRef: 'page:home', role: 'button', name: 'Add to cart', expectedText: '' })

    expect(incompleteVerificationDeclarations(draft)).toBe(1)
    expect(toBrowserVerificationContract(draft)).toEqual({ pages: [{ pageRef: 'page:home', path: '/', markerText: 'Home' }], interactions: [] })
  })

  it('reports an access path without a visible marker as incomplete', () => {
    const draft = createVerificationContractDraft([{ id: 'page:story' }])
    draft.pages[0].path = '/story'

    expect(incompleteVerificationDeclarations(draft)).toBe(1)
    expect(toBrowserVerificationContract(draft)).toBeUndefined()
  })

  it('does not submit an interaction until its page is also declared for browser observation', () => {
    const draft = createVerificationContractDraft([{ id: 'page:home' }])
    draft.interactions.push({ id: 'cart', pageRef: 'page:home', role: 'button', name: 'Add to cart', expectedText: 'Added' })

    expect(incompleteVerificationDeclarations(draft)).toBe(1)
    expect(toBrowserVerificationContract(draft)).toBeUndefined()
  })

  it('restores only contract values that belong to currently analyzed routes', () => {
    const draft = createVerificationContractDraft([{ id: 'page:home' }], {
      pages: [{ pageRef: 'page:home', path: '/home', markerText: 'Home' }, { pageRef: 'page:removed', path: '/', markerText: 'Old' }],
      interactions: [{ pageRef: 'page:home', role: 'button', name: 'Continue', expectedText: 'Done' }],
    })
    expect(draft.pages).toEqual([{ pageRef: 'page:home', path: '/home', markerText: 'Home', navigationRole: 'button', navigationName: '', menuRole: 'button', menuName: '' }])
    expect(toBrowserVerificationContract(draft)?.interactions[0]).toMatchObject({ pageRef: 'page:home', name: 'Continue' })
  })

  it('emits a declared menu control only when the menu name is set, and round-trips it', () => {
    const draft = createVerificationContractDraft([{ id: 'page:autumn' }], {
      pages: [{ pageRef: 'page:autumn', path: '/', markerText: 'Autumn', navigateBy: { role: 'button', name: 'Autumn' }, menuControl: { role: 'button', name: '菜单' } }],
      interactions: [],
    })
    const contract = toBrowserVerificationContract(draft)
    expect(contract?.pages[0]).toMatchObject({ navigateBy: { role: 'button', name: 'Autumn' }, menuControl: { role: 'button', name: '菜单' } })
    draft.pages[0].menuName = '  '
    expect(toBrowserVerificationContract(draft)?.pages[0].menuControl).toBeUndefined()
  })

  it('suggests only unique, unedited source-proven TEXT markers for a single analyzed page', () => {
    const targets = [
      { id: 'home-title', kind: 'data' as const, value: 'Home title', impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' as const } },
      { id: 'overridden-title', kind: 'data' as const, value: 'Shared title', pageOverrides: { 'page:home': 'Home override' }, impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' as const } },
    ]

    expect(suggestVerificationPageMarkers([{ id: 'page:home' }], targets, [])).toEqual({ 'page:home': ['Home title', 'Home override'] })
  })

  it('omits edited, shared, unresolved, ambiguous, unsupported, and unbounded marker candidates', () => {
    const target = (id: string, patch: Partial<Parameters<typeof suggestVerificationPageMarkers>[1][number]> = {}) => ({
      id, kind: 'data' as const, value: id,
      impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' as const },
      ...patch,
    })
    const targets = [
      target('edited'),
      target('shared', { impact: { pageRefs: ['page:home', 'page:story'], unresolved: [], certainty: 'source-proven' } }),
      target('partial', { impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'partial' } }),
      target('unknown', { impact: { pageRefs: ['page:home'], unresolved: ['maybe'], certainty: 'unknown' } }),
      target('missing-route', { impact: { pageRefs: ['page:gone'], unresolved: [], certainty: 'source-proven' } }),
      target('media', { kind: 'media' }),
      target('token', { kind: 'token' }),
      target('too-long', { value: 'x'.repeat(301) }),
      target('shared-duplicate', { value: 'Ambiguous copy', impact: { pageRefs: ['page:home', 'page:story'], unresolved: [], certainty: 'source-proven' } }),
      target('duplicate-a', { value: 'Ambiguous copy' }),
      target('duplicate-b', { value: 'Ambiguous copy' }),
    ]

    expect(suggestVerificationPageMarkers([{ id: 'page:home' }, { id: 'page:story' }], targets, ['edited'])).toEqual({
      'page:home': [], 'page:story': [],
    })
  })
})
