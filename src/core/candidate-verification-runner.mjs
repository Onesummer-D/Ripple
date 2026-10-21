// Entry point for the isolated Playwright verification container. The
// verification itself lives in verification-execution.mjs so the lifecycle,
// failure and attribution behaviour can be exercised by the test suite; the
// completed record is published by verification-publish.mjs only after the
// browser has been closed successfully.
import * as fs from 'node:fs'
import { chromium } from '/ripple/node_modules/playwright/index.mjs'
import { describeError, withDeadline } from './verification-lifecycle.mjs'
import { executeVerification, runnerDeadline } from './verification-execution.mjs'
import { runVerificationAndPublish } from './verification-publish.mjs'

const evidenceRoot = '/evidence'
const outputPath = `${evidenceRoot}/execution.json`
const diagnosticPath = `${evidenceRoot}/runner-diagnostic.json`
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const deadlineAt = runnerDeadline(input)

// One JSON line per event survives a host-side budget kill; the host copies
// progress.jsonl into the exported diagnostics.
const progress = entry => {
  try { fs.appendFileSync(`${evidenceRoot}/progress.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n') } catch { /* bookkeeping must never fail the run */ }
}

// Explicit final-close state machine. Exactly one final close attempt runs:
// the publish gate closes the browser before publishing; when verification
// (or launch) failed, the finally block below performs the bounded close
// instead. A successful close is never repeated, so a failing second close
// cannot contradict an already published execution.json.
//   'pending' — browser not finally closed yet (launch/verification failed,
//               or still running); finally owns the bounded close attempt.
//   'closed'  — the publish gate closed the browser before publishing.
//   'failed'  — a final close attempt was made and failed; no retry.
let browserFinalClose = 'pending'

let exitCode = 0
let browser
try {
  browser = await chromium.launch({ headless: true })
  const { manifest, status } = await runVerificationAndPublish({
    browser,
    outputPath,
    runVerification: () => executeVerification({ input, browser, evidenceRoot, progress, deadlineAt }),
    progress,
  })
  browserFinalClose = 'closed'
  console.log(JSON.stringify({ runId: input.runId, status, checks: manifest.checks.length, artifacts: manifest.artifacts.length }))
} catch (error) {
  // A diagnostic, never an execution record: completed is false and it is
  // written under a different name, so it cannot be attested or approved.
  // outputPath is deliberately left untouched: this run never created it on
  // any failure path, and a pre-existing file belongs to a previous attempt
  // (the publish gate refuses to overwrite it). Exit code is not the safety
  // mechanism; the gate's ordering is.
  if (error?.browserCloseAttempted) browserFinalClose = 'failed'
  const diagnostic = error?.diagnostic ?? {
    schemaVersion: 1, executor: 'playwright', completed: false, status: 'failed-to-run', runId: input.runId,
    reason: 'The verification runner stopped with an unexpected error.',
  }
  try {
    fs.writeFileSync(diagnosticPath, JSON.stringify({ ...diagnostic, completed: false, error: describeError(error, 500) }, null, 2), { flag: 'wx' })
  } catch { /* the original error is reported below */ }
  progress({ event: 'runner-failed', error: describeError(error, 500) })
  console.error(`Ripple verification runner failed: ${describeError(error, 500).message}`)
  exitCode = 3
} finally {
  if (browser && browserFinalClose === 'pending') {
    // Launch or verification failed: still close the browser, bounded, and
    // keep the first error — a close failure here adds evidence and the exit
    // status but never replaces the error being reported.
    browserFinalClose = 'failed'
    const closeFailure = await withDeadline(Promise.resolve().then(() => browser.close()), 3_000, 'browser.close').then(() => undefined, error => describeError(error, 200))
    if (closeFailure) {
      progress({ event: 'browser-close-failed', error: closeFailure })
      console.error(`Ripple verification runner could not close the browser: ${closeFailure.message}`)
      if (exitCode === 0) exitCode = 3
    }
  }
}
process.exit(exitCode)
