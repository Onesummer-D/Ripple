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

test('keeps keyed identities stable and marks unkeyed component and raw list positions as dependent', async ({ page }) => {
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
  expect(await page.getByTestId('static-instance').getAttribute('data-ripple-identity-certainty')).toBe('stable-react-instance')
  expect(await page.getByTestId('card-a').getAttribute('data-ripple-identity-certainty')).toBe('stable-keyed-instance')

  const rawAlpha = page.getByTestId('raw-Raw Alpha')
  const rawBeta = page.getByTestId('raw-Raw Beta')
  const rawAlphaAtPosition = await rawAlpha.getAttribute('data-ripple-instance')
  const rawBetaAtPosition = await rawBeta.getAttribute('data-ripple-instance')
  expect(rawAlphaAtPosition).toBeTruthy()
  expect(rawBetaAtPosition).toBeTruthy()
  expect(rawAlphaAtPosition).not.toBe(rawBetaAtPosition)
  expect(await rawAlpha.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  expect(await rawBeta.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  expect(await rawAlpha.getAttribute('data-ripple-source')).toBe(await rawBeta.getAttribute('data-ripple-source'))
  await page.getByRole('button', { name: 'Reorder raw list' }).click()
  expect(await page.getByTestId('raw-Raw Beta').getAttribute('data-ripple-instance')).toBe(rawAlphaAtPosition)
  expect(await page.getByTestId('raw-Raw Alpha').getAttribute('data-ripple-instance')).toBe(rawBetaAtPosition)

  const componentAlpha = page.getByTestId('unkeyed-Component Alpha')
  const componentBeta = page.getByTestId('unkeyed-Component Beta')
  const componentAlphaAtPosition = await componentAlpha.getAttribute('data-ripple-instance')
  const componentBetaAtPosition = await componentBeta.getAttribute('data-ripple-instance')
  expect(componentAlphaAtPosition).toBeTruthy()
  expect(componentBetaAtPosition).toBeTruthy()
  expect(componentAlphaAtPosition).not.toBe(componentBetaAtPosition)
  expect(await componentAlpha.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  expect(await componentBeta.getAttribute('data-ripple-identity-certainty')).toBe('position-dependent')
  await page.getByRole('button', { name: 'Reorder unkeyed components' }).click()
  expect(await page.getByTestId('unkeyed-Component Beta').getAttribute('data-ripple-instance')).toBe(componentAlphaAtPosition)
  expect(await page.getByTestId('unkeyed-Component Alpha').getAttribute('data-ripple-instance')).toBe(componentBetaAtPosition)

  await page.getByRole('button', { name: 'Reorder', exact: true }).click()
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
