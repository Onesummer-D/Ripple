import type { EditOperation, ScopeDecision, SourceGraph, SourceNode } from './model'

export type StructuredEditOperation = Extract<EditOperation, { action: string }>

export interface CandidateSourceEdit {
  path: string
  start: number
  end: number
  before: string
  after: string
}

export interface CandidateFileWrite {
  path: string
  bytes: Uint8Array
}

export interface CandidateOperationPlan {
  sourceEdits?: readonly CandidateSourceEdit[]
  fileWrites?: readonly CandidateFileWrite[]
}

export interface CandidateOperationContext<O extends StructuredEditOperation = StructuredEditOperation> {
  operation: O
  target: SourceNode
  graph: SourceGraph
  scope: ScopeDecision
  readStagedAsset(sha256: string): Uint8Array
}

/** An executor plans changes; the Candidate core validates and performs every write. */
export interface CandidateOperationExecutor<O extends StructuredEditOperation = StructuredEditOperation> {
  readonly kind: O['kind']
  readonly action: O['action']
  validate(operation: unknown): operation is O
  plan(input: CandidateOperationContext<O>): CandidateOperationPlan
}

export type CandidateOperationRegistry = readonly CandidateOperationExecutor[]

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function assertCandidateOperationRegistry(executors: CandidateOperationRegistry): void {
  const seen = new Set<string>()
  for (const executor of executors) {
    if (!executor || typeof executor.kind !== 'string' || typeof executor.action !== 'string' ||
        typeof executor.validate !== 'function' || typeof executor.plan !== 'function') {
      throw new Error('Candidate operation executor is incomplete')
    }
    const key = `${executor.kind}:${executor.action}`
    if (seen.has(key)) throw new Error(`Duplicate Candidate operation executor: ${key}`)
    seen.add(key)
  }
}

export function hasStructuredOperationFields(operation: unknown): boolean {
  return record(operation) && (hasOwn(operation, 'action') || hasOwn(operation, 'payload'))
}

export function findCandidateOperationExecutor(operation: unknown, executors: CandidateOperationRegistry): CandidateOperationExecutor | undefined {
  if (!record(operation) || !hasOwn(operation, 'action') || !hasOwn(operation, 'payload') || typeof operation.kind !== 'string' || typeof operation.action !== 'string') return undefined
  return executors.find(executor => executor.kind === operation.kind && executor.action === operation.action)
}
