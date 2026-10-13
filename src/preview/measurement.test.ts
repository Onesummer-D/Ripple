import { describe, expect, it } from 'vitest'
import { fixtures } from '../cases/fixtures'
import { centerCoverCrop, intersectionArea, measurementEvidence, parseMeasurement } from './measurement'
import { relationshipProjection } from './relationship'
import { applyDraft, chooseScope, createRuntime, selectSlot, setCandidate } from '../domain/state'

const slot = fixtures.qingye.slots[0]
const expected = { requestId: 'current', caseId: 'qingye' as const, route: '/', width: 375, height: 812, slots: fixtures.qingye.slots }
const message = { type: 'ripple:measurement', requestId: 'current', caseId: 'qingye', route: '/', width: 375, height: 812, measuredAt: '2026-10-13T00:00:00Z', slots: [{ slotId: slot.id, instanceId: slot.instanceId, sourceId: slot.sourceId, rect: { x: 20, y: 20, width: 120, height: 80 } }], cta: { x: 20, y: 70, width: 100, height: 40 } }

describe('live preview evidence', () => {
  it('accepts current identities and rejects stale or malformed measurements', () => {
    expect(parseMeasurement(message, expected)?.width).toBe(375)
    expect(parseMeasurement({ ...message, requestId: 'previous' }, expected)).toBeUndefined()
    expect(parseMeasurement({ ...message, width: 768 }, expected)).toBeUndefined()
    expect(parseMeasurement({ ...message, slots: [message.slots[0], message.slots[0]] }, expected)).toBeUndefined()
    expect(parseMeasurement({ ...message, slots: [{ ...message.slots[0], sourceId: 'other' }] }, expected)).toBeUndefined()
    expect(parseMeasurement({ ...message, cta: { ...message.cta, width: NaN } }, expected)).toBeUndefined()
  })

  it('calculates actual overlap and center-cover visible image area', () => {
    expect(intersectionArea(message.slots[0].rect, message.cta)).toBe(3000)
    expect(intersectionArea(message.slots[0].rect, { x: 500, y: 500, width: 10, height: 10 })).toBe(0)
    expect(centerCoverCrop(400, 500, 800, 450)).toEqual({ x: 0, y: 137.5, width: 400, height: 225 })
    expect(centerCoverCrop(0, 500, 800, 450)).toBeUndefined()
  })

  it('projects real source edges and excludes independent nodes from affected scope', () => {
    const fixture = fixtures.qingye
    const shared = relationshipProjection(fixture, slot.sourceId, { id: 'shared', caseId: fixture.id, mode: 'SHARED', affectedInstanceIds: fixture.slots.filter((item) => item.shared).map((item) => item.instanceId), candidateEditId: 'c' })
    expect(shared.affectedCount).toBe(3)
    expect(shared.edges.filter((edge) => edge.affected)).toHaveLength(3)
    expect(shared.instances.find((node) => node.route === '/about')).toMatchObject({ affected: false, independent: true })
    const local = relationshipProjection(fixture, slot.sourceId, { id: 'local', caseId: fixture.id, mode: 'INSTANCE', affectedInstanceIds: [slot.instanceId], candidateEditId: 'c' })
    expect(local.affectedCount).toBe(1)
    expect(local.edges.filter((edge) => edge.affected)).toHaveLength(1)
    const edgeOnlyFixture = { ...fixture, graph: { ...fixture.graph, nodes: fixture.graph.nodes.map((node) => ({ ...node, sourceId: undefined })) } }
    const edgeOnly = relationshipProjection(edgeOnlyFixture, slot.sourceId)
    expect(edgeOnly.instances.find((node) => node.route === '/')).toMatchObject({ independent: false, unknown: false })
    expect(edgeOnly.instances.find((node) => node.route === '/about')).toMatchObject({ independent: true, unknown: false })
  })

  it('stores matching preview proof in a snapshot and drops wrong candidate or scope proof', () => {
    const candidate = { id: 'c', caseId: 'qingye' as const, slotId: slot.id, instanceId: slot.instanceId, sourceId: slot.sourceId, oldValue: slot.value, newValue: 'new', editKind: 'TEXT' as const }
    const decision = { id: 'd', caseId: 'qingye' as const, mode: 'INSTANCE' as const, affectedInstanceIds: [slot.instanceId], candidateEditId: 'c' }
    const runtime = chooseScope(setCandidate(selectSlot(createRuntime(fixtures.qingye), slot.id), candidate), decision, 'INSTANCE')
    const proof = measurementEvidence('E-LIVE-test', 'qingye', '/', parseMeasurement(message, expected)!, { previewMode: 'candidate', candidateEditId: 'c', candidateValue: 'new', scopeDecisionId: 'd', scopeMode: 'INSTANCE' })
    const wrong = { ...proof, id: 'E-LIVE-stale', context: { ...proof.context!, candidateValue: 'old' } }
    const applied = applyDraft(runtime, fixtures.qingye, '2026-10-13T01:00:00Z', [proof, wrong])
    expect(applied.snapshots[0].previewEvidence?.map((item) => item.id)).toEqual(['E-LIVE-test'])
    expect(applied.snapshots[0].verificationEvidenceIds).toContain('E-LIVE-test')
    proof.measurement!.slots[0].rect.width = 777
    expect(applied.snapshots[0].previewEvidence?.[0].measurement?.slots[0].rect.width).toBe(120)
  })
})
