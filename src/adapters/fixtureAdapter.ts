import type { CaseFixture, CaseId } from '../domain/contracts'
import { fixtures } from '../cases/fixtures'
import { adaptCasePackage, type AdapterIssue } from './realEvidenceAdapter'

export interface CaseDataAdapter {
  getCase(caseId: CaseId): CaseFixture
  getSource(caseId: CaseId): 'fixture' | 'real'
  listCases(): CaseFixture[]
  getDiagnostics(): AdapterIssue[]
}

export const createCaseAdapter = (realPackages: Partial<Record<CaseId, unknown>> = {}): CaseDataAdapter => {
  const adapted = Object.fromEntries(
    (Object.keys(fixtures) as CaseId[]).map((caseId) => {
      const result = realPackages[caseId] === undefined ? { fixture: fixtures[caseId], issues: [], source: 'fixture' as const } : adaptCasePackage(fixtures[caseId], realPackages[caseId])
      return [caseId, result]
    }),
  ) as Record<CaseId, ReturnType<typeof adaptCasePackage>>
  return {
    getCase: (caseId) => adapted[caseId].fixture,
    getSource: (caseId) => adapted[caseId].source,
    listCases: () => Object.values(adapted).map((item) => item.fixture),
    getDiagnostics: () => Object.values(adapted).flatMap((item) => item.issues),
  }
}

export const fixtureAdapter: CaseDataAdapter = createCaseAdapter()
