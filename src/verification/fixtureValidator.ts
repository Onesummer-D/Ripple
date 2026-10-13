import { editKinds, evidenceOrigins, evidenceTypes, evidenceVerificationStates, graphEdgeTypes, graphNodeKinds, scopeModes, type CaseFixture } from '../domain/contracts'

export interface ValidationIssue {
  fixtureId: string
  message: string
}

export const validateFixture = (fixture: CaseFixture): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  if (fixture.graph.caseId !== fixture.id) issues.push({ fixtureId: fixture.id, message: 'graph.caseId mismatch' })
  fixture.slots.forEach((slot) => {
    if (!slot.id || !slot.instanceId || !slot.sourceId) issues.push({ fixtureId: fixture.id, message: 'slot identity missing' })
    if (!editKinds.includes(slot.editKind)) issues.push({ fixtureId: fixture.id, message: 'slot editKind invalid' })
  })
  fixture.graph.nodes.forEach((node) => {
    if (!graphNodeKinds.includes(node.kind)) issues.push({ fixtureId: fixture.id, message: 'node kind invalid' })
  })
  const nodeIds = fixture.graph.nodes.map((node) => node.id)
  if (new Set(nodeIds).size !== nodeIds.length) issues.push({ fixtureId: fixture.id, message: 'graph node ids must be unique' })
  if (fixture.graph.nodes.some((node) => node.caseId !== fixture.id)) issues.push({ fixtureId: fixture.id, message: 'graph node caseId mismatch' })
  const edgeIds = fixture.graph.edges.map((edge) => edge.id)
  if (new Set(edgeIds).size !== edgeIds.length) issues.push({ fixtureId: fixture.id, message: 'graph edge ids must be unique' })
  fixture.graph.edges.forEach((edge) => {
    if (!graphEdgeTypes.includes(edge.type)) issues.push({ fixtureId: fixture.id, message: 'edge type invalid' })
    if (!nodeIds.includes(edge.from) || !nodeIds.includes(edge.to)) issues.push({ fixtureId: fixture.id, message: 'edge endpoint missing' })
    if (edge.caseId !== fixture.id) issues.push({ fixtureId: fixture.id, message: 'graph edge caseId mismatch' })
  })
  const slotIds = fixture.slots.map((slot) => slot.id)
  if (new Set(slotIds).size !== slotIds.length) issues.push({ fixtureId: fixture.id, message: 'slot ids must be unique' })
  fixture.slots.forEach((slot) => {
    if (!nodeIds.includes(slot.id) || !nodeIds.includes(slot.instanceId) || !nodeIds.includes(slot.sourceId)) issues.push({ fixtureId: fixture.id, message: `slot ${slot.id} is not represented in graph` })
  })
  const evidenceIds = fixture.evidence.map((item) => item.id)
  if (new Set(evidenceIds).size !== evidenceIds.length) issues.push({ fixtureId: fixture.id, message: 'evidence ids must be unique' })
  fixture.evidence.forEach((item) => {
    if (!evidenceTypes.includes(item.type)) issues.push({ fixtureId: fixture.id, message: 'evidence type invalid' })
    if (!item.id || !item.sourcePath) issues.push({ fixtureId: fixture.id, message: 'evidence identity missing' })
    if (item.verification && !evidenceVerificationStates.includes(item.verification)) issues.push({ fixtureId: fixture.id, message: 'evidence verification invalid' })
    if (item.origin && !evidenceOrigins.includes(item.origin)) issues.push({ fixtureId: fixture.id, message: 'evidence origin invalid' })
    if (item.type === 'SCREENSHOT' && !item.screenshotPath) issues.push({ fixtureId: fixture.id, message: 'screenshot evidence requires screenshotPath' })
    if (item.type === 'RUNTIME' && item.viewport.includes('375') && !item.screenshotPath) issues.push({ fixtureId: fixture.id, message: '375px runtime evidence requires screenshotPath' })
  })
  return issues
}

export const validateScopeMode = (value: string): boolean => scopeModes.includes(value as (typeof scopeModes)[number])
