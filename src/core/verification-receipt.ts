import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { REQUIRED_VERIFICATION_ASSERTION_IDS, type VerificationAssertion, type VerificationRun } from './model'

export class VerificationEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = 'VerificationEvidenceError' }
}

interface BrowserExecutionManifest {
  schemaVersion: 1
  executor: 'playwright'
  completed: boolean
  runId: string
  candidateId: string
  scopeDecisionId: string
  scopeVersion: number
  baseSourceDigest: string
  patchHash: string
  candidateTreeDigest: string
  runtimeFingerprint: string
  checks: Array<{ id: string; route: string; viewport: { width: number; height: number }; state: string; passed: boolean }>
  assertions: VerificationAssertion[]
  evidence: Array<Omit<VerificationRun['evidence'][number], 'artifactPath'> & { artifactPath?: string }>
  artifacts: Array<{ checkId: string; path: string; sha256: string }>
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const receipts = new WeakMap<VerificationRun, string>()
const sameViewport = (left: { width: number; height: number }, right: { width: number; height: number }) => left.width === right.width && left.height === right.height

function regularFile(filePath: string): Buffer {
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new VerificationEvidenceError(`Evidence must be a regular file: ${filePath}`)
  return fs.readFileSync(filePath)
}

function artifactPathWithin(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath)
  const relative = path.relative(root, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new VerificationEvidenceError('Playwright artifact escaped its run directory')
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new VerificationEvidenceError('Playwright artifact cannot traverse a symbolic link')
  }
  return absolute
}

function validateRunRecord(run: VerificationRun, recordPath: string): string {
  const absoluteRecord = path.resolve(recordPath)
  const recordBytes = regularFile(absoluteRecord)
  let manifest: BrowserExecutionManifest
  try { manifest = JSON.parse(recordBytes.toString('utf8')) as BrowserExecutionManifest }
  catch { throw new VerificationEvidenceError('Playwright execution record is not valid JSON') }
  if (manifest.schemaVersion !== 1 || manifest.executor !== 'playwright' || manifest.completed !== true ||
    manifest.runId !== run.id || manifest.candidateId !== run.candidateId || manifest.scopeDecisionId !== run.scopeDecisionId || manifest.scopeVersion !== run.scopeVersion || manifest.baseSourceDigest !== run.baseSourceDigest ||
    manifest.patchHash !== run.patchHash || manifest.candidateTreeDigest !== run.candidateTreeDigest || manifest.runtimeFingerprint !== run.runtimeFingerprint) {
    throw new VerificationEvidenceError('Playwright execution record does not match this candidate run')
  }
  const checks = new Map(manifest.checks.map(check => [check.id, check]))
  if (checks.size !== run.checks.length || run.checks.some(check => {
    const executed = checks.get(check.id)
    const evidence = run.evidence.find(item => item.checkId === check.id)
    return !executed || !evidence || executed.passed !== (evidence.result === 'pass') || executed.route !== check.route || !sameViewport(executed.viewport, check.viewport) || executed.state !== check.state
  })) throw new VerificationEvidenceError('Playwright execution checks do not match the registered run')
  const assertions = new Map(manifest.assertions.map(assertion => [assertion.id, assertion]))
  if (assertions.size !== run.assertions.length || run.assertions.some(assertion => {
    const executed = assertions.get(assertion.id)
    return !executed || executed.result !== assertion.result || executed.detail !== assertion.detail
  })) throw new VerificationEvidenceError('Playwright assertion record does not match the registered run')
  const assertionIds = new Set(run.assertions.map(assertion => assertion.id))
  if (REQUIRED_VERIFICATION_ASSERTION_IDS.some(id => !assertionIds.has(id))) throw new VerificationEvidenceError('Required browser assertions are missing')

  const root = path.dirname(absoluteRecord)
  const executionEvidence = new Map(manifest.evidence.map(item => [item.id, item]))
  if (executionEvidence.size !== run.evidence.length || run.evidence.some(evidence => {
    const executed = executionEvidence.get(evidence.id)
    return !executed || executed.checkId !== evidence.checkId || executed.result !== evidence.result || executed.capturedAt !== evidence.capturedAt ||
      executed.pageUrl !== evidence.pageUrl || !sameViewport(executed.viewport, evidence.viewport) || executed.runtimeState !== evidence.runtimeState ||
      JSON.stringify(executed.elementRefs) !== JSON.stringify(evidence.elementRefs) || executed.reason !== evidence.reason ||
      (executed.artifactPath ? path.resolve(root, executed.artifactPath) : undefined) !== (evidence.artifactPath ? path.resolve(evidence.artifactPath) : undefined) ||
      executed.artifactHash !== evidence.artifactHash
  })) throw new VerificationEvidenceError('Playwright evidence does not match the registered run')
  const artifacts = new Map<string, typeof manifest.artifacts[number]>()
  for (const artifact of manifest.artifacts) {
    const absolute = artifactPathWithin(root, artifact.path)
    const bytes = regularFile(absolute)
    if (sha256(bytes) !== artifact.sha256) throw new VerificationEvidenceError(`Playwright artifact hash mismatch: ${artifact.path}`)
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new VerificationEvidenceError(`Playwright artifact is not a PNG screenshot: ${artifact.path}`)
    const key = `${artifact.checkId}:${absolute}`
    if (artifacts.has(key)) throw new VerificationEvidenceError('Playwright execution record repeats a screenshot artifact')
    artifacts.set(key, artifact)
  }
  const referencedArtifacts = new Set<string>()
  for (const evidence of run.evidence) {
    if (evidence.result === 'pass' && (!evidence.artifactPath || !evidence.artifactHash)) throw new VerificationEvidenceError('Passing evidence needs a captured screenshot and recomputed hash')
    if (!evidence.artifactPath && !evidence.artifactHash) continue
    if (!evidence.artifactPath || !evidence.artifactHash) throw new VerificationEvidenceError('Evidence screenshot path and hash must be recorded together')
    const absoluteArtifact = path.resolve(evidence.artifactPath)
    const artifact = artifacts.get(`${evidence.checkId}:${absoluteArtifact}`)
    if (!artifact || artifact.sha256 !== evidence.artifactHash || sha256(regularFile(absoluteArtifact)) !== evidence.artifactHash) {
      throw new VerificationEvidenceError('Passing evidence screenshot is absent from or differs from the Playwright execution record')
    }
    referencedArtifacts.add(`${evidence.checkId}:${absoluteArtifact}`)
    if (!checks.has(evidence.checkId)) throw new VerificationEvidenceError('Screenshot evidence is attached to an unknown browser check')
  }
  if (referencedArtifacts.size !== artifacts.size) throw new VerificationEvidenceError('Playwright execution record contains unreferenced screenshot artifacts')
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
