import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import ts from 'typescript'
import type { RuntimeElementObservation, SourceGraph } from './model'
import { createRuntimeSourceMap, resolveRuntimeElement, resolveRuntimeInstance } from './project'
import { assessRuntimeIdentity, collectRuntimeIdentitySnapshot, compareRuntimeSnapshots, selectableRuntimeObservations, type RuntimeIdentityRecord, type RuntimeIdentitySnapshot } from './runtime-identity'
import { classifyKeyExpression, createProjectEscapeIndex, RIPPLE_IDENTITY_RUNTIME, sourceAnnotationPlugin } from './source-annotation'
import { removeLink, removeTree } from './test-fixture-dir'

const projectRoot = path.resolve('/ripple-virtual-project')
const transform = (code: string, file = 'src/App.jsx'): string => {
  const plugin = sourceAnnotationPlugin(projectRoot)
  if (!plugin.transform || typeof plugin.transform !== 'function') throw new Error('Expected a transform hook')
  const result = Reflect.apply(plugin.transform, undefined, [code, path.join(projectRoot, file)]) as { code: string } | null
  if (!result) throw new Error('Expected the file to be annotated')
  const parsed = ts.createSourceFile(file, result.code, ts.ScriptTarget.Latest, true, file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TSX)
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  expect(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([])
  return result.code
}
/** Attribute expressions the plugin added to the host element whose source starts at `marker`. */
const hostAttributes = (output: string, original: string, marker: string) => {
  const offset = original.indexOf(marker)
  expect(offset).toBeGreaterThanOrEqual(0)
  const sourceRef = `data-ripple-source="jsx:src/App.jsx#${offset}"`
  const start = output.indexOf(sourceRef)
  expect(start, `annotation for ${marker}`).toBeGreaterThanOrEqual(0)
  const end = output.indexOf('>', output.indexOf('data-ripple-identity-certainty', start))
  return output.slice(start, end)
}

/**
 * The local certainty literal of a host element's annotation. (Round 2 fix: `hostAttributes`
 * contains the owner ternary, which always mentions "position-dependent" and "unknown",
 * so substring checks for those two values were vacuous.)
 */
const certaintyOf = (output: string, original: string, marker: string) => {
  const attributes = hostAttributes(output, original, marker)
  const match = /data-ripple-identity-certainty=\{(?:__rippleCertainty\w*\(\w+, "([a-z-]+)"[^}]*|"(unmapped)")\}/.exec(attributes)
  expect(match, `certainty attribute for ${marker}`).toBeTruthy()
  return match![1] ?? match![2]
}

describe('React key stability classification', () => {
  const classify = (expression: string, inList = true) => {
    const source = ts.createSourceFile('key.tsx', `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const statement = source.statements[0] as ts.ExpressionStatement
    return classifyKeyExpression(statement.expression, source, { item: new Set(['product', 'id']), index: new Set(['index']), local: new Set(['position']), inList })
  }
  it.each([
    ['product.id', 'stable'], ['product', 'stable'], ['id', 'stable'], ['`${product.type}-${product.id}`', 'stable'], ['String(product.id)', 'stable'],
    ['product.id.toString()', 'stable'], ["product['sku']", 'stable'], ['product.id!', 'stable'],
    ["'row-' + product.id", 'stable'], ['product.id ?? product.slug', 'stable'], ['flag ? product.id : product.slug', 'stable'],
    ['`${selected}` + product.id', 'stable'], ['product.row * 0', 'unverified'], ['-product.id', 'unverified'], ['product.a ? product.id : selected', 'unverified'], ['product.id || selected', 'unverified'],
    ['!product.id', 'unverified'], ['product.name.length', 'unverified'], ['product.id === selected', 'unverified'],
    ['index', 'index'], ['`row-${index}`', 'index'], ['product.id + index', 'index'], ['product.id ?? index', 'index'],
    ['Math.random()', 'unstable'], ['crypto.randomUUID()', 'unstable'], ['Date.now()', 'unstable'], ['`${Date.now()}`', 'unstable'], ['new Date().getTime()', 'unstable'], ['nanoid()', 'unstable'],
    ['keyFor(product)', 'unverified'], ['products.indexOf(product)', 'unverified'], ["'static'", 'unverified'], ['prefix', 'unverified'], ['position', 'unverified'], ['product[0]', 'unverified'], ['product[field]', 'unverified'],
  ])('classifies %s inside a list as %s', (expression, expected) => {
    expect(classify(expression)).toBe(expected)
  })
  it.each([["'hero'", 'stable'], ['user.id', 'stable'], ['selectedId', 'stable'], ['Math.random()', 'unstable'], ['computeKey()', 'unverified']])('classifies %s outside a list as %s', (expression, expected) => {
    expect(classify(expression, false)).toBe(expected)
  })
})

describe('source annotation transform', () => {
  it('marks index keys as position-dependent and business keys as stable-keyed', () => {
    const code = `export function App({ items }) { return <main>{items.map((item, i) => <Card key={i} item={item} />)}{items.map(item => <Card key={item.id} item={item} />)}<ol>{items.map((item, i) => <li key={\`row-\${i}\`}>{item.name}</li>)}</ol></main> }
function Card({ item }) { return <p>{item.name}</p> }`
    const output = transform(code)
    expect(output).toMatch(/key=\{\(__rippleKey\d+_*\.k = \(i\)\)\} component=\{Card\}[^>]*certainty="position-dependent"/)
    expect(output).toMatch(/key=\{\(__rippleKey\d+_*\.k = \(item\.id\)\)\} component=\{Card\}[^>]*certainty="stable-keyed-instance"/)
    expect(certaintyOf(output, code, '<li key')).toBe('position-dependent')
  })

  it('treats render props, helper callbacks and loops as unproven repetition', () => {
    const code = `export function App({ items }) {
  const renderRow = item => <li>{item.name}</li>
  const rows = []
  for (const item of items) rows.push(<dt key={item.id}>{item.name}</dt>)
  return <main><List render={item => <dd>{item.name}</dd>} /><ul>{items.map(renderRow)}</ul><dl>{rows}</dl></main>
}`
    const output = transform(code)
    for (const marker of ['<li>', '<dd>']) expect(certaintyOf(output, code, marker), marker).toBe('unknown')
    const looped = hostAttributes(output, code, '<dt')
    expect(certaintyOf(output, code, '<dt')).toBe('unknown')
    expect(looped).toContain('data-ripple-instance')
    expect(output).toMatch(/component=\{List\}[^>]*certainty="stable-react-instance"/)
  })

  it('keeps once-per-render functions transparent', () => {
    const code = `import { useMemo } from 'react'
export function App() { const header = useMemo(() => <h1>Title</h1>, []); const footer = (() => <footer>Foot</footer>)(); return <main>{header}{footer}</main> }`
    const output = transform(code)
    expect(certaintyOf(output, code, '<h1>')).toBe('stable-react-instance')
    expect(certaintyOf(output, code, '<footer>')).toBe('stable-react-instance')
  })

  it('binds root renders, leaves other module-level JSX unbound and never self-references a shadowed component', () => {
    const code = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
const routes = [{ element: <Home /> }]
const note = <small>note</small>
function Home() { const Home = 'shadow'; return <p>home</p> }
function App() { return <main>{routes[0].element}{note}</main> }
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)`
    const output = transform(code)
    expect(output).toMatch(/component=\{App\} root=\{true\}/)
    expect(output).toMatch(/component=\{StrictMode\} root=\{true\}/)
    expect(output).not.toMatch(/component=\{Home\}/)
    expect(hostAttributes(output, code, '<small>')).toContain('data-ripple-instance={"unmapped:')
    expect(output).toMatch(/__rippleUseIdentity\w*\(undefined, __rippleOwner\d+\)/)
    expect(output).toMatch(/__rippleUseIdentity\w*\(App, __rippleOwner\d+\)/)
  })

  it('places boundaries only where React itself consumes the element', () => {
    const output = transform(`export function App({ items, ok }) {
  const stored = <Stored />
  const cell = <span><InStoredHost /></span>
  if (!items.length) return <Empty />
  return <main>
    {ok ? <InHost /> : null}
    {items.map(item => <InList key={item.id} />)}
    {items.map(item => { return <InBlockList key={item.id} /> })}
    <><InFragment /></>
    <Parent><AsChild /><>{ok && <InChildFragment />}</></Parent>
    <Parent slot={<AsProp />} />
    {stored}{cell}
  </main>
}
export const Concise = () => (<InConcise />)`)
    for (const tag of ['Empty', 'InHost', 'InList', 'InBlockList', 'InFragment', 'Parent', 'InConcise']) expect(output, tag).toMatch(new RegExp(`component=\\{${tag}\\}`))
    for (const tag of ['Stored', 'InStoredHost', 'AsChild', 'InChildFragment', 'AsProp']) expect(output, tag).not.toMatch(new RegExp(`component=\\{${tag}\\}`))
  })

  it('injects no hooks into components that the file calls as plain functions', () => {
    const code = `function Row(item) { return <li>{item}</li> }
function Header({ title }) { return <h1>{title}</h1> }
function Card({ title }) { return <h2>{title}</h2> }
export function App({ items }) { return <main>{Header({ title: 'x' })}<ul>{items.map(Row)}</ul><Card title="y" /></main> }`
    const output = transform(code)
    expect(output).not.toMatch(/__rippleUseIdentity\w*\((?:Row|Header),/)
    expect(output).toMatch(/__rippleUseIdentity\w*\(Card,/)
    expect(hostAttributes(output, code, '<li>')).toContain('data-ripple-identity-certainty={"unmapped"}')
    expect(hostAttributes(output, code, '<h1>')).toContain('data-ripple-identity-certainty={"unmapped"}')
  })

  it('orders boundaries that share a source offset (concise arrow bodies and adjacent siblings)', () => {
    const output = transform(`export const Page = () => <Layout title="x" />
function Layout({ title }) { return <h1>{title}</h1> }
export function Pair() { return <main><Layout title="a" /><Layout title="b" /></main> }`)
    expect(output).toMatch(/=> \{\nconst __rippleOwner\d+ = __rippleUseId\(\); const __rippleIdentity\d+ = __rippleUseIdentity\(Page, __rippleOwner\d+\);\nreturn \(<__rippleIdentityBoundary component=\{Layout\}/)
    for (const title of ['x', 'a', 'b']) expect(output).toMatch(new RegExp(`<__rippleIdentityBoundary component=\\{Layout\\}[^>]*><Layout title="${title}" /></__rippleIdentityBoundary>`))
  })

  it('never re-evaluates a key expression, whatever its form', () => {
    // Round 1 treated member access / toString() as pure and repeated them. A getter, Proxy,
    // toString or Symbol.toPrimitive can run user code, so no key expression is repeated.
    const keys = ['item.id', "item['code']", '`${item.slug}`', 'String(item.ref)', 'item.token.toString()', 'item.meta?.uid', 'keyFor(item)', 'id']
    const code = `export function App({ items }) { return <main>
${keys.map((key, index) => `  <ul>{items.map(({ id, ...item }) => <li key={${key}} title="k${index}">x</li>)}</ul>\n  <ol>{items.map(({ id, ...item }) => <Card key={${key}} title="c${index}" />)}</ol>`).join('\n')}
</main> }
function Card({ title }) { return <p>{title}</p> }`
    const output = transform(code)
    for (const key of keys) {
      const occurrences = (text: string) => text.split(`{${key}}`).length - 1 + text.split(`(${key})`).length - 1
      expect(occurrences(code), key).toBe(2)
      expect(occurrences(output), key).toBe(2)
    }
  })

  it('never adds a key to a boundary and keeps keyed state through flatMap, mixed roots and Children.map', () => {
    const code = `import { Children } from 'react'
export function App({ items, children }) { return <main>
  {items.flatMap(item => [<Counter key={item.id} />, <hr key={item.id + '-hr'} />])}
  {items.map(item => item.show ? <Counter key={item.id} /> : <li>hidden</li>)}
  {Children.map(children, child => <Frame>{child}</Frame>)}
</main> }`
    const output = transform(code)
    const boundaryKeys = [...output.matchAll(/<__rippleIdentityBoundary( key=\{\(__rippleKey\d+_*\.k = \([^)]*\)\)\})? component=\{(\w+)\}/g)].map(match => `${match[2]}:${(match[1] ?? '').replace(/__rippleKey\d+_*/, 'cell')}`)
    expect(boundaryKeys).toEqual(['Counter: key={(cell.k = (item.id))}', 'Counter: key={(cell.k = (item.id))}', 'Frame:'])
    expect(output).toMatch(/key=\{\(__rippleKey\d+_*\.k = \(item\.id\)\)\} component=\{Counter\}[^>]*certainty="stable-keyed-instance"/)
    // The key moved to the boundary; the element itself no longer evaluates it.
    expect(output).not.toMatch(/<Counter key=/)
  })

  it('refuses unsafe index injection, detached row JSX, shadowed ancestor keys and position iterators', () => {
    const code = `export function App({ items, rows, selected }) { return <main>
  <ul>{items.map((...args) => <li>{args[0]}</li>)}</ul>
  <ol>{items.map(item => { const mark = item.id === selected ? <i /> : null; return <li key={item.id}>{item.id}{mark}</li> })}</ol>
  <table><tbody>{rows.map(row => <tr key={row.id}>{row.cells.map(row => <td key={row.id}>cell</td>)}</tr>)}</tbody></table>
  <dl>{[...Array(3).keys()].map(i => <dt key={i}>{i}</dt>)}</dl>
</main> }`
    const output = transform(code)
    expect(output).not.toContain('...args,')
    expect(certaintyOf(output, code, '<li>{args')).toBe('unknown')
    expect(certaintyOf(output, code, '<i />')).toBe('unknown')
    expect(certaintyOf(output, code, '<li key')).toBe('stable-keyed-instance')
    const cell = hostAttributes(output, code, '<td key')
    expect(certaintyOf(output, code, '<td key')).toBe('unknown')
    expect(cell).not.toContain('String(row.id),String(row.id)')
    expect(certaintyOf(output, code, '<dt key')).toBe('position-dependent')
  })

  it('never keeps stored or prop-passed JSX stable unless it is rendered once, directly', () => {
    const code = `export function App({ items }) {
  const header = <h1>Title</h1>
  const check = <i>check</i>
  const twice = <b>twice</b>
  return <main>{header}{twice}{twice}<Slot content={<em>slot</em>} /><ul>{items.map(item => <li key={item.id}>{item.id}{item.on && check}</li>)}</ul></main>
}`
    const output = transform(code)
    expect(certaintyOf(output, code, '<h1>')).toBe('stable-react-instance')
    for (const marker of ['<i>', '<b>', '<em>']) expect(certaintyOf(output, code, marker), marker).toBe('unknown')
  })

  it('treats array entries() pairs as positions and Object.keys/entries by provable source', () => {
    // Tightened in round 2: Object.entries(groups) of an unknown-shaped prop is no longer
    // assumed to be an object (an array would yield index keys).
    const code = `const shelf = ['a', 'b']
const labels = { a: 'A', b: 'B' }
export function App({ items, groups }) { return <main>
  <ol>{[...items.entries()].map(([i, item]) => <li key={i}>{item}</li>)}</ol>
  <ul>{Object.entries(groups).map(([name, list]) => <li key={name}>{list.length}</li>)}</ul>
  <ul>{Object.keys(shelf).map(slot => <dt key={slot}>{slot}</dt>)}</ul>
  <ul>{Object.entries(shelf).map(([slot, value]) => <dd key={slot}>{value}</dd>)}</ul>
  <ul>{Object.keys(labels).map(code => <b key={code}>{code}</b>)}</ul>
  <ul>{Object.entries(labels).map(([code, label]) => <i key={code}>{label}</i>)}</ul>
  <ul>{Object.keys({ x: 1, y: 2 }).map(axis => <em key={axis}>{axis}</em>)}</ul>
</main> }`
    const output = transform(code)
    expect(certaintyOf(output, code, '<li key={i}')).toBe('position-dependent')
    expect(certaintyOf(output, code, '<li key={name}')).toBe('unknown')
    expect(certaintyOf(output, code, '<dt key')).toBe('position-dependent')
    expect(certaintyOf(output, code, '<dd key')).toBe('position-dependent')
    expect(certaintyOf(output, code, '<b key')).toBe('stable-keyed-instance')
    expect(certaintyOf(output, code, '<i key')).toBe('stable-keyed-instance')
    expect(certaintyOf(output, code, '<em key')).toBe('stable-keyed-instance')
  })

  it('resolves Object.keys arguments by lexical scope', () => {
    const code = `const items = { a: 1, b: 2 }
export function Props({ items: list }) { const items = list; return <ul>{Object.keys(items).map(key => <li key={key}>{key}</li>)}</ul> }
export function Param({ items }) { return <ol>{Object.keys(items).map(key => <dt key={key}>{key}</dt>)}</ol> }
export function Module() { return <ol>{Object.keys(items).map(key => <dd key={key}>{key}</dd>)}</ol> }
export function Inner() { const list = ['x']; return <ol>{(() => { const list = { y: 1 }; return Object.keys(list).map(key => <b key={key}>{key}</b>) })()}</ol> }`
    const output = transform(code)
    expect(certaintyOf(output, code, '<li key')).toBe('unknown')
    expect(certaintyOf(output, code, '<dt key')).toBe('unknown')
    expect(certaintyOf(output, code, '<dd key')).toBe('stable-keyed-instance')
    expect(certaintyOf(output, code, '<b key')).toBe('stable-keyed-instance')
  })

  it('respects var hoisting when resolving Object.keys arguments', () => {
    const code = `const shapes = { a: 1 }
export function A() { { var shapes = ['x', 'y'] } return <ul>{Object.keys(shapes).map(k => <li key={k}>{k}</li>)}</ul> }
export function B() { return <ul>{Object.keys(shapes).map(k => <dt key={k}>{k}</dt>)}</ul> }`
    const output = transform(code)
    expect(certaintyOf(output, code, '<li key')).toBe('unknown')
    expect(certaintyOf(output, code, '<dt key')).toBe('stable-keyed-instance')
  })

  it('never moves a key in classic-runtime files or past a spread', () => {
    const classic = transform(`/** @jsxRuntime classic */
import React from 'react'
export function App({ items }) { return <ul>{items.map(item => <Card key={item.id} />)}</ul> }`)
    expect(classic).not.toMatch(/component=\{Card\}/)
    expect(classic).not.toContain('__rippleKey')
    expect(classic).toContain('<Card key={item.id} />')
    const spread = transform(`export function App({ items }) { return <ul>{items.map(item => <Card key={item.id} {...item} />)}{items.map(item => <Card {...item} key={item.id} />)}</ul> }`)
    expect(spread).not.toMatch(/component=\{Card\}/)
    expect(spread.match(/key=\{\(__rippleKey\d+_*\.k = \(item\.id\)\)\}/g)).toHaveLength(2)
  })

  it('evaluates an element key once per annotation and only when it is pure', () => {
    const code = `let n = 0
export function App({ items }) { return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}{items.map(item => <p key={n++}>{item.id}</p>)}</ul> }`
    const output = transform(code)
    const row = hostAttributes(output, code, '<li key')
    // No key value appears in host attributes: the trailing "~" is resolved by the collector
    // from React's own fiber keys, so nothing here can run application code.
    expect(row).toMatch(/\+ ":~"\}/)
    expect(row).not.toMatch(/__rippleKey\d/)
    expect(row).not.toContain('data-ripple-list-key')
    expect(output.match(/item\.id(?!\w)/g)).toHaveLength(code.match(/item\.id(?!\w)/g)!.length)
    expect(hostAttributes(output, code, '<p key')).not.toContain('n++')
    expect(output.match(/n\+\+/g)).toHaveLength(1)
  })

  it('keeps directives first, skips async/generator functions and bounds root renders', () => {
    const code = `import { createRoot } from 'react-dom/client'
export function Page() { 'use no memo'; return <main>page</main> }
export async function Loader() { return <p>later</p> }
function Routes({ children }) { return <nav>{children}</nav> }
function Route() { return null }
function Widget() { return <output>w</output> }
createRoot(document.getElementById('a')).render(<Routes><Route path="/a" /></Routes>)
for (const id of ['x', 'y']) createRoot(document.getElementById(id)).render(<Widget />)`
    const output = transform(code)
    expect(output).toMatch(/'use no memo';\nconst __rippleOwner\d+ = __rippleUseId\(\)/)
    expect(output).not.toMatch(/__rippleUseIdentity\w*\(Loader,/)
    expect(output).toMatch(/component=\{Routes\} root=\{true\}[^>]*certainty="stable-react-instance"/)
    expect(output).not.toMatch(/component=\{Route\}/)
    expect(output).toMatch(/component=\{Widget\} root=\{true\}[^>]*certainty="unknown"/)
  })

  it('registers the sha256 of the exact served source', () => {
    const code = `export function App() { return <main>Hi</main> }`
    const output = transform(code)
    const digest = createHash('sha256').update(code, 'utf8').digest('hex')
    expect(output).toContain(`registerRippleSourceVersion as __rippleRegisterSource`)
    expect(output).toContain(`__rippleRegisterSource("src/App.jsx", "${digest}");`)
    expect(output).toContain('data-ripple-instance={"ripple-page-v2:" + encodeURIComponent(JSON.stringify([window.location.pathname, window.location.search, window.location.hash])) + ":" +')
  })

  it('emits no TypeScript-only syntax into JSX files and parses as valid TSX', () => {
    const code = `export const List = ({ items }: { items: Array<{ id: string }> }) => <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>`
    const tsx = transform(code, 'src/App.tsx')
    expect(tsx).toContain('+ ":~"')
    // Host keys are left exactly as written: no capture, no wrapper.
    expect(tsx).not.toContain('__rippleKey')
    expect(tsx).toContain('<li key={item.id}')
    const jsx = transform(`export const List = ({ items }) => <ul>{items.map(item => <li>{item}</li>)}</ul>`)
    expect(jsx).not.toMatch(/\bas\s+(?:typeof|const|string)\b/)
  })
})

describe('project escape index (cross-file hook safety)', () => {
  const project = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-escape-'))
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), text)
    }
    return root
  }
  const hooksIn = (root: string, file: string, component: string) => {
    const plugin = sourceAnnotationPlugin(root)
    const absolute = path.join(root, file)
    const result = Reflect.apply(plugin.transform as (...args: unknown[]) => unknown, undefined, [fs.readFileSync(absolute, 'utf8'), absolute]) as { code: string } | null
    return !!result && new RegExp(`__rippleUseIdentity\\w*\\(${component},`).test(result.code)
  }
  const row = `export function Row(item) { return <li>{item}</li> }\n`

  it('keeps hooks for exports only rendered as JSX and drops them when another file calls them', () => {
    const root = project({
      'src/Row.jsx': row,
      'src/Badge.jsx': `export function Badge() { return <b>x</b> }\n`,
      'src/App.jsx': `import { Row } from './Row'\nimport { Badge } from './Badge.jsx'\nexport function App({ items }) { return <ul><Badge />{items.map(Row)}</ul> }\n`,
    })
    try {
      expect(hooksIn(root, 'src/Badge.jsx', 'Badge')).toBe(true)
      expect(hooksIn(root, 'src/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/App.jsx', 'App')).toBe(true)
    } finally { removeTree(root) }
  })

  it.each([
    ['named barrel', { 'src/ui/index.ts': `export { Row as ListRow } from './Row'\n`, 'src/App.jsx': `import { ListRow } from './ui'\nexport const rows = items => items.map(ListRow)\n` }],
    ['star barrel', { 'src/ui/index.ts': `export * from './Row'\n`, 'src/App.jsx': `import { Row } from './ui/index'\nexport const rows = items => items.map(Row)\n` }],
    ['import then re-export', { 'src/ui/index.ts': `import { Row } from './Row'\nexport { Row }\n`, 'src/App.ts': `import { Row } from './ui'\nexport const first = item => Row(item)\n` }],
    ['namespace member', { 'src/App.jsx': `import * as UI from './ui/Row'\nexport function App({ items }) { return <ul>{items.map(UI.Row)}</ul> }\n` }],
    ['render prop in a .ts file', { 'src/list.ts': `import { Row } from './ui/Row.jsx'\nexport const options = { renderItem: Row }\n` }],
    ['unresolved project alias', { 'src/App.jsx': `import { Row } from '@/ui/Row'\nexport function App({ items }) { return <ul>{items.map(Row)}</ul> }\n` }],
    ['literal dynamic import', { 'src/App.js': `export const load = () => import('./ui/Row').then(module => [1, 2].map(module.Row))\n` }],
    ['non-literal dynamic import', { 'src/App.js': `export const load = name => import(name)\n` }],
    ['string-concatenated dynamic import prefix', { 'src/App.js': `export const load = name => import('./ui/' + name)\n` }],
    ['template dynamic import prefix', { 'src/App.js': 'export const load = name => import(`./ui/${name}.jsx`)\n' }],
    ['namespace re-export (export * as)', { 'src/barrel.ts': `export * as ui from './ui/Row'\n`, 'src/App.jsx': `import { ui } from './barrel'\nexport function App({ items }) { return <ul>{items.map(ui.Row)}</ul> }\n` }],
    ['nested namespace re-export barrel', { 'src/ui/index.ts': `export * from './Row'\n`, 'src/barrel.ts': `export * as kit from './ui'\n`, 'src/App.jsx': `import { kit } from './barrel'\nexport const rows = items => items.map(kit.Row)\n` }],
    ['whole namespace re-export used as a value', { 'src/barrel.ts': `export * as ui from './ui/Row'\n`, 'src/App.jsx': `import { ui } from './barrel'\nexport const all = () => Object.values(ui).map(render => render({}))\n` }],
    ['tsconfig path alias', { 'tsconfig.json': '{ "compilerOptions": { "paths": { "@components/*": ["src/ui/*"] } } }', 'src/App.jsx': `import { Row } from '@components/Row'\nexport const rows = items => items.map(Row)\n` }],
    ['bare alias that is not an installed package', { 'src/App.jsx': `import { Row } from 'ui-kit/Row'\nexport const rows = items => items.map(Row)\n` }],
    ['import.meta.glob', { 'src/App.jsx': `const pages = import.meta.glob('./ui/*.jsx', { eager: true })\nexport const all = () => Object.values(pages).map(module => module.Row({}))\n` }],
    ['caller inside build/', { 'src/build/App.jsx': `import { Row } from '../ui/Row'\nexport const rows = items => items.map(Row)\n` }],
    ['caller in an .mts module', { 'src/App.mts': `import { Row } from './ui/Row.jsx'\nexport const first = (item: string) => Row(item)\n` }],
    ['.call on the function', { 'src/App.jsx': `import { Row } from './ui/Row'\nexport const first = item => Row.call(null, item)\n` }],
  ])('drops hooks when an export escapes through a %s', (_name, files) => {
    const root = project({ 'src/ui/Row.jsx': row, ...files as Record<string, string> })
    try { expect(hooksIn(root, 'src/ui/Row.jsx', 'Row')).toBe(false) } finally { removeTree(root) }
  })

  it('follows default exports imported under another name, and ignores package imports and benign namespace JSX', () => {
    const root = project({
      'src/Cell.jsx': `export default function Cell(item) { return <td>{item}</td> }\n`,
      'src/Row.jsx': row,
      'src/App.jsx': `import Anything from './Cell'\nimport { Row as LibraryRow } from 'some-library'\nimport * as Rows from './Row'\nexport function App({ items }) { return <table>{items.map(Anything)}{items.map(LibraryRow)}<Rows.Row /></table> }\n`,
      'node_modules/some-library/package.json': '{"name":"some-library"}',
    })
    try {
      expect(hooksIn(root, 'src/Cell.jsx', 'Cell')).toBe(false)
      expect(hooksIn(root, 'src/Row.jsx', 'Row')).toBe(true)
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect([...index.origins].map(origin => path.relative(root, origin))).toEqual([path.join('src', 'Cell.jsx#Cell')])
    } finally { removeTree(root) }
  })

  it('resolves linked workspace packages and tsconfig aliases to the real files', () => {
    const root = project({
      'packages/ui/package.json': '{ "name": "@acme/ui", "exports": { ".": { "import": "./index.js" } } }',
      'packages/ui/index.js': `export { Row } from './Row.jsx'\n`,
      'packages/ui/Row.jsx': row,
      'packages/ui/Badge.jsx': `export function Badge() { return <b>b</b> }\n`,
      'apps/web/App.jsx': `import { Row } from '@acme/ui'\nimport { Badge } from '@acme/ui/Badge.jsx'\nexport function App({ xs }) { return <ul><Badge />{xs.map(Row)}</ul> }\n`,
      'src/lib/Item.jsx': `export function Item() { return <i>i</i> }\n`,
      'src/App.jsx': `import { Item } from '@lib/Item'\nexport const all = xs => xs.map(Item)\n`,
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }',
      'index.html': '<div id="root"></div><script type="module" src="/src/App.jsx"></script>',
    })
    try {
      fs.mkdirSync(path.join(root, 'node_modules', '@acme'), { recursive: true })
      fs.symlinkSync(path.join(root, 'packages', 'ui'), path.join(root, 'node_modules', '@acme', 'ui'), 'junction')
      expect(hooksIn(root, 'packages/ui/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'packages/ui/Badge.jsx', 'Badge')).toBe(true)
      expect(hooksIn(root, 'src/lib/Item.jsx', 'Item')).toBe(false)
      const index = createProjectEscapeIndex(root)()
      expect([...index.origins].map(origin => path.relative(root, origin)).sort()).toEqual([path.join('packages', 'ui', 'Row.jsx#Row'), path.join('src', 'lib', 'Item.jsx#Item')])
      expect([...index.names]).toEqual([])
    } finally { removeTree(root) }
  })

  const linkedWorkspace = (manifest: string, extra: Record<string, string> = {}) => {
    const root = project({
      'packages/ui/package.json': manifest,
      'packages/ui/src/index.js': `export { Row } from './Row.jsx'\n`,
      'packages/ui/src/Row.jsx': row,
      'packages/ui/dist/index.js': `export function Row(item) { return item }\n`,
      'apps/web/App.jsx': `import { Row } from '@acme/ui'\nexport const rows = xs => xs.map(Row)\n`,
      ...extra,
    })
    fs.mkdirSync(path.join(root, 'node_modules', '@acme'), { recursive: true })
    fs.symlinkSync(path.join(root, 'packages', 'ui'), path.join(root, 'node_modules', '@acme', 'ui'), 'junction')
    return root
  }
  it.each([
    ['browser before import (manifest key order decides in Vite)', '{ "name": "@acme/ui", "exports": { ".": { "browser": "./src/index.js", "import": "./dist/index.js" } } }'],
    ['development condition', '{ "name": "@acme/ui", "exports": { ".": { "development": "./src/index.js", "default": "./dist/index.js" } } }'],
    ['nested conditions', '{ "name": "@acme/ui", "exports": { ".": { "import": { "development": "./src/index.js", "default": "./dist/index.js" } } } }'],
    ['condition array', '{ "name": "@acme/ui", "exports": { ".": [{ "worker": "./src/index.js" }, "./dist/index.js"] } }'],
    ['sugar exports object', '{ "name": "@acme/ui", "exports": { "browser": "./src/index.js", "default": "./dist/index.js" } }'],
    ['module field next to exports', '{ "name": "@acme/ui", "exports": "./dist/index.js", "module": "./src/index.js" }'],
    ['browser field next to main', '{ "name": "@acme/ui", "main": "./dist/index.js", "browser": "./src/index.js" }'],
    ['legacy jsnext:main field', '{ "name": "@acme/ui", "main": "./dist/index.js", "jsnext:main": "./src/index.js" }'],
    ['legacy jsnext field', '{ "name": "@acme/ui", "main": "./dist/index.js", "jsnext": "./src/index.js" }'],
    ['dotted extension-less module field', '{ "name": "@acme/ui", "main": "./dist/index.js", "module": "./src/index" }'],
  ])('drops hooks when a workspace package entry may resolve through a %s', (_name, manifest) => {
    const root = linkedWorkspace(manifest)
    try {
      expect(hooksIn(root, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect([...index.origins].map(origin => path.relative(root, origin)).sort()).toEqual([path.join('packages', 'ui', 'dist', 'index.js#Row'), path.join('packages', 'ui', 'src', 'Row.jsx#Row')])
    } finally { removeTree(root) }
  })
  it.each([
    ['a target that exists outside the scanned sources', '{ "name": "@acme/ui", "exports": { ".": { "browser": "./node_modules/.cache/entry.js", "default": "./dist/index.js" } } }', { 'packages/ui/node_modules/.cache/entry.js': `export { Row } from '../../src/Row.jsx'\n` }],
    ['an object browser map', '{ "name": "@acme/ui", "main": "./dist/index.js", "browser": { "./dist/index.js": "./src/index.js" } }', {}],
    ['no resolvable entry at all', '{ "name": "@acme/ui", "exports": { "./other": "./dist/index.js" } }', {}],
    ['no entry fields and no index file', '{ "name": "@acme/ui" }', {}],
    ['a directory target with its own manifest', '{ "name": "@acme/ui", "main": "./dist/index.js", "module": "./src/nested" }', { 'packages/ui/src/nested/package.json': '{ "main": "entry.jsx" }', 'packages/ui/src/nested/entry.jsx': `export { Row } from '../Row.jsx'\n` }],
  ])('fails closed for the whole project when a workspace manifest has %s', (_name, manifest, extra) => {
    const root = linkedWorkspace(manifest, { 'src/Badge.jsx': `export function Badge() { return <b>b</b> }\n`, 'src/App.jsx': `import { Badge } from './Badge'\nexport const App = () => <Badge />\n`, ...extra as Record<string, string> })
    try {
      expect(createProjectEscapeIndex(root)().all).toBe(true)
      expect(hooksIn(root, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/Badge.jsx', 'Badge')).toBe(false)
    } finally { removeTree(root) }
  })
  it('fails closed for a deprecated folder mapping that covers the requested subpath', () => {
    const root = linkedWorkspace('{ "name": "@acme/ui", "exports": { ".": "./src/index.js", "./lib/": "./src/" } }', { 'apps/web/Lib.jsx': `import { Row } from '@acme/ui/lib/Row.jsx'\nexport const rows = xs => xs.map(Row)\n`, 'packages/ui/lib/Row.jsx': row })
    try { expect(createProjectEscapeIndex(root)().all).toBe(true) } finally { removeTree(root) }
  })
  it.each([
    ['a types condition pointing at a declaration file', '{ "name": "@acme/ui", "exports": { ".": { "types": "./src/index.d.ts", "import": "./src/index.js" } } }', { 'packages/ui/src/index.d.ts': 'export declare function Row(item: string): unknown\n' }],
    ['a dist target that is not built (fresh worktree)', '{ "name": "@acme/ui", "main": "./build/index.js", "exports": { ".": { "development": "./src/index.js", "default": "./build/index.js" } } }', {}],
    ['subpath patterns next to the root entry', '{ "name": "@acme/ui", "exports": { ".": "./src/index.js", "./*": "./src/*.js" } }', {}],
    ['a null exclusion and a package.json entry', '{ "name": "@acme/ui", "exports": { ".": "./src/index.js", "./internal": null, "./package.json": "./package.json" } }', {}],
    ['a declaration file under a runtime condition', '{ "name": "@acme/ui", "exports": { ".": { "import": "./src/index.js", "default": "./src/index.d.ts" } } }', { 'packages/ui/src/index.d.ts': 'export declare function Row(item: string): unknown\n' }],
    ['a style export and a top-level types field', '{ "name": "@acme/ui", "types": "./src/index.d.ts", "exports": { ".": { "style": "./src/styles.css", "default": "./src/index.js" }, "./styles.css": "./src/styles.css" } }', { 'packages/ui/src/styles.css': 'b { color: red }\n' }],
  ])('keeps the project-wide index precise for a workspace manifest with %s', (_name, manifest, extra) => {
    const root = linkedWorkspace(manifest, { 'src/Badge.jsx': `export function Badge() { return <b>b</b> }\n`, 'src/App.jsx': `import { Badge } from './Badge'\nexport const App = () => <Badge />\n`, ...extra as Record<string, string> })
    try {
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect(index.origins.has(path.join(root, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(true)
      expect(hooksIn(root, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/Badge.jsx', 'Badge')).toBe(true)
    } finally { removeTree(root) }
  })
  it('expands exports subpath patterns for the requested subpath', () => {
    const root = linkedWorkspace('{ "name": "@acme/ui", "exports": { ".": "./dist/index.js", "./*": "./src/*.jsx" } }', {
      'packages/ui/src/Cell.jsx': `export function Cell(item) { return <td>{item}</td> }\n`,
      'apps/web/Table.jsx': `import { Cell } from '@acme/ui/Cell'\nexport const cells = xs => xs.map(Cell)\n`,
    })
    try {
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect(index.origins.has(path.join(root, 'packages', 'ui', 'src', 'Cell.jsx#Cell'))).toBe(true)
      expect(hooksIn(root, 'packages/ui/src/Cell.jsx', 'Cell')).toBe(false)
    } finally { removeTree(root) }
  })
  it('resolves a deep workspace import without an exports map by its file path', () => {
    const root = linkedWorkspace('{ "name": "@acme/ui", "main": "./src/index.js" }', {
      'packages/ui/src/Cell.jsx': `export function Cell(item) { return <td>{item}</td> }\n`,
      'apps/web/Table.jsx': `import { Cell } from '@acme/ui/src/Cell.jsx'\nexport const cells = xs => xs.map(Cell)\n`,
    })
    try {
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect(index.origins.has(path.join(root, 'packages', 'ui', 'src', 'Cell.jsx#Cell'))).toBe(true)
    } finally { removeTree(root) }
  })
  it('resolves dotted extension-less entries and imports to script files instead of treating them as assets', () => {
    const root = linkedWorkspace('{ "name": "@acme/ui", "main": "./dist/index.js", "module": "./src/index.esm" }', {
      'packages/ui/src/index.esm.jsx': `export { Row } from './Row.jsx'\n`,
      'src/Cell.web.jsx': `export function Cell(item) { return <td>{item}</td> }\n`,
      'src/Table.jsx': `import { Cell } from './Cell.web'\nexport const cells = xs => xs.map(Cell)\n`,
    })
    try {
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect(index.origins.has(path.join(root, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(true)
      expect(hooksIn(root, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/Cell.web.jsx', 'Cell')).toBe(false)
    } finally { removeTree(root) }
  })
  it('records files by real path when a symlinked folder is walked before its target', () => {
    const root = project({
      'zshared/Row.jsx': row,
      'zshared/Tile.jsx': `export function Tile() { return <p>t</p> }\n`,
      'zshared/kit/Badge.jsx': `export function Badge() { return <b>b</b> }\n`,
      'src/App.jsx': `import { Row } from './linked/Row'\nexport const rows = xs => xs.map(Row)\n`,
      'src/Lazy.js': `export const load = name => import('./linked/kit/' + name)\n`,
      'src/Globbed.js': `const all = import.meta.glob('./linked/T*.jsx', { eager: true })\nexport const tiles = () => Object.values(all).map(module => module.Tile({}))\n`,
    })
    try {
      fs.symlinkSync(path.join(root, 'zshared'), path.join(root, 'src', 'linked'), 'junction')
      const index = createProjectEscapeIndex(root)()
      expect(index.all).toBe(false)
      expect([...index.origins].map(origin => path.relative(root, origin)).sort()).toEqual([path.join('zshared', 'Row.jsx#Row'), path.join('zshared', 'Tile.jsx#Tile'), path.join('zshared', 'kit', 'Badge.jsx#Badge')].sort())
      expect(hooksIn(root, 'zshared/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/linked/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'zshared/Tile.jsx', 'Tile')).toBe(false)
      expect(hooksIn(root, 'zshared/kit/Badge.jsx', 'Badge')).toBe(false)
    } finally { removeTree(root) }
  })
  it('resolves workspace packages when the project root itself is a symlinked path', () => {
    const real = linkedWorkspace('{ "name": "@acme/ui", "exports": "./src/index.js" }')
    const link = `${real}-link`
    try {
      fs.symlinkSync(real, link, 'junction')
      const index = createProjectEscapeIndex(link)()
      expect(index.all).toBe(false)
      expect(index.origins.has(path.join(real, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(true)
      expect(hooksIn(link, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
    } finally { removeLink(link); removeTree(real) }
  })
  it('looks a workspace package up from the importing file (pnpm per-package links) before the root', () => {
    const root = project({
      'packages/ui/package.json': '{ "name": "@acme/ui", "exports": "./src/index.js" }',
      'packages/ui/src/index.js': `export { Row } from './Row.jsx'\n`,
      'packages/ui/src/Row.jsx': row,
      'node_modules/@acme/ui/package.json': '{ "name": "@acme/ui", "main": "index.js" }',
      'node_modules/@acme/ui/index.js': 'export const Row = item => item\n',
      'apps/web/App.jsx': `import { Row } from '@acme/ui'\nexport const rows = xs => xs.map(Row)\n`,
    })
    try {
      fs.mkdirSync(path.join(root, 'apps', 'web', 'node_modules', '@acme'), { recursive: true })
      fs.symlinkSync(path.join(root, 'packages', 'ui'), path.join(root, 'apps', 'web', 'node_modules', '@acme', 'ui'), 'junction')
      expect(hooksIn(root, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
      expect(createProjectEscapeIndex(root)().origins.has(path.join(root, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(true)
    } finally { removeTree(root) }
  })
  it('keeps hooks for a workspace package whose every entry is proven, and for an unrelated subpath file', () => {
    const root = linkedWorkspace('{ "name": "@acme/ui", "exports": { ".": { "browser": "./src/index.js", "import": "./dist/index.js" }, "./Badge": "./src/Badge.jsx" } }', {
      'packages/ui/src/Badge.jsx': `export function Badge() { return <b>b</b> }\n`,
      'apps/web/Shell.jsx': `import { Badge } from '@acme/ui/Badge'\nexport const Shell = () => <Badge />\n`,
    })
    try {
      expect(createProjectEscapeIndex(root)().all).toBe(false)
      expect(hooksIn(root, 'packages/ui/src/Badge.jsx', 'Badge')).toBe(true)
      expect(hooksIn(root, 'packages/ui/src/Row.jsx', 'Row')).toBe(false)
    } finally { removeTree(root) }
  })
  it('follows every file an extensionless import may resolve to (Vite and TypeScript order extensions differently)', () => {
    const root = project({
      'src/Row.js': `export function Row(item) { return item }\n`,
      'src/Row.tsx': `export function Row(item: string) { return <li>{item}</li> }\n`,
      'src/App.jsx': `import { Row } from './Row'\nexport const rows = xs => xs.map(Row)\n`,
      'src/kit/Cell.js': `export function Cell(item) { return item }\n`,
      'src/kit/Cell.jsx': `export function Cell(item) { return <td>{item}</td> }\n`,
      'src/kit/index.js': `export { Cell } from './Cell'\n`,
      'src/Table.jsx': `import { Cell } from './kit'\nexport const cells = xs => xs.map(Cell)\n`,
    })
    try {
      expect(hooksIn(root, 'src/Row.tsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/kit/Cell.jsx', 'Cell')).toBe(false)
      expect([...createProjectEscapeIndex(root)().origins].map(origin => path.relative(root, origin)).sort()).toEqual([path.join('src', 'Row.js#Row'), path.join('src', 'Row.tsx#Row'), path.join('src', 'kit', 'Cell.js#Cell'), path.join('src', 'kit', 'Cell.jsx#Cell')].sort())
    } finally { removeTree(root) }
  })

  it('reads MDX and inline HTML module scripts as callers', () => {
    const root = project({
      'src/Row.jsx': row,
      'src/Card.jsx': `export function Card() { return <article>c</article> }\n`,
      'src/Tile.jsx': `export function Tile() { return <p>t</p> }\n`,
      'docs/page.mdx': `import { Row } from '../src/Row'\nimport { Card } from '../src/Card'\n\n# Docs\n\n<Card />\n\n{['a', 'b'].map(Row)}\n`,
      'index.html': `<div id="root"></div>\n<script type="module">\nimport { Tile } from './src/Tile.jsx'\nwindow.tiles = [1, 2].map(Tile)\n</script>`,
    })
    try {
      expect(hooksIn(root, 'src/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/Card.jsx', 'Card')).toBe(true)
      expect(hooksIn(root, 'src/Tile.jsx', 'Tile')).toBe(false)
    } finally { removeTree(root) }
  })

  it('follows callers inside symlinked directories', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'outside/App.jsx': `import { Row } from '../src/ui/Row'\nexport const rows = items => items.map(Row)\n` })
    try {
      fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'src', 'linked'), 'junction')
      fs.renameSync(path.join(root, 'outside'), path.join(root, '..', `${path.basename(root)}-outside`))
      removeLink(path.join(root, 'src', 'linked'))
      fs.symlinkSync(path.join(root, '..', `${path.basename(root)}-outside`), path.join(root, 'src', 'linked'), 'junction')
      fs.writeFileSync(path.join(root, '..', `${path.basename(root)}-outside`, 'App.jsx'), `import { Row } from '../ui/Row'\nexport const rows = items => items.map(Row)\n`)
      expect(hooksIn(root, 'src/ui/Row.jsx', 'Row')).toBe(false)
    } finally {
      removeTree(path.join(root, '..', `${path.basename(root)}-outside`))
      removeTree(root)
    }
  })

  it('does not give up on asset requires and scopes prefix imports to their directory', () => {
    const root = project({
      'src/ui/Row.jsx': row,
      'src/pages/Page.jsx': `export function Page() { return <main>p</main> }\n`,
      'tailwind.config.js': `module.exports = { theme: require('./theme.json') }\n`,
      'src/i18n.js': 'export const load = locale => import(`./locales/${locale}.js`)\n',
      'src/App.jsx': `import { Row } from './ui/Row'\nimport { Page } from './pages/Page'\nexport const App = () => <><Row /><Page /></>\nexport const load = name => import('./pages/' + name)\n`,
    })
    try {
      expect(createProjectEscapeIndex(root)()).toMatchObject({ all: false })
      expect(hooksIn(root, 'src/ui/Row.jsx', 'Row')).toBe(true)
      expect(hooksIn(root, 'src/pages/Page.jsx', 'Page')).toBe(false)
    } finally { removeTree(root) }
  })

  it('treats a namespace export rendered only as JSX as benign', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/barrel.ts': `export * as ui from './ui/Row'\n`, 'src/App.jsx': `import { ui } from './barrel'\nexport const App = () => <ui.Row />\n` })
    try { expect(hooksIn(root, 'src/ui/Row.jsx', 'Row')).toBe(true) } finally { removeTree(root) }
  })

  it('reloads served modules whose escape decision flips after an edit elsewhere (HMR)', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/App.jsx': `import { Row } from './ui/Row'\nexport const App = () => <Row />\n` })
    try {
      const plugin = sourceAnnotationPlugin(root) as unknown as Record<string, (...args: unknown[]) => unknown>
      const invalidated: unknown[] = []
      const sent: unknown[] = []
      const rowModule = { id: 'row' }
      plugin.configureServer({ moduleGraph: { getModulesByFile: (file: string) => file.endsWith('Row.jsx') ? new Set([rowModule]) : undefined, invalidateModule: (module: unknown) => invalidated.push(module) }, ws: { send: (payload: unknown) => sent.push(payload) } })
      const rowFile = path.join(root, 'src/ui/Row.jsx')
      const first = plugin.transform(fs.readFileSync(rowFile, 'utf8'), rowFile) as { code: string }
      expect(first.code).toMatch(/__rippleUseIdentity\w*\(Row,/)
      expect(plugin.handleHotUpdate({ file: path.join(root, 'src/App.jsx') })).toBeUndefined()
      fs.writeFileSync(path.join(root, 'src/App.jsx'), `import { Row } from './ui/Row'\nexport const App = ({ items }) => <ul>{items.map(Row)}</ul>\n`)
      expect(plugin.handleHotUpdate({ file: path.join(root, 'src/App.jsx') })).toEqual([])
      expect(invalidated).toEqual([rowModule])
      expect(sent).toEqual([{ type: 'full-reload' }])
      const second = plugin.transform(fs.readFileSync(rowFile, 'utf8'), rowFile) as { code: string }
      expect(second.code).not.toMatch(/__rippleUseIdentity\w*\(Row,/)
    } finally { removeTree(root) }
  })

  it('rebuilds the escape index on the next transform after any watcher event, and reuses it otherwise', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/ui/Other.jsx': `export function Other() { return <i>o</i> }\n`, 'src/App.jsx': `import { Row } from './ui/Row'\nexport const App = () => <ul><Row /></ul>\n` })
    try {
      const plugin = sourceAnnotationPlugin(root) as unknown as Record<string, (...args: unknown[]) => unknown>
      const listeners: Array<() => void> = []
      plugin.configureServer({ moduleGraph: { getModulesByFile: () => undefined, invalidateModule: () => undefined }, ws: { send: () => undefined }, watcher: { on: (event: string, listener: () => void) => { if (event === 'all') listeners.push(listener) } } })
      const rowFile = path.join(root, 'src/ui/Row.jsx')
      const transformRow = () => (plugin.transform(fs.readFileSync(rowFile, 'utf8'), rowFile) as { code: string }).code
      expect(transformRow()).toMatch(/__rippleUseIdentity\w*\(Row,/)
      fs.writeFileSync(path.join(root, 'src/Caller.jsx'), `import { Row } from './ui/Row'\nexport const rows = xs => xs.map(Row)\n`)
      // Within the reuse window and without a file event the cached index is reused.
      expect(transformRow()).toMatch(/__rippleUseIdentity\w*\(Row,/)
      expect(listeners).toHaveLength(1)
      listeners.forEach(listener => listener())
      expect(transformRow()).not.toMatch(/__rippleUseIdentity\w*\(Row,/)
    } finally { removeTree(root) }
  })

  const hmrOffServer = (root: string) => {
    const plugin = sourceAnnotationPlugin(root) as unknown as Record<string, (...args: unknown[]) => unknown>
    const listeners: Array<() => void> = []
    const middlewares: Array<(request: unknown, response: unknown, next: () => void) => void> = []
    const invalidated: unknown[] = []
    const sent: unknown[] = []
    const rowModule = { id: 'row' }
    // No handleHotUpdate call anywhere: Vite never runs it with `server.hmr: false`.
    plugin.configureServer({
      moduleGraph: { getModulesByFile: (file: string) => file.endsWith('Row.jsx') ? new Set([rowModule]) : undefined, invalidateModule: (module: unknown) => invalidated.push(module) },
      ws: { send: (payload: unknown) => sent.push(payload) },
      watcher: { on: (event: string, listener: () => void) => { if (event === 'all') listeners.push(listener) } },
      middlewares: { use: (handler: (request: unknown, response: unknown, next: () => void) => void) => middlewares.push(handler) },
    })
    const rowFile = path.join(root, 'src/ui/Row.jsx')
    expect((plugin.transform(fs.readFileSync(rowFile, 'utf8'), rowFile) as { code: string }).code).toMatch(/__rippleUseIdentity\w*\(Row,/)
    fs.writeFileSync(path.join(root, 'src/Caller.jsx'), `import { Row } from './ui/Row'\nexport const rows = xs => xs.map(Row)\n`)
    listeners.forEach(listener => listener())
    return { middlewares, invalidated, sent, rowModule }
  }
  it('invalidates a served module whose decision flipped before the next request, without HMR', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/App.jsx': `import { Row } from './ui/Row'\nexport const App = () => <ul><Row /></ul>\n` })
    try {
      const server = hmrOffServer(root)
      expect(server.middlewares).toHaveLength(1)
      let passed = false
      server.middlewares[0]({}, {}, () => { passed = true })
      expect(passed).toBe(true)
      expect(server.invalidated).toEqual([server.rowModule])
      expect(server.sent).toEqual([{ type: 'full-reload' }])
      server.middlewares[0]({}, {}, () => undefined)
      expect(server.invalidated).toHaveLength(1)
    } finally { removeTree(root) }
  })
  it('re-checks served decisions before a page navigation even when no watcher event was delivered', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/App.jsx': `import { Row } from './ui/Row'\nexport const App = () => <ul><Row /></ul>\n` })
    try {
      const plugin = sourceAnnotationPlugin(root) as unknown as Record<string, (...args: unknown[]) => unknown>
      const middlewares: Array<(request: unknown, response: unknown, next: () => void) => void> = []
      const invalidated: unknown[] = []
      const rowModule = { id: 'row' }
      plugin.configureServer({ moduleGraph: { getModulesByFile: (file: string) => file.endsWith('Row.jsx') ? new Set([rowModule]) : undefined, invalidateModule: (module: unknown) => invalidated.push(module) }, ws: { send: () => undefined }, middlewares: { use: (handler: (request: unknown, response: unknown, next: () => void) => void) => middlewares.push(handler) } })
      const rowFile = path.join(root, 'src/ui/Row.jsx')
      expect((plugin.transform(fs.readFileSync(rowFile, 'utf8'), rowFile) as { code: string }).code).toMatch(/__rippleUseIdentity\w*\(Row,/)
      fs.writeFileSync(path.join(root, 'src/App.jsx'), `import { Row } from './ui/Row'\nexport const App = ({ xs }) => <ul>{xs.map(Row)}</ul>\n`)
      middlewares[0]({ headers: { accept: '*/*' } }, {}, () => undefined)
      expect(invalidated).toEqual([])
      middlewares[0]({ headers: { accept: 'text/html,application/xhtml+xml' } }, {}, () => undefined)
      expect(invalidated).toEqual([rowModule])
    } finally { removeTree(root) }
  })
  it('re-checks served decisions shortly after a file event even when no request arrives, without HMR', async () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/App.jsx': `import { Row } from './ui/Row'\nexport const App = () => <ul><Row /></ul>\n` })
    try {
      const server = hmrOffServer(root)
      expect(server.invalidated).toEqual([])
      await new Promise(resolve => setTimeout(resolve, 120))
      expect(server.invalidated).toEqual([server.rowModule])
    } finally { removeTree(root) }
  })
  it('resolves relative imports from link paths as well as real directories (preserveSymlinks)', () => {
    const root = project({
      'lib/inner/Mod.jsx': `import { Row } from '../Row'\nexport const rows = xs => xs.map(Row)\n`,
      'lib/Row.jsx': `export function Row(item) { return <b>{item}</b> }\n`,
      'src/Row.jsx': row,
      'lib/inner/Lazy.js': `export const load = name => import('../kit/' + name)\n`,
      'src/kit/Badge.jsx': `export function Badge() { return <b>b</b> }\n`,
    })
    try {
      fs.symlinkSync(path.join(root, 'lib', 'inner'), path.join(root, 'src', 'linked'), 'junction')
      const origins = [...createProjectEscapeIndex(root)().origins].map(origin => path.relative(root, origin)).sort()
      expect(origins).toEqual([path.join('lib', 'Row.jsx#Row'), path.join('src', 'Row.jsx#Row'), path.join('src', 'kit', 'Badge.jsx#Badge')].sort())
      expect(hooksIn(root, 'src/Row.jsx', 'Row')).toBe(false)
      expect(hooksIn(root, 'src/kit/Badge.jsx', 'Badge')).toBe(false)
    } finally { removeTree(root) }
  })

  it('reuses the index only while sources and every observed filesystem fact are unchanged', () => {
    const root = linkedWorkspace('{ "name": "@acme/ui", "exports": { ".": { "browser": "./node_modules/.cache/entry.js", "default": "./src/index.js" } } }')
    try {
      const get = createProjectEscapeIndex(root)
      const first = get(true)
      expect(first.all).toBe(false)
      expect(get(true)).toBe(first)
      // An unscanned target appearing on disk (an observed fact, not a scanned source).
      fs.mkdirSync(path.join(root, 'packages/ui/node_modules/.cache'), { recursive: true })
      fs.writeFileSync(path.join(root, 'packages/ui/node_modules/.cache/entry.js'), 'export {}\n')
      const second = get(true)
      expect(second).not.toBe(first)
      expect(second.all).toBe(true)
      removeTree(path.join(root, 'packages/ui/node_modules'))
      expect(get(true).all).toBe(false)
      // The installed link disappearing (observed node_modules path).
      removeLink(path.join(root, 'node_modules/@acme/ui'))
      const unlinked = get(true)
      expect(unlinked.origins.has(path.join(root, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(false)
      expect(unlinked.names.has('Row')).toBe(true)
      // A manifest edit (config file inside the walk).
      fs.symlinkSync(path.join(root, 'packages', 'ui'), path.join(root, 'node_modules', '@acme', 'ui'), 'junction')
      expect(get(true).origins.has(path.join(root, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(true)
      fs.writeFileSync(path.join(root, 'packages/ui/package.json'), '{ "name": "@acme/ui", "exports": "./dist/index.js" }')
      const edited = get(true)
      expect(edited.origins.has(path.join(root, 'packages', 'ui', 'src', 'Row.jsx#Row'))).toBe(false)
      expect(edited.origins.has(path.join(root, 'packages', 'ui', 'dist', 'index.js#Row'))).toBe(true)
    } finally { removeTree(root) }
  })

  it('sees a same-size edit that keeps the modification time of a recently modified file', () => {
    const before = `import { Row } from './ui/Row'\nexport const a = () => <ul><Row /></ul>\n`
    const after = `import { Row } from './ui/Row'\nexport const a = xs => [xs.map(Row)]\n`.padEnd(before.length, ' ')
    expect(after.length).toBe(before.length)
    const root = project({ 'src/ui/Row.jsx': row, 'src/App.jsx': before })
    try {
      const app = path.join(root, 'src/App.jsx')
      const time = new Date()
      fs.utimesSync(app, time, time)
      const get = createProjectEscapeIndex(root)
      expect(get(true).origins.size).toBe(0)
      fs.writeFileSync(app, after)
      fs.utimesSync(app, time, time)
      expect([...get(true).origins].map(origin => path.relative(root, origin))).toEqual([path.join('src', 'ui', 'Row.jsx#Row')])
    } finally { removeTree(root) }
  })
  it('fails closed when a queued re-check throws: every served module is invalidated', () => {
    const root = project({ 'src/ui/Row.jsx': row, 'src/App.jsx': `import { Row } from './ui/Row'\nexport const App = () => <ul><Row /></ul>\n` })
    try {
      const plugin = sourceAnnotationPlugin(root) as unknown as Record<string, (...args: unknown[]) => unknown>
      const middlewares: Array<(request: unknown, response: unknown, next: () => void) => void> = []
      const invalidated: unknown[] = []
      const rowModule = { id: 'row' }
      plugin.configureServer({ moduleGraph: { getModulesByFile: (file: string) => file.endsWith('Row.jsx') ? new Set([rowModule]) : undefined, invalidateModule: (module: unknown) => invalidated.push(module) }, ws: { send: () => { throw new Error('socket closed') } }, middlewares: { use: (handler: (request: unknown, response: unknown, next: () => void) => void) => middlewares.push(handler) } })
      const rowFile = path.join(root, 'src/ui/Row.jsx')
      plugin.transform(fs.readFileSync(rowFile, 'utf8'), rowFile)
      fs.writeFileSync(path.join(root, 'src/App.jsx'), `import { Row } from './ui/Row'\nexport const App = ({ xs }) => <ul>{xs.map(Row)}</ul>\n`)
      let passed = false
      expect(() => middlewares[0]({ headers: { accept: 'text/html' } }, {}, () => { passed = true })).not.toThrow()
      expect(passed).toBe(true)
      expect(invalidated).toContain(rowModule)
    } finally { removeTree(root) }
  })
  it('rebuilds when a symlink inside the project is retargeted', () => {
    const root = project({ 'shared-a/Row.jsx': row, 'shared-b/Row.jsx': row, 'src/App.jsx': `import { Row } from './linked/Row'\nexport const rows = xs => xs.map(Row)\n` })
    try {
      fs.symlinkSync(path.join(root, 'shared-a'), path.join(root, 'src', 'linked'), 'junction')
      const get = createProjectEscapeIndex(root)
      expect([...get(true).origins].map(origin => path.relative(root, origin))).toEqual([path.join('shared-a', 'Row.jsx#Row')])
      removeLink(path.join(root, 'src', 'linked'))
      fs.symlinkSync(path.join(root, 'shared-b'), path.join(root, 'src', 'linked'), 'junction')
      expect([...get(true).origins].map(origin => path.relative(root, origin))).toEqual([path.join('shared-b', 'Row.jsx#Row')])
    } finally { removeTree(root) }
  })

  it('fails closed for every exported function when a dynamic import is unknowable, but keeps private components', () => {
    const root = project({
      'src/App.jsx': `export function App() { return <main><Inner /></main> }\nfunction Inner() { return <p>x</p> }\nexport const load = name => import(name)\n`,
    })
    try {
      expect(createProjectEscapeIndex(root)()).toMatchObject({ all: true })
      expect(hooksIn(root, 'src/App.jsx', 'App')).toBe(false)
      expect(hooksIn(root, 'src/App.jsx', 'Inner')).toBe(true)
    } finally { removeTree(root) }
  })
})

describe('browser identity runtime', () => {
  type Identity = { component: unknown; path: string; certainty: string } | null
  const load = (contextValue: Identity = null) => {
    const memoCalls: unknown[][] = []
    const react = {
      createContext: () => ({ Provider: 'Provider' }),
      createElement: (type: unknown, props: Record<string, unknown>, children: unknown) => ({ type, props, children }),
      useContext: () => contextValue,
      useMemo: (factory: () => unknown, deps: unknown[]) => { memoCalls.push(deps); return factory() },
    }
    const output = ts.transpileModule(RIPPLE_IDENTITY_RUNTIME, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} as Record<string, (...args: unknown[]) => unknown> }
    new Function('require', 'module', 'exports', output)((name: string) => { if (name !== 'react') throw new Error(name); return react }, module, module.exports)
    return { api: module.exports, memoCalls }
  }

  it('merges certainties so that the weakest proof wins and keyed stability is kept', () => {
    const { api } = load()
    const merge = api.mergeRippleCertainty
    expect(merge('stable-react-instance', 'stable-react-instance')).toBe('stable-react-instance')
    expect(merge('stable-react-instance', 'stable-keyed-instance')).toBe('stable-keyed-instance')
    expect(merge('stable-keyed-instance', 'position-dependent')).toBe('position-dependent')
    expect(merge('position-dependent', 'unknown')).toBe('unknown')
    expect(merge('stable-keyed-instance', 'bogus')).toBe('unknown')
  })

  it('binds an identity only to the component whose element created the boundary', () => {
    function Card() { return null }
    function Other() { return null }
    const memoCard = { $$typeof: Symbol.for('react.memo'), type: Card }
    const forwardCard = { $$typeof: Symbol.for('react.forward_ref'), render: Card }
    const memoForward = { $$typeof: Symbol.for('react.memo'), type: forwardCard }
    for (const component of [Card, memoCard, forwardCard, memoForward]) {
      expect(load({ component, path: 'p', certainty: 'stable-react-instance' }).api.useRippleIdentity(Card)).toMatchObject({ bound: true })
    }
    expect(load({ component: Other, path: 'p', certainty: 'stable-react-instance' }).api.useRippleIdentity(Card)).toMatchObject({ bound: false })
    expect(load({ component: Card, path: 'p', certainty: 'stable-react-instance' }).api.useRippleIdentity(undefined)).toMatchObject({ bound: false })
    expect(load(null).api.useRippleIdentity(Card)).toBeNull()
    const { api } = load()
    expect(api.rippleCertainty(null, 'stable-react-instance')).toBe('unknown')
    expect(api.rippleCertainty({ bound: false, certainty: 'stable-keyed-instance', path: 'p' }, 'stable-react-instance')).toBe('unknown')
    expect(api.rippleCertainty({ bound: true, certainty: 'stable-keyed-instance', path: 'p' }, 'stable-react-instance')).toBe('stable-keyed-instance')
  })

  it('encodes key parts so keys containing "/" cannot collide', () => {
    const { api } = load()
    expect(api.rippleKeyText(['a/b', 'c'])).toBe('a%2Fb/c')
    expect(api.rippleKeyText(['a', 'b/c'])).toBe('a/b%2Fc')
    expect(api.rippleKeyText(['plain', 3])).toBe('plain/3')
    expect(api.rippleKeyText([{ toString: () => 'x' }])).toBeNull()
  })

  it('lets only the first instance of a type claim a boundary', () => {
    function Panel() { return null }
    const boundary = { component: Panel, path: 'p', certainty: 'stable-react-instance' }
    const { api } = load(boundary)
    expect(api.useRippleIdentity(Panel, ':outer:')).toMatchObject({ bound: true })
    expect(api.useRippleIdentity(Panel, ':outer:')).toMatchObject({ bound: true })
    expect(api.useRippleIdentity(Panel, ':inner:')).toMatchObject({ bound: false })
  })

  it('derives a boundary from its lexical owner and memoizes the context value', () => {
    function Card() { return null }
    const { api, memoCalls } = load()
    const boundary = (props: Record<string, unknown>) => (api.RippleIdentity(props) as { props: { value: { path: string; certainty: string } } }).props.value
    expect(boundary({ component: Card, root: true, instanceParts: [], sourceRef: 'jsx:a#1', certainty: 'stable-react-instance' })).toMatchObject({ path: 'jsx:a#1/jsx:a#1', certainty: 'stable-react-instance' })
    expect(boundary({ component: Card, owner: { bound: true, path: 'root', certainty: 'stable-keyed-instance' }, ownerId: ':r1:', instanceParts: ['k'], sourceRef: 'jsx:a#2', certainty: 'stable-react-instance' })).toMatchObject({ path: 'root/jsx:a#2/k', certainty: 'stable-keyed-instance' })
    expect(boundary({ component: Card, owner: { bound: true, path: 'root', certainty: 'position-dependent' }, ownerId: ':r1:', instanceParts: ['k'], sourceRef: 'jsx:a#2', certainty: 'stable-keyed-instance' })).toMatchObject({ path: 'root::r1:/jsx:a#2/k', certainty: 'position-dependent' })
    expect(boundary({ component: Card, owner: { bound: false, path: 'root', certainty: 'stable-react-instance' }, ownerId: ':r9:', instanceParts: ['k'], sourceRef: 'jsx:a#2', certainty: 'stable-keyed-instance' })).toMatchObject({ path: ':r9:/jsx:a#2/k', certainty: 'unknown' })
    expect(boundary({ component: Card, instanceParts: ['k'], sourceRef: 'jsx:a#2', certainty: 'stable-react-instance' })).toMatchObject({ certainty: 'unknown' })
    expect(memoCalls.every(deps => deps.length === 3)).toBe(true)
  })
})

const graph: SourceGraph = {
  id: 'graph:runtime', revision: { projectId: 'project:runtime', sourceDigest: 'digest-a', runtimeFingerprint: 'runtime-a' }, edges: [], unresolved: [],
  nodes: [{ id: 'jsx:src/App.jsx#10', kind: 'jsx-element', label: '<li>' }, { id: 'jsx:src/App.jsx#40', kind: 'jsx-element', label: '<p>' }],
}
const page = { pathname: '/catalog', search: '', hash: '' }
const recordSourceRef = 'jsx:src/App.jsx#10'
const v2Id = (at = page, sourceRef = recordSourceRef, suffix = `jsx:root:${sourceRef}:p1`) =>
  `ripple-page-v2:${encodeURIComponent(JSON.stringify([at.pathname, at.search, at.hash]))}:${suffix}`
const record = (overrides: Partial<RuntimeIdentityRecord> = {}): RuntimeIdentityRecord => ({
  sourceRef: recordSourceRef, sourceFile: 'src/App.jsx', runtimeInstanceId: v2Id(), declaredCertainty: 'stable-keyed-instance', certainty: 'stable-keyed-instance',
  sourceVersion: 'v1', domNode: 1, sameSourceCount: 3, reasons: [], ...overrides,
})
const snap = (records: RuntimeIdentityRecord[], at = page, protocol: RuntimeIdentitySnapshot['protocol'] = 'ripple-runtime-identity/v2'): RuntimeIdentitySnapshot => ({ protocol, page: at, records })
const fileDigest = (file: string) => file === 'src/App.jsx' ? 'v1' : undefined

describe('runtime identity assessment', () => {
  it('proves a stable, versioned, page-matched instance without granting an edit', () => {
    const assessment = assessRuntimeIdentity(graph, snap([record()]), record(), { fileDigest, expectedPage: { pathname: '/catalog' } })
    expect(assessment).toMatchObject({ locatable: true, instanceIdentityProven: true, sameSourceCount: 3, reasons: [] })
    expect(Object.keys(assessment)).not.toContain('authorized')
  })

  it.each<[string, Partial<RuntimeIdentityRecord>, Parameters<typeof assessRuntimeIdentity>[3], string, boolean]>([
    ['unknown graph source', { sourceRef: 'jsx:src/App.jsx#999' }, { fileDigest }, 'source-not-in-graph', false],
    ['changed source', { sourceVersion: 'v0' }, { fileDigest }, 'source-version-mismatch', false],
    ['missing version', { sourceVersion: undefined }, { fileDigest }, 'source-version-unavailable', true],
    ['no digest reader', {}, {}, 'source-version-unavailable', true],
    ['other page', {}, { fileDigest, expectedPage: { pathname: '/featured' } }, 'page-context-mismatch', true],
    ['positional identity', { certainty: 'position-dependent', declaredCertainty: 'position-dependent' }, { fileDigest }, 'identity-not-stable', true],
    ['collection downgrade', { certainty: 'unknown', reasons: ['duplicate-runtime-instance'] }, { fileDigest }, 'duplicate-runtime-instance', true],
  ])('fails closed for %s', (_name, overrides, context, reason, locatable) => {
    const item = record(overrides)
    const assessment = assessRuntimeIdentity(graph, snap([item]), item, context)
    expect(assessment.instanceIdentityProven).toBe(false)
    expect(assessment.locatable).toBe(locatable)
    expect(assessment.reasons).toContain(reason)
  })

  it('requires a named expected page for proof and treats an ambiguous version as not locatable', () => {
    for (const expectedPage of [undefined, {}, { search: '' }]) {
      const assessment = assessRuntimeIdentity(graph, snap([record()]), record(), { fileDigest, ...(expectedPage ? { expectedPage } : {}) })
      expect(assessment.instanceIdentityProven).toBe(false)
      expect(assessment.reasons).toEqual(['page-context-unverified'])
      expect(assessment.locatable).toBe(true)
    }
    const ambiguous = record({ sourceVersion: undefined, reasons: ['source-version-ambiguous'] })
    expect(assessRuntimeIdentity(graph, snap([ambiguous]), ambiguous, { fileDigest, expectedPage: page })).toMatchObject({ locatable: false, instanceIdentityProven: false })
    expect(assessRuntimeIdentity(graph, snap([record()]), record(), { fileDigest: () => { throw new Error('ENOENT') }, expectedPage: page }).reasons).toEqual(['source-version-unavailable'])
  })

  it('proves only a canonical render-time v2 tuple with an exact sourceRef anchor', () => {
    const expectedPage = { pathname: '/catalog', search: '?tab=a b', hash: '#/products' }
    const valid = record({ runtimeInstanceId: v2Id(expectedPage) })
    expect(assessRuntimeIdentity(graph, snap([valid], expectedPage), valid, { fileDigest, expectedPage }).instanceIdentityProven).toBe(true)

    const wrongTuple = record({ runtimeInstanceId: v2Id({ ...expectedPage, search: '?tab=other' }) })
    const wrongAnchor = record({ runtimeInstanceId: v2Id(expectedPage, 'jsx:src/Other.jsx#10') })
    const malformed = record({ runtimeInstanceId: `ripple-page-v2:%E0%A4%A:jsx:root:${recordSourceRef}:p1` })
    for (const item of [wrongTuple, wrongAnchor, malformed]) {
      const assessment = assessRuntimeIdentity(graph, snap([item], expectedPage), item, { fileDigest, expectedPage })
      expect(assessment).toMatchObject({ locatable: true, instanceIdentityProven: false })
      expect(assessment.reasons).toContain('route-namespace-stale')
    }
  })

  it('keeps historical v1 proof limited to empty search and hash', () => {
    const legacy = record({ runtimeInstanceId: `/catalog::_r1_:${recordSourceRef}:p1` })
    expect(assessRuntimeIdentity(graph, snap([legacy], page, 'ripple-runtime-identity/v1'), legacy, { fileDigest, expectedPage: page }).instanceIdentityProven).toBe(true)
    const routed = { ...page, search: '?tab=a' }
    const assessment = assessRuntimeIdentity(graph, snap([legacy], routed, 'ripple-runtime-identity/v1'), legacy, { fileDigest, expectedPage: routed })
    expect(assessment.instanceIdentityProven).toBe(false)
    expect(assessment.reasons).toContain('route-namespace-stale')
  })

  it('does not treat an unknown snapshot protocol as selectable or proven', () => {
    const item = record()
    const unknown = { ...snap([item]), protocol: 'ripple-runtime-identity/v99' } as unknown as RuntimeIdentitySnapshot
    expect(selectableRuntimeObservations(unknown)).toEqual([])
    expect(assessRuntimeIdentity(graph, unknown, item, { fileDigest, expectedPage: page })).toMatchObject({ instanceIdentityProven: false, reasons: expect.arrayContaining(['route-namespace-stale']) })
  })

  it.each(['/?tab=b', '/#/products', '/?tab=b#/products'])(
    'fails closed for a v1 path-only instance on page URL %s while retaining its source location',
    location => {
      const previousLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const versionRegistryKey = Symbol.for('ripple.runtime-identity')
      const previousRegistryDescriptor = Object.getOwnPropertyDescriptor(globalThis, versionRegistryKey)
      try {
        window.history.replaceState(null, '', location)
        Object.defineProperty(globalThis, versionRegistryKey, {
          value: { sourceVersions: new Map([['src/App.jsx', 'v1']]), sourceVersionHistory: new Map() },
          configurable: true,
          writable: true,
        })
        document.body.innerHTML = '<div data-ripple-source="jsx:src/App.jsx#10" data-ripple-instance="/:jsx:src/App.jsx#10" data-ripple-identity-certainty="stable-react-instance"></div>'
        const snapshot = collectRuntimeIdentitySnapshot()
        const collected = snapshot.records[0]
        const assessment = assessRuntimeIdentity(graph, snapshot, collected, {
          fileDigest: file => file === 'src/App.jsx' ? 'v1' : undefined,
          expectedPage: snapshot.page,
        })

        expect(snapshot.page).toMatchObject({
          pathname: new URL(location, window.location.origin).pathname,
          search: new URL(location, window.location.origin).search,
          hash: new URL(location, window.location.origin).hash,
        })
        expect(collected).toMatchObject({ certainty: 'unknown', reasons: expect.arrayContaining(['route-namespace-stale']) })
        expect(assessment).toMatchObject({ locatable: true, instanceIdentityProven: false })
      } finally {
        document.body.replaceChildren()
        window.history.replaceState(null, '', previousLocation || '/')
        if (previousRegistryDescriptor) Object.defineProperty(globalThis, versionRegistryKey, previousRegistryDescriptor)
        else Reflect.deleteProperty(globalThis, versionRegistryKey)
      }
    },
  )

  it('keeps a same-path v1 namespace ambiguous after observed query/hash navigation returns to empty URL', () => {
    const previousLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const registryKey = Symbol.for('ripple.runtime-identity')
    const collectorKey = Symbol.for('ripple.runtime-identity.collector')
    const previousRegistryDescriptor = Object.getOwnPropertyDescriptor(globalThis, registryKey)
    const previousCollectorDescriptor = Object.getOwnPropertyDescriptor(globalThis, collectorKey)
    try {
      Reflect.deleteProperty(globalThis, collectorKey)
      window.history.replaceState(null, '', '/runtime.html?tab=a#/home')
      Object.defineProperty(globalThis, registryKey, {
        value: { sourceVersions: new Map([['src/App.jsx', 'v1']]), sourceVersionHistory: new Map() },
        configurable: true,
        writable: true,
      })
      document.body.innerHTML = '<div data-ripple-source="jsx:src/App.jsx#10" data-ripple-instance="/runtime.html:jsx:src/App.jsx#10" data-ripple-identity-certainty="stable-react-instance"></div>'

      const before = collectRuntimeIdentitySnapshot()
      expect(before.records[0].reasons).toContain('route-namespace-stale')
      window.history.replaceState(null, '', '/runtime.html')
      const after = collectRuntimeIdentitySnapshot()
      const collected = after.records[0]
      const assessment = assessRuntimeIdentity(graph, after, collected, { fileDigest, expectedPage: after.page })

      expect(after.page).toMatchObject({ pathname: '/runtime.html', search: '', hash: '' })
      expect(collected).toMatchObject({ certainty: 'unknown', reasons: expect.arrayContaining(['route-namespace-stale']) })
      expect(assessment).toMatchObject({ locatable: true, instanceIdentityProven: false })
      expect(selectableRuntimeObservations(after)).toEqual([])
    } finally {
      document.body.replaceChildren()
      window.history.replaceState(null, '', previousLocation || '/')
      if (previousRegistryDescriptor) Object.defineProperty(globalThis, registryKey, previousRegistryDescriptor)
      else Reflect.deleteProperty(globalThis, registryKey)
      if (previousCollectorDescriptor) Object.defineProperty(globalThis, collectorKey, previousCollectorDescriptor)
      else Reflect.deleteProperty(globalThis, collectorKey)
    }
  })

  it('keeps only namespace-validated identities that survived collection for source navigation', () => {
    const records = [
      record({ runtimeInstanceId: v2Id(page, recordSourceRef, `jsx:root:${recordSourceRef}:a`) }),
      record({ runtimeInstanceId: v2Id(page, recordSourceRef, `jsx:root:${recordSourceRef}:b`), certainty: 'position-dependent', declaredCertainty: 'position-dependent' }),
      record({ runtimeInstanceId: v2Id(page, recordSourceRef, `jsx:root:${recordSourceRef}:c`), certainty: 'unknown', reasons: ['duplicate-runtime-instance'] }),
      record({ runtimeInstanceId: v2Id(page, recordSourceRef, `jsx:root:${recordSourceRef}:d`), certainty: 'unknown', declaredCertainty: 'unknown' }),
      record({ runtimeInstanceId: undefined, certainty: 'unmapped', declaredCertainty: 'unmapped', reasons: ['unmapped-owner'] }),
      record({ runtimeInstanceId: v2Id(page, recordSourceRef, `jsx:root:${recordSourceRef}:e`), sourceVersion: undefined, reasons: ['source-version-unavailable'] }),
    ]
    const selectable = selectableRuntimeObservations(snap(records))
    expect(selectable.map(item => item.runtimeInstanceId)).toEqual([
      records[0].runtimeInstanceId, records[1].runtimeInstanceId, records[5].runtimeInstanceId,
    ])
    expect(selectable[0]).toMatchObject({ pageContext: page, sourceVersion: 'v1' })
  })

  it('separates identity continuity from React lifecycle', () => {
    const before = snap([record({ runtimeInstanceId: 'same', domNode: 1 }), record({ runtimeInstanceId: 'remount', domNode: 2 }), record({ runtimeInstanceId: 'gone', domNode: 3 }), record({ runtimeInstanceId: 'dup', domNode: 4, reasons: ['duplicate-runtime-instance'] })])
    const after = snap([record({ runtimeInstanceId: 'same', domNode: 1 }), record({ runtimeInstanceId: 'remount', domNode: 9 }), record({ runtimeInstanceId: 'new', domNode: 10 })])
    expect(compareRuntimeSnapshots(before, after).map(change => [change.runtimeInstanceId, change.status])).toEqual([['same', 'same-node'], ['remount', 'remounted'], ['gone', 'removed'], ['new', 'added']])
  })
})

describe('runtime source map hardening', () => {
  const observation = (overrides: Partial<RuntimeElementObservation> = {}): RuntimeElementObservation => ({ sourceRef: 'jsx:src/App.jsx#10', runtimeInstanceId: '/catalog:root:p1', certainty: 'stable-keyed-instance', pageContext: page, sourceVersion: 'v1', reasons: [], ...overrides })
  const selection = { sourceRef: 'jsx:src/App.jsx#10', runtimeInstanceId: '/catalog:root:p1' }

  it('keeps the previous contract for observations without the optional fields', () => {
    const map = createRuntimeSourceMap(graph, [{ sourceRef: 'jsx:src/App.jsx#10', runtimeInstanceId: '/catalog:root:p1', certainty: 'stable-keyed-instance' }])
    expect(resolveRuntimeElement(graph, selection, map).element.id).toBe('jsx:src/App.jsx#10')
  })

  it('rejects collection-downgraded observations but tolerates a missing page-side version', () => {
    expect(() => createRuntimeSourceMap(graph, [observation({ reasons: ['route-namespace-stale'] })])).toThrow(/降级/)
    expect(() => createRuntimeSourceMap(graph, [observation({ reasons: ['source-version-unavailable'], sourceVersion: undefined })])).not.toThrow()
  })

  it('separates navigation-only resolution from strict instance resolution', () => {
    const map = createRuntimeSourceMap(graph, [observation()])
    expect(resolveRuntimeElement(graph, selection, map).verification).toBe('navigation-only')
    expect(resolveRuntimeElement(graph, selection, map, { fileDigest }).verification).toBe('navigation-only')
    expect(resolveRuntimeElement(graph, selection, map, { page }).verification).toBe('navigation-only')
    expect(resolveRuntimeElement(graph, selection, map, { fileDigest, page }).verification).toBe('strict')
    expect(resolveRuntimeInstance(graph, selection, map, { fileDigest, page }).verification).toBe('strict')
    expect(() => resolveRuntimeInstance(graph, selection, map, { page } as never)).toThrow(/源码版本读取器/)
    expect(() => resolveRuntimeInstance(graph, selection, map, { fileDigest } as never)).toThrow(/页面上下文/)
    expect(() => createRuntimeSourceMap(graph, [observation({ reasons: ['source-version-ambiguous'], sourceVersion: undefined })])).toThrow(/降级/)
  })

  it('never proves an instance without a digest reader, even with a page-side version', () => {
    const item = record()
    expect(assessRuntimeIdentity(graph, snap([item]), item, { expectedPage: page })).toMatchObject({ locatable: true, instanceIdentityProven: false, reasons: ['source-version-unavailable'] })
    expect(assessRuntimeIdentity(graph, snap([item]), item, { fileDigest: () => undefined }).instanceIdentityProven).toBe(false)
    const ambiguous = record({ sourceVersion: undefined, reasons: ['source-version-ambiguous'] })
    expect(assessRuntimeIdentity(graph, snap([ambiguous]), ambiguous, { fileDigest }).instanceIdentityProven).toBe(false)
  })

  it('requires the same source version and page when asked', () => {
    const map = createRuntimeSourceMap(graph, [observation()])
    expect(resolveRuntimeElement(graph, selection, map, { fileDigest, page }).element.id).toBe('jsx:src/App.jsx#10')
    expect(() => resolveRuntimeElement(graph, selection, map, { fileDigest: () => 'v2' })).toThrow(/源码版本/)
    expect(() => resolveRuntimeElement(graph, selection, map, { page: { ...page, hash: '#other' } })).toThrow(/页面上下文/)
    const unversioned = createRuntimeSourceMap(graph, [observation({ sourceVersion: undefined, reasons: ['source-version-unavailable'] })])
    expect(() => resolveRuntimeElement(graph, selection, unversioned, { fileDigest })).toThrow(/源码版本/)
    const noPage = createRuntimeSourceMap(graph, [observation({ pageContext: undefined })])
    expect(() => resolveRuntimeElement(graph, selection, noPage, { page })).toThrow(/页面上下文/)
  })
})
