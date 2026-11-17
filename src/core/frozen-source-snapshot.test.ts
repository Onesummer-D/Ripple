import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { createFrozenSourceSnapshot, createFrozenTypeScriptHost, createFrozenTypeScriptSystem } from './frozen-source-snapshot'

const roots: string[] = []
const root = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-frozen-source-')); roots.push(value); return value }
afterEach(() => { for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }) })
const bytes = (value: string) => Buffer.from(value, 'utf8')
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

describe('FrozenSourceSnapshot', () => {
  it('copies every byte and retains the source digest when the writable checkout changes', () => {
    const directory = root()
    const file = path.join(directory, 'src', 'App.tsx')
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, 'export const App = () => <main>before</main>\n')
    const original = fs.readFileSync(file)
    const snapshot = createFrozenSourceSnapshot(directory, [{ path: 'src/App.tsx', bytes: original }])
    const digest = snapshot.sourceDigest
    original.fill(0)
    fs.writeFileSync(file, 'export const App = () => <main>after</main>\n')
    expect(snapshot.readFile(file)!.toString()).toContain('before')
    expect(snapshot.readFile(file)!.toString()).not.toContain('after')
    expect(snapshot.sourceDigest).toBe(digest)
    expect(snapshot.fileHashes.get('src/App.tsx')).toBe(sha(bytes('export const App = () => <main>before</main>\n')))
    const read = snapshot.readFile(file)!
    read.fill(0)
    expect(snapshot.readFile(file)!.toString()).toContain('before')
  })

  it('rejects duplicate and escaping paths, and fails closed on missing tracked bytes', () => {
    const directory = root()
    expect(() => createFrozenSourceSnapshot(directory, [{ path: '../escape.ts', bytes: bytes('x') }])).toThrow()
    expect(() => createFrozenSourceSnapshot(directory, [{ path: 'a.ts', bytes: bytes('x') }, { path: 'a.ts', bytes: bytes('y') }])).toThrow()
    expect(() => createFrozenSourceSnapshot(directory, [{ path: 'a\\b.ts', bytes: bytes('x') }])).toThrow()
    const snapshot = createFrozenSourceSnapshot(directory, [{ path: 'src/a.ts', bytes: bytes('export const a = 1') }])
    expect(snapshot.readFile(path.join(directory, 'src', 'missing.ts'))).toBeUndefined()
    expect(snapshot.readFile(path.resolve(directory, '..', 'outside.ts'))).toBeUndefined()
    expect(snapshot.fileExists(path.join(directory, 'src', 'missing.ts'))).toBe(false)
  })

  it('serves TS and JSX to CompilerHost from frozen bytes and never falls back to changed project files', () => {
    const directory = root()
    const app = path.join(directory, 'src', 'App.tsx')
    const dependency = path.join(directory, 'src', 'value.ts')
    fs.mkdirSync(path.dirname(app))
    fs.writeFileSync(app, 'export const App = () => <main>live</main>')
    fs.writeFileSync(dependency, 'export const value = "live"')
    const snapshot = createFrozenSourceSnapshot(directory, [
      { path: 'src/App.tsx', bytes: bytes('import { value } from "./value"; export const App = () => <main>{value}</main>') },
      { path: 'src/value.ts', bytes: bytes('export const value = "frozen"') },
    ])
    const options: ts.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true }
    const host = createFrozenTypeScriptHost(snapshot, ts, options)
    const program = ts.createProgram([app], options, host)
    const source = program.getSourceFile(app)
    expect(source?.getFullText()).toContain('value')
    expect(program.getSourceFile(dependency)?.getFullText()).toContain('frozen')
    expect(program.getSourceFile(dependency)?.getFullText()).not.toContain('live')
    expect(host.readFile(path.join(directory, 'src', 'missing.ts'))).toBeUndefined()
    expect(host.fileExists(path.join(directory, 'src', 'missing.ts'))).toBe(false)
    const checker = program.getTypeChecker()
    const jsxTag = source?.statements[1] && ts.isVariableStatement(source.statements[1])
      ? (((source.statements[1].declarationList.declarations[0].initializer as ts.ArrowFunction).body as ts.JsxElement).openingElement.tagName)
      : undefined
    expect(jsxTag).toBeDefined()
    expect(() => checker.getSymbolAtLocation(jsxTag!)).not.toThrow()
    expect(Object.hasOwn(snapshot, 'trusted')).toBe(false)
    expect(Object.hasOwn(snapshot, 'runtimeProof')).toBe(false)
    expect(Object.hasOwn(snapshot, 'authorizationEligible')).toBe(false)
  })

  it('parses config includes and CSS through the frozen TypeScript system after live files change', () => {
    const directory = root()
    const config = '{"compilerOptions":{"jsx":"preserve"},"include":["src/**/*.tsx"]}'
    const jsx = 'export const Page = () => <article>frozen</article>'
    const snapshot = createFrozenSourceSnapshot(directory, [
      { path: 'tsconfig.json', bytes: bytes(config) },
      { path: 'src/Page.tsx', bytes: bytes(jsx) },
      { path: 'src/page.css', bytes: bytes('.page { color: red }') },
    ])
    fs.mkdirSync(path.join(directory, 'src'))
    fs.writeFileSync(path.join(directory, 'tsconfig.json'), '{"include":[]}')
    fs.writeFileSync(path.join(directory, 'src', 'Page.tsx'), 'export const Page = () => <aside>live</aside>')
    fs.writeFileSync(path.join(directory, 'src', 'page.css'), '.page { color: blue }')
    fs.writeFileSync(path.join(directory, 'src', 'Live.tsx'), 'export const Live = () => <div />')
    const system = createFrozenTypeScriptSystem(snapshot, ts)
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(directory, 'tsconfig.json'), {}, {
      ...system,
      onUnRecoverableConfigFileDiagnostic: () => {},
    })
    expect(parsed?.fileNames.map(file => path.resolve(file).replaceAll('\\', '/')))
      .toEqual([path.join(directory, 'src', 'Page.tsx').replaceAll('\\', '/')])
    expect(system.readFile(path.join(directory, 'src', 'Page.tsx'))).toContain('frozen')
    expect(system.readFile(path.join(directory, 'src', 'page.css'))).toContain('red')
    expect(system.readFile(path.join(directory, 'tsconfig.json'))).toBe(config)
    expect(() => system.writeFile(path.join(directory, '.git', 'index.lock'), '')).toThrow('frozen-snapshot-write-denied')
    const host = createFrozenTypeScriptHost(snapshot, ts, { jsx: ts.JsxEmit.Preserve })
    expect(() => host.writeFile(path.join(directory, '.git', 'index.lock'), '', false)).toThrow('frozen-snapshot-write-denied')
  })
})
