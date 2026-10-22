/** Issue #6 — codescandy TEXT candidate gate reproduction (static + fail-closed demo).
 *  Attempts ONE simple TEXT candidate on the ProfileHeader "Overview" literal and
 *  records the expected CandidateError. Never relaxes Scope/sandbox checks. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate, CandidateError } from '../src/core/candidate.ts'

const repo = process.argv[2]
const workRoot = process.argv[3] ?? path.resolve(process.cwd(), '..', '.ripple-thirdparty-reprobe')
const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

const graph = analyzeProject(repo, true)
const target = graph.nodes.find(n => n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))
if (!target) throw new Error('Overview TEXT target not found')
const impact = sourceProvenPageImpact(graph, target.id)

const scope = {
  id: 'scope-reprobe-1', version: 1, decidedBy: 'b-reprobe', decidedAt: new Date().toISOString(),
  strategy: 'shared', includedRefs: [target.id], excludedRefs: [], protectedRefs: [],
}
const operations = [{
  id: 'op-overview-text', kind: 'TEXT', targetRef: target.id,
  before: target.value, after: target.value.replace('Overview', 'Overview (reprobe)'),
}]
const candidateRoot = path.join(workRoot, 'candidate-worktree')
const artifactRoot = path.join(workRoot, 'artifacts')
fs.rmSync(workRoot, { recursive: true, force: true })
fs.mkdirSync(artifactRoot, { recursive: true })

let gate
try {
  createCandidate({ projectRoot: repo, candidateRoot, artifactRoot, graph, scope, operations })
  gate = { rejected: false }
} catch (error) {
  gate = {
    rejected: true,
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    isCandidateError: error instanceof CandidateError,
  }
}
const result = {
  schemaVersion: 1,
  codescandySha: actual,
  target: { id: target.id, path: target.location.path, value: JSON.stringify(target.value) },
  impact,
  gate,
  note: 'createCandidate 必须先通过 sourceProvenPageImpact 门控；composite-jsx-child 与 data-router 覆盖未决时拒绝是正确 fail-closed。',
}
fs.writeFileSync(path.join(artifactRoot, 'candidate-gate.json'), JSON.stringify(result, null, 2) + '\n')
// cleanup any leftover worktree so reruns stay clean
try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', candidateRoot], { stdio: 'pipe' }) } catch { /* not created */ }
fs.rmSync(workRoot, { recursive: true, force: true })
console.log(JSON.stringify(result, null, 2))
process.exitCode = gate.rejected ? 0 : 1
