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

  it('缺口：root tsconfig 仅有 references 而 alias 声明在非标准文件名时，模块解析失败并被如实记录', () => {
    // 输入：root tsconfig.json 只有 references（solution 风格），paths 在非标准文件名 tsconfig.web.json
    const root = makeProject({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.web.json' }] }),
      'tsconfig.web.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', baseUrl: '.', paths: { '*': ['./src/*'] } }, include: ['src'] }),
      'src/types.ts': `export const title = 'Hello';`,
      'src/main.tsx': `import { title } from 'types'; export const App = () => <h1>{title}</h1>;`,
    })
    const graph = analyzeProject(root)
    // 当前真实行为（缺口，2026-10-21 实测）：references 不被追随、非标准配置文件名不读取，
    // 裸导入 'types' 解析失败后降级为一条自指 imports 边（component → 自身所在文件），
    // 且不进入 unresolved。该自指边具有误导性（看似已解析，实际未指向真实目标文件）。
    // 本用例锁定该真实行为，供提交 A：① 支持追随 tsconfig references；
    // ② 解析失败应进入 unresolved 如实记录，而非产生自指边或静默丢失。
    const imports = graph.edges.filter(edge => edge.kind === 'imports')
    expect(imports.every(edge => edge.to === 'file:src/main.tsx')).toBe(true)
    expect(imports.some(edge => edge.to === 'file:src/types.ts')).toBe(false)
    expect(graph.unresolved.some(entry => entry.includes('types'))).toBe(false)
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
