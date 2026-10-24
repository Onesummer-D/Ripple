/**
 * Runtime Identity 阶段二真实采集原型（C+D）。
 *
 * 链路：真实 React 页面（Vite dev + sourceAnnotationPlugin）→ 浏览器内
 * collectRuntimeIdentitySnapshot → 宿主 assessRuntimeIdentity（fileDigest =
 * 标注后 served code 的 sha256，与插件注册值同口径）→ 证据归档（sha256）。
 *
 * 不人工固定成功字段；instanceIdentityProven 只来自 assessRuntimeIdentity。
 * 用法：node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *        scripts/runtime-identity-phase2-proto.mjs [output.json]
 * 退出码：0 = 全部场景断言通过；2 = 有场景未达预期（证据已归档）。
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { analyzeProject } from '../src/core/project.ts'
import { assessRuntimeIdentity, collectRuntimeIdentitySnapshot, compareRuntimeSnapshots } from '../src/core/runtime-identity.ts'
import { sourceAnnotationPlugin } from '../src/core/source-annotation.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const outputPath = process.argv[2] ?? path.join(repoRoot, 'docs/probes/runtime-identity-phase2-proto-20261024.json')

const fixtureBase = path.join(path.dirname(repoRoot), '.ripple-fixtures')
fs.mkdirSync(fixtureBase, { recursive: true })
const root = fs.mkdtempSync(path.join(fixtureBase, 'ripple-identity-phase2-'))

const write = (name, content) => {
  const target = path.join(root, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

// ---------------------------------------------------------------------------
// 独立测试工程：一个真实可运行的 React SPA，按 pathname 分场景。
// ---------------------------------------------------------------------------
write('package.json', JSON.stringify({ name: 'identity-phase2-proto' }))
write('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
write('index.html', `<!doctype html><html><head><title>identity phase2</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`)
write('src/main.jsx', `import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
createRoot(document.getElementById('root')).render(<App />);`)
write('src/kit.jsx', `export function Hero() { return <h1 data-proto="solo">Solo Hero</h1> }
export function Row({ title }) { return <h2>{title}</h2> }
export function Pinnable() { return <h1 data-proto="remount">Pinned Note</h1> }
export function SharedMarker() { return <h1 data-proto="shared">Shared Text</h1> }`)
write('src/App.jsx', `import { useState } from 'react';
import { Hero, Row, Pinnable, SharedMarker } from './kit.jsx';

const items = [{ id: 'a', title: 'Keyed A' }, { id: 'b', title: 'Keyed B' }];

export function App() {
  const { pathname } = window.location;
  const [show, setShow] = useState(true);
  if (pathname === '/solo') return <main><Hero /></main>;
  if (pathname === '/keyed') return <main>{items.map(item => <Row key={item.id} title={item.title} />)}</main>;
  if (pathname === '/positional') return <main>{items.map((item, i) => <Row key={i} title={\`Pos \${i}\`} />)}</main>;
  if (pathname === '/unstable') return <main>{items.map((item, i) => <Row key={Math.random()} title={\`Unstable \${i}\`} />)}</main>;
  if (pathname === '/remount') return <main><button id="toggle" onClick={() => setShow(value => !value)}>toggle</button>{show ? <Pinnable key="pin-1" /> : null}</main>;
  if (pathname === '/alpha' || pathname === '/beta') return <main><SharedMarker /></main>;
  return <main>unknown</main>;
}`)

execFileSync('git', ['init', '-q'], { cwd: root })
execFileSync('git', ['add', '.'], { cwd: root })
execFileSync('git', ['-c', 'user.name=Proto', '-c', 'user.email=proto@example.invalid', 'commit', '-qm', 'phase2 fixture'], { cwd: root })

// ---------------------------------------------------------------------------
// 宿主侧：SourceGraph + served-source digest。
// 插件注册的 sourceVersion = 变换输入（原始文件内容 utf8）的 sha256
// （source-annotation.ts 用输入 code 计算注册值，而非标注后输出），宿主同口径；
// 不一致时 assessRuntimeIdentity 给出 source-version-mismatch 且 locatable=false。
// ---------------------------------------------------------------------------
const graph = analyzeProject(root)
const annotation = sourceAnnotationPlugin(root)
const fileDigest = (file) => {
  try { return createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8'), 'utf8').digest('hex') } catch { return undefined }
}

// ---------------------------------------------------------------------------
// 服务与采集
// ---------------------------------------------------------------------------
const reactModule = await import('@vitejs/plugin-react')
const react = reactModule.default ?? reactModule
const collectorCode = `(${collectRuntimeIdentitySnapshot.toString()})`
const nm = path.join(repoRoot, 'node_modules')
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  plugins: [
    annotation,
    react(),
    { name: 'proto-collector', transformIndexHtml: { order: 'post', handler: html => html.replace('</head>', () => `<script>window.__rippleCollect = ${collectorCode};</script></head>`) } },
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      react: path.join(nm, 'react'),
      'react/jsx-runtime': path.join(nm, 'react', 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(nm, 'react', 'jsx-dev-runtime.js'),
      'react-dom': path.join(nm, 'react-dom'),
      'react-dom/client': path.join(nm, 'react-dom', 'client.js'),
    },
  },
  optimizeDeps: { include: ['react', 'react-dom/client'], esbuildOptions: { preserveSymlinks: true } },
  server: { port: 0, strictPort: false },
})
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')

const browser = await chromium.launch()
const evidence = { protocol: 'ripple-runtime-identity/v1', fixture: root, base, scenarios: {}, failures: [] }
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const recordOf = (snapshot, label) => {
  const matches = snapshot.records.filter(r => r.label === label)
  return matches.length === 1 ? matches[0] : undefined
}
const check = (name, condition, detail) => {
  if (!condition) evidence.failures.push({ scenario: name, detail })
}

try {
  const page = await browser.newPage()
  const collect = async (pathname) => {
    await page.goto(`${base}${pathname}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-ripple-source]', { timeout: 15000 })
    const snapshot = await page.evaluate(() => window.__rippleCollect({ label: 'data-proto' }))
    evidence.scenarios[pathname] = { snapshotSha256: sha(snapshot), snapshot }
    return snapshot
  }
  const assess = (pathname, label, context = {}) => {
    const snapshot = evidence.scenarios[pathname].snapshot
    const record = recordOf(snapshot, label)
    if (!record) return undefined
    return assessRuntimeIdentity(graph, snapshot, record, { fileDigest, expectedPage: { pathname }, ...context })
  }

  // S1 单一静态 JSX 元素：stable-react-instance，严格证明成立
  const solo = await collect('/solo')
  const s1 = assess('/solo', 'solo')
  check('single-static', s1?.certainty === 'stable-react-instance' && s1?.instanceIdentityProven === true && s1?.reasons.length === 0 && s1?.sameSourceCount === 1, s1)

  // S2 同源组件多稳定 keyed 实例：id 区分实例，逐一严格证明
  await collect('/keyed')
  const keyed = evidence.scenarios['/keyed'].snapshot
  const keyedRecords = keyed.records.filter(r => r.sourceFile === 'src/kit.jsx' && r.certainty === 'stable-keyed-instance')
  const keyedAssess = keyedRecords.map(r => assessRuntimeIdentity(graph, keyed, r, { fileDigest, expectedPage: { pathname: '/keyed' } }))
  check('multi-keyed', keyedAssess.length === 2 && keyedAssess.every(a => a.instanceIdentityProven === true) &&
    new Set(keyedAssess.map(a => a.runtimeInstanceId)).size === 2 && keyedAssess.every(a => a.sameSourceCount === 2), keyedAssess)
  evidence.scenarios['/keyed'].assessments = keyedAssess

  // S3 无稳定 key 的重复列表：position-dependent，可定位但不证明实例
  await collect('/positional')
  const positional = evidence.scenarios['/positional'].snapshot
  const positionalAssess = positional.records.filter(r => r.certainty === 'position-dependent')
    .map(r => assessRuntimeIdentity(graph, positional, r, { fileDigest, expectedPage: { pathname: '/positional' } }))
  check('positional-list', positionalAssess.length === 2 && positionalAssess.every(a => a.certainty === 'position-dependent' && a.locatable === true && a.instanceIdentityProven === false && a.reasons.includes('identity-not-stable')), positionalAssess)
  evidence.scenarios['/positional'].assessments = positionalAssess

  // S4 重新挂载：key 保持身份连续，DOM 节点变化 → remounted
  await collect('/remount')
  const before = evidence.scenarios['/remount'].snapshot
  const beforeRecord = recordOf(before, 'remount')
  await page.click('#toggle'); await page.waitForTimeout(100)
  const hidden = await page.evaluate(() => window.__rippleCollect({ label: 'data-proto' }))
  const removed = compareRuntimeSnapshots(before, hidden)
  await page.click('#toggle'); await page.waitForTimeout(100)
  const reshown = await page.evaluate(() => window.__rippleCollect({ label: 'data-proto' }))
  const remount = compareRuntimeSnapshots(before, reshown)
  const remountRecord = recordOf(reshown, 'remount')
  const s4 = assessRuntimeIdentity(graph, reshown, remountRecord, { fileDigest, expectedPage: { pathname: '/remount' } })
  check('remount', beforeRecord?.runtimeInstanceId === remountRecord?.runtimeInstanceId &&
    removed.some(c => c.runtimeInstanceId === beforeRecord?.runtimeInstanceId && c.status === 'removed') &&
    remount.some(c => c.runtimeInstanceId === beforeRecord?.runtimeInstanceId && c.status === 'remounted') &&
    s4.instanceIdentityProven === true, { removed, remount, s4 })
  evidence.scenarios['/remount'].lifecycle = { removed, remount, assessment: s4 }

  // S5 同源组件不同页面：正确 expectedPage 证明；错误 expectedPage 降级
  await collect('/alpha')
  await collect('/beta')
  const s5a = assess('/alpha', 'shared')
  const s5b = assess('/beta', 'shared')
  const s5wrong = assess('/alpha', 'shared', { expectedPage: { pathname: '/beta' } })
  check('cross-page', s5a?.instanceIdentityProven === true && s5b?.instanceIdentityProven === true &&
    s5wrong?.instanceIdentityProven === false && s5wrong?.reasons.includes('page-context-mismatch'), { s5a, s5b, s5wrong })
  evidence.scenarios['/alpha'].assessment = s5a
  evidence.scenarios['/beta'].assessment = s5b
  evidence.scenarios['/alpha'].wrongPageAssessment = s5wrong

  // S7 文件版本不一致：错误 digest → source-version-mismatch，不可定位
  const s7 = assess('/solo', 'solo', { fileDigest: () => 'deadbeef'.repeat(8) })
  check('version-mismatch', s7?.instanceIdentityProven === false && s7?.locatable === false && s7?.reasons.includes('source-version-mismatch'), s7)
  evidence.scenarios['/solo'].versionMismatchAssessment = s7

  // S8 身份在运行时不稳定（随机 key）：certainty unknown，不证明
  await collect('/unstable')
  const unstable = evidence.scenarios['/unstable'].snapshot
  const unstableAssess = unstable.records.filter(r => r.certainty === 'unknown')
    .map(r => assessRuntimeIdentity(graph, unstable, r, { fileDigest, expectedPage: { pathname: '/unstable' } }))
  check('unstable-identity', unstableAssess.length === 2 && unstableAssess.every(a => a.certainty === 'unknown' && a.instanceIdentityProven === false && a.reasons.includes('identity-not-stable')), unstableAssess)
  evidence.scenarios['/unstable'].assessments = unstableAssess
} finally {
  await browser.close()
  await server.close()
}

// ---------------------------------------------------------------------------
// 归档与判定
// ---------------------------------------------------------------------------
evidence.graph = { id: graph.id, nodes: graph.nodes.length, jsxElements: graph.nodes.filter(n => n.kind === 'jsx-element').length }
evidence.verdict = { exitCode: evidence.failures.length ? 2 : 0, satisfied: evidence.failures.length === 0, failures: evidence.failures.length }
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2))

const summary = Object.fromEntries(Object.entries(evidence.scenarios).map(([k, v]) => [k, { records: v.snapshot.records.length, sha: v.snapshotSha256.slice(0, 12) }]))
console.log(JSON.stringify({ base, graph: evidence.graph, scenarios: summary, verdict: evidence.verdict }, null, 2))
process.exit(evidence.verdict.exitCode)
