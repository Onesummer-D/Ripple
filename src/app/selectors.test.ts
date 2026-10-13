import { describe, expect, it } from 'vitest'
import { caseOrder, fixtures } from '../cases/fixtures'
import { truthMatrix } from '../cases/truthMatrix'
import type { CandidateEdit } from '../domain/contracts'
import { affectedInstanceIdsFor, candidatePreviewValues, evidencePresentation, impactProjection, projectValues, routePreviewProjection } from './selectors'

describe('app selectors', () => {
  it('previews scoped candidates without applying or touching independent sources', () => {
    const fixture = fixtures.qiguang
    const slot = fixture.slots[1]
    const candidate: CandidateEdit = { id: 'media', caseId: fixture.id, instanceId: slot.instanceId, slotId: slot.id, sourceId: slot.sourceId, oldValue: slot.value, newValue: 'media://new', editKind: 'MEDIA' }
    const local = candidatePreviewValues(fixture.slots, candidate)
    expect(local.filter((item) => item.value === 'media://new').map((item) => item.route)).toEqual(['/program'])
    const shared = candidatePreviewValues(fixture.slots, candidate, { id: 'shared', caseId: fixture.id, candidateEditId: candidate.id, mode: 'SHARED', affectedInstanceIds: affectedInstanceIdsFor(fixture, candidate, 'SHARED') })
    expect(shared.filter((item) => item.value === 'media://new').map((item) => item.route)).toEqual(['/', '/program', '/tickets'])
    expect(shared.find((item) => item.route === '/archive')?.value).toBe('/assets/qiguang-archive.svg')
    expect(fixture.slots[1].value).toBe('/assets/qiguang-original.svg')
  })
  it('projects draft values without mutating fixture data', () => {
    caseOrder.forEach((caseId) => {
      const fixture = fixtures[caseId]
      const first = fixture.slots[0]
      const values = projectValues(fixture, { [first.id]: 'candidate' })
      expect(values.find((item) => item.id === first.id)?.value).toBe('candidate')
      expect(fixture.slots[0].value).not.toBe('candidate')
    })
  })

  it('derives INSTANCE and SHARED scope from the same source contract', () => {
    truthMatrix.forEach((expectation) => {
      const fixture = fixtures[expectation.caseId]
      const slot = fixture.slots.find((item) => item.id === expectation.selectedSlotId)
      expect(slot).toBeDefined()
      const candidate = { id: expectation.fixtureId, caseId: fixture.id, instanceId: slot!.instanceId, slotId: slot!.id, sourceId: slot!.sourceId, oldValue: slot!.value, newValue: 'candidate', editKind: fixture.editKind } satisfies CandidateEdit
      expect(affectedInstanceIdsFor(fixture, candidate, 'INSTANCE')).toEqual([slot!.instanceId])
      expect(affectedInstanceIdsFor(fixture, candidate, 'SHARED')).toEqual(fixture.slots.filter((item) => item.sourceId === slot!.sourceId).map((item) => item.instanceId))
    })
  })

  it('projects graph nodes and explicit unknown evidence', () => {
    const fixture = fixtures['third-party']
    const sourceSlot = fixture.slots[0]
    const projection = impactProjection(fixture, { id: 'scope', caseId: fixture.id, mode: 'INSTANCE', affectedInstanceIds: [sourceSlot.instanceId], candidateEditId: 'candidate' })
    expect(projection.nodes.map((node) => node.id)).toEqual([sourceSlot.instanceId])
    expect(projection.edges.length).toBeGreaterThan(0)
    expect(evidencePresentation(fixture.evidence.find((item) => item.id.includes('UNKNOWN'))!)).toEqual({ unknown: true, label: 'UNKNOWN' })
  })

  it('groups route previews while preserving affected state', () => {
    expect(routePreviewProjection(fixtures.qingye.slots).map((item) => item.route)).toEqual(['/', '/autumn', '/collection', '/about'])
    expect(routePreviewProjection(fixtures.qiguang.slots).map((item) => item.route)).toEqual(['/', '/program', '/tickets', '/archive'])
    const thirdParty = fixtures['third-party']
    const selected = thirdParty.slots[0]
    const preview = routePreviewProjection(thirdParty.slots, { id: 'scope', caseId: thirdParty.id, mode: 'INSTANCE', affectedInstanceIds: [selected.instanceId], candidateEditId: 'candidate' })
    expect(preview.find((item) => item.route === '/showcase')?.affected).toBe(true)
    expect(preview.find((item) => item.route === '/docs')?.affected).toBe(false)
  })
})
