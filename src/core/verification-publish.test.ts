// @vitest-environment node
// Publish-gate tests for the verification container entry.
// P0: the published execution.json must serialize summary.manifest (top-level
// v4 ExecutionManifest), never the executor wrapper; arbitrary objects are
// refused.
// P1: a pre-existing outputPath is never deleted and never overwritten —
// cleanup only ever removes this run's own temp file.
// P1: exactly one final browser close — the gate closes before publishing and
// marks the attempt; the entry's state machine never closes a second time.
// All tests run locally against a fake browser and a temp directory.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { runVerificationAndPublish } from './verification-publish.mjs'

const tempOutput = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-publish-'))
  return { directory, outputPath: path.join(directory, 'execution.json') }
}

// The shape executeVerification() actually returns: the v4 manifest inside a
// wrapper the host never sees on disk.
const runSummary = (runId = 'run-1') => ({
  manifest: {
    schemaVersion: 4, executor: 'playwright', completed: true, runId,
    candidateId: 'candidate-1', checks: [{ id: `${runId}-desktop` }],
  },
  viewportDiagnostics: [{ checkId: `${runId}-desktop` }],
  status: 'complete',
})

const countingBrowser = (counter: { calls: number }, behavior?: () => Promise<void>) => ({
  close: async () => { counter.calls += 1; await behavior?.() },
})

describe('verification publish gate', () => {
  it('serializes summary.manifest as the top-level execution record and returns the wrapper summary', async () => {
    const { outputPath } = tempOutput()
    const order: string[] = []
    const summary = await runVerificationAndPublish({
      browser: { close: async () => { order.push('close') } },
      outputPath,
      runVerification: async () => { order.push('verify'); return runSummary() },
    })
    expect(order).toEqual(['verify', 'close'])
    expect(summary).toEqual(runSummary())
    const published = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    // Readable as a top-level ExecutionManifest: the wrapper fields the host
    // never validates must not leak into the file.
    expect(published).toMatchObject({ schemaVersion: 4, executor: 'playwright', completed: true, runId: 'run-1' })
    expect(published.viewportDiagnostics).toBeUndefined()
    expect(published.status).toBeUndefined()
    expect(published.checks).toEqual([{ id: 'run-1-desktop' }])
    // No temp files are left next to the published record.
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual(['execution.json'])
  })

  it('refuses to publish when verification returns no valid v4 manifest, before any close', async () => {
    const { outputPath } = tempOutput()
    const counter = { calls: 0 }
    await expect(runVerificationAndPublish({
      browser: countingBrowser(counter),
      outputPath,
      runVerification: async () => ({ completed: true, runId: 'run-1' }),
    })).rejects.toThrow('did not return a valid v4 execution manifest')
    expect(fs.existsSync(outputPath)).toBe(false)
    expect(counter.calls).toBe(0)
  })

  it('refuses to publish a manifest whose completed flag is false', async () => {
    const { outputPath } = tempOutput()
    const summary = runSummary()
    summary.manifest.completed = false
    await expect(runVerificationAndPublish({
      browser: { close: async () => {} },
      outputPath,
      runVerification: async () => summary,
    })).rejects.toThrow('did not return a valid v4 execution manifest')
    expect(fs.existsSync(outputPath)).toBe(false)
  })

  it('throws without leaving any record when the final browser.close rejects', async () => {
    const { outputPath } = tempOutput()
    const events: Array<Record<string, unknown>> = []
    const error = await runVerificationAndPublish({
      browser: { close: async () => { throw new Error('browser.close wedged') } },
      outputPath,
      runVerification: async () => runSummary(),
      progress: (entry: Record<string, unknown>) => events.push(entry),
    }).then(() => undefined, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('browser.close wedged')
    // The final-close state machine flag: the caller must not close again.
    expect((error as { browserCloseAttempted?: boolean }).browserCloseAttempted).toBe(true)
    // The completed record never reached the disk: there is nothing a host
    // could attest even if it ignored the exit code entirely.
    expect(fs.existsSync(outputPath)).toBe(false)
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual([])
    expect(events).toEqual([expect.objectContaining({ event: 'browser-close-failed', error: expect.objectContaining({ message: expect.stringContaining('wedged') }) })])
  })

  it('throws without leaving any record when the final browser.close hangs past its deadline', async () => {
    const { outputPath } = tempOutput()
    await expect(runVerificationAndPublish({
      browser: { close: () => new Promise(() => {}) },
      outputPath,
      runVerification: async () => runSummary(),
      closeTimeoutMs: 50,
    })).rejects.toThrow('browser.close did not settle within 50ms')
    expect(fs.existsSync(outputPath)).toBe(false)
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual([])
  })

  it('closes the browser exactly once on the success path', async () => {
    const { outputPath } = tempOutput()
    const counter = { calls: 0 }
    await runVerificationAndPublish({
      browser: countingBrowser(counter),
      outputPath,
      runVerification: async () => runSummary(),
    })
    expect(counter.calls).toBe(1)
  })

  it('propagates the verification error untouched, never closes, and never touches a pre-existing record', async () => {
    const { outputPath } = tempOutput()
    fs.writeFileSync(outputPath, JSON.stringify({ schemaVersion: 4, executor: 'playwright', completed: true, runId: 'earlier-run', checks: [] }))
    const original = new Error('Runner budget expired during run-desktop')
    original.name = 'RunnerAborted'
    const counter = { calls: 0 }
    const error = await runVerificationAndPublish({
      browser: countingBrowser(counter, async () => { throw new Error('close failed too') }),
      outputPath,
      runVerification: async () => { throw original },
    }).then(() => undefined, (caught: unknown) => caught)
    // The first error wins: the gate does not run close on the failure path
    // and rethrows the exact original error.
    expect(error).toBe(original)
    expect(counter.calls).toBe(0)
    // The pre-existing record of an earlier attempt survives untouched.
    expect(fs.existsSync(outputPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).runId).toBe('earlier-run')
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual(['execution.json'])
  })

  it('refuses to overwrite an existing record and leaves it byte-identical', async () => {
    const { outputPath } = tempOutput()
    fs.writeFileSync(outputPath, '{}')
    const counter = { calls: 0 }
    await expect(runVerificationAndPublish({
      browser: countingBrowser(counter),
      outputPath,
      runVerification: async () => runSummary(),
    })).rejects.toThrow()
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('{}')
    expect(counter.calls).toBe(1)
    // No temp file of this run is left behind after the refused publish.
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual(['execution.json'])
  })

  it('never closes a second time when the browser closed but publishing failed', async () => {
    // The browser's final close is tracked separately from publishing: the
    // pre-existing outputPath makes the publish link fail with EEXIST after
    // a successful close — the caller must see the close as done and never
    // close again.
    const { outputPath } = tempOutput()
    fs.writeFileSync(outputPath, '{}')
    const counter = { calls: 0 }
    const closeState = { closed: false, attempted: false }
    await expect(runVerificationAndPublish({
      browser: countingBrowser(counter),
      outputPath,
      browserCloseState: closeState,
      runVerification: async () => runSummary(),
    })).rejects.toThrow()
    expect(counter.calls).toBe(1)
    expect(closeState).toEqual({ closed: true, attempted: true })
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('{}')
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual(['execution.json'])
  })

  it('publishes a full-contract v4 manifest with every host-read field intact', async () => {
    // Positive contract test: the gate must accept and byte-faithfully
    // publish a manifest carrying every field the host binds against, so a
    // record the gate accepts is a record the host can read.
    const { outputPath } = tempOutput()
    const full = {
      schemaVersion: 4, executor: 'playwright', completed: true,
      runId: 'run-full', candidateId: 'candidate-1', scopeDecisionId: 'scope-1', scopeVersion: 1,
      baseSourceDigest: 'base', patchHash: 'patch', candidateTreeDigest: 'tree', runtimeFingerprint: 'runtime',
      verificationContractHash: 'contract',
      viewports: [{ name: 'desktop', width: 1440, height: 900 }],
      checks: [{ id: 'run-full-desktop', route: '/', viewport: { width: 1440, height: 900 }, state: 'rendered', passed: true }],
      baselineComparisons: [{ route: '/', viewport: { width: 1440, height: 900 }, maskedOperationIds: [], matched: true }],
      scopeObservations: [{ pageRef: 'page:home', route: '/', baselineRouteIdentity: 'verified', candidateRouteIdentity: 'verified' }],
      interactionObservations: [{ interactionIndex: 0, baselinePassed: true, candidatePassed: true }],
      assertions: [{ id: 'target-change', result: 'pass', detail: 'Every edited value appeared.' }],
      evidence: [{ id: 'evidence-run-full-desktop', checkId: 'run-full-desktop', result: 'pass', artifactPath: 'run-full-desktop.png' }],
      artifacts: [{ checkId: 'run-full-desktop', path: 'run-full-desktop.png', sha256: 'digest' }],
      resourceSnapshots: [{ url: 'https://images.example.test/a.png', contentType: 'image/png', sha256: 'digest', artifactPath: 'resources/digest' }],
      unavailableResources: [],
      loadedExternalResourceUrls: ['https://images.example.test/a.png'],
      blockedExternalResourceUrls: [],
      browserErrorDetails: { total: 0, byCategory: {}, samples: [], truncated: false },
    }
    const summary = { manifest: full, viewportDiagnostics: [{ checkId: 'run-full-desktop' }], status: 'complete' }
    await runVerificationAndPublish({
      browser: { close: async () => {} },
      outputPath,
      runVerification: async () => summary,
    })
    const published = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    // Round-trip integrity: every host-read field survives at the top level.
    expect(published).toEqual(full)
    expect(published.viewportDiagnostics).toBeUndefined()
    expect(published.status).toBeUndefined()
  })

  it.each([
    ['a non-object manifest', { manifest: null }],
    ['a manifest with the wrong executor', { manifest: { schemaVersion: 4, executor: 'puppeteer', completed: true, runId: 'run-1', checks: [] } }],
    ['a manifest with a stale schema version', { manifest: { schemaVersion: 3, executor: 'playwright', completed: true, runId: 'run-1', checks: [] } }],
    ['a manifest whose checks are not an array', { manifest: { schemaVersion: 4, executor: 'playwright', completed: true, runId: 'run-1', checks: 'nope' } }],
    ['a manifest without a runId', { manifest: { schemaVersion: 4, executor: 'playwright', completed: true, checks: [] } }],
  ])('refuses to publish %s', async (_name, summary) => {
    const { outputPath } = tempOutput()
    const counter = { calls: 0 }
    await expect(runVerificationAndPublish({
      browser: countingBrowser(counter),
      outputPath,
      runVerification: async () => summary,
    })).rejects.toThrow('did not return a valid v4 execution manifest')
    expect(fs.existsSync(outputPath)).toBe(false)
  })
})
