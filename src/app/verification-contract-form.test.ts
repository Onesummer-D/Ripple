import { describe, expect, it } from 'vitest'
import { createVerificationContractDraft, incompleteVerificationDeclarations, toBrowserVerificationContract } from './verification-contract-form'

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
    expect(draft.pages).toEqual([{ pageRef: 'page:home', path: '/home', markerText: 'Home', navigationRole: 'button', navigationName: '' }])
    expect(toBrowserVerificationContract(draft)?.interactions[0]).toMatchObject({ pageRef: 'page:home', name: 'Continue' })
  })
})
