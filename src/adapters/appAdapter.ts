import type { CaseId } from '../domain/contracts'
import { createCaseAdapter } from './fixtureAdapter'

/**
 * B can populate this map with parsed JSON packages without changing App or
 * the domain state machine. Empty by default so the demo remains deterministic.
 */
export const realCasePackages: Partial<Record<CaseId, unknown>> = {}
export const appAdapter = createCaseAdapter(realCasePackages)
