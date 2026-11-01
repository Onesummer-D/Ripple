#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const expectedSha = '5291ecbfedd72f5ffcb4fc2afb4d7bf8d31836a1'
const expectedTree = '1b398d5b4d33df256d3cd70829c0819742bbe69c'
const providedSha = process.argv.find(arg => arg.startsWith('--a-sha='))?.slice('--a-sha='.length) ?? expectedSha
const providedTree = process.argv.find(arg => arg.startsWith('--a-tree='))?.slice('--a-tree='.length) ?? expectedTree
const providedRoot = process.argv.find(arg => arg.startsWith('--a-root='))?.slice('--a-root='.length)
const aRoot = resolve(providedRoot ?? resolve(here, '..', '..', '..', '..', 'acp6-browser-observation-docs-20261030'))

const requiredFiles = [
  'docs/acceptance/2026-10-31/run-final-observation-vectors.mjs',
  'docs/acceptance/2026-10-31/canonical-observation-digest.ps1',
  'docs/acceptance/2026-10-31/validate-final-schemas.mjs',
  'docs/acceptance/2026-10-31/compare-final-reports.mjs',
  'docs/acceptance/2026-10-31/acp6-observation-v2-final-manifest.json',
  'docs/acceptance/2026-10-31/acp6-observation-v2-compatibility-matrix.json',
  'docs/acceptance/2026-11-01/legacy-history/negative-missing-relation-source-identity.v0.json',
  'docs/acceptance/2026-10-31/vectors/negative-missing-relation-source-identity.json',
  'docs/acceptance/2026-10-31/vectors/negative-forged-source-identity.json',
  'docs/acceptance/2026-10-31/vectors/negative-opaque-node-relation.json',
  'docs/acceptance/2026-10-31/vectors/negative-source-ref-no-mapping.json',
  'docs/acceptance/2026-10-31/vectors/negative-missing-source-mappings.json',
  'docs/acceptance/2026-10-31/vectors/negative-forged-source-mappings.json',
  'docs/acceptance/2026-10-31/vectors/negative-old-source-digest.json',
  'docs/acceptance/2026-10-31/vectors/negative-missing-source-anchor.json',
  'docs/acceptance/2026-10-31/vectors/negative-nonunique-source-anchor.json',
  'docs/acceptance/2026-10-31/vectors/negative-source-use-location.json',
  'docs/acceptance/2026-10-31/vectors/g0-project-mismatch.json',
  'docs/acceptance/2026-10-31/vectors/g0-semantic-candidate.json',
]

const requiredGates = [
  'negative-missing-relation-source-identity.json',
  'negative-forged-source-identity.json',
  'negative-opaque-node-relation.json',
  'negative-source-ref-no-mapping.json',
]

const expandedMigrationCases = [
  'negative-missing-source-mappings.json',
  'negative-forged-source-mappings.json',
  'negative-old-source-digest.json',
  'negative-missing-source-anchor.json',
  'negative-nonunique-source-anchor.json',
  'negative-source-use-location.json',
  'g0-project-mismatch.json',
  'g0-semantic-candidate.json',
]

function gitValue(args) {
  try {
    return execFileSync('git', ['-C', aRoot, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const actualSha = gitValue(['rev-parse', 'HEAD'])
const actualTree = gitValue(['rev-parse', 'HEAD^{tree}'])
const worktreeStatus = gitValue(['status', '--porcelain'])
const worktreeClean = worktreeStatus === ''
const filesPresent = requiredFiles.every(file => existsSync(resolve(aRoot, file)))
const exactShaMatch = providedSha === expectedSha && actualSha === expectedSha
const exactTreeMatch = providedTree === expectedTree && actualTree === expectedTree
const status = exactShaMatch && exactTreeMatch && worktreeClean && filesPresent ? 'prepared-not-executed' : 'blocked'

const result = {
  protocol: 'acp6-d-a5291-eobs02-execution-prep/v1',
  status,
  expectedSha,
  providedSha,
  actualSha,
  expectedTree,
  providedTree,
  actualTree,
  exactShaMatch,
  exactTreeMatch,
  worktreeClean,
  filesPresent,
  requiredFiles,
  contractVersions: {
    graphIdentityVersion: 'sourcegraph-identity/v2',
    graphSchemaVersion: 'acp6-sourcegraph/v1',
    relationIdentityVersion: 'relation-id/v1',
    sourceMappingVersion: 'sourcegraph-source-mapping/v1',
    observationBindingVersion: 'sourcegraph-observation-binding/v1',
  },
  requiredGates: requiredGates.map(fixture => ({
    fixture,
    prepared: filesPresent && existsSync(resolve(aRoot, `docs/acceptance/2026-10-31/vectors/${fixture}`)),
    executed: false,
    passed: false,
  })),
  expandedMigrationCases: expandedMigrationCases.map(fixture => ({
    fixture,
    prepared: filesPresent && existsSync(resolve(aRoot, `docs/acceptance/2026-10-31/vectors/${fixture}`)),
    executed: false,
    passed: false,
  })),
  execution: {
    runnerSet: ['Node', 'PowerShell', 'Schema parity', 'Dual report'],
    formalExecution: false,
    requiredNegativeExecuted: false,
    requiredNegativePassed: false,
    blockReason: worktreeClean
      ? 'A independent archive and E explicit sign-off are pending; this preparation script never runs the four validators'
      : 'A worktree is dirty; materialize the exact archived commit before any validator can run',
  },
  preservedStatuses: {
    eObs02: 'blocked',
    dualReport: 'blocked',
    n01N32: 'not-executed',
    productionWrites: false,
  },
}

console.log(JSON.stringify(result, null, 2))
if (status !== 'prepared-not-executed') process.exitCode = 1

