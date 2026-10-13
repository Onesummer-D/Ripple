import { describe, expect, it } from 'vitest'
import { fixtures } from '../cases/fixtures'
import { createCaseAdapter } from './fixtureAdapter'
import { adaptCasePackage, parseRealCasePackage } from './realEvidenceAdapter'

describe('real evidence adapter', () => {
  it('preserves unknown and loading verification even with complete metadata', () => {
    for (const verification of ['unknown', 'loading']) {
      const result = parseRealCasePackage({ caseId: 'qingye', evidence: [{ id: 'E-REAL', type: 'STRUCTURE', route: '/', viewport: '1440x900', summary: 'pending proof', sourcePath: 'proof.json', verification }] })
      expect(result.package?.evidence?.[0]?.verification).toBe(verification)
    }
  })
  it('falls back to fixture data without changing the UI contract', () => {
    const adapter = createCaseAdapter()
    expect(adapter.getCase('qingye').graph.caseId).toBe('qingye')
    expect(adapter.getDiagnostics()).toEqual([])
  })

  it('maps a real package and preserves unknown evidence explicitly', () => {
    const result = adaptCasePackage(fixtures['third-party'], {
      caseId: 'third-party',
      graph: fixtures['third-party'].graph,
      evidence: [{ id: 'E-REAL-THIRD-001', type: 'STRUCTURE', route: '/showcase', viewport: '375x812', summary: 'Token consumer path', sourcePath: 'b/evidence/token.json' }, { id: 'E-BROKEN-THIRD-001' }],
      provenance: { repositoryUrl: 'https://example.com/project', commit: 'abc123', license: 'MIT', consumerPaths: ['/showcase', '/docs'] },
    })
    expect(result.source).toBe('real')
    expect(result.fixture.evidence[0]?.origin).toBe('real')
    expect(result.fixture.evidence[1]?.verification).toBe('unknown')
    expect(result.fixture.provenance?.repositoryUrl).toContain('example.com')
    expect(result.issues.some((issue) => issue.path === 'evidence[1]')).toBe(true)
  })

  it('rejects unsupported cases and malformed graph records before merge', () => {
    expect(parseRealCasePackage({ caseId: 'unknown' }).package).toBeUndefined()
    const result = adaptCasePackage(fixtures.qingye, { caseId: 'qingye', graph: { id: 'g', nodes: [{ id: 'n' }], edges: [] } })
    expect(result.source).toBe('real')
    expect(result.issues.some((issue) => issue.path === 'graph.nodes[0]')).toBe(true)
  })

  it('does not silently accept malformed arrays or unsupported mobile evidence', () => {
    const result = adaptCasePackage(fixtures.qingye, {
      caseId: 'qingye',
      graph: { id: 'g', nodes: 'broken', edges: [] },
      evidence: [{ id: 'E-MOBILE', type: 'RUNTIME', route: '/autumn', viewport: '375x812', summary: 'mobile risk', sourcePath: 'risk.json' }],
    })
    expect(result.issues.some((issue) => issue.path === 'graph.nodes')).toBe(true)
    expect(result.fixture.evidence[0]?.verification).toBe('unknown')
    expect(result.issues.some((issue) => issue.path === 'evidence[0]')).toBe(true)
  })

  it('generates stable unknown IDs and reports duplicate graph/evidence IDs', () => {
    const result = adaptCasePackage(fixtures.qingye, {
      caseId: 'qingye',
      graph: { id: 'real-graph', nodes: fixtures.qingye.graph.nodes, edges: fixtures.qingye.graph.edges },
      evidence: [{ type: 'STRUCTURE', route: '/', viewport: 'fixture', summary: 'missing id', sourcePath: 'evidence.json' }, { id: 'E-DUP', type: 'STRUCTURE', route: '/', viewport: 'fixture', summary: 'duplicate', sourcePath: 'a.json' }, { id: 'E-DUP', type: 'STRUCTURE', route: '/', viewport: 'fixture', summary: 'duplicate', sourcePath: 'b.json' }],
    })
    expect(result.fixture.evidence[0]?.id).toBe('E-UNKNOWN-qingye-001')
    expect(result.issues.some((issue) => issue.message === 'evidence ids must be unique')).toBe(true)
  })
})
