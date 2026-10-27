import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

async function checksumModuleSource(): Promise<string> {
  const source = await readFile(new URL('../src/core/runtime-identity-checksum.ts', import.meta.url), 'utf8')
  return transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText
}

type ChecksumModule = typeof import('../src/core/runtime-identity-checksum')

async function serveChecksumModule(page: Page, origin: string) {
  const moduleSource = await checksumModuleSource()
  await page.route(`${origin}/**`, route => {
    const pathname = new URL(route.request().url()).pathname
    return pathname === '/runtime-identity-checksum.js'
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: moduleSource })
      : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>context fixture</body></html>' })
  })
  await page.goto(`${origin}/`)
}

test('localhost Chromium provides secure Web Crypto SHA-256 for v1.2 Assessment verification', async ({ page }) => {
  await serveChecksumModule(page, 'http://localhost')
  const result = await page.evaluate(async () => {
    const checksum = await (new Function('url', 'return import(url)') as (url: string) => Promise<ChecksumModule>)('/runtime-identity-checksum.js')
    const available = checksum.runtimeIdentityAssessmentChecksumAvailable()
    const digest = await checksum.runtimeIdentityAssessmentChecksum(
      { checkId: 'localhost-check', route: '/', viewport: { width: 1280, height: 800 }, state: 'settled', side: 'baseline' },
      'a'.repeat(64), '["jsx:src/App.tsx#10","instance-1",0]', { instanceIdentityProven: true, reasons: [] },
    )
    return { secure: globalThis.isSecureContext, available, digest }
  })

  expect(result.secure).toBe(true)
  expect(result.available).toBe(true)
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/)
})

test('non-secure HTTP context reports Web Crypto unavailable instead of verifying an Assessment', async ({ page }) => {
  await serveChecksumModule(page, 'http://insecure.test')
  const context = await page.evaluate(() => ({
    secure: globalThis.isSecureContext,
    subtleAvailable: !!globalThis.crypto?.subtle,
  }))
  expect(context.secure).toBe(false)
  expect(context.subtleAvailable).toBe(false)

  const result = await page.evaluate(async () => {
    const module = await (new Function('url', 'return import(url)') as (url: string) => Promise<ChecksumModule>)('/runtime-identity-checksum.js')
    let rejected = ''
    try {
      await module.runtimeIdentityAssessmentChecksum(
        { checkId: 'insecure-check', route: '/', viewport: { width: 1280, height: 800 }, state: 'settled', side: 'baseline' },
        'a'.repeat(64), '["jsx:src/App.tsx#10","instance-1",0]', { instanceIdentityProven: true, reasons: [] },
      )
    } catch (error) {
      rejected = error instanceof Error ? error.message : String(error)
    }
    return { available: module.runtimeIdentityAssessmentChecksumAvailable(), rejected }
  })
  expect(result.available).toBe(false)
  expect(result.rejected).toBe('Web Crypto SHA-256 is unavailable in this environment.')
})
