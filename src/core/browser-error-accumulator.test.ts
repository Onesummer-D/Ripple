import { describe, expect, it } from 'vitest'

// The browser executor is plain ESM because it runs directly in the Playwright
// container. Keep the accumulator's contract tested from the TypeScript suite.
// @ts-expect-error The runtime helper intentionally has no TS build target.
import { createBrowserErrorAccumulator } from './browser-error-accumulator.mjs'

describe('browser error accumulator', () => {
  it('keeps exact totals and category counts while bounding unique samples', () => {
    const accumulator = createBrowserErrorAccumulator({ sampleLimit: 2 })
    for (let index = 0; index < 100; index += 1) {
      accumulator.add('console-error', `module failed ${index}; token=secret-${index}`, { url: 'https://example.test/app?secret=do-not-record', viewport: { width: 375, height: 812 }, phase: 'scope-probe' })
    }
    const result = accumulator.snapshot()
    expect(result.total).toBe(100)
    expect(result.byCategory).toEqual({ 'console-error': 100 })
    expect(result.samples).toHaveLength(2)
    expect(result.samples.every((sample: string) => !sample.includes('secret-'))).toBe(true)
    expect(result.samples.every((sample: string) => !sample.includes('?secret='))).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('strips query strings and fragments from URLs embedded in messages', () => {
    const accumulator = createBrowserErrorAccumulator()
    accumulator.add('console-error', 'GET https://cdn.example.test/a.js?X-Amz-Signature=abc&exp=1#frag failed; see http://127.0.0.2:5173/src/App.tsx?t=123')
    const [sample] = accumulator.snapshot().samples
    expect(sample).toContain('https://cdn.example.test/a.js failed')
    expect(sample).toContain('http://127.0.0.2:5173/src/App.tsx')
    expect(sample).not.toMatch(/Signature|abc|exp=|frag|t=123/)
  })

  it('bounds redaction work on very large messages', () => {
    const accumulator = createBrowserErrorAccumulator()
    const started = Date.now()
    accumulator.add('console-error', 'http://x/'.repeat(40_000))
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(accumulator.snapshot().samples[0].length).toBeLessThan(600)
  })

  it('retains viewport and phase context for representative diagnostics', () => {
    const accumulator = createBrowserErrorAccumulator()
    accumulator.add('pageerror', 'module failed', { url: 'http://candidate.test/src/App.tsx?x=1', viewport: { width: 1440, height: 900 }, phase: 'candidate-nav' })
    expect(accumulator.snapshot().samples[0]).toContain('[pageerror] 1440x900 candidate-nav http://candidate.test/src/App.tsx: module failed')
  })
})

