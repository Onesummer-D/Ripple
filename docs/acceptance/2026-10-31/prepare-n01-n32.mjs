#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, 'acp6-observation-v2-n01-n32-execution-manifest-2026-10-31.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const expectedIds = Array.from({ length: 32 }, (_, index) => `N${String(index + 1).padStart(2, '0')}`)
const errors = []

if (manifest.status !== 'prepared-not-executed') errors.push('manifest status must remain prepared-not-executed')
if (manifest.scope !== 'evidence-only; no production SourceGraph, VerificationRun, Runtime Identity or authorization writes') {
  errors.push('manifest scope is not evidence-only')
}
if (!Array.isArray(manifest.cases) || manifest.cases.length !== expectedIds.length) errors.push('case count must be exactly 32')
const ids = (manifest.cases ?? []).map(item => item.id)
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) errors.push('case IDs must be ordered N01 through N32')

for (const item of manifest.cases ?? []) {
  if (item.status !== 'not-executed') errors.push(`${item.id}: status must remain not-executed`)
  if (!item.expected?.primaryReasonCode || !item.expected?.observationStatus || item.expected?.proof !== 'not-proven') {
    errors.push(`${item.id}: expected reason/status/proof is incomplete`)
  }
  if (!item.gate) errors.push(`${item.id}: gate is missing`)
}

if (manifest.archiveLayout?.productionWrites !== false || manifest.archiveLayout?.sidecarOnly !== true) {
  errors.push('archive layout must be sidecar-only with productionWrites=false')
}

const result = {
  protocol: manifest.protocol,
  status: errors.length === 0 ? 'prepared-not-executed' : 'rejected',
  caseCount: manifest.cases?.length ?? 0,
  ids: { first: ids[0] ?? null, last: ids.at(-1) ?? null },
  productionWrites: false,
  errors,
  manifest: manifestPath,
}

const outArg = process.argv.find(arg => arg.startsWith('--out='))?.slice('--out='.length)
if (outArg) await writeFile(resolve(outArg), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result, null, 2))
if (errors.length) process.exitCode = 1

