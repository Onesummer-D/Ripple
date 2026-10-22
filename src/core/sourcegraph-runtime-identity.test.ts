// C+D 联合验收：SourceGraph（C, PR #11）× Runtime Identity（D, PR #18）。
// 证明链路：页面点选 → sourceRef → SourceGraph → 页面消费关系 → Scope 证据，
// 以及候选版本改变后的实例身份失效与实例级授权不自动获得。
// 全程 fail-closed：静态无法证明的关系一律保留 unknown 与未解析原因；
// 同一路由器内混入不可证明的路由时，按 C 的 route-coverage 语义整体降级为 partial。
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  analyzeProject, createRuntimeSourceMap, resolveRuntimeElement,
  resolveRuntimeInstance, sourceFileDigest,
} from './project'
import { sourceProvenPageImpact, evaluateOperationPageScope } from './scope'
import { makeFixtureRoot, removeTree } from './test-fixture-dir'
import type { RuntimeElementObservation, SourceGraph } from './model'

const directories: string[] = []
function project(files: Record<string, string>): string {
  const root = makeFixtureRoot('ripple-cd-joint')
  directories.push(root)
  const contents = {
    'package.json': JSON.stringify({ name: 'cd-joint-test' }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }),
    'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    'src/main.tsx': `import { App } from './App'; import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<App />);`,
    ...files,
  }
  for (const [name, value] of Object.entries(contents)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
  }
  gitCommit(root)
  return root
}
function gitCommit(root: string) {
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline'], { cwd: root })
}
afterEach(() => { for (const dir of directories.splice(0)) removeTree(dir) })

const footer = {
  'src/components/Footer.tsx': `export function Footer() { return <footer><p>Shared footer text</p></footer> }`,
  'src/components/index.ts': `export { Footer } from './Footer';`,
}
const homePageFile = {
  'src/pages/HomePage.tsx': `import { Footer } from '../components';\nexport default function HomePage() { return <main><h1>Home Title</h1><Footer /></main> }`,
}
const aboutPageFile = {
  'src/pages/AboutPage.tsx': `import { Footer } from '../components/Footer';\nexport function AboutPage() { return <main><h1>About Title</h1><Footer /></main> }`,
}
const orderPageFile = {
  'src/pages/OrderPage.tsx': `export default function OrderPage() { return <main><h1>Order Detail</h1></main> }`,
}
const contactPageFile = {
  'src/pages/ContactPage.tsx': `export function ContactPage() { return <main><h1>Contact Title</h1></main> }`,
}
// 全证明工程：默认导出别名（HomePage）+ 直连命名导出（AboutPage），
// 共享 Footer 分别经 barrel 链与直连链被两个页面消费。
const provenProject = () => project({
  ...footer, ...homePageFile, ...aboutPageFile,
  'src/App.tsx': `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
]);
export const App = () => <RouterProvider router={router} />;`,
})
// 混合工程：一个可证明路由 + 一个仅经 barrel 再导出绑定的路由组件。
const barrelProject = () => project({
  ...footer, ...homePageFile, ...contactPageFile,
  'src/pages/index.ts': `export { ContactPage } from './ContactPage';`,
  'src/App.tsx': `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { ContactPage } from './pages';
const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/contact', element: <ContactPage /> },
]);
export const App = () => <RouterProvider router={router} />;`,
})
// 动态路由工程：两个静态证明路由 + 一个动态参数路由。
const dynamicProject = () => project({
  ...footer, ...homePageFile, ...aboutPageFile, ...orderPageFile,
  'src/App.tsx': `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import OrderPage from './pages/OrderPage';
const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/orders/:orderId', element: <OrderPage /> },
]);
export const App = () => <RouterProvider router={router} />;`,
})

const dataNode = (graph: SourceGraph, label: string) => {
  const node = graph.nodes.find(item => item.kind === 'data' && item.value === label)
  expect(node, `data node ${label}`).toBeDefined()
  return node!
}
const impact = (graph: SourceGraph, label: string) => sourceProvenPageImpact(graph, dataNode(graph, label).id)
const footerParagraphRef = (graph: SourceGraph) => {
  const element = graph.nodes.find(item => item.kind === 'jsx-element' && item.location?.path === 'src/components/Footer.tsx' && item.label === '<p>')
  expect(element, 'Footer <p> jsx sourceRef').toBeDefined()
  return element!.id
}
const observe = (sourceRef: string, runtimeInstanceId: string, overrides: Partial<RuntimeElementObservation> = {}): RuntimeElementObservation =>
  ({ sourceRef, runtimeInstanceId, certainty: 'stable-react-instance', ...overrides })
const homePage = { pathname: '/', search: '', hash: '' }

describe('C+D joint: pick → sourceRef → SourceGraph → page consumption → Scope evidence', () => {
  it('proves a shared Footer consumed by two data-router pages and resolves the picked element', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    // 页面点选（运行时桥采集）→ 运行时映射 → 源码元素
    const runtimeMap = createRuntimeSourceMap(graph, [observe(ref, 'route:/:footer:1', { pageContext: homePage })])
    const resolved = resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }, runtimeMap)
    expect(resolved.element.id).toBe(ref)
    // SourceGraph → 页面消费关系 → Scope 证据：共享 Footer 文本同时被 / 和 /about 消费
    const footerImpact = impact(graph, 'Shared footer text')
    expect(footerImpact.pageRefs).toEqual(['page:/', 'page:/about'])
    expect(footerImpact.certainty).toBe('source-proven')
    // 每个页面自己的标题只被本页消费（含直连命名导出与默认导出别名两种形态）
    expect(impact(graph, 'Home Title').pageRefs).toEqual(['page:/'])
    expect(impact(graph, 'Home Title').certainty).toBe('source-proven')
    expect(impact(graph, 'About Title').pageRefs).toEqual(['page:/about'])
    expect(impact(graph, 'About Title').certainty).toBe('source-proven')
  })

  it('accepts distinct runtime instances of identical source but never merges their identities', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    const runtimeMap = createRuntimeSourceMap(graph, [
      observe(ref, 'route:/:footer:1', { pageContext: homePage }),
      observe(ref, 'route:/about:footer:1', { pageContext: { pathname: '/about', search: '', hash: '' } }),
    ])
    const home = resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }, runtimeMap)
    const about = resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/about:footer:1' }, runtimeMap)
    expect(home.element.id).toBe(ref)
    expect(about.element.id).toBe(ref)
    expect(home.runtimeInstanceId).not.toBe(about.runtimeInstanceId)
    // 来源相同 ≠ 实例相同：双向映射必须逐实例成立
    const aboutOnlyMap = createRuntimeSourceMap(graph, [observe(ref, 'route:/about:footer:1')])
    expect(() => resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }, aboutOnlyMap)).toThrow(/双向映射不匹配/)
  })

  it('invalidates stale instance identity once the candidate revision changes the source', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    const runtimeMap = createRuntimeSourceMap(graph, [observe(ref, 'route:/:footer:1', { pageContext: homePage })])
    // 候选应用：Footer 源文本变化 → 新图 revision；旧映射整体失效（不再对应当前源码图）
    const footerPath = path.join(root, 'src', 'components', 'Footer.tsx')
    fs.writeFileSync(footerPath, `export function Footer() { return <footer><p>Shared footer text v2</p></footer> }`)
    gitCommit(root)
    const nextGraph = analyzeProject(root)
    expect(nextGraph.revision.sourceDigest).not.toBe(graph.revision.sourceDigest)
    expect(() => resolveRuntimeElement(nextGraph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }, runtimeMap)).toThrow(/不再对应/)
    // 新修订上即使重新点选同一元素，未采集 sourceVersion 的旧实例也不能获得 strict 身份
    const nextRef = footerParagraphRef(nextGraph)
    const nextMap = createRuntimeSourceMap(nextGraph, [observe(nextRef, 'route:/:footer:1', { pageContext: homePage })])
    expect(() => resolveRuntimeElement(nextGraph, { sourceRef: nextRef, runtimeInstanceId: 'route:/:footer:1' }, nextMap,
      { fileDigest: () => undefined })).toThrow(/源码版本/)
  })

  it('requires version and page evidence before any strict instance use', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    const digest = sourceFileDigest(root, 'src/components/Footer.tsx')
    const runtimeMap = createRuntimeSourceMap(graph, [observe(ref, 'route:/:footer:1', { pageContext: homePage, sourceVersion: digest })])
    const selection = { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }
    // 无版本/页面证据：只允许导航级解析，绝不视为已证明实例
    const navigationOnly = resolveRuntimeElement(graph, selection, runtimeMap)
    expect(navigationOnly.verification).toBe('navigation-only')
    // 版本或页面不匹配：拒绝（候选版本漂移的旧实例身份）
    expect(() => resolveRuntimeElement(graph, selection, runtimeMap, { fileDigest: () => 'stale-digest' })).toThrow(/源码版本/)
    expect(() => resolveRuntimeElement(graph, selection, runtimeMap, { page: { pathname: '/about', search: '', hash: '' } })).toThrow(/页面上下文/)
    // 双证据齐备：strict
    const strict = resolveRuntimeElement(graph, selection, runtimeMap, { fileDigest: file => sourceFileDigest(root, file), page: homePage })
    expect(strict.verification).toBe('strict')
    // 实例级入口拒绝无证据调用
    expect(() => resolveRuntimeInstance(graph, selection, runtimeMap, {} as never)).toThrow(/实例级身份校验/)
    expect(resolveRuntimeInstance(graph, selection, runtimeMap, { fileDigest: file => sourceFileDigest(root, file), page: homePage }).verification).toBe('strict')
  })

  it('refuses unstable or downgraded observations before they can reach source selection', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    // position-dependent（如同源多实例列表项）不得成为精准编辑目标
    const positional = createRuntimeSourceMap(graph, [observe(ref, 'list:1', { certainty: 'position-dependent' })])
    expect(() => resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'list:1' }, positional)).toThrow(/身份不稳定/)
    // 采集期降级的观察直接拒绝进入源码选择
    expect(() => createRuntimeSourceMap(graph, [observe(ref, 'stale:1', { reasons: ['route-namespace-stale'] })])).toThrow(/降级/)
  })
})

describe('C+D joint: unproven relations stay fail-closed', () => {
  it('keeps a route component bound only through a barrel re-export unproven', () => {
    const root = barrelProject()
    const graph = analyzeProject(root)
    // 直连默认导出（HomePage）的页面引用仍可列出；但 barrel 再导出绑定失败触发
    // route-coverage：影响全集无法确认，同一路由器内的证明目标一并降级为 partial。
    const homeImpact = impact(graph, 'Home Title')
    expect(homeImpact.pageRefs).toEqual(['page:/'])
    expect(homeImpact.certainty).toBe('partial')
    const contactImpact = impact(graph, 'Contact Title')
    expect(contactImpact.pageRefs).toEqual([])
    expect(contactImpact.certainty).toBe('unknown')
    expect(contactImpact.unresolved.length).toBeGreaterThan(0)
    expect(graph.unresolved.some(item => item.includes('route component import binding not proven'))).toBe(true)
    expect(graph.unresolved.some(item => item.startsWith('route-coverage:'))).toBe(true)
  })

  it('downgrades the whole route table when a dynamic parameter route exists, keeping proven page refs', () => {
    const root = dynamicProject()
    const graph = analyzeProject(root)
    const orderImpact = impact(graph, 'Order Detail')
    // 动态参数路由是已解析的运行时实例覆盖：路由节点存在，但其消费边保持
    // semantic-candidate，影响遍历不收集该页面，确定性不是 source-proven 且保留原因。
    expect(graph.nodes.map(item => item.id)).toContain('page:/orders/:orderId')
    expect(orderImpact.pageRefs).toEqual([])
    expect(orderImpact.certainty).not.toBe('source-proven')
    expect(orderImpact.unresolved.length).toBeGreaterThan(0)
    // 已证明的静态路由不受影响：共享 Footer 仍是 source-proven
    const footerImpact = impact(graph, 'Shared footer text')
    expect(footerImpact.pageRefs).toEqual(['page:/', 'page:/about'])
    expect(footerImpact.certainty).toBe('source-proven')
  })

  it('does not upgrade classic <Route element={...}> JSX into proven page consumption', () => {
    const root = project({
      ...footer, ...homePageFile,
      'src/App.tsx': `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
export const App = () => <BrowserRouter><Routes><Route path="/" element={<HomePage />} /></Routes></BrowserRouter>;`,
    })
    const graph = analyzeProject(root)
    const homeImpact = impact(graph, 'Home Title')
    // 元素属性中的 JSX 是路由配置值，不是 App 的直接渲染证明 → 保持未知并保留原因
    expect(homeImpact.certainty).not.toBe('source-proven')
    expect(homeImpact.unresolved.length).toBeGreaterThan(0)
  })

  it('keeps unresolved imports inside the proven subgraph as partial evidence, never source-proven', () => {
    const root = project({
      ...footer,
      'src/pages/HomePage.tsx': `import { Footer } from '../components';\nimport { Missing } from './Missing';\nexport function HomePage() { return <main><h1>Home Title</h1><Footer /><Missing /></main> }`,
      'src/App.tsx': `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
const router = createBrowserRouter([{ path: '/', element: <HomePage /> }]);
export const App = () => <RouterProvider router={router} />;`,
    })
    const graph = analyzeProject(root)
    // HomePage 页内存在无法解析的相对导入时，其影响证明必须降级并说明原因
    const homeImpact = impact(graph, 'Home Title')
    expect(homeImpact.certainty).toBe('partial')
    expect(homeImpact.unresolved.some(item => item.includes('未解析依赖'))).toBe(true)
  })
})

describe('C+D joint: counterexamples — scope propagation and observation hygiene', () => {
  it('propagates shared-source page impact into Scope decisions: every consuming page must be covered', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const footerImpact = impact(graph, 'Shared footer text')
    expect(footerImpact.certainty).toBe('source-proven')
    const affected = footerImpact.pageRefs
    expect(affected).toEqual(['page:/', 'page:/about'])
    // 修改共享 Footer：Scope 只声明一个消费页面 → 另一个页面必须报 conflict，不能静默漏改
    const partialScope = evaluateOperationPageScope(
      { strategy: 'shared', localPageRef: '', includedRefs: ['page:/'], excludedRefs: [], protectedRefs: [] }, affected)
    expect(partialScope).toEqual([
      { pageRef: 'page:/', effect: 'change' },
      { pageRef: 'page:/about', effect: 'conflict', reason: expect.stringContaining('page:/about') },
    ])
    // 两页面都进入 includedRefs → 全部 change
    const fullScope = evaluateOperationPageScope(
      { strategy: 'shared', localPageRef: '', includedRefs: ['page:/', 'page:/about'], excludedRefs: [], protectedRefs: [] }, affected)
    expect(fullScope.every(entry => entry.effect === 'change')).toBe(true)
    // 页面覆盖策略：只覆盖本页时，未明确排除的共享消费者必须报 conflict
    const localOnly = evaluateOperationPageScope(
      { strategy: 'page-override', localPageRef: 'page:/', includedRefs: ['page:/'], excludedRefs: [], protectedRefs: [] }, affected)
    expect(localOnly.find(entry => entry.pageRef === 'page:/about')?.effect).toBe('conflict')
    // 显式排除共享消费者 → preserve（共享修改不传播到该页）
    const localExcluded = evaluateOperationPageScope(
      { strategy: 'page-override', localPageRef: 'page:/', includedRefs: ['page:/'], excludedRefs: ['page:/about'], protectedRefs: [] }, affected)
    expect(localExcluded.find(entry => entry.pageRef === 'page:/about')?.effect).toBe('preserve')
    // 保护页面与排除页面同样阻断 change 策略
    const protectedScope = evaluateOperationPageScope(
      { strategy: 'shared', localPageRef: '', includedRefs: ['page:/', 'page:/about'], excludedRefs: [], protectedRefs: ['page:/about'] }, affected)
    expect(protectedScope.find(entry => entry.pageRef === 'page:/about')?.effect).toBe('conflict')
  })

  it('rejects duplicate, unknown-source and unproven observations before source selection', () => {
    const root = provenProject()
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    const aboutPage = { pathname: '/about', search: '', hash: '' }
    // 同源多实例必须携带不同实例 id；重复 id 说明采集或传递出错，整体拒绝
    expect(() => createRuntimeSourceMap(graph, [
      observe(ref, 'route:/:footer:1', { pageContext: homePage }),
      observe(ref, 'route:/:footer:1', { pageContext: aboutPage }),
    ])).toThrow(/重复/)
    // 未知来源（图中不存在的 sourceRef）不得进入源码选择，更不能被标为 source-proven
    expect(() => createRuntimeSourceMap(graph, [
      observe('jsx:src/components/Phantom.tsx#0', 'route:/:phantom:1', { pageContext: homePage }),
    ])).toThrow(/未映射/)
    // unknown / unmapped 身份的观察直接拒绝
    expect(() => createRuntimeSourceMap(graph, [observe(ref, 'u:1', { certainty: 'unknown' })])).toThrow(/未确认映射身份/)
    expect(() => createRuntimeSourceMap(graph, [observe(ref, 'u:2', { certainty: 'unmapped' })])).toThrow(/未确认映射身份/)
  })

  it('keeps same-source duplicates on one page distinguishable without inventing certainty', () => {
    const root = project({
      ...footer,
      'src/pages/HomePage.tsx': `import { Footer } from '../components/Footer';\nexport function HomePage() { return <main><h1>Home Title</h1><Footer /><Footer /></main> }`,
      'src/App.tsx': `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
const router = createBrowserRouter([{ path: '/', element: <HomePage /> }]);
export const App = () => <RouterProvider router={router} />;`,
    })
    const graph = analyzeProject(root)
    const ref = footerParagraphRef(graph)
    // 静态影响：两个实例同属本页消费，页面影响不因此翻倍或丢失
    const footerImpact = impact(graph, 'Shared footer text')
    expect(footerImpact.pageRefs).toEqual(['page:/'])
    expect(footerImpact.certainty).toBe('source-proven')
    // 同页两个实例：不同实例 id 可以同时成立且互不合并
    const runtimeMap = createRuntimeSourceMap(graph, [
      observe(ref, 'route:/:footer:1', { pageContext: homePage }),
      observe(ref, 'route:/:footer:2', { pageContext: homePage }),
    ])
    const first = resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }, runtimeMap)
    const second = resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:2' }, runtimeMap)
    expect(first.element.id).toBe(ref)
    expect(second.element.id).toBe(ref)
    expect(first.runtimeInstanceId).not.toBe(second.runtimeInstanceId)
    // 缺失其中一个实例的映射里解析另一个 → 双向映射拒绝
    const singleMap = createRuntimeSourceMap(graph, [observe(ref, 'route:/:footer:2', { pageContext: homePage })])
    expect(() => resolveRuntimeElement(graph, { sourceRef: ref, runtimeInstanceId: 'route:/:footer:1' }, singleMap)).toThrow(/双向映射不匹配/)
  })
})
