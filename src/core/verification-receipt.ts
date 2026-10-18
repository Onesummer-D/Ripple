import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { VerificationAssertion, VerificationRun } from './model'

export class VerificationEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = 'VerificationEvidenceError' }
}

interface BrowserExecutionManifest {
  schemaVersion: 1
  executor: 'playwright'
  completed: boolean
  runId: string
  candidateId: string
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  checks: Array<{ id: string; route: string; viewport: { width: number; height: number }; state: string; passed: boolean }>
  assertions: VerificationAssertion[]
  artifacts: Array<{ checkId: string; path: string; sha256: string }>
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const receipts = new WeakMap<VerificationRun, string>()
const requiredAssertions = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']
const sameViewport = (left: { width: number; height: number }, right: { width: number; height: number }) => left.width === right.width && left.height === right.height

function regularFile(filePath: string): Buffer {
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new VerificationEvidenceError(`Evidence must be a regular file: ${filePath}`)
  return fs.readFileSync(filePath)
}

function validateRunRecord(run: VerificationRun, recordPath: string): string {
  const absoluteRecord = path.resolve(recordPath)
  const recordBytes = regularFile(absoluteRecord)
  let manifest: BrowserExecutionManifest
  try { manifest = JSON.parse(recordBytes.toString('utf8')) as BrowserExecutionManifest }
  catch { throw new VerificationEvidenceError('Playwright execution record is not valid JSON') }
  if (manifest.schemaVersion !== 1 || manifest.executor !== 'playwright' || manifest.completed !== true ||
    manifest.runId !== run.id || manifest.candidateId !== run.candidateId || manifest.baseSourceDigest !== run.baseSourceDigest ||
    manifest.patchHash !== run.patchHash || manifest.candidateTreeDigest !== run.candidateTreeDigest || manifest.runtimeFingerprint !== run.runtimeFingerprint) {
    throw new VerificationEvidenceError('Playwright execution record does not match this candidate run')
  }
  const checks = new Map(manifest.checks.map(check => [check.id, check]))
  if (checks.size !== run.checks.length || run.checks.some(check => {
    const executed = checks.get(check.id)
    return !executed || executed.passed !== true || executed.route !== check.route || !sameViewport(executed.viewport, check.viewport) || executed.state !== check.state
  })) throw new VerificationEvidenceError('Playwright execution checks do not match the registered run')
  const assertions = new Map(manifest.assertions.map(assertion => [assertion.id, assertion]))
  if (assertions.size !== run.assertions.length || run.assertions.some(assertion => {
    const executed = assertions.get(assertion.id)
    return !executed || executed.passed !== assertion.passed || executed.detail !== assertion.detail
  })) throw new VerificationEvidenceError('Playwright assertion record does not match the registered run')
  const assertionIds = new Set(run.assertions.filter(assertion => assertion.passed).map(assertion => assertion.id))
  if (requiredAssertions.some(id => !assertionIds.has(id))) throw new VerificationEvidenceError('Required browser assertions are missing or failed')

  const root = path.dirname(absoluteRecord)
  const artifacts = new Map<string, typeof manifest.artifacts[number]>()
  for (const artifact of manifest.artifacts) {
    const absolute = path.resolve(root, artifact.path)
    const relative = path.relative(root, absolute)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new VerificationEvidenceError('Playwright artifact escaped its run directory')
    const bytes = regularFile(absolute)
    if (sha256(bytes) !== artifact.sha256) throw new VerificationEvidenceError(`Playwright artifact hash mismatch: ${artifact.path}`)
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new VerificationEvidenceError(`Playwright artifact is not a PNG screenshot: ${artifact.path}`)
    artifacts.set(`${artifact.checkId}:${path.resolve(absolute)}`, artifact)
  }
  for (const evidence of run.evidence.filter(item => item.result === 'pass')) {
    if (!evidence.artifactPath || !evidence.artifactHash) throw new VerificationEvidenceError('Passing evidence needs a captured screenshot and recomputed hash')
    const absoluteArtifact = path.resolve(evidence.artifactPath)
    const artifact = artifacts.get(`${evidence.checkId}:${absoluteArtifact}`)
    if (!artifact || artifact.sha256 !== evidence.artifactHash || sha256(regularFile(absoluteArtifact)) !== evidence.artifactHash) {
      throw new VerificationEvidenceError('Passing evidence screenshot is absent from or differs from the Playwright execution record')
    }
    const check = checks.get(evidence.checkId)
    if (!check?.passed) throw new VerificationEvidenceError('Passing evidence is attached to a failed browser check')
  }
  return sha256(recordBytes)
}

/** Internal issuance path for repo-controlled browser executors and test harnesses. */
export function attestBrowserExecution(run: VerificationRun, recordPath: string): VerificationRun {
  const recordHash = validateRunRecord(run, recordPath)
  const attested: VerificationRun = { ...run, assertions: run.assertions.map(assertion => ({ ...assertion })), execution: { executor: 'playwright', recordPath: path.resolve(recordPath), recordHash } }
  receipts.set(attested, JSON.stringify(attested))
  return attested
}

/** Preserve a receipt only while the domain layer changes executor-owned status metadata. */
export function carryTrustedBrowserExecution(source: VerificationRun, target: VerificationRun): VerificationRun {
  assertTrustedBrowserExecution(source)
  receipts.set(target, JSON.stringify(target))
  return target
}

export function assertTrustedBrowserExecution(run: VerificationRun): void {
  const snapshot = receipts.get(run)
  if (!snapshot || snapshot !== JSON.stringify(run) || run.execution?.executor !== 'playwright') {
    throw new VerificationEvidenceError('Verification run was not produced by the trusted Playwright executor')
  }
  if (validateRunRecord(run, run.execution.recordPath) !== run.execution.recordHash) throw new VerificationEvidenceError('Playwright execution record changed after capture')
}
