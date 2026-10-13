import { describe, expect, it } from 'vitest'
import { caseOrder, fixtures } from './fixtures'
import { createRuntime, resetRuntime } from '../domain/state'
import { validateFixture } from '../verification/fixtureValidator'

describe('phase 01 fixture contract', () => {
  it('contains all ten deterministic fixture IDs', () => {
    const ids = caseOrder.flatMap((id) => fixtures[id].fixtureIds)
    expect(ids).toEqual(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10'])
  })

  it('keeps same-component different-source negative cases explicit', () => {
    const qingye = fixtures.qingye
    const about = qingye.slots.find((item) => item.id === 'qingye-about-title-slot')
    const shared = qingye.slots.filter((item) => item.shared)
    expect(about?.sourceId).not.toBe(shared[0]?.sourceId)
    expect(shared).toHaveLength(3)
  })

  it('resets each case to its fixture values', () => {
    caseOrder.forEach((id) => {
      const runtime = createRuntime(fixtures[id])
      const changed = { ...runtime, draftValues: { changed: 'temporary' } }
      expect(resetRuntime(fixtures[id]).draftValues).toEqual(runtime.draftValues)
      expect(changed.draftValues).not.toEqual(resetRuntime(fixtures[id]).draftValues)
    })
  })

  it('validates every fixture contract without issues', () => {
    const issues = caseOrder.flatMap((id) => validateFixture(fixtures[id]))
    expect(issues).toEqual([])
  })
})
