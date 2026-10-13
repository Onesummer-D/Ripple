import {
  editKinds,
  evidenceTypes,
  graphEdgeTypes,
  graphNodeKinds,
  type CaseFixture,
  type CaseId,
  type EditableSlot,
  type Evidence,
  type GraphEdgeType,
  type GraphNodeKind,
  type RippleGraph,
  type RippleGraphEdge,
  type RippleGraphNode,
  type RepositoryProvenance,
} from '../domain/contracts'
import { validateFixture } from '../verification/fixtureValidator'

export interface RealCasePackage {
  caseId: CaseId
  graph?: RippleGraph
  slots?: EditableSlot[]
  evidence?: Evidence[]
  provenance?: RepositoryProvenance
}

export interface AdapterIssue {
  path: string
  message: string
}

export interface AdaptedCase {
  fixture: CaseFixture
  issues: AdapterIssue[]
  source: 'fixture' | 'real'
}

const caseIds: CaseId[] = ['qingye', 'qiguang', 'third-party']
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const stringValue = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isCaseId = (value: unknown): value is CaseId => typeof value === 'string' && caseIds.includes(value as CaseId)
const readRecordArray = (value: unknown, path: string, issues: AdapterIssue[]): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'expected an array of objects' })
    return []
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, message: 'expected an object' })
      return []
    }
    return [item]
  })
}

const parseNode = (raw: Record<string, unknown>, caseId: CaseId, index: number, issues: AdapterIssue[]): RippleGraphNode | undefined => {
  if (!stringValue(raw.id) || !stringValue(raw.label) || !graphNodeKinds.includes(raw.kind as GraphNodeKind)) {
    issues.push({ path: `graph.nodes[${index}]`, message: 'node requires id, label, and a valid kind' })
    return undefined
  }
  return {
    id: raw.id,
    caseId,
    kind: raw.kind as GraphNodeKind,
    label: raw.label,
    ...(stringValue(raw.route) ? { route: raw.route } : {}),
    ...(stringValue(raw.sourceId) ? { sourceId: raw.sourceId } : {}),
  }
}

const parseEdge = (raw: Record<string, unknown>, caseId: CaseId, index: number, issues: AdapterIssue[]): RippleGraphEdge | undefined => {
  if (!stringValue(raw.id) || !stringValue(raw.from) || !stringValue(raw.to) || !graphEdgeTypes.includes(raw.type as GraphEdgeType)) {
    issues.push({ path: `graph.edges[${index}]`, message: 'edge requires id, from, to, and a valid type' })
    return undefined
  }
  return { id: raw.id, caseId, type: raw.type as GraphEdgeType, from: raw.from, to: raw.to }
}

const parseGraph = (raw: unknown, caseId: CaseId, issues: AdapterIssue[]): RippleGraph | undefined => {
  if (!isRecord(raw) || !stringValue(raw.id)) {
    issues.push({ path: 'graph', message: 'real package graph is missing a stable id' })
    return undefined
  }
  const nodes = readRecordArray(raw.nodes, 'graph.nodes', issues).flatMap((node, index) => {
    const parsed = parseNode(node, caseId, index, issues)
    return parsed ? [parsed] : []
  })
  const edges = readRecordArray(raw.edges, 'graph.edges', issues).flatMap((edge, index) => {
    const parsed = parseEdge(edge, caseId, index, issues)
    return parsed ? [parsed] : []
  })
  return { id: raw.id, caseId, nodes, edges }
}

const parseSlot = (raw: Record<string, unknown>, index: number, issues: AdapterIssue[]): EditableSlot | undefined => {
  const required = ['id', 'instanceId', 'sourceId', 'label', 'value', 'route']
  if (required.some((key) => !stringValue(raw[key])) || !editKinds.includes(raw.editKind as EditableSlot['editKind']) || typeof raw.shared !== 'boolean') {
    issues.push({ path: `slots[${index}]`, message: 'slot identity, editKind, route, and shared flag are required' })
    return undefined
  }
  return {
    id: raw.id as string,
    instanceId: raw.instanceId as string,
    sourceId: raw.sourceId as string,
    label: raw.label as string,
    value: raw.value as string,
    editKind: raw.editKind as EditableSlot['editKind'],
    route: raw.route as string,
    shared: raw.shared,
  }
}

const parseEvidence = (raw: Record<string, unknown>, caseId: CaseId, index: number, issues: AdapterIssue[]): Evidence => {
  const id = stringValue(raw.id) ? raw.id : `E-UNKNOWN-${caseId}-${String(index + 1).padStart(3, '0')}`
  const screenshotRequired = raw.type === 'SCREENSHOT' || (raw.type === 'RUNTIME' && typeof raw.viewport === 'string' && raw.viewport.includes('375'))
  const valid = stringValue(raw.route) && stringValue(raw.viewport) && stringValue(raw.summary) && stringValue(raw.sourcePath) && evidenceTypes.includes(raw.type as Evidence['type']) && (!screenshotRequired || stringValue(raw.screenshotPath))
  if (!valid) issues.push({ path: `evidence[${index}]`, message: 'incomplete Evidence is preserved as explicit unknown' })
  return {
    id,
    caseId,
    type: valid ? raw.type as Evidence['type'] : 'RUNTIME',
    route: valid ? raw.route as string : 'unknown',
    viewport: valid ? raw.viewport as string : 'unknown',
    summary: valid ? raw.summary as string : 'Evidence is not available yet',
    sourcePath: valid ? raw.sourcePath as string : `unknown://${caseId}/evidence/${id}`,
    ...(stringValue(raw.screenshotPath) ? { screenshotPath: raw.screenshotPath } : {}),
    verification: valid ? (raw.verification === 'unknown' || raw.verification === 'loading' ? raw.verification : 'verified') : 'unknown',
    origin: 'real',
  }
}

const parseProvenance = (raw: unknown, issues: AdapterIssue[]): RepositoryProvenance | undefined => {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || !stringValue(raw.repositoryUrl)) {
    issues.push({ path: 'provenance.repositoryUrl', message: 'repositoryUrl is required when provenance is supplied' })
    return undefined
  }
  if (!Array.isArray(raw.consumerPaths) || raw.consumerPaths.some((path) => !stringValue(path))) {
    issues.push({ path: 'provenance.consumerPaths', message: 'consumerPaths must be an array of strings' })
  }
  return {
    repositoryUrl: raw.repositoryUrl,
    ...(stringValue(raw.commit) ? { commit: raw.commit } : {}),
    ...(stringValue(raw.tag) ? { tag: raw.tag } : {}),
    ...(stringValue(raw.license) ? { license: raw.license } : {}),
    ...(stringValue(raw.noticePath) ? { noticePath: raw.noticePath } : {}),
    ...(stringValue(raw.tokenSource) ? { tokenSource: raw.tokenSource } : {}),
    consumerPaths: Array.isArray(raw.consumerPaths) ? raw.consumerPaths.filter(stringValue) : [],
  }
}

export const parseRealCasePackage = (raw: unknown): { package?: RealCasePackage; issues: AdapterIssue[] } => {
  const issues: AdapterIssue[] = []
  if (!isRecord(raw) || !isCaseId(raw.caseId)) return { issues: [{ path: 'caseId', message: 'a supported caseId is required' }] }
  const caseId = raw.caseId
  const graph = raw.graph !== undefined ? parseGraph(raw.graph, caseId, issues) : undefined
  const slots = raw.slots !== undefined ? readRecordArray(raw.slots, 'slots', issues).flatMap((slot, index) => {
    const parsed = parseSlot(slot, index, issues)
    return parsed ? [parsed] : []
  }) : undefined
  const evidence = raw.evidence !== undefined ? readRecordArray(raw.evidence, 'evidence', issues).map((item, index) => parseEvidence(item, caseId, index, issues)) : undefined
  const provenance = parseProvenance(raw.provenance, issues)
  return { package: { caseId, graph, slots, evidence, provenance }, issues }
}

export const adaptCasePackage = (base: CaseFixture, raw: unknown): AdaptedCase => {
  const parsed = parseRealCasePackage(raw)
  if (!parsed.package || parsed.package.caseId !== base.id) return { fixture: base, issues: parsed.issues, source: 'fixture' }
  const incoming = parsed.package
  const evidence = incoming.evidence?.length ? incoming.evidence : base.evidence.map((item) => ({ ...item, verification: 'unknown' as const, origin: 'real' as const }))
  const fixture: CaseFixture = {
    ...base,
    ...(incoming.graph ? { graph: incoming.graph } : {}),
    ...(incoming.slots ? { slots: incoming.slots } : {}),
    evidence,
    ...(incoming.provenance ? { provenance: incoming.provenance } : {}),
  }
  const contractIssues = validateFixture(fixture).map((issue) => ({ path: issue.fixtureId, message: issue.message }))
  return { fixture, issues: parsed.issues.concat(contractIssues), source: 'real' }
}
