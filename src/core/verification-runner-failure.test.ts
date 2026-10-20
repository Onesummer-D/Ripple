import { describe, expect, it } from 'vitest'
import { buildFailedToRunDiagnostic } from './verification-runner'

describe('failed browser verification diagnostics', () => {
  it('preserves partial viewport progress but never marks the run complete', () => {
    const diagnostic = buildFailedToRunDiagnostic({
      runId: 'run-1', candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 2,
      baseSourceDigest: 'base', patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime',
      reason: 'executor budget expired',
    }, [
      { event: 'runner-start' },
      { event: 'check-complete', checkId: 'desktop-1440', result: 'pass' },
      { event: 'phase', checkId: 'tablet-768', phase: 'scope-probe', durationMs: 42 },
    ], '2026-10-21T00:00:00.000Z')
    expect(diagnostic).toMatchObject({ completed: false, status: 'failed-to-run', reason: 'executor budget expired', recordedAt: '2026-10-21T00:00:00.000Z' })
    expect(diagnostic.completedChecks).toEqual([{ event: 'check-complete', checkId: 'desktop-1440', result: 'pass' }])
    expect(diagnostic.lastProgress).toHaveLength(3)
  })

  it('keeps only the final progress window for long-running failures', () => {
    const progress = Array.from({ length: 40 }, (_, index) => ({ event: 'phase', index }))
    const diagnostic = buildFailedToRunDiagnostic({
      runId: 'run-2', candidateId: 'candidate-2', scopeDecisionId: 'scope-2', scopeVersion: 1,
      baseSourceDigest: 'base', patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime',
      reason: 'browser exited',
    }, progress, '2026-10-21T00:00:00.000Z')
    expect(diagnostic.lastProgress).toHaveLength(24)
    expect((diagnostic.lastProgress as Array<{ index: number }>)[0].index).toBe(16)
  })
})

