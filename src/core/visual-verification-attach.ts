// Host-side attachment of supplementary visual evidence to a VerificationRun.
//
// The isolated container only CAPTURES (screenshots + DOM geometry +
// descriptors under <artifactRoot>/visual/, recorded with SHA-256 in the
// execution manifest). This module validates those records (bounded paths,
// byte hashes), runs analyzeVisualDifference on the host, writes diff and
// evidence artifacts into the run's evidence directory, and attaches
// read-only results to the run BEFORE attestation.
//
// Hard rules:
// - Visual evidence is supplementary: it never changes assertions, status or
//   the approval gate, and it can never be 'pass'. A capture that was never
//   made becomes 'not-run'; an invalid, unbound or unanalysable one becomes
//   'failed-to-run'.
// - Nothing here throws for capture/analysis problems: they become failed
//   visual entries. Programming errors (a run without identity fields) throw.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CandidateRecord } from './candidate'
import type { ProjectRevision, VerificationRun, VisualRunEvidence } from './model'
import { sourceFileDigest } from './project'
import { expectedIdentityFor } from './visual-capture'
import { VisualResourceLimitError } from './visual-diff'
import { analyzeVisualDifference, readScreenshotFile, serializeVisualEvidence, type ScreenshotInput, type VisualDifferenceEvidence } from './visual-evidence'
import { sourceFileFromSourceRef } from './visual-geometry'
import { toVisualEvidenceView } from './visual-evidence-view'
import { DEFAULT_PNG_LIMITS } from './visual-png'

export const VISUAL_ANALYSIS_DIR = 'visual-analysis'
const GEOMETRY_FILE_LIMIT_BYTES = 16 * 1024 * 1024
const HEX64 = /^[a-f0-9]{64}$/
// The container writes exactly these names under visual/<viewport-dir>/; the
// host refuses anything else, so manifest-recorded paths cannot escape.
const CAPTURE_PATH = /^visual\/[a-z0-9-]{1,32}\/(baseline|candidate)(\.png|-geometry\.json)$/

interface CaptureFileRef { path: string; sha256: string }

function readBoundedRegularFile(absolute: string, root?: string): Buffer | undefined {
  if (root !== undefined) {
    // Confine to the evidence root, resolving symbolic links in parent
    // directories too: a symlinked parent must not let the manifest's
    // recorded path read outside the root (same rule readScreenshotFile
    // applies to screenshots).
    let parent: string, rootReal: string
    try { parent = fs.realpathSync(path.dirname(path.resolve(absolute))); rootReal = fs.realpathSync(root) } catch { return undefined }
    const relative = path.relative(rootReal, parent)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined
  }
  let fd: number
  try { fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)) } catch { return undefined }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > GEOMETRY_FILE_LIMIT_BYTES) return undefined
    const bytes = Buffer.alloc(stat.size)
    const read = fs.readSync(fd, bytes, 0, stat.size, 0)
    return bytes.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

function validateRef(value: unknown): CaptureFileRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const ref = value as { path?: unknown; sha256?: unknown }
  if (typeof ref.path !== 'string' || !CAPTURE_PATH.test(ref.path)) return undefined
  if (typeof ref.sha256 !== 'string' || !HEX64.test(ref.sha256)) return undefined
  return { path: ref.path, sha256: ref.sha256 }
}

const diagnostic = (error: unknown) => String((error as Error | null | undefined)?.message ?? error).slice(0, 300)

interface CaptureSide { descriptor: unknown; screenshot: unknown; geometry: unknown; failure: string | null }
interface CaptureEntry {
  checkId: string
  route: string
  viewport: { width: number; height: number }
  state: string
  baseline: CaptureSide
  candidate: CaptureSide
}

/** Structural validation of one manifest visualCaptures entry. */
function validateCaptureEntry(value: unknown): { ok: true; entry: CaptureEntry } | { ok: false; detail: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, detail: 'capture entry is not an object' }
  const item = value as Record<string, unknown>
  if (typeof item.checkId !== 'string' || !item.checkId || item.checkId.length > 200) return { ok: false, detail: 'capture entry has an invalid checkId' }
  if (typeof item.route !== 'string' || !item.route.startsWith('/') || item.route.length > 2048) return { ok: false, detail: 'capture entry has an invalid route' }
  if (typeof item.state !== 'string' || !item.state || item.state.length > 300) return { ok: false, detail: 'capture entry has an invalid state' }
  const viewport = item.viewport as Record<string, unknown> | undefined
  if (typeof viewport?.width !== 'number' || !Number.isInteger(viewport.width) || viewport.width <= 0 ||
    typeof viewport.height !== 'number' || !Number.isInteger(viewport.height) || viewport.height <= 0) return { ok: false, detail: 'capture entry has an invalid viewport' }
  const side = (value: unknown): CaptureSide | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (record.descriptor !== null && (typeof record.descriptor !== 'object' || Array.isArray(record.descriptor))) return undefined
    if (validateRef(record.screenshot) === undefined && record.screenshot !== null) return undefined
    if (validateRef(record.geometry) === undefined && record.geometry !== null) return undefined
    return {
      descriptor: record.descriptor,
      screenshot: record.screenshot,
      geometry: record.geometry,
      failure: typeof record.failure === 'string' ? record.failure.slice(0, 300) : null,
    }
  }
  const baseline = side(item.baseline), candidate = side(item.candidate)
  if (!baseline || !candidate) return { ok: false, detail: 'capture entry has an invalid side record' }
  return {
    ok: true,
    entry: {
      checkId: item.checkId, route: item.route, state: item.state,
      viewport: { width: (viewport as { width: number }).width, height: (viewport as { height: number }).height },
      baseline, candidate,
    },
  }
}

function syntheticEntry(checkId: string, route: string, viewport: { width: number; height: number }, state: string, result: 'not-run' | 'failed-to-run', reason: string): VisualRunEvidence {
  return {
    checkId, route, viewport, state, result, resultReason: reason,
    evidence: null, view: null,
    artifacts: { baseline: null, candidate: null, diff: null, evidenceJson: null },
  }
}

/**
 * Attaches supplementary visual evidence to a run (mutates and returns it).
 * Malformed, unbound or unanalysable captures degrade to failed-to-run /
 * not-run entries; the run itself is never failed by visual evidence.
 */
export function attachVisualEvidence(
  run: VerificationRun,
  manifest: { visualCaptures?: unknown },
  artifactRoot: string,
  candidate: CandidateRecord,
  revision: ProjectRevision,
  targetSourceRefs: string[],
  analyzedAt = new Date().toISOString(),
  dualTargetRefs?: { baseline: string[]; candidate: string[] } | null,
): VerificationRun {
  const attached: VisualRunEvidence[] = []
  // Reading the manifest itself goes through the isolation boundary: a hostile
  // manifest (e.g. a throwing getter) becomes a failed-to-run entry, not a
  // thrown error.
  let captures: unknown
  try {
    captures = manifest.visualCaptures
  } catch (error) {
    attached.push(syntheticEntry('visual-attach', '/', { width: 0, height: 0 }, 'rendered', 'failed-to-run', `Visual evidence manifest could not be read: ${diagnostic(error)}`))
    run.visualEvidences = attached
    return run
  }
  if (!Array.isArray(captures)) return run
  const expected = expectedIdentityFor(candidate, revision)
  // Host-verified expected served versions, per side, bound to each side's OWN
  // revision via C+D `sourceFileDigest` (baseline tree = the project working
  // tree the baseline preview serves; candidate tree = the candidate worktree
  // the candidate preview serves). A file that cannot be read contributes no
  // entry: unverified, never a match, never invented. Cached per run because
  // captures across viewports share the same files.
  const digestCache = { baseline: new Map<string, string | undefined>(), candidate: new Map<string, string | undefined>() }
  const digestFor = (side: 'baseline' | 'candidate', file: string): string | undefined => {
    const cache = digestCache[side]
    if (!cache.has(file)) {
      try {
        cache.set(file, sourceFileDigest(side === 'baseline' ? candidate.projectRoot : candidate.candidateRoot!, file))
      } catch {
        cache.set(file, undefined)
      }
    }
    return cache.get(file)
  }
  const referencedFilesOf = (geometry: unknown): string[] => {
    const raw = geometry as { elements?: Array<{ sourceRef?: unknown }> } | null
    if (!raw || !Array.isArray(raw.elements)) return []
    return [...new Set(raw.elements.map(element => sourceFileFromSourceRef(typeof element?.sourceRef === 'string' ? element.sourceRef : null)).filter((file): file is string => file !== null))].sort()
  }
  const subject = {
    candidateId: run.candidateId, projectId: revision.projectId, patchHash: run.patchHash,
    baseSourceDigest: run.baseSourceDigest, candidateTreeDigest: run.candidateTreeDigest,
    runtimeFingerprint: run.runtimeFingerprint, scopeDecisionId: run.scopeDecisionId, scopeVersion: run.scopeVersion, runId: run.id,
  }
  const loadSide = (entry: CaptureEntry, side: 'baseline' | 'candidate') => {
    const record = entry[side]
    if (record.failure) return { ok: false as const, failure: record.failure }
    const screenshotRef = validateRef(record.screenshot)
    const geometryRef = validateRef(record.geometry)
    const screenshot: ScreenshotInput = screenshotRef ? readScreenshotFile(path.join(artifactRoot, screenshotRef.path), { root: artifactRoot, maxBytes: DEFAULT_PNG_LIMITS.maxFileBytes }) : null
    if (screenshotRef && screenshot instanceof Uint8Array) {
      // The manifest-recorded hash and the descriptor's declared hash must both
      // match the bytes on disk; a record that only matches one is unbound.
      const actual = createHash('sha256').update(screenshot).digest('hex')
      if (actual !== screenshotRef.sha256) return { ok: false as const, failure: `Screenshot bytes do not match the manifest-recorded SHA-256 (${side}).` }
      const declared = (record.descriptor as { screenshot?: { declaredSha256?: unknown } } | null)?.screenshot?.declaredSha256
      if (typeof declared === 'string' && HEX64.test(declared) && actual !== declared) return { ok: false as const, failure: `Screenshot bytes do not match the declared SHA-256 (${side}).` }
    }
    let geometry: unknown = null
    if (geometryRef) {
      const bytes = readBoundedRegularFile(path.join(artifactRoot, geometryRef.path), artifactRoot)
      const actual = bytes ? createHash('sha256').update(bytes).digest('hex') : null
      if (!bytes || actual !== geometryRef.sha256) return { ok: false as const, failure: `Geometry sample bytes do not match the recorded SHA-256 (${side}).` }
      try { geometry = JSON.parse(bytes.toString('utf8')) } catch { return { ok: false as const, failure: `Geometry sample is not valid JSON (${side}).` } }
    }
    // Corrupt or unreadable screenshots stay visible to the analysis, which
    // pins the invalid-input conservative semantics.
    return { ok: true as const, screenshot, geometry }
  }

  // Everything after integrity checks — directory creation, analysis, diff and
  // evidence writes, serialization, read-only view generation — sits inside one
  // failure-isolation boundary: any exception becomes a failed-to-run entry
  // with bounded diagnostics, never a thrown error and never a run failure.
  const analyseAndAttach = (entry: CaptureEntry, index: number): VisualRunEvidence => {
    const outDir = path.join(artifactRoot, VISUAL_ANALYSIS_DIR, String(index))
    try {
      const baseline = loadSide(entry, 'baseline')
      const cand = loadSide(entry, 'candidate')
      if (!baseline.ok || !cand.ok) {
        return syntheticEntry(entry.checkId, entry.route, entry.viewport, entry.state, 'failed-to-run', `Visual capture failed integrity checks: ${!baseline.ok ? baseline.failure : (cand as { failure: string }).failure}.`)
      }

      fs.mkdirSync(outDir, { recursive: true })
      const diffRel = `${VISUAL_ANALYSIS_DIR}/${index}/diff.png`
      let outcome: { evidence: VisualDifferenceEvidence; diffPng: Uint8Array | null }
      try {
        const expectedSourceVersions: { baseline: Record<string, string>; candidate: Record<string, string> } = { baseline: {}, candidate: {} }
        for (const file of referencedFilesOf(baseline.geometry)) {
          const digest = digestFor('baseline', file)
          if (digest) expectedSourceVersions.baseline[file] = digest
        }
        for (const file of referencedFilesOf(cand.geometry)) {
          const digest = digestFor('candidate', file)
          if (digest) expectedSourceVersions.candidate[file] = digest
        }
        outcome = analyzeVisualDifference({
          checkId: entry.checkId, subject, expected, targets: { sourceRefs: targetSourceRefs, ...(dualTargetRefs ? { dual: dualTargetRefs } : {}) },
          expectedSourceVersions,
          baseline: { descriptor: entry.baseline.descriptor, screenshot: baseline.screenshot, geometry: baseline.geometry },
          candidate: { descriptor: entry.candidate.descriptor, screenshot: cand.screenshot, geometry: cand.geometry },
          analyzedAt, diffArtifactPath: diffRel,
        })
      } catch (error) {
        const reason = error instanceof VisualResourceLimitError || error instanceof RangeError
          ? `Visual analysis exceeded its bounded resource budget: ${(error as Error).message}`
          : `Visual analysis failed to run: ${diagnostic(error)}`
        return syntheticEntry(entry.checkId, entry.route, entry.viewport, entry.state, 'failed-to-run', reason)
      }
      const { evidence, diffPng } = outcome
      const serialized = serializeVisualEvidence(evidence)
      fs.writeFileSync(path.join(outDir, 'evidence.json'), serialized.bytes)
      const baselineRef = validateRef(entry.baseline.screenshot)
      const candidateRef = validateRef(entry.candidate.screenshot)
      const diffImage = evidence.observation?.diffImage ?? null
      const diff = diffPng && diffImage
        ? (() => {
          const absolute = path.join(outDir, 'diff.png')
          fs.writeFileSync(absolute, diffPng)
          return { path: absolute, sha256: diffImage.sha256, pixelSha256: diffImage.pixelSha256 }
        })()
        : null
      return {
        checkId: entry.checkId, route: entry.route, viewport: entry.viewport, state: entry.state,
        result: evidence.result, resultReason: evidence.resultReason,
        evidence, view: toVisualEvidenceView(evidence),
        artifacts: {
          baseline: baselineRef ? { path: path.join(artifactRoot, baselineRef.path), sha256: baselineRef.sha256 } : null,
          candidate: candidateRef ? { path: path.join(artifactRoot, candidateRef.path), sha256: candidateRef.sha256 } : null,
          diff,
          evidenceJson: { path: path.join(outDir, 'evidence.json'), sha256: serialized.sha256 },
        },
      }
    } catch (error) {
      // Best-effort removal of partially written host artifacts so a failed
      // attachment never leaves a misleading half-analysis behind.
      try { fs.rmSync(outDir, { recursive: true, force: true }) } catch { /* cleanup must never mask the original problem */ }
      return syntheticEntry(entry.checkId, entry.route, entry.viewport, entry.state, 'failed-to-run', `Visual evidence attachment failed: ${diagnostic(error)}`)
    }
  }

  captures.forEach((raw, index) => {
    try {
      const validated = validateCaptureEntry(raw)
      if (!validated.ok) {
        attached.push(syntheticEntry(`visual-${index}`, '/', { width: 0, height: 0 }, 'rendered', 'failed-to-run', `Visual capture record is invalid: ${validated.detail}.`))
        return
      }
      const { entry } = validated

      // A capture that was never made (missing side descriptor) is not-run —
      // absence must never count as pass.
      if (entry.baseline.descriptor === null || entry.candidate.descriptor === null) {
        const reason = entry.baseline.failure ?? entry.candidate.failure ?? 'capture was never recorded'
        attached.push(syntheticEntry(entry.checkId, entry.route, entry.viewport, entry.state, 'not-run', `Visual capture was not made: ${reason}.`))
        return
      }

      attached.push(analyseAndAttach(entry, index))
    } catch (error) {
      // A hostile record (e.g. a throwing getter) must not abort the remaining
      // captures; record the failure and continue with the next entry.
      attached.push(syntheticEntry(`visual-${index}`, '/', { width: 0, height: 0 }, 'rendered', 'failed-to-run', `Visual capture record could not be read: ${diagnostic(error)}`))
    }
  })
  run.visualEvidences = attached
  return run
}

/**
 * The runner-level hard isolation boundary around attachVisualEvidence. Attach
 * already converts capture/analysis problems into failed-to-run entries and is
 * not expected to throw; this wrapper covers the residual "must never happen"
 * case (a hostile manifest shape, a future regression) so that supplementary
 * visual evidence can NEVER fail the formal verification. On an unexpected
 * throw the formal run is returned untouched, an explicit failed-to-run
 * diagnostic is appended to run.visualEvidences, and a bounded diagnostic file
 * is written best-effort next to the other run artifacts.
 */
export function attachVisualEvidenceSafely(
  run: VerificationRun,
  manifest: { visualCaptures?: unknown },
  artifactRoot: string,
  candidate: CandidateRecord,
  revision: ProjectRevision,
  targetSourceRefs: string[],
  dualTargetRefs?: { baseline: string[]; candidate: string[] } | null,
): VerificationRun {
  try {
    return attachVisualEvidence(run, manifest, artifactRoot, candidate, revision, targetSourceRefs, undefined, dualTargetRefs)
  } catch (error) {
    const entry = syntheticEntry('visual-attach', '/', { width: 0, height: 0 }, 'rendered', 'failed-to-run', `Visual evidence attachment failed unexpectedly: ${diagnostic(error)}`)
    try {
      run.visualEvidences = [...(run.visualEvidences ?? []), entry]
    } catch { /* a hostile run record must still not fail the formal verification */ }
    try {
      fs.writeFileSync(path.join(artifactRoot, 'visual-attach-failure.json'), JSON.stringify({
        phase: 'visual-evidence-attach', at: new Date().toISOString(), detail: diagnostic(error),
      }, null, 2))
    } catch { /* diagnostics must never mask the verification result */ }
    return run
  }
}
