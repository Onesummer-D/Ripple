// C+D data-router 真实联合验证：真实 React/Vite 工程使用 createBrowserRouter + RouterProvider，
// 两个路由共享 Footer，通过真实浏览器完成两次 Link 导航与三次点选，全部使用 D 的
// 实际采集结果（sourceRef / runtimeInstanceId / sourceVersion / certainty）驱动断言：
//   1. C 的 SourceGraph 追踪两个页面对共享 Footer 的 source-proven 消费；
//   2. 跨页面实例身份独立（runtimeInstanceId 不同）、来源相同（sourceRef 相同）；
//   3. 来源不明、版本失效、页面范围不符时继续 fail-closed。
// 实测边界（如实记录，不冒充通过）：经 RouterProvider 动态挂载的组件链当前由
// 采集器保守判定为 certainty='unknown'（owner 链不经过可静态分析的 JSX 挂载点），
// 因此实例身份的“充分证明”（instanceIdentityProven）在本夹具上正确地保持 false；
// stable 确定性的正向路径由 cd-shared-footer-identity.spec.ts（useState 直挂）覆盖。
// 运行：npx playwright test e2e/cd-data-router-footer-identity.spec.ts
// 证据截图输出到 test-results/cd-data-router-*.png。
import { expect, test, type Page } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import type { SourceGraph } from '../src/core/model'
import { analyzeProject, createRuntimeSourceMap, resolveRuntimeElement, sourceFileDigest } from '../src/core/project'
import {
  assessRuntimeIdentity, collectRuntimeIdentitySnapshot, selectableRuntimeObservations,
  type RuntimeIdentityRecord,
  type RuntimeIdentitySnapshot,
} from '../src/core/runtime-identity'
import { sourceProvenPageImpact } from '../src/core/scope'
import { sourceAnnotationPlugin } from '../src/core/source-annotation'

const fixtureRoot = path.join(process.cwd(), 'e2e', 'cd-data-router-footer-fixture')
const evidenceDir = path.join(process.cwd(), 'test-results')
let server: ViteDevServer
let baseUrl: string
let graph: SourceGraph
let projectRoot: string

test.beforeAll(async () => {
  // 与 cd-shared-footer-identity.spec.ts 相同：分析针对临时副本运行（仓库内夹具向上可达
  // node_modules，会触发 TS checker 深层解析路径），vite 仍服务仓库内真实夹具。
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-cd-data-router-'))
  const copyTree = (relative: string) => {
    const from = path.join(fixtureRoot, relative)
    const to = path.join(projectRoot, relative)
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      for (const entry of fs.readdirSync(from)) copyTree(path.join(relative, entry))
    } else {
      fs.copyFileSync(from, to)
    }
  }
  for (const entry of fs.readdirSync(fixtureRoot)) copyTree(entry)
  execFileSync('git', ['init', '-q'], { cwd: projectRoot })
  execFileSync('git', ['add', '.'], { cwd: projectRoot })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline'], { cwd: projectRoot })
  graph = analyzeProject(projectRoot)
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

test.afterAll(async () => {
  await server?.close()
  // Windows 上 git 临时仓库含只读对象文件：先清属性再删，失败重试。
  const makeWritable = (target: string) => {
    let stat: fs.Stats
    try { stat = fs.lstatSync(target) } catch { return }
    try { fs.chmodSync(target, 0o777) } catch { /* ignore */ }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const entry of fs.readdirSync(target)) makeWritable(path.join(target, entry))
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try { makeWritable(projectRoot); fs.rmSync(projectRoot, { recursive: true, force: true }); break } catch { /* retry */ }
  }
})

const snapshot = (page: Page): Promise<RuntimeIdentitySnapshot> => page.evaluate(collectRuntimeIdentitySnapshot, { label: 'data-testid' })
const footerRecord = (snap: RuntimeIdentitySnapshot): RuntimeIdentityRecord => {
  const record = snap.records.find(item => item.label === 'shared-footer')
  expect(record, 'shared-footer runtime record').toBeDefined()
  return record!
}

test('data-router: two Link navigations and three picks → sourceRef → SourceGraph → Scope evidence', async ({ page }) => {
  fs.mkdirSync(evidenceDir, { recursive: true })

  // --- 页面一（/）：真实点选共享 Footer ---
  await page.goto(`${baseUrl}/`)
  await expect(page.getByText('Home Title')).toBeVisible()
  await page.getByTestId('shared-footer').click()
  const homeFirst = await snapshot(page)
  const homeFooter = footerRecord(homeFirst)
  expect(homeFooter.sourceRef).toContain('Footer')
  expect(homeFooter.runtimeInstanceId).toBeTruthy()
  expect(homeFooter.sourceVersion).toBeTruthy()
  await page.screenshot({ path: path.join(evidenceDir, 'cd-data-router-home.png') })

  // --- 第一次真实导航：Link → /about，第二次点选 ---
  await page.getByTestId('nav-about').click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByText('About Title')).toBeVisible()
  await page.getByTestId('shared-footer').click()
  const aboutSnap = await snapshot(page)
  const aboutFooter = footerRecord(aboutSnap)
  await page.screenshot({ path: path.join(evidenceDir, 'cd-data-router-about.png') })

  // --- 第二次真实导航：Link 回到 /，第三次点选 ---
  await page.getByTestId('nav-home').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Home Title')).toBeVisible()
  await page.getByTestId('shared-footer').click()
  const homeAgain = await snapshot(page)
  const homeAgainFooter = footerRecord(homeAgain)

  // --- 跨页面实例身份独立、来源相同（全部来自 D 的真实采集） ---
  expect(aboutFooter.sourceRef).toBe(homeFooter.sourceRef)
  expect(homeAgainFooter.sourceRef).toBe(homeFooter.sourceRef)
  expect(aboutFooter.runtimeInstanceId).not.toBe(homeFooter.runtimeInstanceId)
  expect(homeAgainFooter.runtimeInstanceId).not.toBe(homeFooter.runtimeInstanceId)
  // v2 实例 ID 携带真实 render 时的完整页面 tuple。
  const namespaceTuple = (id: string | undefined) => {
    expect(id?.startsWith('ripple-page-v2:')).toBe(true)
    const start = 'ripple-page-v2:'.length
    const boundary = id!.indexOf(':', start)
    const encoded = id!.slice(start, boundary)
    const decoded = decodeURIComponent(encoded)
    expect(encodeURIComponent(decoded)).toBe(encoded)
    return JSON.parse(decoded)
  }
  expect(namespaceTuple(homeFooter.runtimeInstanceId)).toEqual(['/', '', ''])
  expect(namespaceTuple(aboutFooter.runtimeInstanceId)).toEqual(['/about', '', ''])

  // --- sourceRef → SourceGraph 节点 ---
  const element = graph.nodes.find(node => node.id === homeFooter.sourceRef)
  expect(element, 'sourceRef resolves into the SourceGraph').toBeDefined()
  expect(element!.location?.path).toBe('components/Footer.tsx')

  // --- SourceGraph → 页面消费关系 → Scope 证据（C 的静态证明） ---
  const footerText = graph.nodes.find(node => node.kind === 'data' && node.value === 'Shared footer text')
  expect(footerText, 'shared footer data node').toBeDefined()
  const footerImpact = sourceProvenPageImpact(graph, footerText!.id)
  expect(footerImpact.pageRefs).toEqual(['page:/', 'page:/about'])
  expect(footerImpact.certainty).toBe('source-proven')
  const homeTitle = graph.nodes.find(node => node.kind === 'data' && node.value === 'Home Title')
  expect(sourceProvenPageImpact(graph, homeTitle!.id)).toMatchObject({ pageRefs: ['page:/'], certainty: 'source-proven' })
  const aboutTitle = graph.nodes.find(node => node.kind === 'data' && node.value === 'About Title')
  expect(sourceProvenPageImpact(graph, aboutTitle!.id)).toMatchObject({ pageRefs: ['page:/about'], certainty: 'source-proven' })

  // --- 运行时映射：每页快照各自成图；经 RouterProvider 的 unknown 实例
  // 按设计不可作为精准编辑目标（selectableRuntimeObservations 排除），
  // resolveRuntimeElement 对真实采集结果继续 fail-closed。 ---
  const maps = [homeFirst, aboutSnap, homeAgain].map(snap => createRuntimeSourceMap(graph, selectableRuntimeObservations(snap)))
  for (const [map, footer] of [[maps[0], homeFooter], [maps[1], aboutFooter], [maps[2], homeAgainFooter]] as const) {
    expect(map.observations.some(item => item.runtimeInstanceId === footer.runtimeInstanceId)).toBe(false)
    expect(() => resolveRuntimeElement(graph, { sourceRef: footer.sourceRef, runtimeInstanceId: footer.runtimeInstanceId! }, map)).toThrow(/不匹配|不稳定|降级/)
  }

  // --- D 的采集期评估：来源与版本证据齐备时可定位 ---
  const assess = (snap: RuntimeIdentitySnapshot, record: RuntimeIdentityRecord, expectedPath: string) => assessRuntimeIdentity(graph, snap, record, {
    fileDigest: file => sourceFileDigest(projectRoot, file),
    expectedPage: { pathname: expectedPath, search: '', hash: '' },
  })
  const homeAssessment = assess(homeFirst, homeFooter, '/')
  expect(homeAssessment.locatable).toBe(true)
  const aboutAssessment = assess(aboutSnap, aboutFooter, '/about')
  expect(aboutAssessment.locatable).toBe(true)

  // --- 实测边界如实断言：经 RouterProvider 动态挂载的组件链当前为 unknown 确定性，
  // 实例身份的充分证明正确地保持 fail-closed，而非被强行判为通过。 ---
  expect(homeFooter.certainty).toBe('unknown')
  expect(homeAssessment.instanceIdentityProven).toBe(false)
  expect(homeAssessment.reasons).toContain('identity-not-stable')

  // --- fail-closed：来源不明 ---
  const unknownSource = assess(homeFirst, { ...homeFooter, sourceRef: 'jsx:components/Nowhere.tsx#1' }, '/')
  expect(unknownSource.locatable).toBe(false)
  expect(unknownSource.instanceIdentityProven).toBe(false)
  expect(unknownSource.reasons).toContain('source-not-in-graph')

  // --- fail-closed：版本失效（候选修订后旧采集） ---
  const stale = assess(homeFirst, { ...homeFooter, sourceVersion: '0'.repeat(64) }, '/')
  expect(stale.instanceIdentityProven).toBe(false)
  expect(stale.reasons).toContain('source-version-mismatch')
  expect(stale.locatable).toBe(false)

  // --- fail-closed：页面范围不符（/ 页面的采集被断言为 /about 的实例） ---
  const wrongPage = assess(homeFirst, homeFooter, '/about')
  expect(wrongPage.instanceIdentityProven).toBe(false)
  expect(wrongPage.reasons).toContain('page-context-mismatch')
})
