import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeProject } from './project'
import { sourceProvenPageImpact } from './scope'

/**
 * 第三方通用能力最小复现（Issue #6，提交给 A 的公共接口需求依据）。
 *
 * 每个用例都是自包含的最小真实工程（临时目录 + git commit，与 project.test.ts
 * 同约定），不依赖任何第三方仓库检出、不按项目名称特判。断言锁定**当前真实
 * 行为**：支持的能力证明可用，缺口如实表现为 unknown/未解析，绝不把 unsupported
 * 写成 PASS。
 */

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-thirdparty-repro-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
afterEach(() => {
  // 与仓库既有测试同一约定；本机 Windows rmSync 对 git 只读临时目录有已知 EPERM 噪音，Linux CI 为准。
  for (const root of temporaryRoots.splice(0)) {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 已知环境噪音 */ }
  }
})

function makeProject(files: Record<string, string>): string {
  const root = temp()
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  if (!files['package.json']) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'repro-project', private: true }))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return root
}

const pageFiles = {
  'src/pages/Billing.tsx': `export function Billing() { return <main><h1>Billing Overview</h1></main> }`,
  'src/main.tsx': `import { Billing } from './pages/Billing'; export const App = () => <Billing />;`,
}

describe('第三方能力最小复现：react-router data router 路由识别缺口（提交 A）', () => {
  it('复现：createBrowserRouter 数据路由配置不产生任何 route 节点，页面影响 fail-closed 为 unknown', () => {
    // 输入：react-router v6 data router（createBrowserRouter + 数组路由表，第三方工程最常见形式之一）
    const root = makeProject({
      ...pageFiles,
      'src/App.tsx': `
        import { createBrowserRouter, RouterProvider } from 'react-router-dom';
        import { Billing } from './pages/Billing';
        export const router = createBrowserRouter([{ path: '/billing', element: <Billing /> }]);
        export const App = () => <RouterProvider router={router} />;
      `,
    })
    const graph = analyzeProject(root)
    // 当前真实行为（缺口）：0 个 route 节点
    expect(graph.nodes.filter(node => node.kind === 'route')).toEqual([])
    // 后果：文本节点的页面影响无法证明，保持 unknown（绝不升级为 proven）
    const text = graph.nodes.find(node => node.kind === 'data' && node.value === 'Billing Overview')
    expect(text).toBeDefined()
    const impact = sourceProvenPageImpact(graph, text!.id)
    expect(impact.certainty).toBe('unknown')
    expect(impact.pageRefs).toEqual([])
    expect(impact.unresolved.length).toBeGreaterThan(0)
  })

  it('对照：受支持的 useState + state === literal 惯用法则正常产生 route 节点与页面影响', () => {
    // 输入：当前已支持的 idiom（青野同型）
    const root = makeProject({
      ...pageFiles,
      'src/App.tsx': `
        import { useState } from 'react';
        import { Billing } from './pages/Billing';
        export const App = () => {
          const [page, setPage] = useState('billing');
          return <main><button aria-label="go" onClick={() => setPage('billing')} />{page === 'billing' && <Billing />}</main>;
        };
      `,
    })
    const graph = analyzeProject(root)
    const routes = graph.nodes.filter(node => node.kind === 'route')
    expect(routes.map(node => node.page)).toContain('billing')
    const text = graph.nodes.find(node => node.kind === 'data' && node.value === 'Billing Overview')
    expect(text).toBeDefined()
    expect(sourceProvenPageImpact(graph, text!.id).pageRefs).toContain('page:billing')
  })
})

describe('第三方能力最小复现：codescandy 真实 data router 结构（Component:/children/index/动态参数）', () => {
  // 结构取自 codescandy App.tsx 真实形态（createBrowserRouter + 嵌套 children +
  // Component: 标识符 + index route + 相对 path + 动态参数），最小化后作为提交 A 的
  // 复现输入。A 实现后本组断言应升级为"route→component→source 证明关系成立"，
  // 当前锁定真实行为：路由定义存在于源码、组件可解析，但渲染关系无法证明。
  const routerApp = (extraPages: Record<string, string> = {}) => makeProject({
    'src/pages/DashboardHome.tsx': `export function DashboardHome() { return <main><h1>Home Content</h1></main> }`,
    'src/pages/Profile.tsx': `export function Profile() { return <main><h1>Profile Overview</h1></main> }`,
    'src/pages/OrderDetail.tsx': `export function OrderDetail() { return <main><h1>Order Detail</h1></main> }`,
    'src/App.tsx': `
      import { createBrowserRouter, RouterProvider } from 'react-router-dom';
      import { DashboardHome } from './pages/DashboardHome';
      import { Profile } from './pages/Profile';
      import { OrderDetail } from './pages/OrderDetail';
      const router = createBrowserRouter([
        {
          path: 'dashboard',
          children: [
            { index: true, Component: DashboardHome },
            { path: 'profile', Component: Profile },
            { path: 'orders/:orderId', element: <OrderDetail /> },
          ],
        },
      ]);
      export const App = () => <RouterProvider router={router} />;
    `,
    ...extraPages,
  })

  it('真实结构：嵌套 children + Component:/element:/index/动态参数当前产出 0 route 节点，页面影响 unknown', () => {
    const graph = analyzeProject(routerApp())
    // 附带实测：路由 path 字符串字面量（'dashboard'/'profile'/'orders/:orderId'）当前
    // 不提取为 data 节点（图中仅 JSX 文本成为 data）——路由定义在源码中存在，
    // 但在 SourceGraph 中完全不可见，这是 route 识别缺口的组成部分。
    const pathValues = graph.nodes.filter(node => node.kind === 'data').map(node => node.value)
    expect(pathValues).not.toContain('profile')
    expect(pathValues).not.toContain('orders/:orderId')
    // 当前真实行为（缺口）：0 个 route 节点，三种路由形态（Component:/element:/index/children）均不可证明
    expect(graph.nodes.filter(node => node.kind === 'route')).toEqual([])
    // 后果：页面文本影响 fail-closed 为 unknown（绝不升级为 proven）
    const text = graph.nodes.find(node => node.kind === 'data' && node.value === 'Profile Overview')
    expect(text).toBeDefined()
    const impact = sourceProvenPageImpact(graph, text!.id)
    expect(impact.certainty).toBe('unknown')
    expect(impact.pageRefs).toEqual([])
  })

  it('期望语义（A 实现后的验收标准，当前预先锁定输入与组件解析前提）', () => {
    const graph = analyzeProject(routerApp())
    // 输入前提①：路由涉及的三个组件在图中可解析（component 节点存在）
    const componentNames = graph.nodes.filter(node => node.kind === 'component').map(node => node.label)
    expect(componentNames).toContain('DashboardHome')
    expect(componentNames).toContain('Profile')
    expect(componentNames).toContain('OrderDetail')
    // 输入前提②：App.tsx 到各页面文件的 imports 模块边真实建立（route→component 证明的原材料）
    for (const page of ['DashboardHome', 'Profile', 'OrderDetail']) {
      expect(graph.edges.some(edge =>
        edge.kind === 'imports' && edge.id.startsWith('import:') &&
        edge.from === 'file:src/App.tsx' && edge.to === `file:src/pages/${page}.tsx`,
      )).toBe(true)
    }
    // 备注（不算断言）：A 实现时必须区分——route 定义存在、组件可解析、渲染关系可证明
    // 是三个独立层次；动态参数 :orderId 与条件消费者应保持 partial/unknown，
    // 不能只因检测到 createBrowserRouter 字符串就生成 source-proven 页面关系。
  })
})

describe('第三方能力最小复现：tsconfig 配置读取边界（catch-all alias 与 references）', () => {
  it('支持：固定名单内 tsconfig.app.json 声明的 catch-all paths（* → ./src/*）参与模块解析', () => {
    // 输入：codescandy 同型 catch-all alias（声明在固定读取名单内的配置文件）
    const root = makeProject({
      'tsconfig.app.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', baseUrl: '.', paths: { '*': ['./src/*'] } }, include: ['src'] }),
      'src/types.ts': `export const title = 'Hello';`,
      'src/main.tsx': `import { title } from 'types'; export const App = () => <h1>{title}</h1>;`,
    })
    const graph = analyzeProject(root)
    // import 边真实建立（非 unresolved）= catch-all alias 在固定名单内被读取
    expect(graph.unresolved).toEqual([])
    expect(graph.edges.some(edge => edge.kind === 'imports' && edge.to === 'file:src/types.ts')).toBe(true)
  })

  it('缺口：内部别名裸导入解析失败被静默忽略，无 import 模块边也无 unresolved 记录（2026-10-21 根因已修正）', () => {
    // 输入：root tsconfig.json 只有 references（solution 风格），paths 在非标准文件名 tsconfig.web.json
    const root = makeProject({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.web.json' }] }),
      'tsconfig.web.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', baseUrl: '.', paths: { '*': ['./src/*'] } }, include: ['src'] }),
      'src/types.ts': `export const title = 'Hello';`,
      'src/main.tsx': `import { title } from 'types'; export const App = () => <h1>{title}</h1>;`,
    })
    const graph = analyzeProject(root)
    // 根因（project.ts ImportDeclaration 循环，协调人 2026-10-21 独立审查确认）：
    //   ts.resolveModuleName 失败后，specifier 既不以 '.' 也不以 '@/' 开头 →
    //   unresolved 判定（仅记录这两种前缀）不覆盖裸导入 → continue 静默跳过。
    // 注意区分两类 'imports' 边（Relation 无 source 字段，第四参是边 id，协调人 P1 修正）：
    //   - id `source:<componentId>` = 组件来源边（component → 自身所在文件），属正常语义；
    //   - id `import:<file>:<offset>` = 真实模块导入边（file → 目标文件）。
    // 此前误把组件来源边当作"解析失败的自指 fallback"，本用例按修正后根因断言。
    const moduleImportEdges = graph.edges.filter(edge => edge.kind === 'imports' && edge.id.startsWith('import:'))
    // 真实缺口：指向 src/types.ts 的模块导入边不存在
    expect(moduleImportEdges.some(edge => edge.to === 'file:src/types.ts')).toBe(false)
    // 同时'types'也未进入 unresolved（静默忽略，而非 fail-closed 记录）
    expect(graph.unresolved.some(entry => entry.includes('types'))).toBe(false)
    // 正常组件来源边不受影响（不得要求 A 删除）
    const provenanceEdges = graph.edges.filter(edge => edge.kind === 'imports' && edge.id.startsWith('source:'))
    expect(provenanceEdges.length).toBeGreaterThan(0)
    expect(provenanceEdges.every(edge => edge.from.startsWith('component:'))).toBe(true)
  })
})

describe('第三方能力最小复现：SCSS 变量 Token 识别缺口（保持 unsupported，不伪装 PASS）', () => {
  it('复现：SCSS 变量定义与消费不产生 token 节点，.scss 导入被记录为未解析', () => {
    // 输入：真实 Sass 变量体系（codescandy theme.scss 同型）
    const root = makeProject({
      'src/styles/_variables.scss': `$primary: #754ffe;\n$font-size-base: 0.875rem;`,
      'src/styles/app.scss': `@import 'variables';\n.hero { color: $primary; font-size: $font-size-base; }`,
      'src/main.tsx': `import './styles/app.scss'; export const App = () => <div className="hero">Hi</div>;`,
    })
    const graph = analyzeProject(root)
    // 当前真实能力边界：0 个 token 节点（SCSS Token 未支持，不得记为已验证）
    expect(graph.nodes.filter(node => node.kind === 'token')).toEqual([])
    expect(graph.edges.filter(edge => edge.kind === 'uses-token')).toEqual([])
    // .scss 导入如实进入 unresolved（src/main.tsx → ./styles/app.scss 同型记录）
    expect(graph.unresolved.some(entry => entry.endsWith('.scss'))).toBe(true)
  })
})
