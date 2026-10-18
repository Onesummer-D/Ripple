import path from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const root = path.resolve(process.argv[2] ?? '')
const outDir = path.resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/build-candidate-check.mjs <candidate-root> <output-directory>')
await build({ configFile: false, root, base: './', plugins: [react()], build: { outDir, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] })
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href)
  await page.getByText('Home only brand', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Autumn route' }).click()
  await page.getByText('Home', { exact: true }).waitFor()
  if (await page.getByText('Home only brand', { exact: true }).count()) throw new Error('Page-local override leaked into the non-target autumn page')
  await page.getByRole('button', { name: 'Home route' }).click()
  await page.getByText('Home only brand', { exact: true }).waitFor()
} finally { await browser.close() }
