import { describe, expect, it } from 'vitest'
import { createDemoAdapter } from './demo-adapter'
import { DEMO_CONTENT, demoSlotForElement, projectDemoSlot } from './demo-content'

describe('UI-RC2 Demo content contract', () => {
  it('defines four browsable pages with explicit slot ownership', () => {
    expect(DEMO_CONTENT.pages.map(page => page.pageRef)).toEqual([
      'page:home', 'page:products', 'page:seasonal', 'page:contact',
    ])
    for (const page of DEMO_CONTENT.pages) {
      for (const slot of page.slots) expect(slot.pageRef).toBe(page.pageRef)
    }
  })

  it('projects shared TEXT to Home, Products and Seasonal only when included', () => {
    const slot = DEMO_CONTENT.pages.find(page => page.pageRef === 'page:home')!.slots.find(item => item.sourceKey === 'campaign.hero.title')!
    const input = { selectedSourceKey: 'campaign.hero.title', draftText: '冬日茶器市集', scope: 'include' as const }
    for (const pageRef of ['page:home', 'page:products', 'page:seasonal'] as const) {
      expect(projectDemoSlot(slot, pageRef, input)).toMatchObject({ state: 'candidate', displayText: '冬日茶器市集' })
    }
    expect(projectDemoSlot(slot, 'page:contact', input).state).toBe('unproven')
  })

  it('keeps exclude/protect and UNKNOWN pages fail-closed', () => {
    const slot = DEMO_CONTENT.pages.find(page => page.pageRef === 'page:home')!.slots.find(item => item.sourceKey === 'campaign.hero.title')!
    const base = { selectedSourceKey: 'campaign.hero.title', draftText: '新标题' }
    expect(projectDemoSlot(slot, 'page:products', { ...base, scope: 'exclude' })).toMatchObject({ state: 'protected', displayText: '秋日茶器市集' })
    expect(projectDemoSlot(slot, 'page:products', { ...base, scope: 'protect' })).toMatchObject({ state: 'protected', displayText: '秋日茶器市集' })
    expect(projectDemoSlot(slot, 'page:contact', { ...base, scope: 'include' })).toMatchObject({ state: 'unproven', displayText: '秋日茶器市集' })
    const contactUnknown = DEMO_CONTENT.pages.find(page => page.pageRef === 'page:contact')!.slots[0]
    expect(contactUnknown.selectableElement).toBeUndefined()
    expect(contactUnknown.unknownReasons.length).toBeGreaterThan(0)
  })

  it('keeps target ownership separate from the browsing page', async () => {
    const adapter = createDemoAdapter()
    let model = await adapter.load()
    model = adapter.selectElement(model, 'el:hero-title')
    model = adapter.setDraftText(model, '冬日茶器市集')
    const before = model.pages
    model = adapter.setPage(model, 'page:seasonal')
    expect(model.currentPageRef).toBe('page:seasonal')
    expect(model.selectedElementId).toBe('el:hero-title')
    expect(model.draftAfterText).toBe('冬日茶器市集')
    expect(model.pages).toBe(before)
    expect(demoSlotForElement(model.selectedElementId!)?.pageRef).toBe('page:home')
  })
})
