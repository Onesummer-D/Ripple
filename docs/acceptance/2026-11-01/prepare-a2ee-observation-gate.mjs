#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv.find(arg => arg.startsWith('--root='))?.slice('--root='.length) ?? resolve(here, '..', '..', '..', '..'))
const expectedSha = '2ee08975c891abb1df5ff38881326e78ead28076'
const expectedTree = '60e397f075f8a1d62226d6a736993580b48df9ad'

function gitValue(args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const evidenceHead = gitValue(['rev-parse', 'HEAD'])
const testedTree = gitValue(['rev-parse', `${expectedSha}^{tree}`])
let testedShaIsAncestor = false
try {
  execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', expectedSha, 'HEAD'])
  testedShaIsAncestor = true
} catch {
  testedShaIsAncestor = false
}
const changedFiles = gitValue(['diff', '--name-only', expectedSha, 'HEAD'])
  ?.split(/\r?\n/)
  .filter(Boolean) ?? []
const changedFilesEvidenceOnly = changedFiles.every(path => path.startsWith('docs/acceptance/2026-11-01/'))
const worktreeClean = gitValue(['status', '--porcelain']) === ''
const matrixPath = resolve(root, 'docs/acceptance/2026-11-01/acp6-d-2ee-safety-negative-matrix.json')
const reportPath = resolve(root, 'docs/acceptance/2026-11-01/acp6-d-2ee-offline-safety-revalidation-report.json')
const requiredPaths = [
  'docs/acceptance/2026-10-31/run-final-observation-vectors.mjs',
  'docs/acceptance/2026-10-31/canonical-observation-digest.ps1',
  'docs/acceptance/2026-10-31/validate-final-schemas.mjs',
  'docs/acceptance/2026-10-31/compare-final-reports.mjs',
  'docs/acceptance/2026-10-31/vectors/negative-missing-relation-source-identity.json',
  'docs/acceptance/2026-11-01/legacy-history/negative-missing-relation-source-identity.v0.json',
]
const requiredPathsPresent = requiredPaths.every(path => existsSync(resolve(root, path)))

let matrix = null
let report = null
try {
  matrix = JSON.parse(readFileSync(matrixPath, 'utf8'))
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch {
  // The output below remains blocked when evidence files are absent or malformed.
}

const matrixValid = matrix?.testSha === expectedSha
  && matrix?.testTree === expectedTree
  && matrix?.rows?.length === 63
  && matrix?.requiredGates?.total === 63
  && matrix?.rows?.every(row => row.executed === true && row.passed === true && row.testSha === expectedSha && row.eIndependentSignoff === false)
const reportValid = report?.testSha === expectedSha
  && report?.testTree === expectedTree
  && report?.summary?.requiredNegativeCaseCount === 63
  && report?.summary?.requiredNegativeExecutedCount === 63
  && report?.summary?.passed === true
  && report?.EIndependentSignoff === false
  && report?.productionWrites === false
const status = testedShaIsAncestor && testedTree === expectedTree && worktreeClean && changedFilesEvidenceOnly && requiredPathsPresent && matrixValid && reportValid
  ? 'revalidated-offline-awaiting-E'
  : 'blocked'

const result = {
  protocol: 'acp6-d-a2ee-observation-gate-prep/v1',
  status,
  expectedSha,
  testedSha: expectedSha,
  evidenceHead,
  expectedTree,
  testedTree,
  exactShaMatch: testedShaIsAncestor,
  exactTreeMatch: testedTree === expectedTree,
  changedFiles,
  changedFilesEvidenceOnly,
  worktreeClean,
  requiredPathsPresent,
  matrixValid,
  reportValid,
  requiredNegative: {
    count: matrix?.rows?.length ?? 0,
    executed: matrix?.rows?.every(row => row.executed === true) ?? false,
    passed: matrix?.rows?.every(row => row.passed === true) ?? false,
    eIndependentSignoff: false,
  },
  runners: ['Node', 'PowerShell', 'Schema parity', 'Dual report'],
  formalN01N32Execution: false,
  productionWrites: false,
  historicalEOBS02Preserved: requiredPathsPresent,
}

console.log(JSON.stringify(result, null, 2))
if (status === 'blocked') process.exitCode = 1
