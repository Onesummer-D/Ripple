import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const tempRoot = path.join(process.cwd(), 'node_modules', '.tmp')
fs.mkdirSync(tempRoot, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(tempRoot, 'ripple-preview-browser-'))
const projectRoot = path.join(sandbox, 'site')
const fixtureNodeModules = path.resolve('test/fixtures/react-vite-tailwind/node_modules')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence')
const dockerAvailable = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0
let candidateId = ''
fs.mkdirSync(evidenceRoot, { recursive: true })

test.afterAll(async () => {
  if (candidateId) await fetch('http://127.0.0.1:4173/__ripple/api/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }) }).catch(() => undefined)
  fs.rmSync(sandbox, { recursive: true, force: true })
})

test('runs the exact candidate source in a Docker-isolated browser preview', async ({ page }) => {
  test.setTimeout(300_000)
  if (!dockerAvailable) {
    if (process.env.CI) throw new Error('Docker-backed candidate preview is mandatory in CI; docker info did not succeed')
    test.skip(true, 'Docker is unavailable in this local environment')
  }
  expect(fs.existsSync(path.join(fixtureNodeModules, 'tailwindcss', 'package.json'))).toBe(true)
  expect(fs.existsSync(path.join(fixtureNodeModules, '@alloc', 'quick-lru', 'package.json'))).toBe(true)

  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'ripple-isolated-preview', private: true, type: 'module' }))
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.jsx"></script>')
  fs.writeFileSync(path.join(projectRoot, 'vite.config.ts'), "throw new Error('the target Vite config must not execute in Ripple preview')\n")
  fs.writeFileSync(path.join(projectRoot, 'postcss.config.cjs'), "module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }\n")
  fs.writeFileSync(path.join(projectRoot, 'tailwind.config.cjs'), "module.exports = { content: ['./index.html', './src/**/*.{js,jsx}'], theme: { extend: {} }, plugins: [] }\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.jsx'), "import React from 'react'; import { createRoot } from 'react-dom/client'; import './preview.css'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<App />)\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'preview.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n')
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.jsx'), `import { useState } from 'react'; import { HomePage } from './pages/HomePage.jsx'; import { SecondaryPage } from './pages/SecondaryPage.jsx'; export function App(){const [page,setPage]=useState('home');return <><nav><button onClick={()=>setPage('home')}>Home</button><button onClick={()=>setPage('secondary')}>Secondary</button></nav>{page==='home'&&<HomePage/>}{page==='secondary'&&<SecondaryPage/>}</>}`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), `import { useState } from 'react'; export function HomePage(){const [count,setCount]=useState(0);return <main className="pt-4"><h1>Baseline preview title</h1><p>Unaffected page copy stays intact.</p><button onClick={()=>setCount(count+1)}>Clicked {count}</button></main>}`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'SecondaryPage.jsx'), `export function SecondaryPage(){return <main><h1>Secondary page stays unchanged</h1></main>}`)
  fs.symlinkSync(fixtureNodeModules, path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-preview@example.invalid'); git('config', 'user.name', 'Ripple preview test'); git('add', '.'); git('commit', '-qm', 'preview baseline')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByTestId('project-path').fill(projectRoot)
  await page.getByTestId('analyze-project').click()
  const targetSelect = page.getByTestId('target-select')
  await expect(targetSelect.locator('option').filter({ hasText: 'Baseline preview title' })).toHaveCount(1)
  const targetId = await targetSelect.locator('option').filter({ hasText: 'Baseline preview title' }).getAttribute('value')
  expect(targetId).toBeTruthy()
  await page.getByTestId('intent-input').fill('Change only the home heading; keep the site interaction and other page unchanged.')
  await targetSelect.selectOption(targetId!)
  await page.getByTestId('after-input').fill('Candidate preview title')
  await page.getByTestId('add-operation').click()
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('scope-page:secondary').selectOption('exclude')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByTestId('candidate-id')).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  const patchHash = await page.locator('.hash-grid').locator('div').nth(1).locator('code').innerText()
  const previewResponsePromise = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/preview') && !response.url().endsWith('/stop'))
  await page.getByTestId('toggle-candidate-preview').click()
  const previewResponse = await previewResponsePromise
  const previewPayload = await previewResponse.json() as { error?: string; url?: string }
  expect(previewResponse.ok(), `Candidate preview API failed: ${JSON.stringify(previewPayload)}`).toBeTruthy()
  expect(previewPayload.url).toBeTruthy()
  expect(new URL(previewPayload.url!).hostname).toBe('127.0.0.1')
  expect((await page.request.get(previewPayload.url!)).status()).toBe(200)
  const browserDiagnostics: string[] = []
  page.on('console', message => { if (message.type() === 'error') browserDiagnostics.push(`console: ${message.text()}`) })
  page.on('pageerror', error => browserDiagnostics.push(`pageerror: ${error.message}`))
  page.on('requestfailed', request => browserDiagnostics.push(`requestfailed: ${request.url()} · ${request.failure()?.errorText ?? 'unknown'}`))
  const iframe = page.getByTestId('candidate-preview')
  await expect(iframe).toBeVisible({ timeout: 150_000 })
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  const preview = page.frameLocator('iframe[data-testid="candidate-preview"]')
  try {
    await expect(preview.getByRole('heading', { name: 'Candidate preview title' })).toBeVisible({ timeout: 10_000 })
  } catch (error) {
    const frame = page.frames().find(item => item.url() === previewPayload.url)
    const frameState = await frame?.evaluate(() => ({
      origin: window.origin,
      readyState: document.readyState,
      title: document.title,
      body: document.body?.innerText,
      scripts: Array.from(document.scripts).map(script => ({ src: script.src, type: script.type, nonce: !!script.nonce })),
    })).catch(cause => ({ error: cause instanceof Error ? cause.message : String(cause) }))
    await test.info().attach('candidate-frame-diagnostics', { body: JSON.stringify({ url: previewPayload.url, frameState, browserDiagnostics }, null, 2), contentType: 'application/json' })
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nCandidate iframe diagnostics: ${JSON.stringify({ frameState, browserDiagnostics })}`)
  }
  await expect(preview.getByText('Unaffected page copy stays intact.')).toBeVisible()
  await expect.poll(() => preview.locator('main').evaluate(element => getComputedStyle(element).paddingTop)).toBe('16px')
  const firstInstance = await preview.getByRole('heading', { name: 'Candidate preview title' }).getAttribute('data-ripple-instance')
  expect(firstInstance).toBeTruthy()
  await preview.getByRole('button', { name: 'Clicked 0' }).click()
  await expect(preview.getByRole('button', { name: 'Clicked 1' })).toBeVisible()
  await expect(preview.getByRole('heading', { name: 'Candidate preview title' })).toHaveAttribute('data-ripple-instance', firstInstance!)
  const previewUrl = await iframe.getAttribute('src')
  expect(previewUrl).toBeTruthy()
  const previewFrame = page.frames().find(frame => frame.url() === previewUrl)
  expect(previewFrame).toBeTruthy()
  const sandboxOrigin = await previewFrame!.evaluate(() => window.origin)
  expect(sandboxOrigin).toBe('null')
  const frameHeaders = await fetch(previewUrl!).then(response => ({ csp: response.headers.get('content-security-policy'), status: response.status }))
  expect(frameHeaders.status).toBe(200)
  expect(frameHeaders.csp).toContain("connect-src 'self'")
  await preview.getByRole('button', { name: 'Secondary' }).click()
  await expect(preview.getByRole('heading', { name: 'Secondary page stays unchanged' })).toBeVisible()
  await preview.getByRole('button', { name: 'Home' }).click()
  await expect(preview.getByRole('heading', { name: 'Candidate preview title' })).toBeVisible()
  expect(fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.jsx'), 'utf8')).toContain('Baseline preview title')
  const screenshotPath = path.join(evidenceRoot, 'candidate-preview-isolated.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const screenshotSha256 = createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex')
  const discardedId = candidateId
  await page.getByTestId('scope-page:secondary').selectOption('protect')
  await expect(page.getByTestId('candidate-id')).toHaveCount(0)
  await expect(page.getByTestId('candidate-preview')).toHaveCount(0)
  const containers = execFileSync('docker', ['ps', '--filter', `label=com.ripple.candidate=${discardedId}`, '--quiet'], { encoding: 'utf8' }).trim()
  expect(containers).toBe('')
  const networks = execFileSync('docker', ['network', 'ls', '--filter', `label=com.ripple.candidate=${discardedId}`, '--quiet'], { encoding: 'utf8' }).trim()
  expect(networks).toBe('')
  const remainingWorktrees = execFileSync('git', ['-C', projectRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.startsWith('worktree '))
  expect(remainingWorktrees).toHaveLength(1)
  const discardedCandidate = await fetch('http://127.0.0.1:4173/__ripple/api/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: discardedId }) })
  expect(discardedCandidate.status).toBe(404)
  fs.writeFileSync(path.join(evidenceRoot, 'candidate-preview-run.json'), JSON.stringify({
    schemaVersion: 1, completed: true, execution: 'docker-backed-playwright-preview', candidateId: discardedId, patchHash,
    previewOrigin: new URL(previewUrl!).origin, sourceUnchanged: true, targetChangedInBrowser: true, nonTargetPageNavigable: true,
    sandboxOrigin, viewport: { width: 1440, height: 1000 }, screenshot: { path: path.basename(screenshotPath), sha256: screenshotSha256 },
    assertions: ['candidate source rendered', 'target text updated', 'non-target copy preserved', 'Tailwind 3 PostCSS plugin generated pt-4 and its browser computed style was 16px', 'React event handler worked', 'instance ID survived rerender', 'page scope navigation worked', 'target Vite config not required', 'scope change retired the candidate container, network, and worktree'],
    formalVerification: 'not-run',
  }, null, 2))
  candidateId = ''
})
