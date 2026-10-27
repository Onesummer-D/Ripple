import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * E③ browser acceptance for the read-only RuntimeIdentityRunPairingView.
 * The positive path uses the real Project API, Docker Chromium collector and
 * host Assessment archive. Negative paths alter only the persisted API view
 * at the browser boundary, keeping the production host and receipts intact.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-e3-runtime-identity-'))
const projectRoot = path.join(sandbox, 'site')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence-e3-runtime-identity')
const api = 'http://127.0.0.1:4173/__ripple/api'
const dockerAvailable = process.platform === 'linux' && spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true }).status === 0

type VerificationPayload = {
  candidateId: string
  verification: {
    runId?: string
    runtimeIdentities?: Array<Record<string, any>>
    visualEvidences?: unknown[]
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function writeEvidence(name: string, value: unknown): void {
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const bytes = Buffer.from(JSON.stringify(value, null, 2))
  const file = path.join(evidenceRoot, `${name}.json`)
  fs.writeFileSync(file, bytes)
  fs.writeFileSync(`${file}.sha256`, `${sha256(bytes)}  ${path.basename(file)}\n`)
}

function git(...args: string[]): void {
  execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
}

test.beforeAll(() => {
  fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\ndist/\n')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'ripple-e3-runtime-identity', private: true, type: 'module' }))
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.tsx'), "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />)\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'App.tsx'), "import { HomePage } from './pages/HomePage'; export function App(){return <><nav aria-label=\"Primary\"><a>E3 test navigation</a></nav><HomePage/></>}\n")
  fs.writeFileSync(path.join(projectRoot, 'src', 'pages', 'HomePage.tsx'), "export function HomePage(){return <main><h1>E3 real host title</h1><p>E3 stable paragraph</p></main>}\n")
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  git('init', '-q')
  git('config', 'user.email', 'e3-runtime@example.invalid')
  git('config', 'user.name', 'E3 runtime acceptance')
  git('add', '.')
  git('commit', '-qm', 'E3 runtime identity acceptance baseline')
})

test.afterAll(async () => {
  try {
    const response = await fetch(`${api}/history`)
    const payload = await response.json() as { history?: Array<{ candidateId: string; lifecycle: string }> }
    for (const item of payload.history ?? []) {
      if (item.lifecycle === 'active') {
        await fetch(`${api}/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: item.candidateId }) }).catch(() => undefined)
      }
    }
  } catch { /* cleanup is best effort */ }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); break } catch { /* Windows temp files can be held briefly */ }
  }
})

async function post(page: import('@playwright/test').Page, route: string, body: unknown): Promise<any> {
  const response = await page.request.post(`${api}/${route}`, { data: body, headers: { origin: 'http://127.0.0.1:4173' } })
  const text = await response.text()
  expect(response.ok(), `${route} 失败：${text}`).toBeTruthy()
  return JSON.parse(text)
}

function assertStoredReceipts(payload: VerificationPayload): Array<Record<string, any>> {
  const receipts = payload.verification.runtimeIdentities ?? []
  expect(payload.verification.runId, '真实 VerificationRun 必须存在').toBeTruthy()
  expect(receipts).toHaveLength(8)
  expect(new Set(receipts.map(receipt => receipt.side))).toEqual(new Set(['baseline', 'candidate']))
  for (const receipt of receipts) {
    expect(receipt.archive).toBe('stored')
    expect(receipt.assessmentStatus).toBe('complete')
    expect(receipt.snapshot).toBeTruthy()
    expect(receipt.snapshotSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.assessments).toHaveLength(receipt.snapshot.records.length)
    for (const entry of receipt.assessments) {
      expect(entry.recordKey).toBeTruthy()
      expect(entry.assessmentSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(entry.assessment.instanceIdentityProven).toBe(true)
      expect(entry.assessment.locatable).toBe(true)
      expect(entry.assessment.reasons).toEqual([])
    }
  }
  return receipts
}

async function waitForPairing(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  const pairing = page.getByTestId('runtime-identity-pairing')
  await expect(pairing).toBeVisible({ timeout: 180_000 })
  return pairing
}

async function mutateHistoryForCandidate(
  page: import('@playwright/test').Page,
  candidateId: string,
  name: string,
  mutate: (verification: Record<string, any>) => void,
): Promise<void> {
  await page.unroute('**/__ripple/api/history*').catch(() => undefined)
  await page.route('**/__ripple/api/history*', async route => {
    const response = await route.fetch()
    const payload = await response.json() as { history?: Array<{ candidateId: string; verification?: Record<string, any> }> }
    const item = payload.history?.find(entry => entry.candidateId === candidateId)
    expect(item?.verification, `历史中缺少候选 ${candidateId}`).toBeTruthy()
    mutate(item!.verification!)
    delete item!.verification!.visualEvidences
    writeEvidence(name, payload)
    await route.fulfill({ response, json: payload })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitForPairing(page)
}

test('E③ 真实 API 正例、历史回读、候选隔离与受控负例 UI', async ({ page }) => {
  test.setTimeout(600_000)
  test.skip(!dockerAvailable, 'E③ 正式 API 验收需要 Linux Docker Chromium')
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
  try {
    const analysis = await post(page, 'analyze', { projectRoot })
    const target = analysis.targets.find((item: { label: string }) => item.label === 'E3 real host title')
    expect(target).toBeTruthy()
    const scope = {
      id: 'scope-e3-runtime-identity', version: 1,
      includedRefs: ['page:home', target.id], excludedRefs: [], protectedRefs: [],
      decidedBy: 'e3-browser-acceptance', decidedAt: new Date().toISOString(),
    }
    const verificationContract = { pages: [{ pageRef: 'page:home', path: '/', markerText: 'E3 real host title' }], interactions: [] }

    const first = await post(page, 'candidate', {
      projectId: analysis.revision.projectId,
      rawIntent: 'E3 real runtime identity positive candidate',
      scope,
      operations: [{ id: 'e3-title-1', kind: 'TEXT', targetRef: target.id, before: target.value, after: 'E3 first candidate title' }],
      verificationContract,
    })
    const firstVerified = await post(page, 'candidate/verify', { candidateId: first.candidate.id }) as VerificationPayload
    const firstReceipts = assertStoredReceipts(firstVerified)
    writeEvidence('positive-verification-run-1', firstVerified)

    // The UI reads the persisted formal VerificationRun, rather than visual evidence coverage.
    await page.goto(`/experience.html?adapter=real&project=${encodeURIComponent(projectRoot)}`, { waitUntil: 'networkidle' })
    let pairing = await waitForPairing(page)
    expect(pairing).toHaveAttribute('data-strict', 'true')
    await expect(pairing).toContainText(firstVerified.verification.runId!.slice(0, 12))
    await expect(pairing).toContainText('当前捕获运行点')
    await page.screenshot({ path: path.join(evidenceRoot, 'e3-positive-desktop.png'), fullPage: true })

    // Refresh and mobile layout must preserve the same run projection and capture tuple labels.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle' })
    pairing = await waitForPairing(page)
    await expect(pairing).toContainText(firstVerified.verification.runId!.slice(0, 12))
    await page.screenshot({ path: path.join(evidenceRoot, 'e3-positive-mobile.png'), fullPage: true })
    const history1 = await (await page.request.get(`${api}/history?projectId=${encodeURIComponent(analysis.revision.projectId)}`)).json()
    writeEvidence('positive-history-run-1', history1)
    const storedFirst = history1.history.find((item: { candidateId: string }) => item.candidateId === first.candidate.id)
    expect(storedFirst.verification.runtimeIdentities).toEqual(firstReceipts)

    // Creating the second candidate retires the first. Its verification must never leak into the new candidate.
    const second = await post(page, 'candidate', {
      projectId: analysis.revision.projectId,
      rawIntent: 'E3 second candidate isolation check',
      scope,
      operations: [{ id: 'e3-title-2', kind: 'TEXT', targetRef: target.id, before: target.value, after: 'E3 second candidate title' }],
      verificationContract,
    })
    expect(second.candidate.id).not.toBe(first.candidate.id)
    await page.goto(`/experience.html?adapter=real&project=${encodeURIComponent(projectRoot)}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('verification-status')).toHaveCount(0)
    await expect(page.getByTestId('runtime-identity-pairing')).toHaveCount(0)
    const secondVerified = await post(page, 'candidate/verify', { candidateId: second.candidate.id }) as VerificationPayload
    assertStoredReceipts(secondVerified)
    expect(secondVerified.verification.runId).not.toBe(firstVerified.verification.runId)
    writeEvidence('positive-verification-run-2', secondVerified)
    await page.reload({ waitUntil: 'networkidle' })
    pairing = await waitForPairing(page)
    await expect(pairing).toContainText(secondVerified.verification.runId!.slice(0, 12))
    await expect(pairing).not.toContainText(firstVerified.verification.runId!.slice(0, 12))

    const history2 = await (await page.request.get(`${api}/history?projectId=${encodeURIComponent(analysis.revision.projectId)}`)).json()
    writeEvidence('positive-history-run-2', history2)
    expect(history2.history.find((item: { candidateId: string }) => item.candidateId === first.candidate.id)?.lifecycle).toBe('discarded')
    expect(history2.history.find((item: { candidateId: string }) => item.candidateId === second.candidate.id)?.lifecycle).toBe('active')

    // Controlled API negative: archive failure and missing visualEvidences still render formal receipt diagnostics.
    await mutateHistoryForCandidate(page, second.candidate.id, 'negative-archive-failed', verification => {
      const candidate = verification.runtimeIdentities.find((receipt: Record<string, any>) => receipt.side === 'candidate')
      candidate.archive = 'failed'
      candidate.reason = 'collector-error'
      delete candidate.snapshot
      delete candidate.snapshotSha256
      delete candidate.assessments
      delete candidate.assessmentStatus
    })
    await expect(pairing).toContainText('Candidate 归档失败')
    await expect(page.getByTestId('visual-evidences')).toHaveCount(0)
    await page.screenshot({ path: path.join(evidenceRoot, 'e3-negative-archive-failed-desktop.png'), fullPage: true })

    // Controlled API negative: version-unverifiable remains stored but cannot prove a pair.
    await mutateHistoryForCandidate(page, second.candidate.id, 'negative-version-unverifiable', verification => {
      const candidate = verification.runtimeIdentities.find((receipt: Record<string, any>) => receipt.side === 'candidate')
      candidate.archive = 'stored'
      candidate.assessmentStatus = 'version-unverifiable'
    })
    await expect(pairing).toContainText('Candidate 来源版本无法证明')
    await page.screenshot({ path: path.join(evidenceRoot, 'e3-negative-version-unverifiable-desktop.png'), fullPage: true })

    // Controlled API negative: different runtime identity cannot be repaired by record position or key.
    await mutateHistoryForCandidate(page, second.candidate.id, 'negative-runtime-id-mismatch', verification => {
      const candidate = verification.runtimeIdentities.find((receipt: Record<string, any>) => receipt.side === 'candidate')
      candidate.assessmentStatus = 'complete'
      candidate.snapshot.records[0].runtimeInstanceId = 'ripple-page-v2:foreign-runtime-instance'
    })
    await expect(pairing).toContainText('未完整证明')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(evidenceRoot, 'e3-negative-runtime-id-mismatch-mobile.png'), fullPage: true })

    // Controlled browser environment negative: no Web Crypto means no Assessment proof.
    await page.unroute('**/__ripple/api/history*')
    await page.addInitScript(() => {
      try { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} }) } catch { /* fail closed if the host seals crypto */ }
    })
    await page.reload({ waitUntil: 'networkidle' })
    pairing = await waitForPairing(page)
    await expect(pairing).toContainText('Web Crypto SHA-256')
    await page.screenshot({ path: path.join(evidenceRoot, 'e3-negative-web-crypto-mobile.png'), fullPage: true })
  } finally {
    await page.context().tracing.stop({ path: path.join(evidenceRoot, 'e3-runtime-identity.trace.zip') })
  }
})
