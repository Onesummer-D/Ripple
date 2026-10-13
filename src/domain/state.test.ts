import { describe, expect, it } from 'vitest'
import { fixtures } from '../cases/fixtures'
import { applyDraft, cancelDraft, chooseScope, createRuntime, restorePrevious, restoreSnapshot, selectSlot, setCandidate } from './state'

describe('editor domain state', () => {
  it('keeps a candidate and scope decision typed before applying', () => {
    const fixture = fixtures.qingye
    const selected = selectSlot(createRuntime(fixture), 'qingye-home-title-slot')
    const candidate = setCandidate(selected, {
      id: 'candidate-qingye-1',
      caseId: 'qingye',
      instanceId: 'qingye-home-title',
      slotId: 'qingye-home-title-slot',
      sourceId: 'qingye-shared-title',
      oldValue: '秋日上新',
      newValue: '秋日限定上新',
      editKind: 'TEXT',
    })
    const previewing = chooseScope(candidate, {
      id: 'scope-qingye-1',
      caseId: 'qingye',
      mode: 'INSTANCE',
      affectedInstanceIds: ['qingye-home-title'],
      candidateEditId: 'candidate-qingye-1',
    }, 'INSTANCE')
    const applied = applyDraft(previewing, fixture, '2026-10-11T10:00:00.000Z')
    expect(applied.status).toBe('applied')
    expect(applied.draftValues['qingye-home-title-slot']).toBe('秋日限定上新')
    expect(applied.draftValues['qingye-autumn-title-slot']).toBe('秋日上新')
    expect(applied.snapshots[0]?.previousSnapshotId).toBeUndefined()
  })

  it('projects a shared edit across the source consumers and restores the fixture state', () => {
    const fixture = fixtures.qingye
    const selected = selectSlot(createRuntime(fixture), 'qingye-home-title-slot')
    const candidate = setCandidate(selected, {
      id: 'candidate-qingye-shared',
      caseId: 'qingye',
      instanceId: 'qingye-home-title',
      slotId: 'qingye-home-title-slot',
      sourceId: 'qingye-shared-title',
      oldValue: '秋日上新',
      newValue: '秋日限定上新',
      editKind: 'TEXT',
    })
    const previewing = chooseScope(candidate, {
      id: 'scope-qingye-shared',
      caseId: 'qingye',
      mode: 'SHARED',
      affectedInstanceIds: ['qingye-home-title', 'qingye-autumn-title', 'qingye-collection-title'],
      candidateEditId: 'candidate-qingye-shared',
    }, 'SHARED')
    const applied = applyDraft(previewing, fixture, '2026-10-11T10:00:00.000Z')
    expect(applied.draftValues['qingye-autumn-title-slot']).toBe('秋日限定上新')
    expect(applied.draftValues['qingye-about-title-slot']).toBe('我们的故事')
    const restored = restorePrevious(applied, fixture)
    expect(restored.draftValues['qingye-home-title-slot']).toBe('秋日上新')
    expect(restored.candidate).toBeUndefined()
    expect(restored.decision).toBeUndefined()
  })

  it('preserves media and token edit kinds through candidate and shared preview', () => {
    (['qiguang', 'third-party'] as const).forEach((caseId) => {
      const fixture = fixtures[caseId]
      const first = fixture.slots[0]
      const runtime = setCandidate(selectSlot(createRuntime(fixture), first.id), {
        id: `${caseId}-candidate`,
        caseId,
        instanceId: first.instanceId,
        slotId: first.id,
        sourceId: first.sourceId,
        oldValue: first.value,
        newValue: caseId === 'qiguang' ? '4:3 · Alt' : '#111827',
        editKind: first.editKind,
      })
      const preview = chooseScope(runtime, {
        id: `${caseId}-scope`,
        caseId,
        mode: 'SHARED',
        affectedInstanceIds: fixture.slots.filter((item) => item.sourceId === first.sourceId).map((item) => item.instanceId),
        candidateEditId: `${caseId}-candidate`,
      }, 'SHARED')
      expect(preview.candidate?.editKind).toBe(fixture.editKind)
      expect(preview.decision?.affectedInstanceIds.length).toBeGreaterThan(1)
    })
  })

  it('keeps independent sources isolated and replaces stale scope decisions on re-preview', () => {
    const fixture = fixtures.qingye
    const about = fixture.slots.find((item) => item.id === 'qingye-about-title-slot')!
    const runtime = setCandidate(selectSlot(createRuntime(fixture), about.id), {
      id: 'qingye-about-candidate', caseId: 'qingye', instanceId: about.instanceId, slotId: about.id,
      sourceId: about.sourceId, oldValue: about.value, newValue: '关于青野', editKind: about.editKind,
    })
    const sharedSourcePreview = chooseScope(runtime, {
      id: 'qingye-about-shared', caseId: 'qingye', mode: 'SHARED', affectedInstanceIds: [about.instanceId], candidateEditId: 'qingye-about-candidate',
    }, 'SHARED')
    expect(sharedSourcePreview.decision?.affectedInstanceIds).toEqual([about.instanceId])
    const instancePreview = chooseScope(sharedSourcePreview, {
      id: 'qingye-about-instance', caseId: 'qingye', mode: 'INSTANCE', affectedInstanceIds: [about.instanceId], candidateEditId: 'qingye-about-candidate',
    }, 'INSTANCE')
    expect(instancePreview.decision?.id).toBe('qingye-about-instance')
    expect(instancePreview.decision?.mode).toBe('INSTANCE')
  })

  it('supports cancelling a candidate and restoring a specific snapshot', () => {
    const fixture = fixtures.qiguang
    const first = fixture.slots[0]
    const runtime = setCandidate(selectSlot(createRuntime(fixture), first.id), {
      id: 'qiguang-candidate', caseId: 'qiguang', instanceId: first.instanceId, slotId: first.id,
      sourceId: first.sourceId, oldValue: first.value, newValue: '4:3 · Alt', editKind: 'MEDIA',
    })
    const preview = chooseScope(runtime, {
      id: 'qiguang-scope', caseId: 'qiguang', mode: 'INSTANCE', affectedInstanceIds: [first.instanceId], candidateEditId: 'qiguang-candidate',
    }, 'INSTANCE')
    const applied = applyDraft(preview, fixture, '2026-10-11T10:00:00.000Z')
    expect(cancelDraft(preview).candidate).toBeUndefined()
    expect(restoreSnapshot(applied, fixture, applied.snapshots[0].id).draftValues[first.id]).toBe('4:3 · Alt')
    expect(restoreSnapshot(applied, fixture, 'missing').draftValues[first.id]).toBe('4:3 · Alt')
  })

  it('tracks the current snapshot pointer and prevents duplicate apply', () => {
    const fixture = fixtures.qingye
    const slot = fixture.slots[0]
    const candidate = setCandidate(selectSlot(createRuntime(fixture), slot.id), {
      id: 'qingye-repeat-candidate', caseId: 'qingye', instanceId: slot.instanceId, slotId: slot.id,
      sourceId: slot.sourceId, oldValue: slot.value, newValue: '秋日限定', editKind: 'TEXT',
    })
    const preview = chooseScope(candidate, {
      id: 'qingye-repeat-scope', caseId: 'qingye', mode: 'INSTANCE', affectedInstanceIds: [slot.instanceId], candidateEditId: 'qingye-repeat-candidate',
    }, 'INSTANCE')
    const applied = applyDraft(preview, fixture, '2026-10-11T10:00:00.000Z')
    expect(applied.currentSnapshotId).toBe('qingye-snapshot-1')
    expect(applyDraft(applied, fixture, '2026-10-11T10:01:00.000Z').snapshots).toHaveLength(1)
    const restored = restorePrevious(applied, fixture)
    expect(restored.currentSnapshotId).toBeUndefined()
    expect(restored.status).toBe('idle')
  })

  it('follows previousSnapshotId across multi-version restores and branches', () => {
    const fixture = fixtures.qingye
    const slot = fixture.slots[0]
    const makePreview = (runtime: ReturnType<typeof createRuntime>, value: string, id: string) => chooseScope(setCandidate(selectSlot(runtime, slot.id), {
      id: `${id}-candidate`, caseId: 'qingye', instanceId: slot.instanceId, slotId: slot.id,
      sourceId: slot.sourceId, oldValue: runtime.draftValues[slot.id] ?? slot.value, newValue: value, editKind: 'TEXT',
    }), {
      id: `${id}-scope`, caseId: 'qingye', mode: 'INSTANCE', affectedInstanceIds: [slot.instanceId], candidateEditId: `${id}-candidate`,
    }, 'INSTANCE')
    const first = applyDraft(makePreview(createRuntime(fixture), '一版', 's1'), fixture, '2026-10-11T10:00:00.000Z')
    const second = applyDraft(makePreview(first, '二版', 's2'), fixture, '2026-10-11T10:01:00.000Z')
    expect(second.snapshots[1]?.previousSnapshotId).toBe('qingye-snapshot-1')
    expect(restorePrevious(second, fixture).draftValues[slot.id]).toBe('一版')
    const branchBase = restoreSnapshot(second, fixture, 'qingye-snapshot-1')
    const branch = applyDraft(makePreview(branchBase, '分支版', 's3'), fixture, '2026-10-11T10:02:00.000Z')
    expect(branch.snapshots[2]?.previousSnapshotId).toBe('qingye-snapshot-1')
    expect(restorePrevious(branch, fixture).draftValues[slot.id]).toBe('一版')
  })
})
