import { describe, expect, it } from 'vitest'
import { caseOrder, fixtures } from './fixtures'
import { expectedRoutesFor, truthMatrix } from './truthMatrix'

describe('fixture truth matrix', () => {
  it('covers each deterministic fixture exactly once', () => {
    expect(truthMatrix.map((item) => item.fixtureId)).toEqual([
      'F01', 'F02', 'F03', 'F04', 'F05',
      'F06', 'F07', 'F08', 'F09', 'F10',
    ])
    expect(new Set(truthMatrix.map((item) => item.caseId))).toEqual(new Set(caseOrder))
  })

  it('matches fixture source consumption and preserves negative routes', () => {
    truthMatrix.forEach((expectation) => {
      const fixture = fixtures[expectation.caseId]
      const sourceSlots = fixture.slots.filter((slot) => slot.sourceId === expectation.sourceId)
      const selectedSlot = fixture.slots.find((slot) => slot.id === expectation.selectedSlotId)
      const sourceRoutes = [...new Set(sourceSlots.map((slot) => slot.route))].sort()

      expect(selectedSlot?.sourceId).toBe(expectation.sourceId)
      expect(selectedSlot?.route).toBe(expectation.instanceModeRoutes[0])
      expect(sourceRoutes).toEqual([...expectation.expectedRoutes].sort())
      expectation.excludedRoutes.forEach((route) => {
        expect(sourceRoutes).not.toContain(route)
      })
      expect(expectedRoutesFor(expectation.fixtureId, 'INSTANCE')).toEqual(expectation.instanceModeRoutes)
      expect(expectedRoutesFor(expectation.fixtureId, 'SHARED')).toEqual(expectation.sharedModeRoutes)
    })
  })
})
