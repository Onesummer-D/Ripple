// Golden check of the committed synthetic examples in test/fixtures/visual-evidence.
// They prove the image and geometry algorithms only; they are not browser
// evidence and not acceptance of any real project.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeVisualDifference, serializeVisualEvidence, type VisualDifferenceEvidence } from './visual-evidence'
import { buildVisualFixtureCases, comparableEvidence, requestFromFixtureInput, type VisualFixtureInput } from './visual-evidence-fixtures'
import { readPng, sha256Hex } from './visual-png'

const root = fileURLToPath(new URL('../../test/fixtures/visual-evidence', import.meta.url))
const cases = buildVisualFixtureCases()

const EXPECTED: Record<string, { result: string; outcome: 'changed' | 'unchanged' | null; reasons?: string[]; findings?: string[] }> = {
  'target-text-change': { result: 'unknown', outcome: 'changed', findings: ['change-inside-target'] },
  'non-target-change': { result: 'unknown', outcome: 'changed', findings: ['change-inside-target', 'change-outside-target'] },
  'geometric-overlap': { result: 'risk', outcome: 'changed', findings: ['change-inside-target', 'geometry-risk', 'geometry-risk'] },
  'dpr-mismatch': { result: 'unknown', outcome: null, reasons: ['device-pixel-ratio-mismatch', 'image-size-mismatch'] },
  'page-extent-changed': { result: 'unknown', outcome: null, reasons: ['image-size-mismatch'] },
  'screenshot-missing': { result: 'not-run', outcome: null, reasons: ['screenshot-missing', 'capture-incomplete'] },
  'corrupt-png': { result: 'failed-to-run', outcome: null, reasons: ['screenshot-hash-mismatch', 'screenshot-invalid'] },
  'interaction-state-mismatch': { result: 'unknown', outcome: null, reasons: ['interaction-state-mismatch'] },
  'unchanged-insufficient-evidence': { result: 'unknown', outcome: 'unchanged', findings: ['no-visual-change'] },
  'identity-stale': { result: 'stale', outcome: null, reasons: ['identity-stale'] },
  'antialias-noise': { result: 'unknown', outcome: 'unchanged', findings: ['no-visual-change', 'target-visually-unchanged'] },
  'target-unmapped': { result: 'unknown', outcome: 'changed', findings: ['change-unattributed'] },
}

describe('committed visual-difference examples', () => {
  it('covers every generated case and nothing else', () => {
    expect(cases.map(item => item.name).sort()).toEqual(Object.keys(EXPECTED).sort())
    const committed = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    expect(committed).toEqual(Object.keys(EXPECTED).sort())
  })

  for (const fixture of cases) {
    it(`${fixture.name}: committed inputs reproduce the committed evidence`, () => {
      const dir = path.join(root, fixture.name)
      const read = (name: string) => new Uint8Array(fs.readFileSync(path.join(dir, name)))
      const input = JSON.parse(fs.readFileSync(path.join(dir, 'input.json'), 'utf8')) as VisualFixtureInput
      // The generator is deterministic at the pixel level (PNG bytes may differ by zlib version).
      for (const [name, bytes] of Object.entries(fixture.files)) {
        const committed = readPng(read(name))
        if (fixture.pixelDigests[name] && readPng(bytes).ok) {
          expect(committed.ok && committed.png.pixelSha256).toBe(fixture.pixelDigests[name])
        } else {
          expect(committed.ok).toBe(false)
          expect(read(name).length).toBe(bytes.length)
        }
      }
      const { evidence, diffPng } = analyzeVisualDifference(requestFromFixtureInput(input, read))
      const committedEvidence = JSON.parse(fs.readFileSync(path.join(dir, 'expected-evidence.json'), 'utf8')) as VisualDifferenceEvidence
      expect(comparableEvidence(evidence)).toEqual(comparableEvidence(committedEvidence))

      const expectation = EXPECTED[fixture.name]
      expect(evidence.result).toBe(expectation.result)
      expect(evidence.result).not.toBe('pass')
      expect(evidence.observation?.outcome ?? null).toBe(expectation.outcome)
      if (expectation.reasons) expect(evidence.comparability.reasons.map(reason => reason.code)).toEqual(expectation.reasons)
      if (expectation.findings) expect(evidence.findings.map(finding => finding.code)).toEqual(expectation.findings)
      // Provenance labels keep synthetic examples from passing as browser evidence.
      expect(evidence.inputs.baseline.descriptor.browser?.name ?? 'synthetic-scene-renderer').toBe('synthetic-scene-renderer')
      expect(evidence.inputs.baseline.descriptor.pageUrl).toMatch(/\.invalid\//)

      const diffPath = path.join(dir, 'diff.png')
      if (evidence.observation?.diffImage) {
        expect(diffPng).not.toBeNull()
        const committedDiff = new Uint8Array(fs.readFileSync(diffPath))
        const decoded = readPng(committedDiff)
        expect(decoded.ok && decoded.png.pixelSha256).toBe(evidence.observation.diffImage.pixelSha256)
        // The committed diff is the one the committed evidence describes.
        expect(sha256Hex(committedDiff)).toBe(committedEvidence.observation!.diffImage!.sha256)
        expect(committedDiff.length).toBe(committedEvidence.observation!.diffImage!.sizeBytes)
      } else {
        expect(diffPng).toBeNull()
        expect(fs.existsSync(diffPath)).toBe(false)
      }
      expect(serializeVisualEvidence(committedEvidence).text).toBe(fs.readFileSync(path.join(dir, 'expected-evidence.json'), 'utf8'))
    })
  }

  it('lists every committed file with its SHA-256 in the manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { cases: Array<{ name: string; files: Record<string, string> }>; provenance: string }
    expect(manifest.provenance).toMatch(/not browser evidence/)
    for (const entry of manifest.cases) {
      const dir = path.join(root, entry.name)
      expect(fs.readdirSync(dir).sort()).toEqual(Object.keys(entry.files).sort())
      for (const [name, digest] of Object.entries(entry.files)) expect(sha256Hex(fs.readFileSync(path.join(dir, name)))).toBe(digest)
    }
  })
})
