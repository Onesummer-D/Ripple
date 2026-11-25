import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { measureAnalyzerSourceBuild } from '../src/core/graph-producer-evidence-v1'
import { readProjectSnapshot } from '../src/core/project'
import { createReadOnlyAnalysisHistoryService } from '../src/core/read-only-analysis-history'

const endpoint = '/__ripple/api/project/read-only-analysis'
const configKey = 'RIPPLE_LOCAL_ANALYSIS_HOST_CONFIG'
const stateKey = 'RIPPLE_WORKBENCH_STATE_DIR'
const git = (root: string, ...args: string[]) => execFileSync('git', [
  '-C', root, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=Ripple Browser Test', '-c', 'user.email=test@example.invalid', ...args,
], { encoding: 'utf8' }).trim()

function commitProject(root: string) {
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'browser test source')
}

function projectFixture(parent: string, name: string, malformedCss = false) {
  const root = path.join(parent, name)
  mkdirSync(root)
  writeFileSync(path.join(root, 'App.tsx'), 'import "./theme.css"; export const App = () => <main className="card">Source</main>\n')
  const css = Buffer.from(':root{--ink:blue} .card{color:var(--ink)}\n')
  writeFileSync(path.join(root, 'theme.css'), malformedCss ? Buffer.concat([css, Buffer.from([47, 42, 255, 42, 47])]) : css)
  git(root, 'init', '-q')
  commitProject(root)
  const { revision, root: checkoutRoot } = readProjectSnapshot(root)
  return { checkoutRoot, binding: {
    projectId: revision.projectId, sourceDigest: revision.sourceDigest, repository: `fixture/${name}`,
    gitHead: revision.gitCommit, rootTree: git(root, 'rev-parse', 'HEAD^{tree}'),
  } }
}

function hostFixture(parent: string, projects: Array<ReturnType<typeof projectFixture>>) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const config = path.join(parent, 'host.json')
  const privateKeyPath = path.join(parent, 'signing-key.pem')
  const publicKeyPath = path.join(parent, 'verification-key.pem')
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))
  writeFileSync(config, JSON.stringify({
    version: 'ripple/local-project-analysis-host/v1', projects, privateKeyPath, publicKeyPath,
    analyzerBuildPin: measureAnalyzerSourceBuild(),
  }), { mode: 0o600 })
  return config
}

async function openProject(page: Page, address: string, root: string) {
  await page.goto(address)
  await page.getByTestId('project-path').fill(root)
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/__ripple/api/analyze')
  await page.getByTestId('analyze-project').click()
  expect((await response).status()).toBe(200)
  await expect(page.getByTestId('read-only-analysis-panel')).toBeVisible()
}

async function runAnalysis(page: Page) {
  const response = page.waitForResponse(res => new URL(res.url()).pathname === endpoint)
  await page.getByRole('button', { name: '运行只读分析' }).click()
  return response
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`)
  await page.getByTestId('read-only-analysis-panel').screenshot({ path: file, animations: 'disabled' })
  await info.attach(name, { path: file, contentType: 'image/png' })
}

test('the workbench renders a real read-only summary and reports evidence failures', async ({ page }, info) => {
  test.setTimeout(90_000)
  const parent = mkdtempSync(path.join(tmpdir(), 'ripple-read-only-panel-'))
  const servers: ViteDevServer[] = []
  const previousEnv = [process.env[configKey], process.env[stateKey]] as const
  async function serve(config?: string) {
    if (config) process.env[configKey] = config
    else delete process.env[configKey]
    process.env[stateKey] = path.join(parent, 'workbench-state')
    const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false } })
    servers.push(server)
    await server.listen()
    return `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/`
  }
  try {
    const registered = projectFixture(parent, 'registered')
    const unknown = projectFixture(parent, 'unregistered')
    const failed = projectFixture(parent, 'analysis-failure', true)
    let activeAddress = await serve(hostFixture(parent, [registered, failed]))
    await openProject(page, activeAddress, registered.checkoutRoot)
    const response = await runAnalysis(page)
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON()).toEqual({ projectId: registered.binding.projectId })
    const summary = await response.json()
    expect(summary).toEqual({
      projectId: registered.binding.projectId, sourceDigest: registered.binding.sourceDigest,
      graphDigest: expect.stringMatching(/^[a-f0-9]{64}$/), mappingCount: 1, unresolvedCount: expect.any(Number),
      hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
    })
    const panel = page.getByTestId('read-only-analysis-panel')
    await expect(panel.getByRole('heading', { name: '内容摘要 content-only' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '来源证明' })).toBeVisible()
    for (const [label, value] of [
      ['项目 ID', summary.projectId], ['SourceDigest', summary.sourceDigest], ['GraphDigest', summary.graphDigest],
      ['Mapping 数量', summary.mappingCount], ['unresolved 数量', summary.unresolvedCount],
      ['Host Receipt', '验签通过 verified'], ['Producer Evidence', '复验通过 available-producer-evidence'],
    ]) {
      const field = panel.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })
      await expect(field.locator('dd')).toHaveText(String(value))
    }
    await expect(page.getByTestId('toggle-project-preview')).toBeEnabled()
    const firstCapture = page.waitForResponse(res => new URL(res.url()).pathname === '/__ripple/api/project/read-only-history/capture')
    await page.getByRole('button', { name: '保存分析记录' }).click()
    expect((await firstCapture).status()).toBe(201)
    await page.getByRole('button', { name: '刷新历史' }).click()
    await expect(panel.locator('.read-only-analysis-history-item')).toHaveCount(1)

    writeFileSync(path.join(registered.checkoutRoot, 'theme.css'), ':root{--ink:green} .card{color:var(--ink)}\n')
    commitProject(registered.checkoutRoot)
    const drift = await runAnalysis(page)
    expect(drift.status()).toBe(409)
    expect((await drift.json()).code).toBe('project-drift')
    await expect(panel.getByRole('alert')).toContainText('project-drift')
    await expect(panel.getByRole('heading', { name: '来源证明' })).toHaveCount(0)
    await screenshot(page, info, 'project-drift')

    const historyService = createReadOnlyAnalysisHistoryService()
    await historyService.capture({
      summary: {
        projectId: registered.binding.projectId, sourceDigest: 'c'.repeat(64), graphDigest: 'd'.repeat(64),
        mappingCount: 4, unresolvedCount: 1, hostReceiptStatus: 'verified',
        producerEvidenceStatus: 'available-producer-evidence',
      },
      binding: { ...registered.binding, gitHead: '4'.repeat(40), rootTree: '3'.repeat(40), sourceDigest: 'c'.repeat(64) },
      repository: registered.binding.repository, gitHead: '4'.repeat(40), rootTree: '3'.repeat(40),
      sourceDigest: 'c'.repeat(64), graphDigest: 'd'.repeat(64), mappingCount: 4, unresolvedCount: 1,
    })
    await page.getByRole('button', { name: '刷新历史' }).click()
    await expect(panel.locator('.read-only-analysis-history-item')).toHaveCount(2)
    const historyItems = panel.locator('.read-only-analysis-history-item input')
    await historyItems.nth(0).check()
    await historyItems.nth(1).check()
    await expect(panel.getByTestId('read-only-analysis-comparison')).toContainText('SourceDigest：已变化')
    await screenshot(page, info, 'read-only-analysis-history-comparison')

    async function expectFailure(server: string, root: string, status: number, code: string) {
      await openProject(page, server, root)
      const failure = await runAnalysis(page)
      expect(failure.status()).toBe(status)
      expect((await failure.json()).code).toBe(code)
      await expect(panel.getByRole('alert').filter({ hasText: code })).toBeVisible()
      await expect(panel.getByRole('heading', { name: '来源证明' })).toHaveCount(0)
      await screenshot(page, info, code)
    }
    await expectFailure(activeAddress, unknown.checkoutRoot, 404, 'project-unregistered')
    await expectFailure(activeAddress, failed.checkoutRoot, 503, 'analysis-failed')
    await expectFailure(await serve(), registered.checkoutRoot, 503, 'host-config-unavailable')
  } finally {
    for (const [index, key] of [configKey, stateKey].entries()) {
      if (previousEnv[index] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[index]
    }
    await Promise.allSettled(servers.map(server => server.close()))
    rmSync(parent, { recursive: true, force: true })
  }
})
