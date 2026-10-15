import { describe, expect, it } from 'vitest'
import { measurementEvidence } from './measurement'
import { previewExplanations, sourceExplanation } from './explanations'
import { fixtures } from '../cases/fixtures'
import type { CandidateEdit } from '../domain/contracts'
import type { PreviewMeasurement } from '../domain/contracts'

const report: PreviewMeasurement = { measuredAt: '2026-10-14T00:00:00Z', width: 375, height: 812, slots: [{ slotId: 'title', instanceId: 'instance', sourceId: 'source', rect: { x: 0, y: 0, width: 100, height: 100 } }], cta: { x: 50, y: 50, width: 100, height: 50 } }
const proof = () => measurementEvidence('proof', 'qingye', '/autumn', structuredClone(report), { previewMode: 'candidate' })
describe('evidence explanations', () => {
  it('explains reads consumers and scope without including the independent About source', () => {
    const candidate: CandidateEdit = { id: 'c', caseId: 'qingye', slotId: fixtures.qingye.slots[0].id, instanceId: 'qingye-home-title', sourceId: 'qingye-shared-title', editKind: 'TEXT', oldValue: 'old', newValue: 'new' }
    const explanation = sourceExplanation(fixtures.qingye, candidate, { id: 'd', caseId: 'qingye', candidateEditId: 'c', mode: 'INSTANCE', affectedInstanceIds: ['qingye-home-title'] })
    expect(explanation.consumers.map((node) => node.route)).toEqual(['/', '/autumn', '/collection'])
    expect(explanation.affected).toHaveLength(1)
    expect(explanation.evidence.length).toBeGreaterThan(0)
    expect(sourceExplanation({ ...fixtures.qingye, evidence: [] }, candidate).state).toBe('unknown')
  })
  it('reports the measured intersection and clears risk after a new separated sample', () => {
    const evidence = proof()
    expect(previewExplanations(evidence)[0]).toMatchObject({ state: 'risk', finding: expect.stringContaining('2500 px²'), evidenceIds: ['proof'] })
    evidence.measurement!.cta!.y = 200
    expect(previewExplanations(evidence)[0].state).toBe('observed')
  })
  it('keeps missing, unverified and loading results explicitly unknown', () => {
    for (const evidence of [undefined, { ...proof(), verification: 'loading' as const }, { ...proof(), verification: 'unknown' as const }]) {
      expect(previewExplanations(evidence)[0]).toMatchObject({ state: 'unknown', evidenceIds: [] })
    }
  })
  it('calculates centered cover only and treats undecoded media as unknown', () => {
    const evidence = proof()
    delete evidence.measurement!.cta
    const slot = evidence.measurement!.slots[0]
    slot.media = { naturalWidth: 400, naturalHeight: 500, objectFit: 'cover', objectPosition: '50% 50%' }
    expect(previewExplanations(evidence)[0].finding).toContain('400 × 400')
    slot.media.objectPosition = '0% 0%'
    expect(previewExplanations(evidence)[0].finding).not.toContain('中心 cover')
    slot.media.naturalWidth = 0
    expect(previewExplanations(evidence)[0].state).toBe('unknown')
  })
  it('uses computed consumer colors without making contrast or design claims', () => {
    const evidence = proof()
    delete evidence.measurement!.cta
    evidence.measurement!.slots[0].style = { color: 'rgb(255, 102, 51)', backgroundColor: 'rgba(0, 0, 0, 0)', borderColor: 'rgb(0, 0, 0)' }
    const card = previewExplanations(evidence)[0]
    expect(card.finding).toContain('rgb(255, 102, 51)')
    expect(card.evidenceIds).toEqual(['proof'])
  })
})
