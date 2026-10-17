import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const testTempRoot = path.join(process.cwd(), 'node_modules', '.tmp')
fs.mkdirSync(testTempRoot, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(testTempRoot, 'ripple-workbench-browser-'))
const projectRoot = path.join(sandbox, 'site')
const boltProjectRoot = process.env.RIPPLE_BOLT_PROJECT
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence')
let candidateId = ''
fs.mkdirSync(evidenceRoot, { recursive: true })

test.beforeAll(() => {
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'workbench-browser-project', private: true }))
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.tsx'), `import { useState } from 'react'; import { HomePage } from './pages/HomePage'; export function App(){const [page]=useState('home'); return <>{page === 'home' && <HomePage />}</>}`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), `export function HomePage(){return <main><h1>Baseline title</h1><button>Browse items</button></main>}`)
  const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-browser@example.invalid'); git('config', 'user.name', 'Ripple browser test'); git('add', '.'); git('commit', '-qm', 'test project baseline')
})

test.afterAll(async () => {
  if (candidateId) await fetch('http://127.0.0.1:4173/__ripple/api/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }) }).catch(() => undefined)
  fs.rmSync(sandbox, { recursive: true, force: true })
})

test('opens a real local project, keeps multiple operations and explicit local Scope in one isolated candidate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /从真实源码开始/ })).toBeVisible()
  await expect(page.getByText(/CaseFixture|qingye|qiguang/i)).toHaveCount(0)
  await page.getByTestId('project-path').fill(projectRoot)
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('target-select').locator('option').filter({ hasText: 'Baseline title' })).toHaveCount(1)
  await expect(page.locator('.route-list').getByText('page:home', { exact: true })).toBeVisible()
  await expect(page.getByText('SOURCE-PROVEN', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(evidenceRoot, 'workbench-analysis-1440.png'), fullPage: true })

  await page.getByTestId('intent-input').fill('Update only the home headline and primary action while preserving other page behavior.')
  const targetSelect = page.getByTestId('target-select')
  const titleId = await targetSelect.locator('option').filter({ hasText: 'Baseline title' }).getAttribute('value')
  expect(titleId).toBeTruthy()
  await targetSelect.selectOption(titleId!)
  await page.getByTestId('after-input').fill('Candidate title')
  await page.getByTestId('add-operation').click()
  const ctaId = await targetSelect.locator('option').filter({ hasText: 'Browse items' }).getAttribute('value')
  expect(ctaId).toBeTruthy()
  await targetSelect.selectOption(ctaId!)
  await page.getByTestId('after-input').fill('Explore items')
  await page.getByTestId('add-operation').click()
  await expect(page.getByText('2 项', { exact: true })).toBeVisible()
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  await expect(page.getByTestId('candidate-diff')).toContainText('Candidate title')
  await expect(page.getByTestId('candidate-diff')).toContainText('Explore items')
  await expect(page.getByTestId('verification-state')).toContainText('NOT RUN')
  await page.screenshot({ path: path.join(evidenceRoot, 'workbench-candidate-1440.png'), fullPage: true })

  for (const viewport of [{ width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: path.join(evidenceRoot, `workbench-candidate-${viewport.width}.png`), fullPage: true })
  }
  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  candidateId = ''
})

test('opens the supplied Bolt project in the workbench and builds a shared-scope candidate', async ({ page }) => {
  test.skip(!boltProjectRoot, 'RIPPLE_BOLT_PROJECT is only available in the private Bolt acceptance workflow')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByTestId('project-path').fill(boltProjectRoot!)
  await page.getByTestId('analyze-project').click()
  await expect(page.locator('.metric-card').filter({ hasText: '实际页面状态' })).toContainText('4')
  await expect(page.locator('.component-row').filter({ hasText: 'Footer' })).toContainText('/home')
  await expect(page.locator('.component-row').filter({ hasText: 'Footer' })).toContainText('/story')
  const footerSource = fs.readFileSync(path.join(boltProjectRoot!, 'src', 'components', 'Footer.tsx'), 'utf8')
  const brandStart = footerSource.indexOf('山野器物')
  const brandTargetId = `literal:src/components/Footer.tsx#${brandStart}`
  await expect(page.getByTestId('target-select').locator(`option[value="${brandTargetId}"]`)).toHaveCount(1)
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-analysis.png'), fullPage: true })

  await page.getByTestId('intent-input').fill('Update the shared footer brand on every page without changing page content.')
  const targetSelect = page.getByTestId('target-select')
  await targetSelect.selectOption(brandTargetId)
  await page.getByTestId('after-input').fill('山野器物 · Ripple UI验收')
  await page.getByTestId('add-operation').click()
  for (const pageId of ['home', 'autumn', 'products', 'story']) await page.getByTestId(`scope-page:${pageId}`).selectOption('include')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  await expect(page.getByTestId('candidate-diff')).toContainText('山野器物 · Ripple UI验收')
  await expect(page.getByTestId('verification-state')).toContainText('NOT RUN')
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-shared-candidate.png'), fullPage: true })
  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  candidateId = ''
})
