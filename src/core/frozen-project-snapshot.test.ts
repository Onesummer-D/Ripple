// @vitest-environment node
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decodeFrozenUtf8, frozenSourceSystem, readFrozenBytes, captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import { createFrozenSourceSnapshot } from './frozen-source-snapshot'
import { analyzeProject, digestTrackedTree } from './project'

const roots: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-frozen-'))
  roots.push(root)
  const files: Record<string, string> = {
    'index.html': '<script type="module" src="/src/main.tsx"></script>',
    'package.json': '{"dependencies":{"react-router-dom":"^6.28.0"}}',
    'tsconfig.json': '{"compilerOptions":{"jsx":"preserve","baseUrl":".","paths":{"@/*":["src/*"]}},"include":["src"]}',
    'src/main.tsx': "import {HashRouter,Routes,Route} from 'react-router-dom'; import Page from '@/Page'; import './theme.css'; export function App(){return <HashRouter><Routes><Route path='/home' element={<Page/>}/></Routes></HashRouter>}",
    'src/Page.tsx': 'export default function Page(){return <h1 className="title">Frozen 中文</h1>}',
    'src/router.d.ts': "declare module 'react-router-dom' { export const HashRouter: any; export const Routes: any; export const Route: any; }",
    'src/theme.css': '/* 中文 😀 � */\r\n:root {--accent: red}.title{color:var(--accent)}',
    '.ripple/overrides.json': '{"schemaVersion":2,"targets":{},"pages":{}}',
  }
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text) }
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test'); git('config', 'core.autocrlf', 'false'); git('add', '.'); git('commit', '-m', 'fixture')
  return { root, git, files }
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('FrozenSourceSnapshot', () => {
  it('replays exact production digest, HEAD/tree and defensively copies bytes', () => {
    const { root, git } = fixture()
    const snapshot = captureFrozenSourceSnapshot(root)
    expect(snapshot.sourceDigest).toBe(digestTrackedTree(root))
    expect(snapshot.gitHead).toBe(git('rev-parse', 'HEAD'))
    expect(snapshot.rootTree).toBe(git('rev-parse', 'HEAD^{tree}'))
    const first = readFrozenBytes(snapshot, 'src/theme.css')!
    first.fill(0)
    expect(readFrozenBytes(snapshot, 'src/theme.css')![0]).toBe(47)
    expect(Object.isFrozen(snapshot.trackedFiles)).toBe(true)
  })
  it('analyzes solely captured TS/config/CSS/page bytes after disk contents change', () => {
    const { root } = fixture()
    const snapshot = captureFrozenSourceSnapshot(root)
    const before = analyzeProject(snapshot)
    for (const file of snapshot.trackedFiles) fs.writeFileSync(path.join(root, file), 'broken disk bytes')
    const after = analyzeProject(snapshot)
    expect(after).toEqual(before)
    expect(after.nodes.some(node => node.value === 'Frozen 中文')).toBe(true)
    expect(after.nodes.some(node => node.kind === 'route' && node.routePath === '/home')).toBe(true)
    expect(after.nodes.filter(node => node.kind === 'token-use')).toHaveLength(1)
    expect(after.edges.some(edge => edge.kind === 'imports' && edge.to === 'file:src/Page.tsx')).toBe(true)
    const sys = frozenSourceSystem(snapshot)
    expect(sys.readFile(path.join(root, '../outside.ts'))).toBeUndefined()
    expect(sys.fileExists(path.join(root, 'node_modules/react/index.d.ts'))).toBe(false)
    expect(() => sys.writeFile('x', 'x')).toThrow()
  })
  it('keeps path calling convention and preserves graph payload on a bounded project', () => {
    const { root } = fixture()
    expect(analyzeProject(captureFrozenSourceSnapshot(root))).toEqual(analyzeProject(root))
  })
  it('rejects dirty capture, unbranded snapshots and path escapes', () => {
    const { root } = fixture()
    const snapshot = captureFrozenSourceSnapshot(root)
    expect(() => analyzeProject(createFrozenSourceSnapshot(snapshot.root, snapshot.trackedFiles.map(file => ({ path: file, bytes: snapshot.readFile(path.join(snapshot.root, file))! })), { gitHead: snapshot.gitHead, rootTree: snapshot.rootTree }))).toThrow()
    expect(() => readFrozenBytes(snapshot, '../theme.css')).toThrow()
    fs.writeFileSync(path.join(root, 'src/Page.tsx'), 'changed')
    expect(() => captureFrozenSourceSnapshot(root)).toThrow()
  })
  it('rejects symlink-mode and staged entries before reading project bytes', () => {
    const { root, git } = fixture()
    const blob = git('rev-parse', 'HEAD:src/Page.tsx')
    execFileSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', `120000,${blob},src/linked-page.tsx`])
    try {
      captureFrozenSourceSnapshot(root, false)
      throw new Error('expected symlink index rejection')
    } catch (error) { expect(error).toMatchObject({ code: 'snapshot-file-invalid' }) }
  })
  it('distinguishes valid U+FFFD, BOM and invalid UTF-8 without normalization', () => {
    expect(decodeFrozenUtf8(Buffer.from([0xef, 0xbf, 0xbd]))).toBe('�')
    expect(decodeFrozenUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('\uFEFFa')
    for (const bytes of [[0xc3, 0x28], [0xff], [0xed, 0xa0, 0x80]]) expect(() => decodeFrozenUtf8(Buffer.from(bytes))).toThrow()
  })
})
