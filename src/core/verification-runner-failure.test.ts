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

  it('keeps first errors, lifecycle summaries and still-running tasks even after they scroll out of the tail', () => {
    const progress: unknown[] = [
      { event: 'runner-start' },
      { event: 'first-error', checkId: 'run-desktop', phase: 'open-page', side: 'baseline', type: 'Error', message: 'Target.createTarget failed' },
      { event: 'task', checkId: 'run-desktop', task: 'viewport', state: 'started' },
      { event: 'task', checkId: 'run-desktop', task: 'viewport', state: 'failed' },
      { event: 'viewport-lifecycle', checkId: 'run-desktop', pagesOpened: 1, pagesClosed: 1, pagesLeaked: 0 },
      { event: 'phase', checkId: 'run-desktop', phase: 'open-page', late: true },
      { event: 'task', checkId: 'run-tablet', task: 'scope-probe:page:products:candidate', state: 'started' },
      ...Array.from({ length: 40 }, (_, index) => ({ event: 'phase', checkId: 'run-tablet', phase: 'scope-values', index })),
    ]
    const diagnostic = buildFailedToRunDiagnostic({
      runId: 'run', candidateId: 'candidate', scopeDecisionId: 'scope', scopeVersion: 1,
      baseSourceDigest: 'base', patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime',
      reason: 'executor budget expired',
    }, progress, '2026-10-21T00:00:00.000Z', { completed: true, status: 'pass', viewports: [] })
    expect(diagnostic).toMatchObject({ completed: false, status: 'failed-to-run', lateEvents: 1 })
    expect(diagnostic.firstErrors).toEqual([expect.objectContaining({ phase: 'open-page', side: 'baseline' })])
    expect(diagnostic.viewportLifecycle).toEqual([expect.objectContaining({ checkId: 'run-desktop', pagesLeaked: 0 })])
    expect(diagnostic.unfinishedTasks).toEqual([expect.objectContaining({ checkId: 'run-tablet', task: 'scope-probe:page:products:candidate' })])
    // A runner diagnostic is carried as data; it cannot mark the run complete.
    expect(diagnostic.runnerDiagnostic).toMatchObject({ completed: false, status: 'pass' })
    expect(diagnostic.lastProgress).toHaveLength(24)
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

