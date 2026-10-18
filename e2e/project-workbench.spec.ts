import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from 'node:net'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-workbench-browser-'))
const projectRoot = path.join(sandbox, 'site')
const boltProjectRoot = process.env.RIPPLE_BOLT_PROJECT
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence')
const dockerAvailable = process.platform === 'linux' && spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0
let candidateId = ''
fs.mkdirSync(evidenceRoot, { recursive: true })

test.beforeAll(() => {
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'workbench-browser-project', private: true }))
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />)`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.tsx'), `/* suggested asset https://assets.example.test/preview-check.gif; injected hostile URL https://untrusted.example.invalid/pixel.gif */ import { useState } from 'react'; import { Navigation } from './components/Navigation'; import { HomePage } from './pages/HomePage'; import { AutumnPage } from './pages/AutumnPage'; export function App(){const [page,setPage]=useState('home'); return <><button onClick={()=>setPage('home')}>Home route</button><button onClick={()=>setPage('autumn')}>Autumn route</button>{page === 'home' && <><Navigation/><HomePage/></>}{page === 'autumn' && <><Navigation/><AutumnPage/></>}</>}`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), `import { useState } from 'react'; export function HomePage(){const [clicks,setClicks]=useState(0); return <main><h1>Baseline title</h1><img alt="approved test image" src="https://assets.example.test/preview-check.gif"/><img alt="not approved image" src="https://untrusted.example.invalid/pixel.gif"/><a href="https://untrusted.example.invalid/leave">External navigation</a><button>Browse items</button><button onClick={()=>setClicks(clicks+1)}>Clicks {clicks}</button></main>}`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'AutumnPage.tsx'), `export function AutumnPage(){return <main><h1>Autumn baseline</h1></main>}`)
  fs.writeFileSync(path.join(projectRoot, 'src', 'components', 'Navigation.tsx'), `export function Navigation(){return <nav>Shared navigation brand</nav>}`)
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-browser@example.invalid'); git('config', 'user.name', 'Ripple browser test'); git('add', '.'); git('commit', '-qm', 'test project baseline')
})

test.afterAll(async () => {
  if (candidateId) await fetch('http://127.0.0.1:4173/__ripple/api/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }) }).catch(() => undefined)
  fs.rmSync(sandbox, { recursive: true, force: true })
})

async function expectCandidateRetired(id: string) {
  const response = await fetch('http://127.0.0.1:4173/__ripple/api/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: id }) })
  expect(response.status, 'discarding an already-retired candidate must not find a stale API entry').toBe(404)
  const worktrees = execFileSync('git', ['-C', projectRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.startsWith('worktree '))
  expect(worktrees, 'candidate cleanup must leave only the source project worktree').toHaveLength(1)
}

function createApprovalProject(): string {
  const root = path.join(sandbox, 'approval-flow-project')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndist/\n')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ripple-approval-flow', private: true, type: 'module' }))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />)")
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), "import { useState } from 'react'; import { Navigation } from './components/Navigation'; import { HomePage } from './pages/HomePage'; import { AutumnPage } from './pages/AutumnPage'; export function App(){const [page,setPage]=useState('home'); return <><button onClick={()=>setPage('home')}>Home route</button><button onClick={()=>setPage('autumn')}>Autumn route</button><Navigation/>{page==='home' && <HomePage/>}{page==='autumn' && <AutumnPage/>}</>}")
  fs.writeFileSync(path.join(root, 'src', 'components', 'Navigation.tsx'), 'export function Navigation(){return <nav aria-label="Primary"><a>Shared navigation brand</a></nav>}')
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), "import { useState } from 'react'; export function HomePage(){const [clicks,setClicks]=useState(0); return <main><h1>Home page</h1><button onClick={()=>setClicks(clicks+1)}>Clicks {clicks}</button></main>}")
  fs.writeFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), 'export function AutumnPage(){return <main><h1>Autumn page</h1></main>}')
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-approval@example.invalid'); git('config', 'user.name', 'Ripple approval test'); git('add', '.'); git('commit', '-qm', 'trusted local workflow baseline')
  return root
}

test('opens a real local project, keeps multiple operations and explicit local Scope in one isolated candidate', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /从真实源码开始/ })).toBeVisible()
  await expect(page.getByText(/CaseFixture|qingye|qiguang/i)).toHaveCount(0)
  await page.getByTestId('project-path').fill(projectRoot)
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('target-select').locator('option').filter({ hasText: 'Baseline title' })).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByTestId('preview-resource-draft')).toHaveValue('')
  const resourcePolicy = page.getByTestId('preview-resource-policy')
  await expect(resourcePolicy.getByText('https://assets.example.test/preview-check.gif')).toBeVisible()
  await expect(resourcePolicy.getByText('https://untrusted.example.invalid/pixel.gif')).toBeVisible()
  await resourcePolicy.locator('li').filter({ hasText: 'https://assets.example.test/preview-check.gif' }).getByTestId('add-preview-resource').click()
  await page.getByTestId('save-preview-resources').click()
  await expect(page.getByTestId('preview-resource-draft')).toHaveValue('https://assets.example.test/preview-check.gif')
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
  await page.getByTestId('scope-page:autumn').selectOption('exclude')
  await page.getByRole('radio', { name: /仅在一个页面创建可维护覆盖/ }).check()
  await page.getByLabel('选择局部覆盖页面').selectOption('page:home')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  await expect(page.getByTestId('candidate-diff')).toContainText('Candidate title')
  await expect(page.getByTestId('candidate-diff')).toContainText('Explore items')
  await expect(page.getByTestId('verification-state')).toContainText('NOT RUN')
  await page.screenshot({ path: path.join(evidenceRoot, 'workbench-candidate-1440.png'), fullPage: true })

  await page.reload()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('candidate-id')).toHaveText(candidateId)
  await expect(page.getByTestId('candidate-diff')).toContainText('Candidate title')
  await expect(page.getByTestId('verification-state')).toContainText('NOT RUN')

  for (const viewport of [{ width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: path.join(evidenceRoot, `workbench-candidate-${viewport.width}.png`), fullPage: true })
  }
  if (dockerAvailable) {
    await page.route('https://assets.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64') }))
    await page.getByTestId('toggle-candidate-preview').click()
    const preview = page.frameLocator('iframe[data-testid="candidate-preview"]')
    await expect(preview.getByRole('heading', { name: 'Candidate title' })).toBeVisible({ timeout: 90_000 })
    await expect(preview.getByRole('heading', { name: 'Candidate title' })).toHaveAttribute('data-ripple-source', /jsx:src\/pages\/HomePage\.tsx#/)
    await page.getByTestId('toggle-element-selection').click()
    await preview.getByRole('heading', { name: 'Candidate title' }).click()
    await expect(page.getByTestId('selected-source')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('selected-jsx-source')).toContainText('src/pages/HomePage.tsx#')
    await expect(page.getByTestId('selected-source')).toContainText('Patch')
    await expect(page.getByTestId('selected-source')).toContainText('stable-react-instance')
    const previewUrl = await page.getByTestId('candidate-preview').getAttribute('src')
    const previewFrame = page.frames().find(frame => frame.url() === previewUrl)
    expect(previewFrame).toBeTruthy()
    for (const width of [1440, 768, 390]) {
      await page.getByTestId(`preview-viewport-${width}`).click()
      await expect.poll(() => previewFrame!.evaluate(() => window.innerWidth)).toBe(width)
      expect(await previewFrame!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
    }
    expect(new URL(previewUrl!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    const wrongHostResponse = await page.request.get(previewUrl!, { headers: { host: 'attacker.invalid' } })
    expect(wrongHostResponse.status()).toBe(403)
    const wrongOriginResponse = await page.request.get(previewUrl!, { headers: { origin: 'https://attacker.invalid' } })
    expect(wrongOriginResponse.status()).toBe(403)
    const deniedMethodResponse = await page.request.post(previewUrl!, { data: 'not a preview operation' })
    expect(deniedMethodResponse.status()).toBe(405)
    const previewResponse = await page.request.get(previewUrl!)
    const previewCsp = previewResponse.headers()['content-security-policy'] ?? ''
    expect(previewCsp).toContain("img-src 'self' data: blob: https://assets.example.test/preview-check.gif")
    expect(previewCsp).not.toContain('https://untrusted.example.invalid')
    expect(previewCsp).not.toMatch(/img-src[^;]*\bhttps:\s*(?:;|$)/)
    const permittedImageWidth = await previewFrame!.evaluate(async () => {
      const image = new Image()
      image.src = 'https://assets.example.test/preview-check.gif'
      document.body.append(image)
      await image.decode()
      return image.naturalWidth
    })
    expect(permittedImageWidth).toBe(1)
    const externalRequests: string[] = []
    page.on('request', request => { if (request.url().startsWith('https://untrusted.example.invalid/')) externalRequests.push(request.url()) })
    await preview.getByRole('link', { name: 'External navigation' }).click()
    await expect(preview.getByRole('heading', { name: 'Candidate title' })).toBeVisible()
    expect(externalRequests).toEqual([])
    const blockedUrl = 'https://untrusted.example.invalid/pixel.gif'
    const blockedRequest = page.waitForEvent('requestfailed', request => request.url() === blockedUrl)
    await previewFrame!.evaluate((url: string) => {
      const image = new Image()
      image.src = url
      document.body.append(image)
    }, blockedUrl)
    expect((await blockedRequest).failure()?.errorText).toBe('csp')
    const unapprovedPathUrl = 'https://assets.example.test/not-approved.gif'
    const unapprovedPathRequest = page.waitForEvent('requestfailed', request => request.url() === unapprovedPathUrl)
    await previewFrame!.evaluate((url: string) => {
      const image = new Image()
      image.src = url
      document.body.append(image)
    }, unapprovedPathUrl)
    expect((await unapprovedPathRequest).failure()?.errorText).toBe('csp')
    await page.getByTestId('run-verification').click()
    const verificationState = page.getByTestId('verification-state')
    await expect(verificationState).toContainText(/INCOMPLETE|RISKS/, { timeout: 120_000 })
    await expect(page.getByTestId('verification-assertions').getByText('responsive-layout')).toBeVisible()
    const assertionCards = page.getByTestId('verification-assertions').locator('div')
    const verificationLink = page.locator('.verification-record a')
    const recordHref = await verificationLink.getAttribute('href')
    expect(recordHref).toBeTruthy()
    const recordResponse = await page.request.get(new URL(recordHref!, 'http://127.0.0.1:4173').toString())
    expect(recordResponse.ok()).toBe(true)
    const executionRecord = await recordResponse.json()
    await expect(assertionCards.filter({ hasText: 'target-change' })).toContainText('PASS')
    await expect(assertionCards.filter({ hasText: 'non-target-preserved' })).toContainText('PASS')
    await expect(assertionCards.filter({ hasText: 'source-mapping' })).toContainText('PASS')
    await expect(assertionCards.filter({ hasText: 'interaction' })).toContainText('UNKNOWN')
    const verificationImages = page.getByTestId('verification-evidence').locator('img')
    await expect(verificationImages).toHaveCount(3)
    await expect.poll(() => verificationImages.evaluateAll(images => images.every(image => {
      const rendered = image as HTMLImageElement
      return rendered.complete && rendered.naturalWidth > 0
    }))).toBe(true)
    expect(executionRecord).toMatchObject({ candidateId, patchHash: expect.any(String), candidateTreeDigest: expect.any(String), scopeVersion: 1 })
    expect(executionRecord.evidence.map((item: { viewport: { width: number } }) => item.viewport.width)).toEqual([1440, 768, 390])
    expect(executionRecord.evidence.every((item: { result: string }) => item.result === 'pass')).toBe(true)
    expect(executionRecord.baselineComparisons).toHaveLength(3)
    expect(executionRecord.baselineComparisons.every((comparison: { matched: boolean; baselineDigest: string; candidateDigest: string; maskedOperationIds: string[] }) =>
      comparison.matched && comparison.baselineDigest === comparison.candidateDigest && comparison.maskedOperationIds.length === 2)).toBe(true)
    fs.writeFileSync(path.join(evidenceRoot, 'workbench-verification-execution.json'), JSON.stringify(executionRecord, null, 2))
    const screenshotUrls = await verificationImages.evaluateAll(images => images.map(image => (image as HTMLImageElement).src))
    const screenshotResponses = await Promise.all(screenshotUrls.map(url => page.request.get(url)))
    for (const [index, screenshot] of screenshotResponses.entries()) {
      expect(screenshot.ok()).toBe(true)
      const bytes = await screenshot.body()
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(executionRecord.evidence[index].artifactHash)
      fs.writeFileSync(path.join(evidenceRoot, `workbench-verification-${[1440, 768, 390][index]}.png`), bytes)
    }
    await page.getByTestId('toggle-element-selection').click()
    await page.getByTestId('toggle-candidate-preview').click()
  } else if (process.env.CI) {
    throw new Error('Docker-backed workbench element selection is mandatory in CI')
  }
  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  const discardedId = candidateId
  await expectCandidateRetired(discardedId)
  candidateId = ''
})

test('creates a centralized page-only override for a shared JSX text target', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('project-path').fill(projectRoot)
  await page.getByTestId('analyze-project').click()
  const targetSelect = page.getByTestId('target-select')
  const brandId = await targetSelect.locator('option').filter({ hasText: 'Shared navigation brand' }).getAttribute('value')
  expect(brandId).toBeTruthy()
  await targetSelect.selectOption(brandId!)
  await expect(page.getByText('可证明消费：/autumn、/home')).toBeVisible()
  await page.getByTestId('intent-input').fill('Change the shared navigation label only on the home page.')
  await page.getByTestId('after-input').fill('Home-only navigation')
  await page.getByTestId('add-operation').click()
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('scope-page:autumn').selectOption('exclude')
  await page.getByLabel('仅在一个页面创建可维护覆盖，不改共享值').check()
  await page.getByLabel('选择局部覆盖页面').selectOption('page:home')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  await expect(page.getByTestId('candidate-diff')).toContainText('Home-only navigation')
  await expect(page.getByTestId('candidate-diff')).toContainText('overrides.json')
  await expect(page.getByTestId('candidate-diff')).toContainText('RipplePageForState')
  expect(fs.readFileSync(path.join(projectRoot, 'src', 'components', 'Navigation.tsx'), 'utf8')).toContain('Shared navigation brand')
  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  await expectCandidateRetired(candidateId)
  candidateId = ''
})

test('records trusted three-viewport evidence while unsupported assertions stay unknown', async ({ page }) => {
  test.setTimeout(180_000)
  test.skip(!dockerAvailable, 'Docker-backed ProjectRunner and VerificationRunner are required')
  await page.goto('/')
  await page.getByTestId('project-path').fill(projectRoot)
  await page.getByTestId('analyze-project').click()
  const targetSelect = page.getByTestId('target-select')
  const titleId = await targetSelect.locator('option').filter({ hasText: 'Baseline title' }).getAttribute('value')
  expect(titleId).toBeTruthy()
  await targetSelect.selectOption(titleId!)
  await page.getByTestId('intent-input').fill('Change only the home title and preserve everything else.')
  await page.getByTestId('after-input').fill('Verified title')
  await page.getByTestId('add-operation').click()
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('scope-page:autumn').selectOption('exclude')
  await page.getByLabel('仅在一个页面创建可维护覆盖，不改共享值').check()
  await page.getByLabel('选择局部覆盖页面').selectOption('page:home')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByTestId('candidate-id')).toBeVisible()
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()

  await page.getByTestId('run-verification').click()
  await expect(page.getByTestId('verification-state')).toContainText(/INCOMPLETE|RISKS/, { timeout: 120_000 })
  const assertions = page.getByTestId('verification-assertions')
  const recordHref = await page.locator('.verification-record a').getAttribute('href')
  expect(recordHref).toBeTruthy()
  const recordResponse = await page.request.get(new URL(recordHref!, 'http://127.0.0.1:4173').toString())
  expect(recordResponse.ok()).toBe(true)
  const executionRecord = await recordResponse.json()
  await expect(assertions.locator('div').filter({ hasText: 'target-change' })).toContainText('PASS')
  await expect(assertions.locator('div').filter({ hasText: 'source-mapping' })).toContainText('PASS')
  await expect(assertions.locator('div').filter({ hasText: 'interaction' })).toContainText('UNKNOWN')
  expect(executionRecord).toMatchObject({ candidateId, patchHash: expect.any(String), candidateTreeDigest: expect.any(String), scopeVersion: 1 })
  fs.writeFileSync(path.join(evidenceRoot, 'workbench-single-target-verification.json'), JSON.stringify(executionRecord, null, 2))
  const images = page.getByTestId('verification-evidence').locator('img')
  await expect(images).toHaveCount(3)
  const urls = await images.evaluateAll(elements => elements.map(element => (element as HTMLImageElement).src))
  expect(executionRecord.evidence.map((item: { viewport: { width: number } }) => item.viewport.width)).toEqual([1440, 768, 390])
  expect(executionRecord.evidence.every((item: { result: string }) => item.result === 'pass')).toBe(true)
  for (const [index, url] of urls.entries()) {
    const screenshot = await page.request.get(url)
    expect(screenshot.ok()).toBe(true)
    const bytes = await screenshot.body()
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(executionRecord.evidence[index].artifactHash)
    fs.writeFileSync(path.join(evidenceRoot, `workbench-single-target-${[1440, 768, 390][index]}.png`), bytes)
  }

  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  candidateId = ''
})

test('approves, applies, rolls back and restores a contract-verified shared TEXT page override through the workbench UI', async ({ page }) => {
  test.setTimeout(360_000)
  if (!dockerAvailable) {
    if (process.env.CI) throw new Error('Docker-backed approval/apply/rollback workflow is mandatory in CI')
    test.skip(true, 'Docker-backed candidate and baseline previews are unavailable locally')
  }
  const approvalProject = createApprovalProject()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByTestId('project-path').fill(approvalProject)
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('target-select').locator('option').filter({ hasText: 'Shared navigation brand' })).toHaveCount(1, { timeout: 30_000 })
  const targetSelect = page.getByTestId('target-select')
  const targetId = await targetSelect.locator('option').filter({ hasText: 'Shared navigation brand' }).getAttribute('value')
  expect(targetId).toBeTruthy()
  await targetSelect.selectOption(targetId!)
  await page.getByTestId('intent-input').fill('Change the shared navigation only on Home; preserve Autumn and the counter interaction.')
  await page.getByRole('radio', { name: /仅在一个页面创建可维护覆盖/ }).check()
  await page.getByLabel('选择局部覆盖页面').selectOption('page:home')
  await page.getByTestId('after-input').fill('Home-only brand')
  await page.getByTestId('add-operation').click()
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('scope-page:autumn').selectOption('exclude')
  await page.getByTestId('verification-contract').fill(JSON.stringify({
    pages: [
      { pageRef: 'page:home', path: '/', markerText: 'Home page' },
      { pageRef: 'page:autumn', path: '/', markerText: 'Autumn page', navigateBy: { role: 'button', name: 'Autumn route' } },
    ],
    interactions: [{ pageRef: 'page:home', role: 'button', name: 'Clicks 0', expectedText: 'Clicks 1' }],
  }, null, 2))
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByTestId('candidate-id')).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  const patchHash = (await page.locator('.hash-grid > div').nth(1).locator('code').innerText()).trim()
  expect(patchHash).toMatch(/^[a-f0-9]{64}$/)
  await page.getByTestId('verify-candidate').click()
  await expect(page.getByTestId('verification-state')).toContainText('PASSED', { timeout: 180_000 })
  const assertions = page.getByTestId('verification-assertions')
  for (const assertionId of ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']) {
    await expect(assertions.locator('div').filter({ hasText: assertionId })).toContainText('PASS')
  }
  const recordHref = await page.locator('.verification-record a').getAttribute('href')
  expect(recordHref).toBeTruthy()
  const executionResponse = await page.request.get(new URL(recordHref!, 'http://127.0.0.1:4173').toString())
  expect(executionResponse.ok()).toBe(true)
  const execution = await executionResponse.json()
  expect(execution).toMatchObject({ candidateId, patchHash, verificationContractHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(execution.scopeObservations).toHaveLength(6)
  expect(execution.interactionObservations).toHaveLength(3)
  expect(execution.scopeObservations.every((item: { baselineMarkerVisible: boolean; candidateMarkerVisible: boolean }) => item.baselineMarkerVisible && item.candidateMarkerVisible)).toBe(true)

  await page.getByTestId('approve-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('已批准')
  await page.getByTestId('apply-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('applied')
  const git = (...args: string[]) => execFileSync('git', ['-C', approvalProject, ...args], { encoding: 'utf8' }).trim()
  expect(fs.readFileSync(path.join(approvalProject, 'src', 'components', 'Navigation.tsx'), 'utf8')).toContain('<RippleText')
  expect(fs.readFileSync(path.join(approvalProject, 'src', 'App.tsx'), 'utf8')).toContain('RipplePageForState')
  expect(git('status', '--porcelain')).not.toBe('')

  const portProbe = createServer()
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve))
  const runtimePort = (portProbe.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()))
  const viteCli = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
  const runtimeServer = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(runtimePort), '--strictPort'], { cwd: approvalProject, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let runtimeLogs = ''
  runtimeServer.stdout.setEncoding('utf8').on('data', chunk => { runtimeLogs += chunk })
  runtimeServer.stderr.setEncoding('utf8').on('data', chunk => { runtimeLogs += chunk })
  const runtimeUrl = `http://127.0.0.1:${runtimePort}/`
  const runtimePage = await page.context().newPage()
  try {
    await expect.poll(async () => (await fetch(runtimeUrl).catch(() => undefined))?.ok ?? false, { timeout: 30_000 }).toBe(true)
    await runtimePage.goto(runtimeUrl)
    await expect(runtimePage.getByRole('heading', { name: 'Home page' })).toBeVisible()
    await expect(runtimePage.getByText('Home-only brand', { exact: true })).toBeVisible()
    await runtimePage.getByRole('button', { name: 'Autumn route' }).click()
    await expect(runtimePage.getByRole('heading', { name: 'Autumn page' })).toBeVisible()
    await expect(runtimePage.getByText('Shared navigation brand', { exact: true })).toBeVisible()
    await expect(runtimePage.getByText('Home-only brand', { exact: true })).toHaveCount(0)

    await page.getByTestId('rollback-candidate').click()
    await expect(page.getByTestId('candidate-workflow')).toContainText('rolled-back')
    expect(git('status', '--porcelain')).toBe('')
    await runtimePage.goto(runtimeUrl)
    await expect(runtimePage.getByText('Shared navigation brand', { exact: true })).toBeVisible()
    await expect(runtimePage.getByText('Home-only brand', { exact: true })).toHaveCount(0)

    const historyRecord = page.getByTestId('candidate-history').locator('article').filter({ hasText: candidateId })
    await expect(historyRecord).toContainText('rolled-back')
    await expect(historyRecord).toContainText(patchHash.slice(0, 16))
    await historyRecord.getByRole('button', { name: '恢复记录' }).click()
    await expect(page.getByTestId('candidate-id')).toHaveText(candidateId)
    await expect(page.getByTestId('verification-state')).toContainText('PASSED')
    await expect(page.getByTestId('candidate-workflow')).toContainText('rolled-back')
    const restoredHistory = await page.request.get('http://127.0.0.1:4173/__ripple/api/history')
    const history = await restoredHistory.json()
    expect(history.history.find((item: { candidateId: string }) => item.candidateId === candidateId)).toMatchObject({ lifecycle: 'rolled-back', patchHash })
    candidateId = ''
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nApplied project Vite logs:\n${runtimeLogs}`)
  } finally {
    await runtimePage.close()
    runtimeServer.kill('SIGTERM')
    await new Promise<void>(resolve => runtimeServer.once('close', () => resolve()))
  }
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
  await page.getByTestId('toggle-candidate-preview').click()
  await expect(page.getByTestId('candidate-preview')).toBeVisible({ timeout: 75_000 })
  const preview = page.frameLocator('iframe[data-testid="candidate-preview"]')
  await expect(preview.getByText('山野器物 · Ripple UI验收', { exact: true })).toBeVisible({ timeout: 30_000 })
  for (const label of ['秋日手作节', '商品专题', '品牌故事']) {
    await preview.getByRole('button', { name: label, exact: true }).first().click()
    await expect(preview.getByText('山野器物 · Ripple UI验收', { exact: true })).toBeVisible()
  }
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-isolated-preview.png'), fullPage: true })
  await page.getByTestId('toggle-candidate-preview').click()
  await expect(page.getByTestId('candidate-preview')).toHaveCount(0)
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-shared-candidate.png'), fullPage: true })
  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  candidateId = ''
})
