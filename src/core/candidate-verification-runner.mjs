// Entry point for the isolated Playwright verification container. The
// verification itself lives in verification-execution.mjs so the lifecycle,
// failure and attribution behaviour can be exercised by the test suite.
import * as fs from 'node:fs'
import { chromium } from '/ripple/node_modules/playwright/index.mjs'
import { describeError, withDeadline } from './verification-lifecycle.mjs'
import { executeVerification, runnerDeadline } from './verification-execution.mjs'

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

let exitCode = 0
let browser
try {
  browser = await chromium.launch({ headless: true })
  const { manifest, status } = await executeVerification({ input, browser, evidenceRoot, progress, deadlineAt })
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ runId: input.runId, status, checks: manifest.checks.length, artifacts: manifest.artifacts.length }))
} catch (error) {
  // A diagnostic, never an execution record: completed is false and it is
  // written under a different name, so it cannot be attested or approved.
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
  if (browser) await withDeadline(browser.close(), 3_000, 'browser.close').catch(() => undefined)
}
process.exit(exitCode)
