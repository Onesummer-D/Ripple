#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const nodeReport = JSON.parse(await readFile(resolve(here, 'acp6-observation-v2-final-digest-report.json'), 'utf8'))
const powershellReport = JSON.parse(await readFile(resolve(here, 'acp6-observation-v2-final-powershell-report.json'), 'utf8'))
const schemaReport = JSON.parse(await readFile(resolve(here, 'acp6-observation-v2-final-schema-report.json'), 'utf8'))
const requiredPending = [
  nodeReport.pending?.missingRelationSourceIdentity,
  powershellReport.pending?.['missing-relation-source-identity'],
  schemaReport.pending?.['missing-relation-source-identity'],
]
const requiredPendingPresent = requiredPending.every(item => item?.required === true && item?.fixtureLoaded !== false && item?.status === 'blocked')
const requiredPendingExecuted = requiredPendingPresent && requiredPending.every(item => item.executed === true && item.status === 'passed')
const checks = {
  G0Digest: nodeReport.vectors.G0.digest === powershellReport.G0.digest,
  G0CanonicalBytes: nodeReport.vectors.G0.canonicalBytesSha256 === powershellReport.G0.canonicalBytesSha256 && nodeReport.vectors.G0.canonicalBytesBase64 === powershellReport.G0.canonicalBytesBase64,
  G4Digest: nodeReport.vectors.G4.digest === powershellReport.G4.digest,
  G4CanonicalBytes: nodeReport.vectors.G4.canonicalBytesSha256 === powershellReport.G4.canonicalBytesSha256 && nodeReport.vectors.G4.canonicalBytesBase64 === powershellReport.G4.canonicalBytesBase64,
  B0Digest: nodeReport.vectors.B0.digest === powershellReport.B0.digest,
  B0CanonicalBytes: nodeReport.vectors.B0.canonicalBytesSha256 === powershellReport.B0.canonicalBytesSha256 && nodeReport.vectors.B0.canonicalBytesBase64 === powershellReport.B0.canonicalBytesBase64,
  NegativeCases: Object.values(nodeReport.negative).every(item => item.pass) && Object.values(powershellReport.negative).every(item => item.pass),
  ReasonCodeClosedSet: nodeReport.reasonCodeClosedSet?.pass === true && powershellReport.reasonCodeClosedSet?.pass === true,
  SchemaParity: Object.values(schemaReport.checks ?? {}).every(Boolean) && (schemaReport.cases ?? []).every(item => item.pass === true),
  ArtifactPathCases: nodeReport.vectors.artifactPathCasesPass && powershellReport.artifactPathCases.every(item => item.pass),
  CaptureFormatCases: nodeReport.vectors.captureFormatCasesPass && powershellReport.captureFormatCases.every(item => item.pass),
  RequiredPendingNegativePresent: requiredPendingPresent,
  RequiredNegativeExecuted: requiredPendingExecuted,
}
const corePassed = Object.entries(checks).filter(([name]) => name !== 'RequiredNegativeExecuted').every(([, value]) => value)
const result = {
  status: !corePassed ? 'failed' : (requiredPendingExecuted ? 'passed' : 'blocked'),
  executionSummary: { prepared: true, executed: true, passed: corePassed && requiredPendingExecuted, failed: !corePassed, blocked: corePassed && !requiredPendingExecuted, requiredNegativeCaseCount: requiredPending.length, requiredNegativeExecutedCount: requiredPending.filter(item => item?.executed === true).length },
  checks,
  requiredPending: { id: 'E-OBS-02', fixture: 'negative-missing-relation-source-identity.json', expectedReasonCode: 'graph-schema-invalid', expectedObservationStatus: 'unavailable', status: requiredPendingExecuted ? 'passed' : 'blocked' },
  nodeHeadIndependent: true,
  powershellDotNetIndependent: true,
}
await writeFile(resolve(here, 'acp6-observation-v2-final-dual-report.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
if (result.status !== 'passed') process.exitCode = 1
