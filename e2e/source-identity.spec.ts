import { expect, test } from '@playwright/test'
import react from '@vitejs/plugin-react'
import * as path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { sourceAnnotationPlugin } from '../src/core/source-annotation'

const fixtureRoot = path.join(process.cwd(), 'e2e', 'source-identity-fixture')
let server: ViteDevServer
let baseUrl: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fixtureRoot,
    logLevel: 'silent',
    plugins: [sourceAnnotationPlugin(fixtureRoot), react()],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Vite fixture listener did not bind a TCP address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => { await server?.close() })

test('keeps keyed component instance identity through rerender, reorder and conditional remount', async ({ page }) => {
  await page.goto(baseUrl)
  const instanceFor = async (id: string) => page.getByTestId(`card-${id}`).getAttribute('data-ripple-instance')
  const alphaBefore = await instanceFor('a')
  const betaBefore = await instanceFor('b')
  const alphaSource = await page.getByTestId('card-a').getAttribute('data-ripple-source')
  const betaSource = await page.getByTestId('card-b').getAttribute('data-ripple-source')
  expect(alphaBefore).toBeTruthy()
  expect(betaBefore).toBeTruthy()
  expect(alphaBefore).not.toBe(betaBefore)
  expect(alphaSource).toBe(betaSource)
  expect(await page.getByTestId('card-a').getAttribute('data-ripple-identity-certainty')).toBe('stable-keyed-instance')

  await page.getByRole('button', { name: 'Reorder' }).click()
  await expect(page.locator('article').first()).toHaveAttribute('data-testid', 'card-b')
  expect(await instanceFor('a')).toBe(alphaBefore)
  expect(await instanceFor('b')).toBe(betaBefore)

  await page.getByRole('button', { name: 'Toggle' }).click()
  await expect(page.locator('article')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle' }).click()
  expect(await instanceFor('a')).toBe(alphaBefore)
  expect(await instanceFor('b')).toBe(betaBefore)

  await page.getByRole('button', { name: 'Switch page' }).click()
  const featuredAlpha = await instanceFor('a')
  expect(featuredAlpha).toBeTruthy()
  expect(featuredAlpha).not.toBe(alphaBefore)
})
