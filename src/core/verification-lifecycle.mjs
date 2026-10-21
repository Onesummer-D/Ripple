// Lifecycle primitives for the isolated Playwright verification runner.
//
// Run #11 failed because scope probes were fanned out with Promise.all: one
// probe rejected early, the batch rejected, and the sibling probes kept their
// own freshly opened pages alive into the next viewport. Their progress lines
// were then written under the next viewport's id (a shared mutable
// currentCheckId), the first exception was never persisted, and the run ran
// into the host's 180 s kill.
//
// A ViewportScope fixes ownership and attribution in one place:
//   - every page is opened through the scope and is closed by scope.close();
//   - tasks never reject; they report completed / failed / timed-out, and the
//     scope keeps waiting on (or reports as unsettled) work it started;
//   - progress lines carry the scope's own checkId, so work that outlives its
//     viewport is tagged `late` instead of being attributed to the next one;
//   - the first exception (type, sanitized message, phase, pageRef, side, url)
//     is emitted to progress immediately, so it survives a budget kill.
import * as fs from 'node:fs'
import { redactMessage, safeUrl } from './browser-error-accumulator.mjs'

export class DeadlineError extends Error {
  constructor(label, ms) {
    super(`${label} did not settle within ${ms}ms`)
    this.name = 'DeadlineError'
  }
}

// `expiry` lets a caller recognise its own deadline by identity; a deadline
// raised by nested work is just a failure to that caller.
export function withDeadline(promise, ms, label, expiry = new DeadlineError(label, ms)) {
  if (!Number.isFinite(ms)) return promise
  let timer
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(expiry), Math.max(0, ms)) })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// The innermost timed phase that saw an error annotates it once, so the
// failure keeps the phase/pageRef/side where it was actually thrown.
const errorContext = Symbol('ripple.verification.errorContext')

export function annotateError(error, context) {
  if (error && typeof error === 'object' && !error[errorContext]) {
    try { Object.defineProperty(error, errorContext, { value: context, enumerable: false }) } catch { /* frozen error objects keep their outer context */ }
  }
  return error
}

export function describeError(error, limit = 300) {
  const type = error instanceof Error ? (error.name || 'Error') : typeof error
  const raw = error instanceof Error ? error.message : String(error)
  return { type: String(type).slice(0, 60), message: redactMessage(String(raw).split('\n')[0], limit) }
}

const pick = (source, keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined && source[key] !== '').map(key => [key, source[key]]))
const errorFields = ['phase', 'pageRef', 'side', 'route']

export function createViewportScope({ checkId, viewport, progress, recordError, openTimeoutMs = 15_000, closeTimeoutMs = 5_000, now = Date.now }) {
  const pages = new Set()
  const pending = new Set()
  const taskStates = new Map()
  // Phases that have started but not finished; on a timeout this says where
  // the viewport was stuck.
  const activePhases = new Map()
  let phaseSequence = 0
  const counters = { pagesOpened: 0, pagesClosed: 0, closeFailures: 0 }
  let firstError
  let closed = false

  const emit = entry => progress({ checkId, ...(closed ? { late: true } : {}), ...entry })
  const track = promise => {
    pending.add(promise)
    promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  // The close itself is tracked: a close that hangs past its deadline stays
  // pending and is reported as unsettled rather than silently dropped.
  const closePage = async page => {
    pages.delete(page)
    try {
      await withDeadline(track(Promise.resolve().then(() => page.close())), closeTimeoutMs, 'page.close')
      counters.pagesClosed += 1
    } catch {
      counters.closeFailures += 1
    }
  }

  const scope = {
    checkId,
    viewport,
    get closed() { return closed },
    get firstError() { return firstError },
    inFlight: () => [...activePhases.values()].slice(0, 8).map(({ startedAt, ...item }) => ({ ...item, elapsedMs: now() - startedAt })),

    // Records an exception against this viewport. Returns the sanitized form.
    fail(error, context = {}) {
      const described = describeError(error)
      // The innermost annotation (where the error was thrown) wins over the
      // context of the task that observed it.
      const location = { ...pick(context, errorFields), ...pick(error?.[errorContext], errorFields) }
      const url = safeUrl(context.url)
      // An error that only re-reports an already recorded failure (for example
      // the viewport abort caused by a failed probe) is not counted twice.
      if (!error?.alreadyRecorded) recordError(context.category ?? 'viewport-failed', described.message, { url, viewport, phase: location.phase ?? checkId })
      if (!firstError) {
        firstError = {
          ...described, ...location, ...(url ? { url } : {}),
          ...(context.inFlight?.length ? { inFlight: context.inFlight } : {}),
          at: new Date(now()).toISOString(),
        }
        emit({ event: 'first-error', ...firstError })
      }
      return { ...described, ...location }
    },

    async timed(phase, fn, extra = {}) {
      const started = now()
      const id = ++phaseSequence
      activePhases.set(id, { phase, ...extra, startedAt: started })
      try {
        return await fn()
      } catch (error) {
        throw annotateError(error, { phase, ...extra })
      } finally {
        activePhases.delete(id)
        emit({ event: 'phase', phase, durationMs: now() - started, ...extra })
      }
    },

    // Every page used by this viewport is opened here and closed by close().
    // A newPage() that resolves after the deadline or after close() is still
    // registered and closed, so it cannot leak into the next viewport.
    async openPage(browser, label) {
      if (closed) throw new Error(`viewport ${checkId} is closed`)
      const registered = track(browser.newPage({ viewport: { width: viewport.width, height: viewport.height } }).then(page => {
        counters.pagesOpened += 1
        if (closed) track(closePage(page))
        else pages.add(page)
        return page
      }))
      return scope.timed('open-page', () => withDeadline(registered, openTimeoutMs, `open ${label} page`), { side: label })
    },

    // Closes one page this viewport opened, now (probe pages are released as
    // soon as their probe ends so at most one candidate/baseline pair is open).
    async release(page) {
      if (page && pages.has(page)) await closePage(page)
    },

    // Runs fn as a tracked task. Never rejects: the caller decides what a
    // failed or timed-out task means for the verdict.
    async task(name, fn, { deadlineMs = Infinity, ...context } = {}) {
      const started = now()
      taskStates.set(name, 'running')
      emit({ event: 'task', task: name, state: 'started' })
      const run = track(Promise.resolve().then(fn))
      const ownDeadline = new DeadlineError(name, deadlineMs)
      let outcome
      try {
        outcome = { status: 'completed', value: await withDeadline(run, deadlineMs, name, ownDeadline) }
      } catch (error) {
        // Only this task's own deadline means "timed out"; a nested deadline
        // (for example a slow newPage) is an ordinary failure of the task.
        const status = error === ownDeadline ? 'timed-out' : 'failed'
        const category = status === 'timed-out' ? 'task-timeout' : (context.category ?? 'task-failed')
        outcome = { status, error: scope.fail(error, { ...context, category, ...(status === 'timed-out' ? { inFlight: scope.inFlight() } : {}) }) }
      }
      taskStates.set(name, outcome.status)
      emit({ event: 'task', task: name, state: outcome.status, durationMs: now() - started })
      return outcome
    },

    // Closes every page this viewport opened, then waits (bounded) for work it
    // started to settle; closing a page makes in-flight calls on it reject.
    async close({ graceMs = closeTimeoutMs, extra = {} } = {}) {
      const inFlightAtClose = scope.inFlight()
      // Mark closed first so a newPage() resolving during close is closed on
      // arrival instead of being added to a set that is already drained.
      closed = true
      const openAtClose = pages.size
      await Promise.all([...pages].map(closePage))
      // Settling work can start more work (a late page is closed on arrival),
      // so drain until nothing is pending or the grace period ends.
      let timer
      const graceExpired = new Promise(resolve => { timer = setTimeout(() => resolve(true), graceMs) })
      while (pending.size && !await Promise.race([Promise.allSettled([...pending]).then(() => false), graceExpired])) { /* drain */ }
      clearTimeout(timer)
      const tasks = { started: taskStates.size, completed: 0, failed: 0, 'timed-out': 0, running: 0 }
      for (const state of taskStates.values()) tasks[state] += 1
      const summary = {
        ...counters,
        openAtClose,
        pagesLeaked: pages.size,
        unsettled: pending.size,
        ...(inFlightAtClose.length ? { inFlightAtClose } : {}),
        tasks,
        unfinishedTasks: [...taskStates].filter(([, state]) => state !== 'completed').slice(0, 16).map(([task, state]) => ({ task, state })),
      }
      progress({ checkId, event: 'viewport-lifecycle', ...summary, ...extra })
      return summary
    },
  }
  return scope
}

// The verification container runs with --pids-limit and --memory. Chromium
// threads count against the pids limit, so record how close a viewport came
// to either limit. Returns only the fields the kernel exposes.
export function readCgroupUsage(root = '/sys/fs/cgroup') {
  const read = file => { try { return fs.readFileSync(`${root}/${file}`, 'utf8').trim() } catch { return undefined } }
  const number = value => (value === undefined || value === 'max' ? value : Number(value))
  const eventCount = (text, key) => {
    const line = text?.split('\n').find(item => item.startsWith(`${key} `))
    return line ? Number(line.split(' ')[1]) : undefined
  }
  const usage = {
    pidsCurrent: number(read('pids.current') ?? read('pids/pids.current')),
    pidsMax: number(read('pids.max') ?? read('pids/pids.max')),
    pidsLimitHits: eventCount(read('pids.events') ?? read('pids/pids.events'), 'max'),
    memoryCurrent: number(read('memory.current') ?? read('memory/memory.usage_in_bytes')),
    oomKills: eventCount(read('memory.events'), 'oom_kill'),
  }
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined && !Number.isNaN(value)))
}
