import { describe, expect, it } from 'vitest'
import { fixtures } from '../cases/fixtures'
import { createPageDocument } from './pageDocument'
import { viewportForEvidence } from './viewports'
import { evidenceAssetHref } from './evidenceAssets'

describe('page document projections', () => {
  it('renders all local routes with source identities and distinct content', () => {
    for (const fixture of Object.values(fixtures)) {
      for (const route of new Set(fixture.slots.map((slot) => slot.route))) {
        const html = createPageDocument(fixture.id, route, fixture.slots, {})
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        expect(parsed.body.dataset.route).toBe(route)
        expect(parsed.querySelectorAll('[data-slot-id]').length).toBe(fixture.slots.filter((slot) => slot.route === route).length)
        expect(parsed.querySelector('[data-source-id]')?.getAttribute('data-source-id')).toBe(fixture.slots.find((slot) => slot.route === route)?.sourceId)
      }
    }
    expect(createPageDocument('qingye', '/about', fixtures.qingye.slots, {})).toContain('青野的故事')
    expect(createPageDocument('qiguang', '/archive', fixtures.qiguang.slots, {})).toContain('往届回顾')
  })

  it('escapes candidate content rather than executing it in the preview', () => {
    const html = createPageDocument('qingye', '/', [{ ...fixtures.qingye.slots[0], value: '<script>oops()</script>' }], {})
    expect(html).toContain('&lt;script&gt;')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('script')).toBeNull()
  })

  it('maps only known Evidence viewports and exposes supported assets', () => {
    expect(viewportForEvidence('375x812')?.width).toBe(375)
    expect(viewportForEvidence('768 × 1024')?.height).toBe(1024)
    expect(viewportForEvidence('fixture')).toBeUndefined()
    expect(viewportForEvidence('1375')).toBeUndefined()
    expect(evidenceAssetHref('fixtures/a.json')).toBe('/fixtures/a.json')
    expect(evidenceAssetHref('unknown://a')).toBeUndefined()
    expect(evidenceAssetHref('javascript:alert(1)')).toBeUndefined()
  })
})
