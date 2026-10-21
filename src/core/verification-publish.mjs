// Final publish gate for the isolated verification runner (candidate-
// verification-runner.mjs is the entry).
//
// The completed execution record is what a host later attests into a Receipt,
// so its existence must alone imply a healthy run and its top level must be
// the manifest the host validates (schemaVersion 4, executor, completed:true,
// runId and the full binding). A browser that cannot be closed is a sick run
// (its renderer processes may still be alive and able to touch shared state),
// and a process exit code is only a convention — the disk must not carry an
// attestable completed record after a run whose final cleanup failed. This
// gate therefore orders the end of the run strictly:
//
//   1. run the verification (RunnerAborted propagates, nothing is written);
//   2. validate the returned summary actually contains a v4 execution
//      manifest — an arbitrary object is never published as an execution
//      record;
//   3. close the browser under a deadline — a close that rejects or hangs
//      throws before any completed record exists on disk, and is reported as
//      a `browser-close-failed` progress event so it persists in
//      progress.jsonl ahead of the runner diagnostic. The thrown error
//      carries `browserCloseAttempted: true` so the caller's final-close
//      state machine never closes a second time;
//   4. only then publish the manifest atomically (write a same-directory temp
//      file unique to this run, link it into place), refusing to overwrite an
//      existing file and keeping the original flag:'wx' no-clobber semantics
//      of the entry.
//
// Cleanup discipline: this gate only ever deletes the temp file it created
// itself. outputPath is never removed — a pre-existing file belongs to a
// previous attempt and must survive (the no-clobber link above protects it),
// and on failure paths this run never created outputPath at all.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describeError, withDeadline } from './verification-lifecycle.mjs'

// The shape the host attestation binds against. Anything else means the
// executor contract changed without the host, and publishing it would write
// a file that looks like, but is not, an execution record.
function executionManifestOf(summary) {
  const manifest = summary?.manifest
  const valid = !!manifest && typeof manifest === 'object' &&
    manifest.schemaVersion === 4 &&
    manifest.executor === 'playwright' &&
    manifest.completed === true &&
    typeof manifest.runId === 'string' && manifest.runId.length > 0 &&
    Array.isArray(manifest.checks)
  if (!valid) {
    throw new Error('verification did not return a valid v4 execution manifest; refusing to publish an execution record')
  }
  return manifest
}

export async function runVerificationAndPublish({
  browser, outputPath, runVerification, closeTimeoutMs = 3_000, progress = () => {},
}) {
  // A failure here means nothing of this run exists at outputPath yet, so
  // there is nothing of ours to delete: let the original error propagate.
  const summary = await runVerification()
  const manifest = executionManifestOf(summary)
  // Fail-closed final cleanup: close the browser BEFORE the completed record
  // exists anywhere on disk. The rejection (or deadline) propagates, so the
  // caller writes only a completed:false diagnostic.
  try {
    await withDeadline(Promise.resolve().then(() => browser.close()), closeTimeoutMs, 'browser.close')
  } catch (error) {
    progress({ event: 'browser-close-failed', error: describeError(error, 200) })
    if (error && typeof error === 'object') error.browserCloseAttempted = true
    throw error
  }
  const directory = path.dirname(outputPath)
  // Temp name is unique to this run (pid + random nonce): cleanup can only
  // ever touch a file this invocation created.
  const temporaryPath = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`)
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
    // A hard link publishes atomically and fails with EEXIST when the final
    // name is already taken, preserving the entry's no-clobber semantics on
    // every platform; the temp name is then removed either way.
    try {
      fs.linkSync(temporaryPath, outputPath)
    } finally {
      fs.rmSync(temporaryPath, { force: true })
    }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch { /* keep the original error */ }
    throw error
  }
  return summary
}
