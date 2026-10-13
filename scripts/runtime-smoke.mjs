import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { caseOrder, fixtures } from '../src/cases/fixtures.ts'
import { truthMatrix } from '../src/cases/truthMatrix.ts'
import { affectedInstanceIdsFor, impactProjection, projectValues, routePreviewProjection } from '../src/app/selectors.ts'
import { applyDraft, chooseScope, createRuntime, restorePrevious, selectSlot, setCandidate } from '../src/domain/state.ts'
import { parseRealCasePackage } from '../src/adapters/realEvidenceAdapter.ts'
import { validateFixture } from '../src/verification/fixtureValidator.ts'

const root = process.cwd()
const workspace = path.resolve(root, '..', '..')
const acceptanceDate = process.env.RIPPLE_ACCEPTANCE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const results = []
const check = (name, condition, detail = 'pass') => {
  assert.ok(condition, `${name}: ${detail}`)
  results.push({ name, detail })
}

const runtimeResults = caseOrder.map((caseId, index) => {
  const fixture = fixtures[caseId]
  const matrix = truthMatrix.find((item) => item.caseId === caseId)
  const selectedSlot = fixture.slots.find((item) => item.id === matrix?.selectedSlotId) ?? fixture.slots[0]
  const initialValues = Object.fromEntries(fixture.slots.map((item) => [item.id, item.value]))
  const candidate = {
    id: `${caseId}-runtime-smoke-candidate`,
    caseId,
    instanceId: selectedSlot.instanceId,
    slotId: selectedSlot.id,
    sourceId: selectedSlot.sourceId,
    oldValue: selectedSlot.value,
    newValue: `runtime-${index + 1}`,
    editKind: selectedSlot.editKind,
  }
  const mode = index % 2 === 0 ? 'INSTANCE' : 'SHARED'
  const decision = {
    id: `${caseId}-runtime-smoke-scope`,
    caseId,
    mode,
    affectedInstanceIds: affectedInstanceIdsFor(fixture, candidate, mode),
    candidateEditId: candidate.id,
  }
  const applied = applyDraft(
    chooseScope(setCandidate(selectSlot(createRuntime(fixture), selectedSlot.id), candidate), decision, mode),
    fixture,
    '2026-10-12T00:00:00.000Z',
  )
  const projection = impactProjection(fixture, applied.snapshots[0]?.decision)
  const routePreviews = routePreviewProjection(projectValues(fixture, applied.draftValues), applied.snapshots[0]?.decision)
  const restored = restorePrevious(applied, fixture)
  const expectedRoutes = matrix?.[mode === 'INSTANCE' ? 'instanceModeRoutes' : 'sharedModeRoutes'] ?? []
  const excludedRoutes = matrix?.excludedRoutes ?? []
  const changedRoutes = fixture.slots.filter((item) => applied.draftValues[item.id] === candidate.newValue).map((item) => item.route)
  const unchangedRoutes = fixture.slots.filter((item) => applied.draftValues[item.id] === initialValues[item.id]).map((item) => item.route)
  return {
    caseId,
    mode,
    snapshotId: applied.currentSnapshotId,
    affectedInstanceIds: decision.affectedInstanceIds,
    projectedNodes: projection.nodes.length,
    projectedRoutes: projection.nodes.map((item) => item.route),
    routePreviewRoutes: routePreviews.filter((item) => item.affected).map((item) => item.route),
    expectedRoutes,
    excludedRoutes,
    changedRoutes,
    unchangedRoutes,
    restoredSnapshotId: restored.currentSnapshotId,
    restoredValues: restored.draftValues,
    initialValues,
  }
})

check('fixture validation', caseOrder.every((caseId) => validateFixture(fixtures[caseId]).length === 0))
check('three case runtime flows', runtimeResults.length === 3 && runtimeResults.every((item) => item.snapshotId?.includes('-snapshot-1') && item.changedRoutes.slice().sort().join('|') === item.expectedRoutes.slice().sort().join('|') && item.projectedRoutes.slice().sort().join('|') === item.expectedRoutes.slice().sort().join('|')))
check('route preview projections match impact', runtimeResults.every((item) => item.routePreviewRoutes.slice().sort().join('|') === item.expectedRoutes.slice().sort().join('|')))
const scopeProbeFixture = fixtures.qingye
const scopeProbeSlot = scopeProbeFixture.slots.find((item) => item.id === truthMatrix.find((entry) => entry.fixtureId === 'F01')?.selectedSlotId) ?? scopeProbeFixture.slots[0]
const scopeProbeCandidate = { id: 'scope-probe', caseId: 'qingye', instanceId: scopeProbeSlot.instanceId, slotId: scopeProbeSlot.id, sourceId: scopeProbeSlot.sourceId, oldValue: scopeProbeSlot.value, newValue: 'scope-probe-value', editKind: scopeProbeSlot.editKind }
const instanceProbe = affectedInstanceIdsFor(scopeProbeFixture, scopeProbeCandidate, 'INSTANCE')
const sharedProbe = affectedInstanceIdsFor(scopeProbeFixture, scopeProbeCandidate, 'SHARED')
check('instance/shared projections differ', instanceProbe.length === 1 && sharedProbe.length === 3 && instanceProbe.every((id) => sharedProbe.includes(id)))
check('restore returns initial values', runtimeResults.every((item) => item.restoredSnapshotId === undefined && JSON.stringify(item.restoredValues) === JSON.stringify(item.initialValues)))
check('negative routes remain unchanged', runtimeResults.every((item) => item.excludedRoutes.every((route) => item.unchangedRoutes.includes(route) && !item.changedRoutes.includes(route) && !item.projectedRoutes.includes(route))))
const immutableBefore = Object.fromEntries(caseOrder.map((caseId) => [caseId, JSON.stringify(fixtures[caseId].slots)]))
caseOrder.forEach((caseId) => projectValues(fixtures[caseId], { [fixtures[caseId].slots[0].id]: 'immutable-probe' }))
check('selector value projection is immutable', caseOrder.every((caseId) => JSON.stringify(fixtures[caseId].slots) === immutableBefore[caseId]))

const unknownEvidence = parseRealCasePackage({ caseId: 'third-party', evidence: [{}] })
check('real adapter preserves unknown evidence', unknownEvidence.package?.evidence?.[0]?.verification === 'unknown' && unknownEvidence.package.evidence[0].origin === 'real')
check('real adapter reports malformed input', unknownEvidence.issues.some((issue) => issue.path === 'evidence[0]'))

const evidenceDirectory = path.join(workspace, 'docs', 'acceptance', acceptanceDate, 'evidence')
fs.mkdirSync(evidenceDirectory, { recursive: true })
const report = {
  command: 'node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/runtime-smoke.mjs',
  acceptanceDate,
  generatedAt: new Date().toISOString(),
  checks: results,
  cases: runtimeResults,
  skipped: 0,
}
fs.writeFileSync(path.join(evidenceDirectory, 'node-runtime-smoke.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
