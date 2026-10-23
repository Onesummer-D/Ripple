// Regenerates the synthetic visual-difference fixtures under
// test/fixtures/visual-evidence from src/core/visual-evidence-fixtures.ts.
//
//   npm run fixtures:visual-evidence
//
// The output proves the image/geometry algorithms only. It is not browser
// evidence and not acceptance of any real project.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { buildVisualFixtureCases, requestFromFixtureInput } = await import('../src/core/visual-evidence-fixtures.ts')
const { analyzeVisualDifference, serializeVisualEvidence } = await import('../src/core/visual-evidence.ts')

const outputRoot = path.join(root, 'test', 'fixtures', 'visual-evidence')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = { schema: 'ripple-visual-fixture-manifest/v1', generator: 'scripts/generate-visual-evidence-fixtures.mjs', source: 'src/core/visual-evidence-fixtures.ts', provenance: 'synthetic-scene-renderer (no browser, no fonts); not browser evidence, not project acceptance', cases: [] }

for (const fixture of buildVisualFixtureCases()) {
  const dir = path.join(outputRoot, fixture.name)
  fs.mkdirSync(dir, { recursive: true })
  const written = {}
  const write = (name, bytes) => { fs.writeFileSync(path.join(dir, name), bytes); written[name] = sha256(bytes) }
  for (const [name, bytes] of Object.entries(fixture.files)) write(name, bytes)
  write('input.json', `${JSON.stringify(fixture.input, null, 2)}\n`)
  const { evidence, diffPng } = analyzeVisualDifference(requestFromFixtureInput(fixture.input, name => fixture.files[name]))
  const stalePath = path.join(dir, 'diff.png')
  if (diffPng) write('diff.png', diffPng)
  else if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath)
  write('expected-evidence.json', serializeVisualEvidence(evidence).text)
  manifest.cases.push({ name: fixture.name, description: fixture.input.description, result: evidence.result, files: written })
  console.log(`${fixture.name.padEnd(34)} ${evidence.result.padEnd(14)} ${evidence.observation ? `${evidence.observation.outcome} ${evidence.observation.changedPixels}px ${evidence.observation.regionCount} region(s)` : evidence.comparability.reasons.map(reason => reason.code).join(',')}`)
}
fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
