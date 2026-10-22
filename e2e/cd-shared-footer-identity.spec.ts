// C+D 真实工作台验证：在真实 React/Vite 工程（跨页面共享 Footer）中证明
//   页面点选 → sourceRef → SourceGraph → 页面消费关系 → Scope 证据
// 运行：npx playwright test e2e/cd-shared-footer-identity.spec.ts
// 证据截图输出到 test-results/cd-shared-footer-*.png。
import { expect, test, type Page } from '@playwright/test'
import react from '@vitejs/plugin-react'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import type { SourceGraph } from '../src/core/model'
import { analyzeProject, createRuntimeSourceMap, resolveRuntimeElement, sourceFileDigest } from '../src/core/project'
import {
  assessRuntimeIdentity, collectRuntimeIdentitySnapshot, selectableRuntimeObservations,
  type RuntimeIdentitySnapshot,
} from '../src/core/runtime-identity'
import { sourceProvenPageImpact } from '../src/core/scope'
import { sourceAnnotationPlugin } from '../src/core/source-annotation'

const fixtureRoot = path.join(process.cwd(), 'e2e', 'cd-shared-footer-fixture')
const evidenceDir = path.join(process.cwd(), 'test-results')
let server: ViteDevServer
let baseUrl: string
let graph: SourceGraph

test.beforeAll(async () => {
  graph = analyzeProject(fixtureRoot)
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

const snapshot = (page: Page): Promise<RuntimeIdentitySnapshot> => page.evaluate(collectRuntimeIdentitySnapshot, { label: 'data-testid' })
const footerRecord = (snap: RuntimeIdentitySnapshot) => {
  const record = snap.records.find(item => item.label === 'shared-footer')
  expect(record, 'shared-footer runtime record').toBeDefined()
  return record!
}

test('real pick on two pages → sourceRef → SourceGraph → page consumption → Scope evidence', async ({ page }) => {
  fs.mkdirSync(evidenceDir, { recursive: true })
  await page.goto(baseUrl)

  // --- 页面一（home）：真实点选共享 Footer ---
  await page.getByTestId('shared-footer').click()
  const home = await snapshot(page)
  const homeFooter = footerRecord(home)
  expect(homeFooter.sourceRef).toContain('Footer')
  expect(homeFooter.runtimeInstanceId).toBeTruthy()
  expect(homeFooter.certainty).toBe('stable-react-instance')
  expect(homeFooter.sourceVersion).toBeTruthy()
  await page.screenshot({ path: path.join(evidenceDir, 'cd-shared-footer-home.png') })

  // --- 切页（about）：同源码、不同 React 实例 ---
  await page.getByTestId('switch-page').click()
  await expect(page.getByText('About Title')).toBeVisible()
  await page.getByTestId('shared-footer').click()
  const about = await snapshot(page)
  const aboutFooter = footerRecord(about)
  expect(aboutFooter.sourceRef).toBe(homeFooter.sourceRef)
  expect(aboutFooter.runtimeInstanceId).not.toBe(homeFooter.runtimeInstanceId)
  await page.screenshot({ path: path.join(evidenceDir, 'cd-shared-footer-about.png') })

  // --- sourceRef → SourceGraph 节点 ---
  const element = graph.nodes.find(node => node.id === homeFooter.sourceRef)
  expect(element, 'sourceRef resolves into the SourceGraph').toBeDefined()
  expect(element!.location?.path).toBe('main.jsx')

  // --- SourceGraph → 页面消费关系 → Scope 证据 ---
  const footerText = graph.nodes.find(node => node.kind === 'data' && node.value === 'Shared footer text')
  expect(footerText, 'shared footer data node').toBeDefined()
  const footerImpact = sourceProvenPageImpact(graph, footerText!.id)
  expect(footerImpact.pageRefs).toEqual(['page:about', 'page:home'])
  expect(footerImpact.certainty).toBe('source-proven')
  const homeTitle = graph.nodes.find(node => node.kind === 'data' && node.value === 'Home Title')
  expect(sourceProvenPageImpact(graph, homeTitle!.id).pageRefs).toEqual(['page:home'])
  const aboutTitle = graph.nodes.find(node => node.kind === 'data' && node.value === 'About Title')
  expect(sourceProvenPageImpact(graph, aboutTitle!.id).pageRefs).toEqual(['page:about'])

  // --- 运行时映射：同源码两实例并存，身份不合并 ---
  const runtimeMap = createRuntimeSourceMap(graph, [...selectableRuntimeObservations(home), ...selectableRuntimeObservations(about)])
  const resolvedHome = resolveRuntimeElement(graph, { sourceRef: homeFooter.sourceRef, runtimeInstanceId: homeFooter.runtimeInstanceId! }, runtimeMap)
  const resolvedAbout = resolveRuntimeElement(graph, { sourceRef: aboutFooter.sourceRef, runtimeInstanceId: aboutFooter.runtimeInstanceId! }, runtimeMap)
  expect(resolvedHome.element.id).toBe(homeFooter.sourceRef)
  expect(resolvedAbout.element.id).toBe(aboutFooter.sourceRef)

  // --- D 的采集期评估：版本+页面双证据齐备时实例身份才被证明 ---
  const pageContext = { pathname: new URL(baseUrl).pathname, search: '', hash: '' }
  const assessment = assessRuntimeIdentity(graph, home, homeFooter, {
    fileDigest: file => sourceFileDigest(fixtureRoot, file),
    expectedPage: pageContext,
  })
  expect(assessment.locatable).toBe(true)
  expect(assessment.instanceIdentityProven).toBe(true)
  expect(assessment.reasons).toEqual([])
  // 版本漂移（候选修订后旧采集）→ 拒绝且保留原因
  const stale = assessRuntimeIdentity(graph, home, { ...homeFooter, sourceVersion: '0'.repeat(64) }, {
    fileDigest: file => sourceFileDigest(fixtureRoot, file),
    expectedPage: pageContext,
  })
  expect(stale.instanceIdentityProven).toBe(false)
  expect(stale.reasons).toContain('source-version-mismatch')
})
