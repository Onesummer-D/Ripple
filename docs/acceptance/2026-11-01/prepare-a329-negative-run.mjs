#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const expectedSha = '329028d8226dad1a637b1a5d4cd232457b3374d0'
const providedSha = process.argv.find(arg => arg.startsWith('--a-sha='))?.slice('--a-sha='.length) ?? expectedSha
const providedRoot = process.argv.find(arg => arg.startsWith('--a-root='))?.slice('--a-root='.length)
const aRoot = resolve(providedRoot ?? resolve(here, '..', '..', '..', '..', 'acp6-browser-observation-docs-20261030'))
let actualSha = null
try {
  actualSha = execFileSync('git', ['-C', aRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  actualSha = null
}
const requiredFiles = [
  'docs/acceptance/2026-10-31/run-final-observation-vectors.mjs',
  'docs/acceptance/2026-10-31/canonical-observation-digest.ps1',
  'docs/acceptance/2026-10-31/validate-final-schemas.mjs',
  'docs/acceptance/2026-10-31/compare-final-reports.mjs',
  'docs/acceptance/2026-10-31/vectors/negative-missing-relation-source-identity.json',
]
const filesPresent = requiredFiles.every(file => existsSync(resolve(aRoot, file)))
const exactShaMatch = providedSha === expectedSha && actualSha === expectedSha
const result = {
  protocol: 'acp6-a329-eobs02-execution-prep/v1',
  status: exactShaMatch && filesPresent ? 'prepared-not-executed' : 'blocked',
  expectedSha,
  providedSha,
  actualSha,
  exactShaMatch,
  filesPresent,
  requiredFiles,
  runnerSet: ['Node', 'PowerShell', 'Schema parity', 'Dual report'],
  requiredNegative: {
    id: 'E-OBS-02',
    fixture: 'negative-missing-relation-source-identity.json',
    expectedReasonCode: 'graph-schema-invalid',
    expectedObservationStatus: 'unavailable',
    executed: false,
    passed: false,
  },
  productionWrites: false,
  formalExecution: false,
}
console.log(JSON.stringify(result, null, 2))
if (result.status !== 'prepared-not-executed') process.exitCode = 1
