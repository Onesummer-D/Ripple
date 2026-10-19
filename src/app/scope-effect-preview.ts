import type { EditOperation } from '../core/model'
import { evaluateOperationPageScope, pageTextValues, type ScopePageDecision } from '../core/scope'

export type PageScopeChoice = 'include' | 'exclude' | 'protect' | ''
export type ScopePreviewOutcome = 'change' | 'preserve' | 'conflict' | 'undecided' | 'unknown'

export interface ScopePreviewRoute { id: string; label: string }
export interface ScopePreviewTarget {
  id: string
  kind: 'data' | 'media' | 'token'
  label: string
  value?: string
  pageOverrides?: Record<string, string>
  impact: { pageRefs: string[]; unresolved: string[]; certainty: 'source-proven' | 'partial' | 'unknown' }
}
export interface ScopeEffectRow {
  operationId: string
  operationLabel: string
  kind: EditOperation['kind']
  pageRef: string
  pageLabel: string
  outcome: ScopePreviewOutcome
  currentValue?: string
  plannedValue?: string
  reason?: string
}

interface ScopeEffectPreviewInput {
  routes: ScopePreviewRoute[]
  targets: ScopePreviewTarget[]
  operations: EditOperation[]
  choices: Record<string, PageScopeChoice>
  scope: ScopePageDecision
}

export function buildScopeEffectPreview({ routes, targets, operations, choices, scope }: ScopeEffectPreviewInput): ScopeEffectRow[] {
  const targetById = new Map(targets.map(target => [target.id, target]))

  return operations.flatMap(operation => {
    const target = targetById.get(operation.targetRef)
    return routes.map(route => {
      const base = {
        operationId: operation.id,
        operationLabel: target?.label ?? operation.targetRef,
        kind: operation.kind,
        pageRef: route.id,
        pageLabel: route.label,
      }
      if (!target || operation.kind !== 'TEXT' || target.kind !== 'data' || target.impact.certainty !== 'source-proven' || target.impact.unresolved.length) {
        return { ...base, outcome: 'unknown' as const, reason: '当前证据不足以计算该操作在此页面的实际文本值。' }
      }

      if (!target.impact.pageRefs.includes(route.id)) {
        return { ...base, outcome: 'unknown' as const, reason: '当前源码图没有证明该页面消费此目标，也没有足够证据确认其保持不变。' }
      }
      const { baselineText, requestedText } = pageTextValues(target, operation, route.id)

      if (!choices[route.id]) {
        return { ...base, outcome: 'undecided' as const, currentValue: baselineText, reason: '请选择此受影响页面的范围。' }
      }

      const effect = evaluateOperationPageScope(scope, [route.id])[0]!
      if (effect.effect === 'change') return { ...base, outcome: 'change' as const, currentValue: baselineText, plannedValue: requestedText }
      if (effect.effect === 'preserve') return { ...base, outcome: 'preserve' as const, currentValue: baselineText, plannedValue: baselineText }
      return { ...base, outcome: 'conflict' as const, currentValue: baselineText, reason: effect.reason }
    })
  })
}

