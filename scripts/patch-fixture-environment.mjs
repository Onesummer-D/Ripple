// One-off integration helper: restore the machine-dependent `environment`
// block of regenerated golden evidence files from the previously committed
// versions, so CI (Node 22.22.0 pinned) keeps byte-for-byte reproducibility.
// Usage: node scripts/patch-fixture-environment.mjs <commit-ish>
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const base = process.argv[2] ?? 'HEAD'
const dir = 'test/fixtures/visual-evidence'
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name, 'expected-evidence.json')
  if (!fs.existsSync(file)) continue
  const old = JSON.parse(execFileSync('git', ['show', `${base}:${file.replaceAll('\\', '/')}`], { encoding: 'utf8' }))
  const current = JSON.parse(fs.readFileSync(file, 'utf8'))
  current.environment = old.environment
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`)
}
// The manifest pins SHA-256 of every committed file; refresh it after patching.
const manifestPath = path.join(dir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const hash = data => createHash('sha256').update(data).digest('hex')
for (const entry of manifest.cases) {
  const written = {}
  for (const name of Object.keys(entry.files)) {
    written[name] = hash(fs.readFileSync(path.join(dir, entry.name, name)))
  }
  entry.files = written
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`environment blocks restored from ${base}; manifest hashes refreshed`)
