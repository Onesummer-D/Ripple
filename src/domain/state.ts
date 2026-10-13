import type { CandidateEdit, CaseFixture, CaseId, Evidence, ScopeDecision, ScopeMode, Snapshot } from './contracts'

export interface CaseRuntime {
  caseId: CaseId
  selectedSlotId?: string
  candidate?: CandidateEdit
  decision?: ScopeDecision
  draftValues: Record<string, string>
  snapshots: Snapshot[]
  currentSnapshotId?: string
  status: 'idle' | 'selected' | 'candidate' | 'previewing' | 'applied'
}

export const createRuntime = (fixture: CaseFixture): CaseRuntime => ({
  caseId: fixture.id,
  draftValues: Object.fromEntries(fixture.slots.map((item) => [item.id, item.value])),
  snapshots: [],
  status: 'idle',
})

export const resetRuntime = (fixture: CaseFixture): CaseRuntime => createRuntime(fixture)
export const resetCase = resetRuntime

export const selectSlot = (runtime: CaseRuntime, slotId: string): CaseRuntime => ({
  ...runtime,
  selectedSlotId: slotId,
  candidate: undefined,
  decision: undefined,
  status: 'selected',
})

export const setCandidate = (runtime: CaseRuntime, candidate: CandidateEdit): CaseRuntime => ({
  ...runtime,
  candidate,
  decision: undefined,
  status: 'candidate',
})

export const chooseScope = (runtime: CaseRuntime, decision: ScopeDecision, mode: ScopeMode): CaseRuntime => ({
  ...runtime,
  decision: { ...decision, mode },
  status: 'previewing',
})

export const cancelDraft = (runtime: CaseRuntime): CaseRuntime => ({
  ...runtime,
  selectedSlotId: undefined,
  candidate: undefined,
  decision: undefined,
  status: runtime.snapshots.length > 0 ? 'applied' : 'idle',
})

export const createSnapshot = (runtime: CaseRuntime, fixture: CaseFixture, decision: ScopeDecision, state: Record<string, string>, createdAt: string, previewEvidence: Evidence[] = []): Snapshot => ({
  id: runtime.caseId + '-snapshot-' + String(runtime.snapshots.length + 1),
  caseId: runtime.caseId,
  createdAt,
  decision,
  verificationEvidenceIds: [...fixture.evidence.map((item) => item.id), ...previewEvidence.map((item) => item.id)],
  previewEvidence: structuredClone(previewEvidence),
  state,
  previousSnapshotId: runtime.currentSnapshotId,
})

export const applyDraft = (runtime: CaseRuntime, fixture: CaseFixture, createdAt: string, previewEvidence: Evidence[] = []): CaseRuntime => {
  if (!runtime.candidate || !runtime.decision) return runtime
  if (runtime.status === 'applied') return runtime
  if (runtime.candidate.caseId !== runtime.caseId || runtime.decision.caseId !== runtime.caseId || runtime.decision.candidateEditId !== runtime.candidate.id) return runtime
  const knownInstances = new Set(fixture.slots.map((item) => item.instanceId))
  if (runtime.decision.affectedInstanceIds.some((id) => !knownInstances.has(id))) return runtime
  const nextValues = { ...runtime.draftValues }
  const affected = new Set(runtime.decision.affectedInstanceIds)
  fixture.slots.forEach((item) => {
    if (affected.has(item.instanceId) && item.sourceId === runtime.candidate?.sourceId) {
      nextValues[item.id] = runtime.candidate?.newValue ?? nextValues[item.id]
    }
  })
  const { candidate, decision } = runtime
  const matchingEvidence = previewEvidence.filter((item) => item.caseId === runtime.caseId && item.verification === 'verified' && item.context?.previewMode === 'candidate' && item.context.candidateEditId === candidate.id && item.context.candidateValue === candidate.newValue && item.context.scopeDecisionId === decision.id && item.context.scopeMode === decision.mode)
  const snapshot = createSnapshot(runtime, fixture, runtime.decision, nextValues, createdAt, matchingEvidence)
  return { ...runtime, draftValues: nextValues, snapshots: runtime.snapshots.concat(snapshot), currentSnapshotId: snapshot.id, status: 'applied' }
}

export const restorePrevious = (runtime: CaseRuntime, fixture: CaseFixture): CaseRuntime => {
  const current = runtime.currentSnapshotId ? runtime.snapshots.find((item) => item.id === runtime.currentSnapshotId) : undefined
  const previous = current?.previousSnapshotId ? runtime.snapshots.find((item) => item.id === current.previousSnapshotId) : undefined
  const initialValues = Object.fromEntries(fixture.slots.map((item) => [item.id, item.value]))
  return {
    ...runtime,
    selectedSlotId: undefined,
    candidate: undefined,
    decision: undefined,
    draftValues: previous?.state ?? initialValues,
    currentSnapshotId: previous?.id,
    status: previous ? 'applied' : 'idle',
  }
}

export const restoreSnapshot = (runtime: CaseRuntime, fixture: CaseFixture, snapshotId: string): CaseRuntime => {
  const snapshot = runtime.snapshots.find((item) => item.id === snapshotId)
  if (!snapshot || snapshot.caseId !== fixture.id) return runtime
  return {
    ...runtime,
    selectedSlotId: undefined,
    candidate: undefined,
    decision: undefined,
    draftValues: { ...snapshot.state },
    currentSnapshotId: snapshot.id,
    status: 'applied',
  }
}
