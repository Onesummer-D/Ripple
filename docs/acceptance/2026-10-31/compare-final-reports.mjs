#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const nodeReport = JSON.parse(await readFile(resolve(here, 'acp6-observation-v2-final-digest-report.json'), 'utf8'))
const powershellReport = JSON.parse(await readFile(resolve(here, 'acp6-observation-v2-final-powershell-report.json'), 'utf8'))
const schemaReport = JSON.parse(await readFile(resolve(here, 'acp6-observation-v2-final-schema-report.json'), 'utf8'))
const sourceIdentityNegative = [
  nodeReport.vectors?.missingRelationSourceIdentityRejected,
  nodeReport.vectors?.forgedSourceIdentityRejected,
  nodeReport.vectors?.opaqueNodeRelationRejected,
  nodeReport.vectors?.sourceRefNoMappingRejected,
  powershellReport.negative?.['missing-relation-source-identity'],
  powershellReport.negative?.['forged-source-identity'],
  powershellReport.negative?.['opaque-node-relation'],
  powershellReport.negative?.['source-ref-no-mapping'],
  ...(schemaReport.cases ?? []).filter(item => ['negative-missing-relation-source-identity.json', 'negative-forged-source-identity.json', 'negative-opaque-node-relation.json', 'negative-source-ref-no-mapping.json'].includes(item.name)),
]
const sourceIdentityNegativeExecuted = sourceIdentityNegative.length === 12 && sourceIdentityNegative.every(item => item?.executed === true && item?.status === 'passed' && item?.pass === true)
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
  SourceIdentityNegativeExecuted: sourceIdentityNegativeExecuted,
}
const corePassed = Object.values(checks).every(Boolean)
const result = {
  status: corePassed ? 'passed' : 'failed',
  executionSummary: { prepared: true, executed: true, passed: corePassed, failed: !corePassed, blocked: false, requiredNegativeCaseCount: sourceIdentityNegative.length, requiredNegativeExecutedCount: sourceIdentityNegative.filter(item => item?.executed === true).length },
  checks,
  sourceIdentityNegative: { id: 'E-OBS-02', fixtures: ['negative-missing-relation-source-identity.json', 'negative-forged-source-identity.json', 'negative-opaque-node-relation.json', 'negative-source-ref-no-mapping.json'], expected: 'all fail-closed and executed', status: sourceIdentityNegativeExecuted ? 'passed' : 'failed' },
  nodeHeadIndependent: true,
  powershellDotNetIndependent: true,
}
await writeFile(resolve(here, 'acp6-observation-v2-final-dual-report.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
if (result.status !== 'passed') process.exitCode = 1
