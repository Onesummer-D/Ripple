// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { createViewportScope, DeadlineError, readCgroupUsage, withDeadline } from './verification-lifecycle.mjs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

type FakePage = { closed: boolean; close: () => Promise<void> }
const fakePage = (): FakePage => {
  const page: FakePage = { closed: false, close: async () => { page.closed = true } }
  return page
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function scopeFor(checkId = 'run-desktop') {
  const events: Array<Record<string, unknown>> = []
  const errors: Array<[string, string]> = []
  const scope = createViewportScope({
    checkId, viewport: { name: 'desktop', width: 1440, height: 900 },
    progress: (entry: Record<string, unknown>) => events.push(entry),
    recordError: (category: string, message: string) => errors.push([category, message]),
    openTimeoutMs: 50, closeTimeoutMs: 200,
  })
  return { scope, events, errors }
}

describe('viewport scope lifecycle', () => {
  it('closes a page whose newPage() resolves only after the viewport closed', async () => {
    const { scope, events } = scopeFor()
    const late = deferred<FakePage>()
    const page = fakePage()
    const opening = scope.openPage({ newPage: () => late.promise }, 'candidate')
    await expect(opening).rejects.toBeInstanceOf(DeadlineError)
    const closing = scope.close({ graceMs: 1_000 })
    late.resolve(page)
    const summary = await closing
    expect(page.closed).toBe(true)
    expect(summary).toMatchObject({ pagesOpened: 1, pagesClosed: 1, pagesLeaked: 0, unsettled: 0 })
    expect(events.find(event => event.event === 'first-error')).toBeUndefined()
  })

  it('reports work that never settles instead of hiding it', async () => {
    const { scope } = scopeFor()
    const never = new Promise<never>(() => {})
    const outcome = await scope.task('probe', () => scope.timed('scope-marker', () => never, { pageRef: 'page:story', side: 'candidate' }), { deadlineMs: 20 })
    expect(outcome.status).toBe('timed-out')
    const summary = await scope.close({ graceMs: 30 })
    expect(summary.unsettled).toBeGreaterThan(0)
    expect(summary.inFlightAtClose).toEqual([expect.objectContaining({ phase: 'scope-marker', pageRef: 'page:story', side: 'candidate' })])
    expect(summary.unfinishedTasks).toEqual([{ task: 'probe', state: 'timed-out' }])
    expect(scope.firstError).toMatchObject({ type: 'DeadlineError', inFlight: [expect.objectContaining({ phase: 'scope-marker' })] })
  })

  it('never rejects a task and keeps the innermost failure location as the first error', async () => {
    const { scope, events, errors } = scopeFor()
    const first = await scope.task('a', () => scope.timed('scope-values', async () => { throw new TypeError('boom at https://x.test/a?token=1') }, { pageRef: 'page:story', side: 'candidate' }), { phase: 'scope-probe', category: 'scope-probe-failed' })
    const second = await scope.task('b', async () => { throw new Error('later') })
    expect([first.status, second.status]).toEqual(['failed', 'failed'])
    expect(scope.firstError).toMatchObject({ type: 'TypeError', phase: 'scope-values', pageRef: 'page:story', side: 'candidate', message: 'boom at https://x.test/a' })
    expect(events.filter(event => event.event === 'first-error')).toHaveLength(1)
    expect(errors.map(([category]) => category)).toEqual(['scope-probe-failed', 'task-failed'])
  })

  it('tags progress emitted after close as late under its own viewport', async () => {
    const { scope, events } = scopeFor('run-tablet')
    const gate = deferred<void>()
    const outcome = scope.task('slow', () => scope.timed('scope-navigate', () => gate.promise), { deadlineMs: 10 })
    expect((await outcome).status).toBe('timed-out')
    const closing = scope.close({ graceMs: 1_000 })
    gate.resolve()
    await closing
    const late = events.filter(event => event.late)
    expect(late).toEqual([expect.objectContaining({ checkId: 'run-tablet', phase: 'scope-navigate' })])
  })

  it('applies no deadline to an unbounded wait and clears its timer', async () => {
    await expect(withDeadline(Promise.resolve(1), Infinity, 'x')).resolves.toBe(1)
    await expect(withDeadline(new Promise(() => {}), 5, 'stuck')).rejects.toThrow('stuck did not settle within 5ms')
  })

  it('reads cgroup v2 pids and memory pressure when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-cgroup-'))
    fs.writeFileSync(path.join(root, 'pids.current'), '97\n')
    fs.writeFileSync(path.join(root, 'pids.max'), '128\n')
    fs.writeFileSync(path.join(root, 'pids.events'), 'max 14\n')
    fs.writeFileSync(path.join(root, 'memory.events'), 'low 0\nhigh 0\nmax 2\noom 1\noom_kill 1\n')
    expect(readCgroupUsage(root)).toEqual({ pidsCurrent: 97, pidsMax: 128, pidsLimitHits: 14, oomKills: 1 })
    expect(readCgroupUsage(path.join(root, 'missing'))).toEqual({})
  })
})
