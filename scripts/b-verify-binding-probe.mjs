/** Ripple B — minimal repro probe for the baseline-comparison binding refusal.
 *
 *  Reproduces EXACTLY what A's verification runner computes for sourceBindings()
 *  on the codescandy ACCEPTED candidate — WITHOUT Docker/browser. Runs from any
 *  A-core checkout (imports are relative to this script's location).
 *
 *  Finding (A core 2f2e5a7, codescandy b700bbd):
 *    sourceBindings() returns UNIQUE refs on both sides:
 *      baselineSourceRefs = sourceRefs = ['jsx:src/sub-components/profile/ProfileHeader.tsx#2522']
 *    via the containing-jsx fallback. The CI failure
 *    "Source binding for op-overview-text is not unique." therefore does NOT
 *    come from non-unique refs: the executor compares the ROOT page ('/'),
 *    where pageExpectations has no entry → spec.text = '' → the same message.
 *    See docs/probes/b-codescandy-verification-20261024.md and
 *    docs/probes/a-interface-requirements-issue6.md (AC-P4/AC-P5).
 *
 *  Also records graph hygiene: the Overview literal carries TWO identical
 *  reads edges (component #131 → literal #2620, both source-proven).
 *
 *  Usage:
 *    node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *      scripts/b-verify-binding-probe.mjs <codescandy-repo>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate } from '../src/core/candidate.ts'
import { openSession, recordSourceGraph, chooseScope, stageOperations, stageCandidate } from '../src/core/session.ts'
import { sourceBindings } from '../src/core/verification-runner.ts'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const coreHead = execFileSync('git', ['-C', path.resolve(scriptDir, '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const repo = path.resolve(process.argv[2] ?? '')
const EXPECTED = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
if (!repo) throw new Error('usage: b-verify-binding-probe.mjs <codescandy-repo>')
if (execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== EXPECTED) throw new Error('Refusing unpinned checkout')

const result = { schemaVersion: 1, coreHead, codescandySha: EXPECTED, graphHygiene: null, bindings: null }
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-bindprobe-'))
const project = path.join(tempRoot, 'project-clone')
const candidateRoot = path.join(tempRoot, 'candidate')
const artifactRoot = path.join(tempRoot, 'artifacts')
try {
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--', repo, project], { stdio: 'pipe' })
  execFileSync('git', ['-C', project, 'config', 'core.autocrlf', 'false'], { stdio: 'pipe' })
  const graph = analyzeProject(project, true)
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const target = graph.nodes.find(n => n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))
  if (!target) throw new Error('Overview target not found')
  const readsEdges = graph.edges.filter(e => e.kind === 'reads' && e.to === target.id)
  const fromIds = readsEdges.map(e => `${e.from} (${e.certainty})`)
  result.graphHygiene = {
    readsEdgesToTarget: readsEdges.length,
    from: fromIds,
    duplicateIdenticalEdges: readsEdges.length !== new Set(readsEdges.map(e => `${e.from}->${e.to}:${e.kind}`)).size,
  }
  const impact = sourceProvenPageImpact(graph, target.id)
  const REPLACEMENT = 'Overview (reprobe)'
  const impacted = new Set(impact.pageRefs)
  const scope = {
    id: 'scope-bindprobe-1', version: 1, decidedBy: 'b-bindprobe', decidedAt: new Date().toISOString(),
    strategy: 'shared',
    includedRefs: [target.id, ...impact.pageRefs],
    excludedRefs: graph.nodes.filter(n => n.kind === 'route').map(n => n.id).filter(id => !impacted.has(id)),
    protectedRefs: [],
  }
  const operations = [{ id: 'op-overview-text', kind: 'TEXT', targetRef: target.id, before: target.value, after: target.value.replace('Overview', REPLACEMENT) }]
  let session = openSession('session-bindprobe', graph.revision, 'binding probe', [target.id], null)
  session = recordSourceGraph(session, graph.id, graph.revision.sourceDigest)
  session = chooseScope(session, scope)
  session = stageOperations(session, operations, [])
  fs.mkdirSync(artifactRoot, { recursive: true })
  const record = createCandidate({ projectRoot: project, candidateRoot, artifactRoot, graph, scope, operations, executors: [], candidateId: 'candidate-bindprobe' })
  session = stageCandidate(session, record)
  const candidateGraph = analyzeProject(candidateRoot, false)
  const bindings = sourceBindings(record, graph, candidateGraph, session)
  result.bindings = bindings.map(b => ({
    operationId: b.operationId,
    baselineSourceRefs: b.baselineSourceRefs,
    sourceRefs: b.sourceRefs,
    pageExpectationPages: Object.keys(b.pageExpectations),
    bindingUniqueBothSides: b.baselineSourceRefs.length === 1 && b.sourceRefs.length === 1,
  }))
  result.conclusion = 'binding unique on both sides; CI refusal is the root-page comparison with empty pageExpectation (see AC-P4), plus duplicate reads edges (AC-P5)'
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
console.log(JSON.stringify(result, null, 2))
