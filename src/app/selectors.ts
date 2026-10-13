import type { CandidateEdit, CaseFixture, EditableSlot, Evidence, ScopeDecision, ScopeMode } from '../domain/contracts'

export const projectValues = (fixture: CaseFixture, draftValues: Record<string, string>): EditableSlot[] => (
  fixture.slots.map((item) => ({ ...item, value: draftValues[item.id] ?? item.value }))
)

export const candidatePreviewValues = (values: EditableSlot[], candidate?: CandidateEdit, decision?: ScopeDecision): EditableSlot[] => {
  const affected = new Set(decision?.affectedInstanceIds ?? (candidate ? [candidate.instanceId] : []))
  return values.map((slot) => ({ ...slot, value: candidate && slot.sourceId === candidate.sourceId && affected.has(slot.instanceId) ? candidate.newValue : slot.value }))
}

export interface RoutePreviewProjection {
  route: string
  value: string
  slotIds: string[]
  instanceIds: string[]
  shared: boolean
  affected: boolean
}

export const routePreviewProjection = (values: EditableSlot[], decision?: ScopeDecision): RoutePreviewProjection[] => {
  const affectedInstances = new Set(decision?.affectedInstanceIds ?? [])
  const previews = new Map<string, RoutePreviewProjection>()
  values.forEach((slot) => {
    const current = previews.get(slot.route)
    if (current) {
      current.slotIds.push(slot.id)
      if (!current.instanceIds.includes(slot.instanceId)) current.instanceIds.push(slot.instanceId)
      current.shared = current.shared || slot.shared
      current.affected = current.affected || affectedInstances.has(slot.instanceId)
      return
    }
    previews.set(slot.route, {
      route: slot.route,
      value: slot.value,
      slotIds: [slot.id],
      instanceIds: [slot.instanceId],
      shared: slot.shared,
      affected: affectedInstances.has(slot.instanceId),
    })
  })
  return [...previews.values()]
}

export const affectedInstanceIdsFor = (fixture: CaseFixture, candidate: CandidateEdit, mode: ScopeMode): string[] => (
  mode === 'SHARED'
    ? [...new Set(fixture.slots.filter((item) => item.sourceId === candidate.sourceId).map((item) => item.instanceId))]
    : [candidate.instanceId]
)

export const impactProjection = (fixture: CaseFixture, decision?: ScopeDecision) => {
  const affectedIds = new Set(decision?.affectedInstanceIds ?? [])
  const nodes = fixture.graph.nodes.filter((node) => node.kind === 'instance' && affectedIds.has(node.id))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = fixture.graph.edges.filter((edge) => nodeIds.has(edge.from) || nodeIds.has(edge.to))
  return { nodes, edges }
}

export const evidencePresentation = (item: Evidence) => {
  const unknown = item.verification === 'unknown' || item.id.includes('UNKNOWN')
  return { unknown, label: unknown ? 'UNKNOWN' : item.verification === 'loading' ? 'LOADING' : item.origin === 'fixture' ? 'FIXTURE' : item.type }
}
