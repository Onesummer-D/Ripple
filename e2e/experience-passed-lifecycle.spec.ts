import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

// A+F 第三批联合验收：真实 UI 成功路径（A passed fixture 7a3ec43）。
// 与 scripts/a-passed-fixture-e2e.mjs（A 的 API 级验收）使用同一固定工程
// test/fixtures/passed-text-lifecycle（两页 data-router + SiteFooter 共享文本源），
// 但全部操作经 F 正式工作台界面完成：
//   加载真实工程 → iframe 点选共享页脚文本 → 显式完整 Scope（两页）
//   → POST /candidate → POST /candidate/verify（真实 Docker，7/7 passed）
//   → UI 审批（绑定最新 passed runId）→ 两步确认应用 → 两步确认回滚
//   → 刷新核对生命周期与版本记录。
// 同一 candidateId 贯穿五步；应用/回滚均为磁盘逐字节校验。
// 预演两态：本机无 Docker 时如实跳过主链路（CI 具备 Docker，必须全链路执行）。

const FOOTER_BEFORE = '青野家居 · 共同页脚文案'
const FOOTER_AFTER = '青野家居 · 升级后的共同页脚文案'
const REQUIRED_ASSERTIONS = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16)

const sandbox = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.tmp', 'ripple-xp-passed-'))
const projectRoot = path.join(sandbox, 'site')
const evidenceRoot = path.resolve(process.env.RIPPLE_BROWSER_ARTIFACT_DIR ?? 'test-results/evidence-passed-lifecycle')
const API = 'http://127.0.0.1:4173/__ripple/api'
fs.mkdirSync(evidenceRoot, { recursive: true })

let baselineBytes = Buffer.alloc(0)
let expectedAppliedBytes = Buffer.alloc(0)
let fixtureSha = ''

test.beforeAll(() => {
  const fixtureSrc = path.resolve('test/fixtures/passed-text-lifecycle')
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.cpSync(fixtureSrc, projectRoot, { recursive: true })
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  // 与 A 验收脚本同口径：固定作者时间 → 可复现 fixture SHA；.gitattributes 锁定 LF 字节
  const gitEnv = { ...process.env, GIT_AUTHOR_DATE: '2026-10-23T12:00:00+08:00', GIT_COMMITTER_DATE: '2026-10-23T12:00:00+08:00' }
  const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe', env: gitEnv })
  git('init', '-q')
  git('config', 'user.email', 'passed-fixture@ripple.example.invalid')
  git('config', 'user.name', 'Ripple passed fixture')
  git('add', '.')
  git('commit', '-qm', 'baseline: 两页共享页脚文本')
  fixtureSha = git('rev-parse', 'HEAD').toString().trim()
  const footerFile = path.join(projectRoot, 'src', 'components', 'SiteFooter.tsx')
  baselineBytes = fs.readFileSync(footerFile)
  expectedAppliedBytes = Buffer.from(baselineBytes.toString('utf8').replace(FOOTER_BEFORE, FOOTER_AFTER), 'utf8')
})

test.afterAll(async () => {
  // 尽力清理：丢弃活动候选并停止预演（幂等）
  try {
    const history = await (await fetch(`${API}/history`)).json() as { history?: Array<{ candidateId: string; lifecycle: string }> }
    for (const item of history.history ?? []) {
      if (item.lifecycle === 'active') await fetch(`${API}/discard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: item.candidateId }) }).catch(() => undefined)
    }
  } catch { /* 尽力清理 */ }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); break } catch { /* 重试 */ }
  }
})

async function analyzeFixture() {
  const response = await fetch(`${API}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectRoot }) })
  if (!response.ok) throw new Error(`analyze 失败：${await response.text()}`)
  return (await response.json()) as {
    revision: { projectId: string; sourceDigest: string }
    routes: Array<{ id: string }>
    targets: Array<{ id: string; label: string; value?: string; impact: { pageRefs: string[]; certainty: string; unresolved?: string[] } }>
  }
}

test('联合验收 UI 成功路径：点选共享页脚 → 完整 Scope → 7/7 passed → 审批 → 应用（逐字节）→ 回滚（逐字节）→ 刷新核对', async ({ page }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width: 1440, height: 1000 })

  // 0. 前置证明：共享页脚文本的 PageImpact 修改前即 source-proven 覆盖两页
  const analysis = await analyzeFixture()
  const routeIds = analysis.routes.map(route => route.id).sort()
  expect(routeIds, 'A fixture 必须为两页 data-router').toEqual(['page:/', 'page:/about'])
  const footerTarget = analysis.targets.find(target => (target.value ?? target.label).includes(FOOTER_BEFORE))
  expect(footerTarget, '必须找到共享页脚文本目标').toBeTruthy()
  expect(footerTarget!.impact.certainty).toBe('source-proven')
  expect([...footerTarget!.impact.pageRefs].sort()).toEqual(routeIds)

  // 1. 加载真实工程
  await page.goto(`/experience.html?adapter=real&project=${encodeURIComponent(projectRoot)}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('real-badge')).toContainText('真实工程')
  const frame = page.getByTestId('real-preview-frame')
  const pending = page.getByTestId('real-preview-pending')
  await expect(frame.or(pending).first()).toBeVisible({ timeout: 150_000 })
  if (!(await frame.isVisible().catch(() => false))) {
    if (process.env.CI) throw new Error('CI 必须具备 Docker 隔离预演：联合验收成功路径不可跳过')
    test.skip(true, '本机无 Docker：隔离项目预演不可用，成功路径在 CI（ubuntu + Docker）执行')
  }

  // 2. iframe 内点选共享页脚文本（真实 D 桥 + /project/source-selection 授权）
  await expect(page.getByTestId('picker-toggle')).toBeEnabled()
  await page.getByTestId('picker-toggle').click()
  await expect(page.getByTestId('picker-hint')).toBeVisible()
  const projectFrame = page.frameLocator('[data-testid="real-preview-frame"]')
  await expect(projectFrame.getByRole('heading', { name: '青野家居生活馆' })).toBeVisible({ timeout: 90_000 })
  const previewFrame = page.frames().find(candidate => candidate !== page.mainFrame())!
  const footerRef = await previewFrame.locator('footer p').getAttribute('data-ripple-source')
  expect(footerRef, '预演必须把页脚文本标注到 SiteFooter.tsx 源码').toMatch(/^jsx:src\/components\/SiteFooter\.tsx#\d+$/)
  const selectionResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/project/source-selection'), { timeout: 60_000 })
  await projectFrame.locator('footer p').click()
  const selectionHttp = await selectionResponse
  expect(selectionHttp.ok(), `source-selection 未成功：${await selectionHttp.text()}`).toBe(true)
  const selection = await selectionHttp.json() as { element: { id: string } }
  expect(selection.element.id).toBe(footerRef)
  await expect(page.getByTestId('selection-summary')).toBeVisible()
  await expect(page.getByTestId('runtime-identity')).toBeVisible()
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-picked-1440.png'), fullPage: true })

  // 3. 修改文字 + 显式完整 Scope：同源页 /about 明确包含（编辑页锁定包含）
  await page.getByTestId('draft-text-input').fill(FOOTER_AFTER)
  await page.getByTestId('scope-include-page:/about').click()
  await expect(page.getByTestId('scope-summary')).toContainText('未决定 0')

  // 3b. 验证合同：页标记由用户确认（分析建议可改）；显式声明一项真实交互
  await expect(page.getByTestId('verification-contract')).toBeVisible()
  await page.getByTestId('contract-marker-page:/').fill('青野家居生活馆')
  await page.getByTestId('contract-marker-page:/about').fill('关于青野')
  await page.getByTestId('contract-interaction-name').fill('展开服务详情')
  await page.getByTestId('contract-interaction-expected').fill('服务详情已展开')
  await page.getByTestId('contract-interaction-add').click()
  await expect(page.getByTestId('contract-interaction-0')).toContainText('展开服务详情')
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-contract-1440.png'), fullPage: true })

  // 4. POST /candidate：真实 CandidateRecord（请求体携带验证合同）
  const candidateRequest = page.waitForRequest(request => request.url().includes('/__ripple/api/candidate') && request.method() === 'POST')
  const candidateResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate') && response.status() === 200)
  await page.getByTestId('create-candidate').click()
  const candidateBody = JSON.parse((await candidateRequest).postData() ?? '{}') as {
    verificationContract?: { pages: Array<{ pageRef: string; path: string; markerText: string }>; interactions: Array<{ pageRef: string; role: string; name: string; expectedText: string }> }
  }
  expect(candidateBody.verificationContract?.pages.map(page => page.markerText).sort()).toEqual(['关于青野', '青野家居生活馆'])
  expect(candidateBody.verificationContract?.interactions).toEqual([{ pageRef: 'page:/', role: 'button', name: '展开服务详情', expectedText: '服务详情已展开' }])
  const candidatePayload = await (await candidateResponse).json() as {
    sessionId: string
    candidate: { id: string; patchHash?: string }
    workflow: { lifecycle: string }
  }
  const candidateId = candidatePayload.candidate.id
  expect(candidatePayload.workflow.lifecycle).toBe('active')
  await expect(page.getByTestId('candidate-box')).toBeVisible()
  // 候选创建后项目预演已停止：画布如实呈现
  await expect(page.getByTestId('real-preview-pending')).toContainText('项目预演已在候选创建时停止')

  // 5. POST /candidate/verify：真实 Docker VerificationRun，要求 7/7 passed
  const verifyResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/verify') && response.status() === 200, { timeout: 300_000 })
  await page.getByTestId('run-verification').click()
  const verifyPayload = await (await verifyResponse).json() as {
    candidateId: string
    verification: { state: string; runId?: string; recordHash?: string; reason?: string; recordUrl?: string }
  }
  expect(verifyPayload.candidateId).toBe(candidateId)
  expect(verifyPayload.verification.state, `验证未 passed：${verifyPayload.verification.reason ?? ''}`).toBe('passed')
  const runId = verifyPayload.verification.runId!
  expect(runId, '正式验证运行记录必须存在').toBeTruthy()
  // 执行记录（正式 API）：七项断言全部 pass，无缺失
  expect(verifyPayload.verification.recordUrl, '执行记录 recordUrl 必须提供').toBeTruthy()
  const record = await (await fetch(`http://127.0.0.1:4173${verifyPayload.verification.recordUrl}`)).json() as { assertions?: Array<{ id: string; result: string; detail?: string }> }
  const assertions = record.assertions ?? []
  for (const id of REQUIRED_ASSERTIONS) {
    const found = assertions.find(item => item.id === id)
    expect(found?.result, `断言 ${id} 必须 pass（实际 ${found ? `${found.result}: ${found.detail ?? ''}` : '缺失'}）`).toBe('pass')
  }
  expect(assertions.length).toBe(REQUIRED_ASSERTIONS.length)
  // 界面如实展示：状态、运行 ID、七项断言、四视口截图
  await expect(page.getByTestId('verification-status')).toContainText(runId.slice(0, 12))
  await expect(page.getByTestId('verification-assertions')).toBeVisible()
  await expect(page.getByTestId('verification-shots')).toBeVisible()
  expect(await page.getByTestId('verification-shots').locator('img').count(), '四视口验证应产出真实截图').toBeGreaterThanOrEqual(1)
  await expect(page.getByTestId('approve-candidate')).toBeEnabled()
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-verified-1440.png'), fullPage: true })

  // 6. UI 审批：核对绑定最新 passed runId（服务端正式接口）
  const approveResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/approve') && response.status() === 200)
  await page.getByTestId('approve-candidate').click()
  const approvePayload = await (await approveResponse).json() as { candidateId: string; workflow: { approval?: { verificationRunId?: string } } }
  expect(approvePayload.candidateId).toBe(candidateId)
  expect(approvePayload.workflow.approval?.verificationRunId).toBe(runId)
  await expect(page.getByTestId('lifecycle-status')).toContainText('已审批')
  await expect(page.getByTestId('lifecycle-status')).toContainText(runId.slice(0, 12))
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-approved-1440.png'), fullPage: true })

  // 7. 两步确认应用：磁盘与候选文件逐字节一致
  const applyResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/apply') && response.status() === 200)
  await page.getByTestId('apply-candidate').click()
  expect(await page.getByTestId('apply-candidate').textContent()).toContain('确认应用')
  await page.getByTestId('apply-candidate').click()
  const applyPayload = await (await applyResponse).json() as { candidateId: string }
  expect(applyPayload.candidateId).toBe(candidateId)
  // 应用成功后适配器全量回读（含重建项目预演），界面状态在此后刷新：放宽等待
  await expect(page.getByTestId('lifecycle-status')).toContainText('已应用', { timeout: 90_000 })
  const appliedBytes = fs.readFileSync(path.join(projectRoot, 'src', 'components', 'SiteFooter.tsx'))
  expect(Buffer.compare(appliedBytes, expectedAppliedBytes), `应用后整文件逐字节不相等：实际 sha=${sha(appliedBytes)} 期望 sha=${sha(expectedAppliedBytes)}`).toBe(0)
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-applied-1440.png'), fullPage: true })

  // 8. 两步确认回滚：磁盘与基线逐字节一致
  const rollbackResponse = page.waitForResponse(response => response.url().includes('/__ripple/api/candidate/rollback') && response.status() === 200)
  await page.getByTestId('rollback-candidate').click()
  expect(await page.getByTestId('rollback-candidate').textContent()).toContain('确认回滚')
  await page.getByTestId('rollback-candidate').click()
  const rollbackPayload = await (await rollbackResponse).json() as { candidateId: string }
  expect(rollbackPayload.candidateId).toBe(candidateId)
  await expect(page.getByTestId('lifecycle-status')).toContainText('已回滚', { timeout: 90_000 })
  const restoredBytes = fs.readFileSync(path.join(projectRoot, 'src', 'components', 'SiteFooter.tsx'))
  expect(Buffer.compare(restoredBytes, baselineBytes), `回滚后整文件逐字节未还原：实际 sha=${sha(restoredBytes)} 基线 sha=${sha(baselineBytes)}`).toBe(0)
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-rolled-back-1440.png'), fullPage: true })

  // 9. 刷新界面：核对真实生命周期与版本记录（服务端历史为权威）
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('real-badge')).toContainText('真实工程', { timeout: 30_000 })
  await expect(page.getByTestId('candidate-status')).toContainText('已回滚', { timeout: 60_000 })
  await expect(page.getByTestId('lifecycle-status')).toContainText('已回滚')
  const history = await (await fetch(`${API}/history?projectId=${analysis.revision.projectId}`)).json() as {
    history: Array<{
      candidateId: string
      lifecycle: string
      patchHash?: string
      approval?: { verificationRunId?: string }
      verification: {
        runId?: string
        recordUrl?: string
        evidence?: Array<{ id: string; artifactUrl?: string; viewport: { width: number; height: number } }>
      }
    }>
  }
  const stored = history.history.find(item => item.candidateId === candidateId)
  expect(stored, '候选必须已持久化到服务端历史').toBeTruthy()
  expect(stored!.lifecycle).toBe('rolled-back')
  expect(stored!.patchHash).toBe(candidatePayload.candidate.patchHash)
  expect(stored!.approval?.verificationRunId).toBe(runId)
  expect(stored!.verification.runId).toBe(runId)
  const expectedRecordUrl = `/__ripple/api/candidate/${encodeURIComponent(candidateId)}/runs/${encodeURIComponent(runId)}`
  expect(stored!.verification.recordUrl).toBe(expectedRecordUrl)
  const archivedEvidence = stored!.verification.evidence?.find(entry => entry.artifactUrl)
  expect(archivedEvidence, '真实 VerificationRun 历史必须引用归档截图').toBeTruthy()
  expect(archivedEvidence!.artifactUrl).toBe(`/__ripple/api/candidate/${encodeURIComponent(candidateId)}/evidence/${encodeURIComponent(archivedEvidence!.id)}`)
  // 回滚后工作树恢复干净（逐字节还原 → git 无差异）
  expect(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-passed-refreshed-1440.png'), fullPage: true })

  // 10. 历史胶片必须绑定真实 Candidate、VerificationRun 和截图 artifact，并在 Chromium 中成功解码。
  const historyImageUrl = new URL(archivedEvidence!.artifactUrl!, 'http://127.0.0.1:4173').toString()
  const historyImageResponse = page.waitForResponse(response => response.url() === historyImageUrl)
  await page.getByTestId('open-history').click()
  const historyCard = page.getByTestId(`version-${candidateId}`)
  await expect(historyCard).toBeVisible()
  const historyImage = page.getByTestId(`film-shot-real-${candidateId}`)
  await expect(historyImage).toBeVisible()
  expect(await historyImage.getAttribute('src')).toBe(archivedEvidence!.artifactUrl)
  expect(await historyImage.evaluate(image => (image as HTMLImageElement).currentSrc)).toBe(historyImageUrl)
  const loadedArtifact = await historyImageResponse
  expect(loadedArtifact.status(), `归档截图 GET 失败：${loadedArtifact.status()} ${historyImageUrl}`).toBe(200)
  expect(loadedArtifact.headers()['content-type']).toMatch(/^image\//)
  await expect.poll(() => historyImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByTestId(`film-src-real-${candidateId}`)).toContainText('真实截图')
  await page.setViewportSize({ width: 1440, height: 900 })
  await historyCard.scrollIntoViewIfNeeded()
  const desktopCardBox = await historyCard.boundingBox()
  expect(desktopCardBox?.width).toBe(300)
  expect(await historyCard.evaluate(element => getComputedStyle(element).scrollSnapAlign)).toBe('start')
  const sourceBadgeBox = await page.getByTestId(`film-src-real-${candidateId}`).boundingBox()
  const lifecycleBadgeBox = await historyCard.locator('.ripple-xp-film-flag').boundingBox()
  expect(sourceBadgeBox && lifecycleBadgeBox && sourceBadgeBox.x + sourceBadgeBox.width < lifecycleBadgeBox.x).toBe(true)
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-history-1440x900.png') })

  // 键盘顺序以真实 Tab 导航验证：版本选择 Enter 与证据展开 Space 互不串联。
  await page.getByTestId('close-filmstrip').focus()
  await page.keyboard.press('Tab')
  await expect(historyCard).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(historyCard).toHaveAttribute('aria-current', 'true')
  const evidenceToggle = page.getByTestId(`evidence-toggle-${candidateId}`)
  await page.keyboard.press('Tab')
  await expect(evidenceToggle).toBeFocused()
  await page.keyboard.press('Space')
  await expect(evidenceToggle).toHaveAttribute('aria-expanded', 'true')

  // 网络层负例：真实归档 URL 首次返回 404，浏览器须显示加载失败；同 URL 重试后放行真实 GET。
  let artifactGetCount = 0
  let historyPanelOpen = false
  await page.route(historyImageUrl, async route => {
    if (!historyPanelOpen) {
      await route.continue()
      return
    }
    artifactGetCount += 1
    if (artifactGetCount === 1) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"artifact missing"}' })
      return
    }
    await route.continue()
  })
  await page.reload({ waitUntil: 'networkidle' })
  historyPanelOpen = true
  await page.getByTestId('open-history').click()
  const failedThumbnail = page.getByTestId(`film-shot-failed-${candidateId}`)
  await expect(failedThumbnail).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await failedThumbnail.scrollIntoViewIfNeeded()
  const mobileCardBox = await page.getByTestId(`version-card-${candidateId}`).boundingBox()
  expect(mobileCardBox?.width).toBeLessThanOrEqual(358)
  expect(await page.getByTestId('version-filmstrip').locator('.ripple-xp-film-list').evaluate(element => getComputedStyle(element).overflowX)).toBe('auto')
  await page.screenshot({ path: path.join(evidenceRoot, 'xp-history-390x844-failed.png') })
  const retryImageResponse = page.waitForResponse(response => response.url() === historyImageUrl && response.status() === 200)
  await page.getByTestId(`film-shot-retry-${candidateId}`).click()
  const retryResponse = await retryImageResponse
  expect(retryResponse.status()).toBe(200)
  await expect.poll(() => page.getByTestId(`film-shot-real-${candidateId}`).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(artifactGetCount).toBe(2)
  await page.unroute(historyImageUrl)

  console.log(JSON.stringify({ fixtureSha, candidateId, runId, historyImageUrl, historyImageStatus: loadedArtifact.status(), retryImageStatus: retryResponse.status(), artifactGetCount, patchHash: candidatePayload.candidate.patchHash, recordHash: verifyPayload.verification.recordHash }))
})
