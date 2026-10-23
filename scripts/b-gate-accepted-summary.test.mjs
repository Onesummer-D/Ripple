// P0-1 正例测试：所有真实校验成功时必须 pass === true；
// 任一布尔项为 false、混入非布尔元数据、或候选未创建时必须 pass === false。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptedPass } from './b-gate-accepted-summary.mjs'

const allTrueAcceptance = () => ({
  created: true,
  verification: {
    recordShapeOk: true,
    modifiedTarget: true,
    patchHashMatchesBytes: true,
    markerMatchesRecord: true,
    candidateBytesExactEdit: true,
    candidateTreeDigestMatches: true,
  },
  scopeVerification: {
    actualScopePresent: true,
    actualScopeIsFullScope: true,
    targetIncluded: true,
    allImpactedPagesIncluded: true,
    unimpactedRoutesExplicitlyExcluded: true,
    noProtectedRefs: true,
  },
})

const allTruePostChecks = () => ({
  callerRepoDigestUnchanged: true,
  callerRepoWorktreesUnchanged: true,
  callerProjectCleanAfterCandidateRemoval: true,
  noOwnedWorktreeLeft: true,
})

test('正例：全部校验成功时 pass === true', () => {
  assert.equal(acceptedPass(allTrueAcceptance(), allTruePostChecks()), true)
})

test('负例：任一校验失败则 pass === false', () => {
  for (const mutate of [
    (a) => { a.verification.patchHashMatchesBytes = false },
    (a) => { a.scopeVerification.allImpactedPagesIncluded = false },
    (a) => { a.verification.unexpectedNull = null },
  ]) {
    const acceptance = allTrueAcceptance()
    mutate(acceptance)
    assert.equal(acceptedPass(acceptance, allTruePostChecks()), false, `mutate=${mutate.toString()}`)
  }
  assert.equal(acceptedPass(allTrueAcceptance(), { ...allTruePostChecks(), noOwnedWorktreeLeft: false }), false)
})

test('负例：候选未创建（含异常路径）永远 pass === false', () => {
  const withError = { created: false, error: { errorName: 'CandidateError', message: '…', isCandidateError: true } }
  assert.equal(acceptedPass(withError, allTruePostChecks()), false)
  assert.equal(acceptedPass(undefined, allTruePostChecks()), false)
})

test('P0-1 回归：字符串元数据（如 coreSha）混入布尔组时不得让真成功变失败', () => {
  // 元数据若在组内，every(v===true) 必为 false —— 本组只收布尔，元数据应在组外信封上
  const acceptance = allTrueAcceptance()
  assert.equal(acceptedPass(acceptance, allTruePostChecks()), true)
  assert.equal('coreSha' in acceptance.scopeVerification, false)
  assert.equal('coreSha' in (acceptance.verification ?? {}), false)
})
