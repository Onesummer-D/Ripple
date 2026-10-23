// Synthetic resource regression probes for Visual Difference Evidence.
// Run each in an independent Node 22 process, preferably under `/usr/bin/time -v`.
// This does NOT run the browser VerificationRunner or attest a real project.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { analyzeVisualDifference } from '../src/core/visual-evidence.ts'
import { clusterChangedPixels, MASK_CHANGED, VisualResourceLimitError } from '../src/core/visual-diff.ts'
import { encodePng, sha256Hex } from '../src/core/visual-png.ts'

const scenario = process.argv[2]
if (!['large-many-regions', 'dense-near-cap', 'grid-limit', 'component-limit', 'header-limit'].includes(scenario)) {
  throw new Error('Usage: benchmark-visual-evidence.mjs <large-many-regions|dense-near-cap|grid-limit|component-limit|header-limit>')
}
const observed = { scenario, source: 'synthetic resource benchmark, NOT browser evidence', node: process.version, platform: process.platform }
const start = performance.now()
const MB = 1024 * 1024
let lastRss = process.memoryUsage().rss
function sample() { lastRss = Math.max(lastRss, process.memoryUsage().rss) }
const identity = {
  candidateId: 'benchmark-candidate', patchHash: 'a'.repeat(64), baseSourceDigest: 'b'.repeat(64),
  candidateTreeDigest: 'c'.repeat(64), runtimeFingerprint: 'benchmark-runtime', scopeDecisionId: 'benchmark-scope', scopeVersion: 1,
}
function createRequest(width, height, a, b, grid) {
  const side = (name, screenshot) => ({
    descriptor: {
      side: name, route: '/', pageUrl: 'http://fixture.invalid/', viewport: { width, height: Math.min(height, 900) }, devicePixelRatio: 1,
      browser: { name: 'benchmark-renderer', version: '1' }, runtimeFingerprint: identity.runtimeFingerprint,
      interactionState: 'rendered', sourceDigest: name === 'baseline' ? identity.baseSourceDigest : identity.candidateTreeDigest,
      capture: { completed: true, stable: true, fullPage: true, animationsDisabled: true, fontsReady: true, capturedAt: '2026-10-21T00:00:00.000Z', scroll: { x: 0, y: 0 } },
      screenshot: { declaredSha256: sha256Hex(screenshot) },
    }, screenshot, geometry: null,
  })
  return { checkId: 'benchmark-check', subject: identity, expected: identity,
    baseline: side('baseline', a), candidate: side('candidate', b),
    parameters: { mergeDistanceCssPx: grid }, analyzedAt: '2026-10-21T00:00:00.000Z', diffArtifactPath: 'benchmark-diff.png' }
}
const init = (n) => { const rgba = new Uint8Array(n * 4); rgba.fill(255); return rgba }
if (scenario === 'component-limit') {
  const width = 1001, height = 405, mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) mask[y * width + x] = MASK_CHANGED
  assert.throws(() => clusterChangedPixels(mask, width, height, 1), VisualResourceLimitError)
  observed.result = 'visual-analysis-resource-limit / connected components'
} else {
  const width = scenario === 'large-many-regions' ? 1440 : scenario === 'header-limit' ? 8192 : 2400
  const height = scenario === 'large-many-regions' ? 6000 : scenario === 'header-limit' ? 4096 : 4500
  let bPng, aPng
  if (scenario === 'header-limit') {
    // Valid PNG chunk framing for max-input dimensions, deliberately lacking
    // actual scanline bytes: resource preflight must refuse BEFORE inflate.
    const { deflateSync } = await import('node:zlib')
    const table = new Uint32Array(256)
    for (let n=0;n<256;n++) { let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0 }
    const chunk = (type, data) => { const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4);b.set(data,8);let c=0xffffffff;for(const v of b.subarray(4,8+data.length))c=table[(c^v)&255]^(c>>>8);b.writeUInt32BE((c^0xffffffff)>>>0,8+data.length);return b }
    const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6
    aPng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0]))),chunk('IEND',Buffer.alloc(0))]);bPng=aPng
  } else {
    const a = init(width * height), b = new Uint8Array(a)
    if (scenario === 'large-many-regions') {
      for (let y = 0; y < height; y += 31) for (let x = 0; x < width; x += 29) b.set([0, 0, 0, 255], (y * width + x) * 4)
    } else {
      for (let p = 0; p < b.length; p += 4) { b[p] = 0; b[p+1] = 0; b[p+2] = 0 }
    }
    aPng=encodePng(width,height,a);sample();bPng=encodePng(width,height,b);sample()
  }
  const grid = scenario === 'grid-limit' ? 1 : 8
  const outcome = analyzeVisualDifference(createRequest(width,height,aPng,bPng,grid));sample()
  observed.result = outcome.evidence.result
  observed.failure = outcome.evidence.inputs.baseline.screenshot.failure?.code ?? null
  observed.changedPixels = outcome.evidence.observation?.changedPixels ?? null
  observed.regionCount = outcome.evidence.observation?.regionCount ?? null
  observed.diffPngBytes = outcome.diffPng?.byteLength ?? null
  if (scenario === 'grid-limit' || scenario === 'header-limit') {
    assert.equal(observed.result, 'failed-to-run')
    assert.equal(observed.failure, 'visual-analysis-resource-limit')
    assert.equal(observed.regionCount, null)
  } else {
    assert.equal(observed.result, 'unknown')
    assert.ok(observed.changedPixels > 0)
    assert.ok(outcome.diffPng?.byteLength)
  }
}
observed.elapsedMs = +(performance.now()-start).toFixed(2)
observed.rssAtEndMiB = +(process.memoryUsage().rss/MB).toFixed(2)
observed.maxSampledRssMiB = +(lastRss/MB).toFixed(2)
console.log(JSON.stringify(observed))
