import { expect, test } from '@playwright/test'
import { projectPreviewViewports } from '../src/core/project-viewports'
import { collectRuntimeIdentitySnapshot } from '../src/core/runtime-identity'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from 'node:net'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-workbench-browser-'))
const projectRoot = path.join(sandbox, 'site')
const boltProjectRoot = process.env.RIPPLE_BOLT_PROJECT
let boltDisposableRoot = ''
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence')
const dockerAvailable = process.platform === 'linux' && spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0
const expectedProjectViewports = projectPreviewViewports.map(({ name, width, height }) => ({ name, width, height }))

function summarizeViteTransformError(pathname: string, body: string): string {
  const text = body.replace(/<[^>]*>/g, ' ')
  const unresolvedImport = text.match(/Failed to resolve import\s+["']([^"']{1,160})["']\\s+from\\s+["']([^"']{1,160})["']/i)
  if (unresolvedImport) return `${pathname}: unresolved import ${unresolvedImport[1]} from ${unresolvedImport[2]}`
  const missingPackage = text.match(/Cannot find package ["']([^"']{1,160})["']/i)
  if (missingPackage) return `${pathname}: missing package ${missingPackage[1]}`
  const unknownUtility = text.match(/Cannot apply unknown utility class ["']([^"']{1,120})["']/i)
  if (unknownUtility) return `${pathname}: unknown utility ${unknownUtility[1]}`
  return `${pathname}: Vite HTTP 500, ${Buffer.byteLength(body)} bytes, sha256=${createHash('sha256').update(body).digest('hex')}`
}
function readPreviewContainerLogs(previewId: string): string {
  try {
    const containers = execFileSync('docker', [
      'ps', '--all', '--quiet',
      '--filter', 'label=com.ripple.preview=true',
      '--filter', 'label=com.ripple.candidate=' + previewId,
    ], { encoding: 'utf8', timeout: 10_000 }).trim().split(/\r?\n/).filter(Boolean)
    if (!containers.length) return 'no source-preview container found'
    return containers.map(container => {
      const role = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.ripple.preview.role"}}', container], {
        encoding: 'utf8', timeout: 10_000,
      }).trim()
      const logs = execFileSync('docker', ['logs', '--tail', '120', container], {
        encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
      })
      return '[' + role + ' ' + container + ']\n' + logs.slice(-8_000)
    }).join('\n\n')
  } catch (error) {
    return 'unable to read source-preview container logs: ' + (error instanceof Error ? error.message : String(error))
  }
}

let candidateId = ''
let sourcePreviewProjectId = ''
let sourcePreviewId = ''
fs.mkdirSync(evidenceRoot, { recursive: true })

test.beforeAll(() => {
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'workbench-browser-project', private: true }))
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  fs.mkdirSync(path.join(projectRoot, 'tooling'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'configs'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: './tooling/react-site.json' }] }))
  fs.writeFileSync(path.join(projectRoot, 'configs', 'shared-aliases.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', baseUrl: '..', paths: { '@/*': ['src/*'] } } }))
  fs.writeFileSync(path.join(projectRoot, 'tooling', 'react-site.json'), JSON.stringify({ extends: '../configs/shared-aliases.json', compilerOptions: { composite: true }, include: ['../src'] }))
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from '@/App'; createRoot(document.getElementById('root')!).render(<App />)`)
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
  if (sourcePreviewProjectId && sourcePreviewId) await fetch('http://127.0.0.1:4173/__ripple/api/project/preview/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: sourcePreviewProjectId, previewId: sourcePreviewId }) }).catch(() => undefined)
  if (boltDisposableRoot && boltProjectRoot) execFileSync('git', ['-C', boltProjectRoot, 'worktree', 'remove', '--force', boltDisposableRoot], { stdio: 'pipe' })
  fs.rmSync(sandbox, { recursive: true, force: true })
})

function createBoltDisposableProject(): string {
  if (!boltProjectRoot) throw new Error('RIPPLE_BOLT_PROJECT is required')
  const disposableRoot = path.join(sandbox, 'bolt-disposable')
  execFileSync('git', ['-C', boltProjectRoot, 'worktree', 'add', '--detach', disposableRoot, 'HEAD'], { stdio: 'pipe' })
  boltDisposableRoot = disposableRoot
  const dependencies = path.join(boltProjectRoot, 'node_modules')
  if (!fs.existsSync(dependencies)) throw new Error('Bolt dependency tree is missing; prepare it with npm ci --ignore-scripts in the isolated acceptance job')
  fs.symlinkSync(dependencies, path.join(disposableRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return disposableRoot
}

async function expectCandidateRetired(id: string) {
  const response = await fetch('http://127.0.0.1:4173/__ripple/api/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: id }) })
  expect(response.status, 'discarding an already-retired candidate must not find a stale API entry').toBe(404)
  const worktrees = execFileSync('git', ['-C', projectRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.startsWith('worktree '))
  expect(worktrees, 'candidate cleanup must leave only the source project worktree').toHaveLength(1)
}

function createApprovalProject(titles = { home: 'Home page', autumn: 'Autumn page' }, withMedia = false): string {
  const root = fs.mkdtempSync(path.join(sandbox, 'approval-flow-project-'))
  fs.chmodSync(root, 0o755)
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndist/\n')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ripple-approval-flow', private: true, type: 'module' }))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />)")
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), "import { useState } from 'react'; import { Navigation } from './components/Navigation'; import { HomePage } from './pages/HomePage'; import { AutumnPage } from './pages/AutumnPage'; export function App(){const [page,setPage]=useState('home'); return <><button onClick={()=>setPage('home')}>Home route</button><button onClick={()=>setPage('autumn')}>Autumn route</button><Navigation/>{page==='home' && <HomePage/>}{page==='autumn' && <AutumnPage/>}</>}")
  fs.writeFileSync(path.join(root, 'src', 'components', 'Navigation.tsx'), 'export function Navigation(){return <nav aria-label="Primary"><a>Shared navigation brand</a><span>Common route marker</span></nav>}')
  fs.writeFileSync(path.join(root, 'tailwind.config.js'), "export default { theme: { extend: { colors: { brand: { 700: '#246' } } } } }")
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `import { useState } from 'react'; export function HomePage(){const [clicks,setClicks]=useState(0); return <main>${withMedia ? '<img alt="Home hero" src="/hero.jpg" />' : ''}<h1 className="text-brand-700">${titles.home}</h1><button onClick={()=>setClicks(clicks+1)}>Clicks {clicks}</button></main>}`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), `export function AutumnPage(){return <main><h1>${titles.autumn}</h1></main>}`)
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
  const homeMarkerSuggestions = page.getByLabel('home 页面标记建议')
  const autumnMarkerSuggestions = page.getByLabel('autumn 页面标记建议')
  await expect(homeMarkerSuggestions.locator('option').filter({ hasText: 'Baseline title' })).toHaveCount(1)
  await expect(autumnMarkerSuggestions.locator('option').filter({ hasText: 'Autumn baseline' })).toHaveCount(1)
  await expect(homeMarkerSuggestions.locator('option').filter({ hasText: 'Shared navigation brand' })).toHaveCount(0)
  await expect(page.locator('.verification-marker-suggestion small').first()).toContainText('不是浏览器证据')
  await page.getByLabel('home 页面访问路径').fill('/')
  await page.getByLabel('home 页面标记文字').fill('Manual home acceptance marker')
  await page.getByTestId('analyze-project').click()
  await expect(page.getByLabel('home 页面标记文字')).toHaveValue('Manual home acceptance marker')
  await expect(page.getByLabel('home 页面标记建议').locator('option').filter({ hasText: 'Baseline title' })).toHaveCount(1)
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

  if (dockerAvailable) {
    await page.route('https://assets.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64') }))
const sourcePreviewResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/project/preview') && response.status() === 200)
    await page.getByTestId('toggle-project-preview').click()
    const sourcePreview = await (await sourcePreviewResponse).json() as { projectId: string; previewId: string; sourceDigest: string; url: string }
    sourcePreviewProjectId = sourcePreview.projectId
    sourcePreviewId = sourcePreview.previewId
    expect(sourcePreview.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(new URL(sourcePreview.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    const projectFrame = page.frameLocator('iframe[data-testid="project-preview"]')
    await expect(projectFrame.getByRole('heading', { name: 'Baseline title' })).toBeVisible({ timeout: 90_000 })
    const firstFrameElement = await page.getByTestId('project-preview').elementHandle()
    await page.getByTestId('project-preview-reload').click()
    await expect(projectFrame.getByRole('heading', { name: 'Baseline title' })).toBeVisible({ timeout: 90_000 })
    expect(await firstFrameElement!.evaluate(element => element.isConnected)).toBe(false)
    expect(await page.getByTestId('project-preview').getAttribute('src')).toBe(sourcePreview.url)
    await projectFrame.locator('body').screenshot({ path: path.join(evidenceRoot, 'workbench-source-preview-1440.png') })
    await page.getByTestId('project-preview-viewport-375').click()
    const projectFrameHandle = page.frames().find(frame => frame.url() === sourcePreview.url)
    expect(projectFrameHandle).toBeTruthy()
    await expect.poll(() => projectFrameHandle!.evaluate(() => innerWidth)).toBe(375)
    await projectFrame.locator('body').screenshot({ path: path.join(evidenceRoot, 'workbench-source-preview-375.png') })
    await page.getByTestId('project-preview-viewport-1440').click()
    await page.getByTestId('toggle-project-element-selection').click()
    await projectFrame.getByRole('heading', { name: 'Baseline title' }).click()
    await expect(page.getByTestId('selected-source')).toContainText('PROJECT SOURCE MAPPING', { timeout: 15_000 })
    await expect(page.getByTestId('selected-jsx-source')).toContainText('src/pages/HomePage.tsx#')
    const selectedSourceRef = await projectFrameHandle!.locator('h1').getAttribute('data-ripple-source')
    expect(selectedSourceRef).toMatch(/^jsx:src\/pages\/HomePage\.tsx#\d+$/)
    const titleId = await page.getByTestId('target-select').locator('option').filter({ hasText: 'Baseline title' }).getAttribute('value')
    expect(titleId).toBeTruthy()
    await page.getByTestId(`use-source-text-${titleId}`).click()
    await expect(page.getByTestId('target-select')).toHaveValue(titleId!)
    await expect(page.getByTestId('after-input')).toHaveValue('Baseline title')
    await expect(page.getByTestId('after-input')).toBeFocused()
    expect(await page.getByTestId('after-input').evaluate(element => (element as HTMLInputElement).selectionEnd)).toBe('Baseline title'.length)
    await expect(page.getByTestId('intent-input')).toHaveValue('')
    await expect(page.getByTestId('edit-panel')).toBeInViewport()
    await page.getByTestId('toggle-project-preview').click()
    await expect(page.getByTestId('project-preview')).toHaveCount(0)
    const staleSelection = await page.request.post('http://127.0.0.1:4173/__ripple/api/project/source-selection', { data: {
      projectId: sourcePreview.projectId, previewId: sourcePreview.previewId, sourceDigest: sourcePreview.sourceDigest, sourceRef: selectedSourceRef,
    } })
    expect(staleSelection.status()).toBe(409)
    expect(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
    sourcePreviewId = ''
    sourcePreviewProjectId = ''
  } else if (process.env.CI) {
    throw new Error('Docker-backed read-only project preview and source picking are mandatory in CI')
  }

  await page.getByTestId('intent-input').fill('Update only the home headline and primary action while preserving other page behavior.')
  const targetSelect = page.getByTestId('target-select')
  const titleId = await targetSelect.locator('option').filter({ hasText: 'Baseline title' }).getAttribute('value')
  expect(titleId).toBeTruthy()
  await targetSelect.selectOption(titleId!)
  await page.getByTestId('after-input').fill('Candidate title')
  await page.getByTestId('add-operation').click()
  await expect(homeMarkerSuggestions.locator('option').filter({ hasText: 'Baseline title' })).toHaveCount(0)
  await expect(page.getByLabel('home 页面标记文字')).toHaveValue('Manual home acceptance marker')
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
  await page.getByLabel('home 页面访问路径').fill('/')
  await page.getByLabel('home 页面标记文字').fill('Home route')
  const scopePlan = page.getByTestId('scope-effect-preview')
  await expect(scopePlan).toContainText('计划预览 · 不是浏览器 Evidence')
  const homePlan = scopePlan.locator('.scope-effect-row').filter({ has: page.getByText('page:home', { exact: true }) })
  const autumnPlan = scopePlan.locator('.scope-effect-row').filter({ has: page.getByText('page:autumn', { exact: true }) })
  await expect(homePlan).toHaveCount(2)
  const titlePlan = homePlan.filter({ hasText: 'Baseline title' })
  const actionPlan = homePlan.filter({ hasText: 'Browse items' })
  await expect(titlePlan).toHaveCount(1)
  await expect(titlePlan).toContainText('Candidate title')
  await expect(titlePlan).toContainText('将修改')
  await expect(actionPlan).toHaveCount(1)
  await expect(actionPlan).toContainText('Explore items')
  await expect(actionPlan).toContainText('将修改')
  await expect(autumnPlan).toHaveCount(2)
  for (const row of await autumnPlan.all()) {
    await expect(row).toContainText('UNKNOWN')
    await expect(row).not.toContainText('Candidate title')
  }
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
    await page.getByTestId('toggle-candidate-preview').click()
    const preview = page.frameLocator('iframe[data-testid="candidate-preview"]')
    await expect(preview.getByRole('heading', { name: 'Candidate title' })).toBeVisible({ timeout: 90_000 })
    await expect(preview.getByRole('heading', { name: 'Candidate title' })).toHaveAttribute('data-ripple-source', /jsx:src\/pages\/HomePage\.tsx#/)
    const candidateFrameUrl = await page.getByTestId('candidate-preview').getAttribute('src')
    const candidateFrameForIdentity = page.frames().find(frame => frame.url() === candidateFrameUrl)
    expect(candidateFrameForIdentity).toBeTruthy()
    const rawIdentity = await preview.getByRole('heading', { name: 'Candidate title' }).evaluate(target => ({
      sourceRef: target.getAttribute('data-ripple-source'),
      instance: target.getAttribute('data-ripple-instance'),
      certainty: target.getAttribute('data-ripple-identity-certainty'),
      fiberKeys: Object.keys(target).filter(key => key.startsWith('__reactFiber$')),
    }))
    const collectedIdentity = await candidateFrameForIdentity!.evaluate(collectRuntimeIdentitySnapshot, { root: 'h1' })
    const candidateTitle = collectedIdentity.records.find(item => item.sourceRef === rawIdentity.sourceRef)
    expect(candidateTitle, 'the clicked h1 has exactly one collector record').toBeTruthy()
    expect(rawIdentity.certainty, 'candidate generated provider must preserve proven component boundary').toBe('stable-react-instance')
    expect(candidateTitle?.certainty).toBe('stable-react-instance')
    expect(candidateTitle?.reasons).toEqual([])
    expect(candidateTitle?.sourceVersion).toMatch(/^[a-f0-9]{64}$/)
    expect(candidateTitle?.runtimeInstanceId).toBe(rawIdentity.instance)
    expect(candidateTitle?.sameSourceCount).toBe(1)
    expect(collectedIdentity.page).toEqual({ pathname: '/', search: '', hash: '' })
    // A forged parent-window message cannot masquerade as the candidate frame.
    await page.evaluate(() => window.postMessage({ type: 'ripple:element-selected', protocol: 'ripple-runtime-identity/v1',
      previewId: 'stale-preview', token: 'wrong-nonce', sourceRef: 'jsx:bad#0', identityCertainty: 'stable-react-instance',
      tagName: 'h1', text: 'forged' }, '*'))
    await page.getByTestId('toggle-element-selection').click()
    await preview.getByRole('heading', { name: 'Candidate title' }).click()
    await expect(page.getByTestId('selected-source')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('selected-jsx-source')).toContainText('src/pages/HomePage.tsx#')
    await expect(page.getByTestId('selected-source')).toContainText('Patch')
    await expect(page.getByTestId('selected-source')).toContainText('stable-react-instance')
    const previewUrl = await page.getByTestId('candidate-preview').getAttribute('src')
    const previewFrame = page.frames().find(frame => frame.url() === previewUrl)
    expect(previewFrame).toBeTruthy()
    for (const { width } of projectPreviewViewports) {
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
    fs.writeFileSync(path.join(evidenceRoot, 'workbench-verification-execution.json'), JSON.stringify(executionRecord, null, 2))
    await expect(assertionCards.filter({ hasText: 'target-change' })).toContainText('PASS')
    await expect(assertionCards.filter({ hasText: 'non-target-preserved' })).toContainText('PASS')
    await expect(assertionCards.filter({ hasText: 'source-mapping' })).toContainText('PASS')
    await expect(assertionCards.filter({ hasText: 'interaction' })).toContainText('UNKNOWN')
    await expect(assertionCards.filter({ hasText: 'scope-propagation' })).toContainText('UNKNOWN')
    const verificationImages = page.getByTestId('verification-evidence').locator('img')
    await expect(verificationImages).toHaveCount(projectPreviewViewports.length)
    await expect.poll(() => verificationImages.evaluateAll(images => images.every(image => {
      const rendered = image as HTMLImageElement
      return rendered.complete && rendered.naturalWidth > 0
    }))).toBe(true)
    expect(executionRecord).toMatchObject({ candidateId, patchHash: expect.any(String), candidateTreeDigest: expect.any(String), scopeVersion: 1 })
    expect(executionRecord.viewports).toEqual(expectedProjectViewports)
    expect(executionRecord.evidence.map((item: { viewport: { width: number } }) => item.viewport.width)).toEqual(expectedProjectViewports.map(viewport => viewport.width))
    expect(executionRecord.evidence.every((item: { result: string }) => item.result === 'pass')).toBe(true)
    expect(executionRecord.baselineComparisons).toHaveLength(projectPreviewViewports.length)
    expect(executionRecord.baselineComparisons.every((comparison: { matched: boolean; baselineDigest: string; candidateDigest: string; maskedOperationIds: string[] }) =>
      comparison.matched && comparison.baselineDigest === comparison.candidateDigest && comparison.maskedOperationIds.length === 2)).toBe(true)
    const screenshotUrls = await verificationImages.evaluateAll(images => images.map(image => (image as HTMLImageElement).src))
    const screenshotResponses = await Promise.all(screenshotUrls.map(url => page.request.get(url)))
    for (const [index, screenshot] of screenshotResponses.entries()) {
      expect(screenshot.ok()).toBe(true)
      const bytes = await screenshot.body()
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(executionRecord.evidence[index].artifactHash)
      fs.writeFileSync(path.join(evidenceRoot, `workbench-verification-${projectPreviewViewports[index].width}.png`), bytes)
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
  await expect(page.getByText('已证明显示于 /autumn、/home')).toBeVisible()
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

test('records trusted four-viewport evidence while unsupported assertions stay unknown', async ({ page }) => {
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
  await expect(images).toHaveCount(projectPreviewViewports.length)
  const urls = await images.evaluateAll(elements => elements.map(element => (element as HTMLImageElement).src))
  expect(executionRecord.viewports).toEqual(expectedProjectViewports)
  expect(executionRecord.evidence.map((item: { viewport: { width: number } }) => item.viewport.width)).toEqual(expectedProjectViewports.map(viewport => viewport.width))
  expect(executionRecord.evidence.every((item: { result: string }) => item.result === 'pass')).toBe(true)
  for (const [index, url] of urls.entries()) {
    const screenshot = await page.request.get(url)
    expect(screenshot.ok()).toBe(true)
    const bytes = await screenshot.body()
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(executionRecord.evidence[index].artifactHash)
    fs.writeFileSync(path.join(evidenceRoot, `workbench-single-target-${projectPreviewViewports[index].width}.png`), bytes)
  }

  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  candidateId = ''
})

test('keeps ambiguous shared route markers unknown when SPA navigation leaves the verifier on the wrong page', async ({ page }) => {
  test.setTimeout(180_000)
  test.skip(!dockerAvailable, 'Docker-backed VerificationRunner is required to attest route identity')
  const project = createApprovalProject()
  await page.goto('/')
  await page.getByTestId('project-path').fill(project)
  await page.getByTestId('analyze-project').click()
  const targetSelect = page.getByTestId('target-select')
  const brandId = await targetSelect.locator('option').filter({ hasText: 'Shared navigation brand' }).getAttribute('value')
  expect(brandId).toBeTruthy()
  await targetSelect.selectOption(brandId!)
  await page.getByTestId('intent-input').fill('Update the shared navigation label while verifying both routed pages.')
  await page.getByTestId('after-input').fill('Verified navigation label')
  await page.getByTestId('add-operation').click()
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('scope-page:autumn').selectOption('include')
  await page.getByLabel('home 页面访问路径').fill('/')
  await page.getByLabel('home 页面标记文字').fill('Common route marker')
  await page.getByLabel('autumn 页面访问路径').fill('/')
  await page.getByLabel('autumn 页面标记文字').fill('Common route marker')
  await page.getByLabel('autumn 页面导航控件名称').fill('Home route')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByTestId('candidate-id')).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  await page.getByTestId('run-verification').click()
  await expect(page.getByTestId('verification-state')).toContainText(/INCOMPLETE|RISKS/, { timeout: 120_000 })
  const assertions = page.getByTestId('verification-assertions')
  const scopeAssertion = assertions.locator('div').filter({ hasText: 'scope-propagation' })
  await expect(scopeAssertion).toContainText('UNKNOWN')
  await expect(scopeAssertion).toContainText('route marker')
  await expect(assertions.locator('div').filter({ hasText: 'target-change' })).toContainText('PASS')
  const recordHref = await page.locator('.verification-record a').getAttribute('href')
  expect(recordHref).toBeTruthy()
  const execution = await (await page.request.get(new URL(recordHref!, 'http://127.0.0.1:4173').toString())).json()
  expect(execution).toMatchObject({ candidateId })
  const observations = execution.scopeObservations as Array<{
    pageRef: string
    baselineMarkerVisible: boolean
    candidateMarkerVisible: boolean
    baselineMarkerMatchCount: number
    candidateMarkerMatchCount: number
    baselineRouteIdentity: string
    candidateRouteIdentity: string
    viewport: { width: number; height: number }
  }>
  expect(observations).toHaveLength(2 * projectPreviewViewports.length)
  for (const observation of observations) {
    expect(observation.baselineMarkerVisible).toBe(true)
    expect(observation.candidateMarkerVisible).toBe(true)
    expect(observation.baselineMarkerMatchCount).toBe(1)
    expect(observation.candidateMarkerMatchCount).toBe(1)
    expect(observation.baselineRouteIdentity).toBe('ambiguous')
    expect(observation.candidateRouteIdentity).toBe('ambiguous')
  }
  fs.writeFileSync(path.join(evidenceRoot, 'workbench-ambiguous-route-identity.json'), JSON.stringify(execution, null, 2))
  await page.getByTestId('discard-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toHaveCount(0)
  candidateId = ''
})

test('suggests Scope from the union and intersection of proven consumers, and disables unsupported local overrides', async ({ page }) => {
  test.setTimeout(120_000)
  const project = createApprovalProject()
  await page.goto('/')
  await page.getByTestId('project-path').fill(project)
  await page.getByTestId('analyze-project').click()
  const targetSelect = page.getByTestId('target-select')
  const targetId = await targetSelect.locator('option').filter({ hasText: 'Shared navigation brand' }).getAttribute('value')
  expect(targetId).toBeTruthy()
  await targetSelect.selectOption(targetId!)
  await page.getByTestId('intent-input').fill('Change only the Home navigation label and keep the shared value for Autumn.')
  await page.getByTestId('after-input').fill('Home-only brand')
  await page.getByTestId('add-operation').click()

  const homeTitleId = await targetSelect.locator('option').filter({ hasText: 'Home page' }).getAttribute('value')
  expect(homeTitleId).toBeTruthy()
  await targetSelect.selectOption(homeTitleId!)
  await page.getByTestId('after-input').fill('Home-only title')
  await page.getByTestId('add-operation').click()
  await expect(page.getByText('2 项', { exact: true })).toBeVisible()

  const scopePlan = page.getByTestId('scope-effect-preview')
  await page.getByTestId('scope-preset-shared').click()
  await expect(page.getByTestId('scope-page:home')).toHaveValue('include')
  await expect(page.getByTestId('scope-page:autumn')).toHaveValue('include')
  await expect(page.getByRole('radio', { name: /修改共享来源/ })).toBeChecked()
  await expect(scopePlan).toContainText('计划预览 · 不是浏览器 Evidence')
  await expect(scopePlan.locator('.scope-effect-row')).toHaveCount(4)
  const homeRows = scopePlan.locator('.scope-effect-row').filter({ hasText: 'page:home' })
  const autumnRows = scopePlan.locator('.scope-effect-row').filter({ hasText: 'page:autumn' })
  await expect(homeRows).toHaveCount(2)
  for (const row of await homeRows.all()) await expect(row).toContainText('将修改')
  await expect(autumnRows).toHaveCount(2)
  await expect(autumnRows.filter({ hasText: 'Shared navigation brand' })).toContainText('将修改')
  await expect(autumnRows.filter({ hasText: 'Home page' })).toContainText('UNKNOWN')

  await page.getByTestId('scope-preset-page').click()
  await expect(page.getByTestId('scope-page:home')).toHaveValue('include')
  await expect(page.getByTestId('scope-page:autumn')).toHaveValue('exclude')
  await expect(page.getByLabel('选择局部覆盖页面')).toHaveValue('page:home')
  await expect(homeRows.filter({ hasText: 'Shared navigation brand' })).toContainText('Home-only brand')
  await expect(homeRows.filter({ hasText: 'Home page' })).toContainText('Home-only title')
  await expect(autumnRows.filter({ hasText: 'Shared navigation brand' })).toContainText('保持当前值')
  await expect(autumnRows.filter({ hasText: 'Home page' })).toContainText('UNKNOWN')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await scopePlan.screenshot({ path: path.join(evidenceRoot, 'scope-effect-preview-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await scopePlan.screenshot({ path: path.join(evidenceRoot, 'scope-effect-preview-mobile.png') })

  const disjointProject = createApprovalProject({ home: 'Disjoint Home title', autumn: 'Disjoint Autumn title' })
  await page.getByTestId('project-path').fill(disjointProject)
  await page.getByTestId('analyze-project').click()
  const disjointTargets = page.getByTestId('target-select')
  await expect(disjointTargets.locator('option').filter({ hasText: 'Disjoint Home title' })).toHaveCount(1, { timeout: 30_000 })
  const disjointHomeId = await disjointTargets.locator('option').filter({ hasText: 'Disjoint Home title' }).getAttribute('value')
  expect(disjointHomeId).toBeTruthy()
  await disjointTargets.selectOption(disjointHomeId!)
  await page.getByTestId('intent-input').fill('Update two unrelated page titles independently.')
  await page.getByTestId('after-input').fill('Home title v2')
  await page.getByTestId('add-operation').click()
  const autumnTitleId = await disjointTargets.locator('option').filter({ hasText: 'Disjoint Autumn title' }).getAttribute('value')
  expect(autumnTitleId).toBeTruthy()
  await disjointTargets.selectOption(autumnTitleId!)
  await page.getByTestId('after-input').fill('Autumn title v2')
  await page.getByTestId('add-operation').click()
  await expect(page.getByTestId('scope-preset-page')).toBeDisabled()
  await expect(page.getByTestId('scope-suggestions')).toContainText('没有共同的已证明消费者')
})

test('keeps local-override suggestions disabled for MEDIA and TOKEN operations', async ({ page }) => {
  const project = createApprovalProject(undefined, true)
  await page.goto('/')
  await page.getByTestId('project-path').fill(project)
  await page.getByTestId('analyze-project').click()
  const targets = page.getByTestId('target-select')
  const mediaOptions = targets.locator('option').filter({ hasText: 'MEDIA ·' })
  await expect(mediaOptions).toHaveCount(1)
  const mediaId = await mediaOptions.getAttribute('value')
  expect(mediaId).toBeTruthy()
  await targets.selectOption(mediaId!)
  await page.getByTestId('intent-input').fill('Update the home hero asset and color token.')
  await page.getByTestId('after-input').fill('/hero-next.jpg')
  await page.getByTestId('add-operation').click()

  const tokenOptions = targets.locator('option').filter({ hasText: 'TOKEN ·' })
  await expect(tokenOptions).toHaveCount(1)
  const tokenId = await tokenOptions.getAttribute('value')
  expect(tokenId).toBeTruthy()
  await targets.selectOption(tokenId!)
  await page.getByTestId('after-input').fill('#135')
  await page.getByTestId('add-operation').click()
  await expect(page.getByTestId('scope-preset-shared')).toBeEnabled()
  await expect(page.getByTestId('scope-preset-page')).toBeDisabled()
  await expect(page.getByTestId('scope-suggestions')).toContainText('仅支持 JSX 文本单页覆盖')
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
  await page.getByTestId('after-input').fill('Home-only brand')
  await page.getByTestId('add-operation').click()
  await page.getByRole('radio', { name: /仅在一个页面创建可维护覆盖/ }).check()
  await page.getByLabel('选择局部覆盖页面').selectOption('page:home')
  await page.getByTestId('scope-page:home').selectOption('include')
  await page.getByTestId('scope-page:autumn').selectOption('exclude')
  await page.getByLabel('home 页面访问路径').fill('/')
  await page.getByLabel('home 页面标记文字').fill('Home page')
  await page.getByLabel('autumn 页面访问路径').fill('/')
  await page.getByLabel('autumn 页面标记文字').fill('Autumn page')
  await page.getByLabel('autumn 页面导航控件名称').fill('Autumn route')
  await page.getByTestId('add-verification-interaction').click()
  await page.getByLabel('交互检查 1 控件名称').fill('Clicks 0')
  await page.getByLabel('交互检查 1 预期结果').fill('Clicks 1')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByTestId('candidate-id')).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  const patchHash = (await page.locator('.hash-grid > div').nth(1).locator('code').innerText()).trim()
  expect(patchHash).toMatch(/^[a-f0-9]{64}$/)
  await page.getByTestId('verify-candidate').click()
  const verificationState = page.getByTestId('verification-state')
  await expect.poll(async () => /PASSED|INCOMPLETE|RISKS|FAILED TO RUN|STALE/.test(await verificationState.locator('span').innerText()), { timeout: 180_000 }).toBe(true)
  const verificationSummary = await verificationState.innerText()
  expect(verificationSummary, `Verification result: ${verificationSummary}`).toContain('PASSED')
  const assertions = page.getByTestId('verification-assertions')
  await expect(assertions).toBeVisible()
  for (const assertionId of ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']) {
    await expect(assertions.locator('div').filter({ hasText: assertionId })).toContainText('PASS')
  }
  const recordHref = await page.locator('.verification-record a').getAttribute('href')
  expect(recordHref).toBeTruthy()
  const executionResponse = await page.request.get(new URL(recordHref!, 'http://127.0.0.1:4173').toString())
  expect(executionResponse.ok()).toBe(true)
  const execution = await executionResponse.json()
  expect(execution).toMatchObject({ candidateId, patchHash, verificationContractHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
  const expectedScopePages = [
    { pageRef: 'page:home', markerText: 'Home page', candidateText: 'Home-only brand' },
    { pageRef: 'page:autumn', markerText: 'Autumn page', candidateText: 'Shared navigation brand' },
  ]
  const scopeObservations = execution.scopeObservations as Array<{
    pageRef: string; route: string; markerText: string; viewport: { width: number; height: number }
    baselineMarkerVisible: boolean; candidateMarkerVisible: boolean
    operations: Array<{ operationId: string; expectedBaselineText: string; expectedCandidateText: string; baselineValues: string[]; candidateValues: string[] }>
  }>
  const expectedObservationKeys = expectedScopePages.flatMap(scopePage => projectPreviewViewports.map(viewport =>
    `${scopePage.pageRef}:${viewport.width}x${viewport.height}`,
  ))
  const observedKeys = scopeObservations.map(item => `${item.pageRef}:${item.viewport.width}x${item.viewport.height}`)
  expect(scopeObservations).toHaveLength(expectedScopePages.length * projectPreviewViewports.length)
  expect(new Set(observedKeys).size).toBe(expectedObservationKeys.length)
  expect([...observedKeys].sort()).toEqual([...expectedObservationKeys].sort())
  for (const scopePage of expectedScopePages) {
    for (const viewport of projectPreviewViewports) {
      const observation = scopeObservations.find(item => item.pageRef === scopePage.pageRef && item.viewport.width === viewport.width && item.viewport.height === viewport.height)
      expect(observation).toMatchObject({
        route: '/', markerText: scopePage.markerText, baselineMarkerVisible: true, candidateMarkerVisible: true,
        operations: [{
          expectedBaselineText: 'Shared navigation brand', expectedCandidateText: scopePage.candidateText,
          baselineValues: ['Shared navigation brand'], candidateValues: [scopePage.candidateText],
        }],
      })
      expect(observation?.operations).toHaveLength(1)
    }
  }
  const interactionObservations = execution.interactionObservations as Array<{
    pageRef: string; viewport: { width: number; height: number }; baselinePassed: boolean; candidatePassed: boolean
  }>
  expect(interactionObservations).toHaveLength(projectPreviewViewports.length)
  expect(interactionObservations.map(item => `${item.pageRef}:${item.viewport.width}x${item.viewport.height}`).sort()).toEqual(
    projectPreviewViewports.map(viewport => `page:home:${viewport.width}x${viewport.height}`).sort(),
  )
  expect(interactionObservations.every(item => item.baselinePassed && item.candidatePassed)).toBe(true)

  await page.getByTestId('approve-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('已批准')
  await page.getByTestId('apply-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('applied')
  await expect(page.getByTestId('rollback-candidate'), 'the exact applied candidate tree must remain rollbackable').toBeEnabled()
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

    await expect(page.getByTestId('rollback-candidate'), 'running the applied project must not invalidate its patch record').toBeEnabled()
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

test('runs the Bolt shared TEXT workflow through the workbench, applies the same patch in a disposable worktree, then rolls it back', async ({ page }) => {
  test.setTimeout(900_000)
  test.skip(!boltProjectRoot, 'RIPPLE_BOLT_PROJECT is only available in the private Bolt acceptance workflow')
  if (!dockerAvailable) throw new Error('Docker-backed ProjectRunner and VerificationRunner are mandatory for the private Bolt acceptance workflow')

  expect(fs.existsSync(path.join(boltProjectRoot!, 'package.json'))).toBe(true)
  expect(fs.existsSync(path.join(boltProjectRoot!, 'package-lock.json'))).toBe(true)
  expect(fs.statSync(path.join(boltProjectRoot!, 'src')).isDirectory()).toBe(true)
  const boltGitRoot = execFileSync('git', ['-C', boltProjectRoot!, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  expect(path.resolve(boltGitRoot)).toBe(path.resolve(boltProjectRoot!))
  const originalHead = execFileSync('git', ['-C', boltProjectRoot!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  expect(originalHead).toBe(process.env.BOLT_REPO_REF)
  const originalStatus = execFileSync('git', ['-C', boltProjectRoot!, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  expect(originalStatus).toBe('')
  const appliedProject = createBoltDisposableProject()
  const disposableGitRoot = execFileSync('git', ['-C', appliedProject, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  expect(path.resolve(disposableGitRoot)).toBe(path.resolve(appliedProject))
  expect(execFileSync('git', ['-C', appliedProject, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(originalHead)
  expect(fs.realpathSync(path.join(appliedProject, 'node_modules'))).toBe(fs.realpathSync(path.join(boltProjectRoot!, 'node_modules')))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByTestId('project-path').fill(appliedProject)
  await page.getByTestId('analyze-project').click()
  await expect(page.locator('.metric-card').filter({ hasText: '实际页面状态' })).toContainText('4')
  await expect(page.locator('.component-row').filter({ hasText: 'Footer' })).toContainText('/home')
  await expect(page.locator('.component-row').filter({ hasText: 'Footer' })).toContainText('/story')

  // Explicitly approve only the exact Pexels image URLs and Google Fonts stylesheet URLs referenced by this pinned Bolt revision.
  const resourceRows = page.getByTestId('preview-resource-policy').locator('li')
  const resourceGroups = [
    resourceRows.filter({ hasText: 'https://images.pexels.com/' }),
    resourceRows.filter({ hasText: 'https://fonts.googleapis.com/' }),
  ]
  for (const rows of resourceGroups) {
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) await rows.nth(index).getByTestId('add-preview-resource').click()
  }
  const resourceDraft = page.getByTestId('preview-resource-draft')
  const approvedResourceUrls = (await resourceDraft.inputValue()).split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  expect(approvedResourceUrls.some(value => new URL(value).hostname === 'images.pexels.com')).toBe(true)
  expect(approvedResourceUrls.some(value => new URL(value).hostname === 'fonts.googleapis.com')).toBe(true)
  expect(approvedResourceUrls.every(value => ['images.pexels.com', 'fonts.googleapis.com'].includes(new URL(value).hostname))).toBe(true)
  await page.getByTestId('save-preview-resources').click()
  await expect(resourceDraft).toHaveValue(/images\.pexels\.com/)
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-analysis.png'), fullPage: true })

  const pexelsResponses: Array<Promise<{ url: string; status: number; contentType: string; sha256: string; bytes: Buffer }>> = []
  page.on('response', response => {
    if (!response.url().startsWith('https://images.pexels.com/')) return
    pexelsResponses.push((async () => {
      const bytes = await response.body()
      return {
        url: response.url(),
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes,
      }
    })())
  })
  const sourcePreviewResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/project/preview') && response.status() === 200)
  const sourcePreviewRequestFailures: Array<{ url: string; error: string }> = []
  page.on('requestfailed', request => sourcePreviewRequestFailures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' }))
  const sourcePreviewTransformErrors = new Map<string, { status: number; contentType: string; contentLength: string; body: Promise<string> }>()
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.port === '4173' || response.status() < 500 || !['/src/index.css', '/src/App.tsx'].includes(url.pathname)) return
    const headers = response.headers()
    sourcePreviewTransformErrors.set(url.pathname, {
      status: response.status(),
      contentType: headers['content-type'] ?? '',
      contentLength: headers['content-length'] ?? '',
      body: response.text().then(body => summarizeViteTransformError(url.pathname, body)).catch(() => url.pathname + ': unable to read Vite error response'),
    })
  })
  await page.getByTestId('toggle-project-preview').click()
  const sourcePreview = await (await sourcePreviewResponse).json() as { projectId: string; previewId: string; sourceDigest: string; url: string }
  sourcePreviewProjectId = sourcePreview.projectId
  sourcePreviewId = sourcePreview.previewId
  expect(sourcePreview.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(new URL(sourcePreview.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
  const sourcePreviewOrigin = new URL(sourcePreview.url).origin
  const sourcePreviewBrowserErrors: string[] = []
  page.on('console', message => {
    const location = message.location()
    if (message.type() === 'error' && location.url.startsWith(sourcePreviewOrigin)) sourcePreviewBrowserErrors.push('console: ' + message.text().slice(0, 500))
  })
  page.on('pageerror', error => sourcePreviewBrowserErrors.push('pageerror: ' + error.message.slice(0, 500)))
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.origin === sourcePreviewOrigin || ['images.pexels.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
      sourcePreviewBrowserErrors.push('requestfailed: ' + request.url() + ' (' + (request.failure()?.errorText ?? 'unknown') + ')')
    }
  })
  
  const projectFrame = page.frameLocator('iframe[data-testid="project-preview"]')
  let sourcePreviewRecovery: { failure: string; paths: string[]; relayProbes: Array<{ path: string; status: number }> } | undefined
  try {
    let initialLoad = 'loading'
    await expect.poll(async () => {
      if (await projectFrame.locator('footer').isVisible()) return initialLoad = 'rendered'
      if (sourcePreviewRequestFailures.some(failure => new URL(failure.url).origin === sourcePreviewOrigin && failure.error === 'net::ERR_NETWORK_CHANGED')) return initialLoad = 'network-changed'
      return 'loading'
    }, { timeout: 90_000 }).not.toBe('loading')
    if (initialLoad === 'network-changed') {
      const failedPaths = [...new Set(sourcePreviewRequestFailures.filter(failure => new URL(failure.url).origin === sourcePreviewOrigin && failure.error === 'net::ERR_NETWORK_CHANGED').map(failure => new URL(failure.url).pathname))]
      const relayProbes = await Promise.all(failedPaths.map(async failedPath => {
        const response = await fetch(new URL(failedPath, sourcePreview.url), { signal: AbortSignal.timeout(10_000) })
        return { path: failedPath, status: response.status }
      }))
      expect(relayProbes.every(probe => probe.status === 200), 'reload is allowed only when the same preview relay can serve each failed module').toBe(true)
      const failureCount = sourcePreviewRequestFailures.length
      await page.getByTestId('project-preview-reload').click()
      await expect(projectFrame.locator('footer')).toBeVisible({ timeout: 90_000 })
      expect(sourcePreviewRequestFailures.slice(failureCount).filter(failure => new URL(failure.url).origin === sourcePreviewOrigin), 'the recovered page must not retain failed source-preview requests').toEqual([])
      sourcePreviewRecovery = { failure: 'net::ERR_NETWORK_CHANGED', paths: failedPaths, relayProbes }
    }
  } catch (error) {
    const diagnostics = await Promise.all([...sourcePreviewTransformErrors].map(async ([url, failure]) =>
      url + ' [HTTP ' + failure.status + ', content-type=' + (failure.contentType || 'none') + ', content-length=' + (failure.contentLength || 'unspecified') + ']: ' + await failure.body))
    const browserErrors = sourcePreviewBrowserErrors.length ? sourcePreviewBrowserErrors.join('\n') : 'none recorded'
    const containerLogs = readPreviewContainerLogs(sourcePreviewId)
    // The relay ledger is what separates "the browser abandoned the request" from
    // "the preview answered", so it is attached before any conclusion is drawn.
    const relayReport = await page.request
      .get(`http://127.0.0.1:4173/__ripple/api/project/preview/report?projectId=${encodeURIComponent(sourcePreviewProjectId)}&previewId=${encodeURIComponent(sourcePreviewId)}`)
      .then(async report => (report.ok() ? await report.text() : `preview report HTTP ${report.status()}: ${await report.text()}`))
      .catch(failure => `preview report unavailable: ${failure instanceof Error ? failure.message : String(failure)}`)
    throw new Error((error instanceof Error ? error.message : String(error)) + '\nVite preview transform responses:\n' + (diagnostics.length ? diagnostics.join('\n\n') : 'none recorded') + '\nPreview browser errors:\n' + browserErrors + '\nPreview request failures:\n' + JSON.stringify(sourcePreviewRequestFailures.filter(failure => new URL(failure.url).origin === sourcePreviewOrigin)) + '\nPreview relay report:\n' + relayReport + '\nPreview container logs:\n' + containerLogs)
  }
  const heroImage = projectFrame.locator('img[alt="山野器物"]')
  await expect.poll(() => heroImage.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const auditedPexelsResponses = await Promise.all(pexelsResponses)
  const loadedPexelsImages = auditedPexelsResponses.filter(response => response.status === 200 && response.contentType.startsWith('image/') && /^[a-f0-9]{64}$/.test(response.sha256))
  expect(loadedPexelsImages.length).toBeGreaterThan(0)
  const sourceResourceDirectory = path.join(evidenceRoot, 'source-resource-snapshots')
  fs.mkdirSync(sourceResourceDirectory, { recursive: true })
  const sourceResourceAudit = loadedPexelsImages.map(({ bytes, ...resource }) => {
    const artifactPath = path.join('source-resource-snapshots', resource.sha256)
    fs.writeFileSync(path.join(evidenceRoot, artifactPath), bytes)
    return { ...resource, artifactPath }
  })
  fs.writeFileSync(path.join(evidenceRoot, 'bolt-resource-load-audit.json'), JSON.stringify({
    sourceCommit: originalHead,
    authorizedUrls: approvedResourceUrls,
    loadedImages: sourceResourceAudit,
    sourcePreviewRecovery: sourcePreviewRecovery ?? null,
  }, null, 2))
  await page.getByTestId('toggle-project-element-selection').click()
  const footerBrand = projectFrame.locator('footer span').filter({ hasText: '山野器物' }).first()
  await footerBrand.scrollIntoViewIfNeeded()
  await footerBrand.click()
  await expect(page.getByTestId('selected-jsx-source')).toContainText('src/components/Footer.tsx#')
  const setTargetButton = page.getByTestId('selected-source').getByRole('button', { name: '编辑这段文字：山野器物', exact: true })
  await expect(setTargetButton).toHaveCount(1)
  const brandTargetId = (await setTargetButton.getAttribute('data-testid'))!.replace('use-source-text-', '')
  await setTargetButton.click()
  await expect(page.getByTestId('target-select')).toHaveValue(brandTargetId)
  await page.getByTestId('toggle-project-preview').click()
  await expect(page.getByTestId('project-preview')).toHaveCount(0)
  sourcePreviewProjectId = ''
  sourcePreviewId = ''

  await page.getByTestId('intent-input').fill('Update the shared footer brand on every page without changing page content or navigation.')
  await page.getByTestId('after-input').fill('山野器物 · Ripple UI验收')
  await page.getByTestId('add-operation').click()
  for (const pageId of ['home', 'autumn', 'products', 'story']) await page.getByTestId(`scope-page:${pageId}`).selectOption('include')
  const verificationPages = [
    ['home', '山野之间，器以新生', ''],
    ['autumn', '秋日手作节 · 限定活动', '秋日手作节'],
    ['products', '器物全集', '商品专题'],
    ['story', '从山野，到日常', '品牌故事'],
  ] as const
  for (const [pageId, markerText, navigationName] of verificationPages) {
    await page.getByLabel(`${pageId} 页面访问路径`).fill('/')
    await page.getByLabel(`${pageId} 页面标记文字`).fill(markerText)
    if (navigationName) await page.getByLabel(`${pageId} 页面导航控件名称`).fill(navigationName)
  }
  await page.getByTestId('add-verification-interaction').click()
  await page.getByLabel('交互检查 1 所在页面').selectOption('page:home')
  await page.getByLabel('交互检查 1 控件名称').fill('浏览器物')
  await page.getByLabel('交互检查 1 预期结果').fill('器物全集')
  await page.getByTestId('create-real-candidate').click()
  await expect(page.getByRole('heading', { name: '候选补丁已生成' })).toBeVisible({ timeout: 30_000 })
  candidateId = (await page.getByTestId('candidate-id').innerText()).trim()
  const patchHash = (await page.locator('.hash-grid > div').nth(1).locator('code').innerText()).trim()
  await expect(page.getByTestId('candidate-diff')).toContainText('山野器物 · Ripple UI验收')
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-candidate.png'), fullPage: true })

  await page.getByTestId('verify-candidate').click()
  // Wait for a terminal verification state, then capture the full execution
  // record into evidence BEFORE asserting PASSED. Run #7 ended with a RISKS
  // verdict whose record was never persisted to the artifact, leaving its 872
  // browser errors unattributable; the record must survive a failing run.
  // The wait is class-based: the failed-to-run label ("FAILED TO RUN") contains
  // the substring "NOT RUN", so a text-based wait would never resolve there.
  await expect(page.getByTestId('verification-state')).not.toHaveClass(/verification-not-run/, { timeout: 480_000 })
  // The state class only leaves not-run at a terminal state (the workbench has
  // no running class); pin that contract explicitly so a future intermediate
  // state cannot race the record lookup below.
  await expect(page.getByTestId('verification-state')).toHaveClass(/verification-(passed|risks|incomplete|stale|failed-to-run)/)
  // FAILED TO RUN produces no trusted record; fail fast with the server's
  // reason (which now carries the runner progress tail) instead of hanging on
  // the missing record link until the test timeout. Run #8 burned the full
  // 15 minute budget this way and still had no diagnosis in the log.
  const recordLink = page.locator('.verification-record a')
  if (await recordLink.count() === 0) {
    const stateText = (await page.getByTestId('verification-state').innerText()).replace(/\s+/g, ' ').trim()
    throw new Error(`Verification ended without a trusted execution record. Workbench state: ${stateText}`)
  }
  const recordHref = await recordLink.getAttribute('href')
  expect(recordHref).toBeTruthy()
  const recordResponse = await page.request.get(new URL(recordHref!, 'http://127.0.0.1:4173').toString())
  expect(recordResponse.ok()).toBe(true)
  const execution = await recordResponse.json() as {
    browserErrorDetails?: { total: number; byCategory: Record<string, number>; samples: string[]; truncated: boolean }
    unavailableResources?: Array<{ url: string; reason: string }>
    runId: string; candidateId: string; patchHash: string; candidateTreeDigest: string; scopeVersion: number
    viewports: Array<{ name: string; width: number; height: number }>
    scopeObservations: Array<{ pageRef: string; viewport: { width: number; height: number }; operations: Array<{ baselineValues: string[]; candidateValues: string[] }> }>
    evidence: Array<{ artifactHash: string }>
    resourceSnapshots: Array<{ url: string; contentType: string; sha256: string; artifactPath: string; sizeBytes: number; source: string; upstreamSha256?: string }>
    loadedExternalResourceUrls: string[]
    blockedExternalResourceUrls: string[]
  }
  fs.writeFileSync(path.join(evidenceRoot, 'bolt-workbench-execution.json'), JSON.stringify(execution, null, 2))
  await expect(page.getByTestId('verification-state')).toContainText('PASSED', { timeout: 480_000 })
  const assertions = page.getByTestId('verification-assertions')
  for (const assertionId of ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']) {
    await expect(assertions.locator('div').filter({ hasText: assertionId })).toContainText('PASS')
  }
  expect(execution).toMatchObject({ candidateId, patchHash, scopeVersion: 1, candidateTreeDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(execution.viewports).toEqual(expectedProjectViewports)
  expect(execution.blockedExternalResourceUrls).toEqual([])
  const verifiedPexels = execution.resourceSnapshots.filter(resource => new URL(resource.url).hostname === 'images.pexels.com' && execution.loadedExternalResourceUrls.includes(resource.url))
  expect(verifiedPexels.length).toBeGreaterThan(0)
  for (const resource of verifiedPexels) {
    expect(resource.contentType.startsWith('image/')).toBe(true)
    expect(resource.artifactPath).toMatch(/^resources\/[a-f0-9]{64}$/)
    expect(resource.sizeBytes).toBeGreaterThan(0)
    expect(resource.sha256).toMatch(/^[a-f0-9]{64}$/)
    const exportedSnapshot = path.join(evidenceRoot, 'resource-snapshots', execution.runId, resource.sha256)
    const snapshotBytes = fs.readFileSync(exportedSnapshot)
    expect(snapshotBytes.length).toBe(resource.sizeBytes)
    expect(createHash('sha256').update(snapshotBytes).digest('hex')).toBe(resource.sha256)
  }
  const expectedScopeObservationKeys = verificationPages.flatMap(([pageId]) => projectPreviewViewports.map(viewport => `page:${pageId}:${viewport.width}x${viewport.height}`)).sort()
  const actualScopeObservationKeys = execution.scopeObservations.map(observation =>
    `${observation.pageRef}:${observation.viewport.width}x${observation.viewport.height}`,
  ).sort()
  expect(actualScopeObservationKeys).toEqual(expectedScopeObservationKeys)
  expect(execution.scopeObservations.every(observation => observation.operations.length === 1 &&
    observation.operations[0].baselineValues.length === 1 && observation.operations[0].candidateValues.length === 1 &&
    observation.operations[0].candidateValues[0] === '山野器物 · Ripple UI验收')).toBe(true)
  const evidenceImages = page.getByTestId('verification-evidence').locator('img')
  await expect(evidenceImages).toHaveCount(projectPreviewViewports.length)
  const evidenceUrls = await evidenceImages.evaluateAll(elements => elements.map(element => (element as HTMLImageElement).src))
  for (const [index, url] of evidenceUrls.entries()) {
    const screenshot = await page.request.get(url)
    expect(screenshot.ok()).toBe(true)
    const bytes = await screenshot.body()
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(execution.evidence[index].artifactHash)
    fs.writeFileSync(path.join(evidenceRoot, `bolt-workbench-${projectPreviewViewports[index].width}.png`), bytes)
  }

  await page.getByTestId('approve-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('已批准')
  await page.getByTestId('apply-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('applied')
  expect(fs.readFileSync(path.join(appliedProject, 'src', 'components', 'Footer.tsx'), 'utf8')).toContain('山野器物 · Ripple UI验收')
  expect(execFileSync('git', ['-C', appliedProject, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(originalHead)

  const restored = await (await page.request.post('http://127.0.0.1:4173/__ripple/api/candidate/restore', { data: { candidateId } })).json() as { analysis: { revision: { projectId: string } } }
  const appliedPreviewResponse = await page.request.post('http://127.0.0.1:4173/__ripple/api/project/preview', { data: { projectId: restored.analysis.revision.projectId } })
  expect(appliedPreviewResponse.ok()).toBe(true)
  const appliedPreview = await appliedPreviewResponse.json() as { projectId: string; previewId: string; url: string }
  sourcePreviewProjectId = appliedPreview.projectId
  sourcePreviewId = appliedPreview.previewId
  await page.evaluate(url => {
    const frame = document.createElement('iframe')
    frame.id = 'applied-bolt-preview'
    frame.title = 'Applied Bolt project'
    frame.sandbox.add('allow-scripts')
    frame.src = url
    document.body.append(frame)
  }, appliedPreview.url)
  const appliedFrame = page.frameLocator('#applied-bolt-preview')
  await expect(appliedFrame.getByText('山野器物 · Ripple UI验收', { exact: true })).toBeVisible({ timeout: 90_000 })
  for (const label of ['秋日手作节', '商品专题', '品牌故事']) {
    await appliedFrame.getByRole('button', { name: label, exact: true }).first().click()
    await expect(appliedFrame.locator('footer').getByText('山野器物 · Ripple UI验收', { exact: true })).toBeVisible()
  }
  await appliedFrame.locator('body').screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-applied-site.png') })
  const stopPreview = await page.request.post('http://127.0.0.1:4173/__ripple/api/project/preview/stop', { data: { projectId: sourcePreviewProjectId, previewId: sourcePreviewId } })
  expect(stopPreview.ok()).toBe(true)
  sourcePreviewProjectId = ''
  sourcePreviewId = ''

  await page.getByTestId('rollback-candidate').click()
  await expect(page.getByTestId('candidate-workflow')).toContainText('rolled-back')
  const rolledBackFooter = fs.readFileSync(path.join(appliedProject, 'src', 'components', 'Footer.tsx'), 'utf8')
  expect(rolledBackFooter).toContain('山野器物</span>')
  expect(rolledBackFooter).not.toContain('Ripple UI验收')
  expect(execFileSync('git', ['-C', appliedProject, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')
  expect(execFileSync('git', ['-C', boltProjectRoot!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(originalHead)
  expect(execFileSync('git', ['-C', boltProjectRoot!, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe(originalStatus)

  const history = await (await page.request.get('http://127.0.0.1:4173/__ripple/api/history')).json() as { history: Array<{ candidateId: string; lifecycle: string; patchHash: string }> }
  expect(history.history.find(item => item.candidateId === candidateId)).toMatchObject({ lifecycle: 'rolled-back', patchHash })
  const historyRow = page.getByTestId('candidate-history').locator('article').filter({ hasText: candidateId })
  await historyRow.getByRole('button', { name: '恢复记录' }).click()
  await expect(page.getByTestId('candidate-id')).toHaveText(candidateId)
  await expect(page.locator('.hash-grid > div').nth(1).locator('code')).toHaveText(patchHash)
  await expect(page.getByTestId('verification-state')).toContainText('PASSED')
  await page.screenshot({ path: path.join(evidenceRoot, 'bolt-workbench-history-restored.png'), fullPage: true })
  candidateId = ''
})

