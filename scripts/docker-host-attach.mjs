// Host-side half of the Docker end-to-end: the container already captured and
// self-checked; here the HOST analyses the exported manifest + evidence tree
// through the real attach path (visual-verification-attach.ts) and pins the
// conservative semantics.
//
//   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
//     scripts/docker-host-attach.mjs <exported-dir>
//
// Expects <exported-dir>/manifest.json and <exported-dir>/evidence/.
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { attachVisualEvidence } from '../src/core/visual-verification-attach.ts'
import { readPng } from '../src/core/visual-png.ts'

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex')

const dir = process.argv[2]
if (!dir) { console.error('usage: docker-host-attach.mjs <exported-dir>'); process.exit(2) }
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const evidenceRoot = path.join(dir, 'evidence')

const RUNTIME = 'docker-e2e-runtime/chromium'
const sha = value => createHash('sha256').update(value).digest('hex')
const BASE_DIGEST = sha('docker-e2e-base')
const TREE_DIGEST = sha('docker-e2e-tree')
const PATCH = sha('docker-e2e-patch')

const run = {
  id: 'run-docker-e2e', candidateId: 'candidate-docker-1', scopeDecisionId: 'scope-docker-1', scopeVersion: 1,
  baseSourceDigest: BASE_DIGEST, patchHash: PATCH, candidateTreeDigest: TREE_DIGEST, runtimeFingerprint: RUNTIME,
  startedAt: '2026-10-23T00:00:00.000Z', completedAt: '2026-10-23T00:00:01.000Z',
  checks: [], assertions: [], evidence: [], status: 'incomplete',
}
const candidate = { id: 'candidate-docker-1', baseSourceDigest: BASE_DIGEST, scopeDecisionId: 'scope-docker-1', scopeVersion: 1, patchHash: PATCH, candidateTreeDigest: TREE_DIGEST }
const revision = { projectId: 'project-docker-1', runtimeFingerprint: RUNTIME }

const attachedRun = attachVisualEvidence(run, manifest, evidenceRoot, candidate, revision, ['src/App.tsx#h1'])
const evidences = attachedRun.visualEvidences ?? []

const problems = []
if (evidences.length !== 1) problems.push(`expected 1 attached evidence, got ${evidences.length}`)
const attached = evidences[0]
if (attached) {
  if (attached.result !== 'unknown') problems.push(`expected 'unknown' (observation, never PASS), got '${attached.result}'`)
  if (!String(attached.resultReason ?? '').includes('Compared: changed')) problems.push(`resultReason unexpected: ${attached.resultReason}`)
  if (attached.evidence?.identity?.status !== 'consistent') problems.push(`identity.status=${attached.evidence?.identity?.status}`)
  if (attached.evidence?.comparability?.comparable !== true) problems.push('comparability.comparable != true')
  if (attached.evidence?.geometry?.target?.status !== 'mapped') problems.push(`geometry.target.status=${attached.evidence?.geometry?.target?.status}`)
  if (attached.view?.state !== 'unknown') problems.push(`view.state=${attached.view?.state}`)
  if (attached.artifacts?.evidenceJson) {
    const bytes = fs.readFileSync(attached.artifacts.evidenceJson.path)
    if (sha256Hex(bytes) !== attached.artifacts.evidenceJson.sha256) {
      problems.push('host evidence.json sha256 mismatch')
    }
  } else {
    problems.push('host evidence.json artifact missing')
  }
  // The host-written diff PNG must exist, hash-match its recorded bindings and
  // decode to the recorded pixel digest — a summary must never report success
  // while the actual artifact is missing or substituted.
  const diff = attached.artifacts?.diff
  if (diff) {
    if (!fs.existsSync(diff.path)) {
      problems.push(`host diff.png missing at ${diff.path}`)
    } else {
      const bytes = fs.readFileSync(diff.path)
      if (sha256Hex(bytes) !== diff.sha256) problems.push('host diff.png sha256 mismatch')
      const decoded = readPng(bytes)
      if (!decoded.ok) {
        problems.push(`host diff.png does not decode (${decoded.code})`)
      } else if (decoded.png.pixelSha256 !== diff.pixelSha256) {
        problems.push('host diff.png pixel digest mismatch')
      }
    }
    const resolvedRoot = path.resolve(evidenceRoot)
    const resolvedDiff = path.resolve(diff.path)
    if (resolvedDiff !== resolvedRoot && !resolvedDiff.startsWith(resolvedRoot + path.sep)) {
      problems.push('host diff.png path escapes the evidence root')
    }
  } else {
    problems.push('host diff.png artifact missing')
  }
}

const summary = { host: { node: process.version, platform: `${process.platform}/${process.arch}` }, attached: attached ? {
  result: attached.result,
  stateLabel: attached.view?.stateLabel,
  summary: attached.view?.summary,
  diffArtifact: attached.artifacts?.diff?.path ?? null,
  evidenceJson: attached.artifacts?.evidenceJson?.path ?? null,
} : null, problems, ok: problems.length === 0 }
console.log(JSON.stringify(summary, null, 2))
process.exitCode = summary.ok ? 0 : 1
