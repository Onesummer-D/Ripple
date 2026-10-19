import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectConfigGraph, toViteAliasRules } from './project-config-resolver.mjs'

const roots: string[] = []
function project(configs: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-config-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/main.tsx'), 'export const App = () => <main />')
  fs.writeFileSync(path.join(root, 'vite.config.ts'), 'export default {}')
  fs.writeFileSync(path.join(root, 'index.html'), '<script type="module" src="/src/main.tsx"></script>')
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ files: [], references: Object.keys(configs).map(config => ({ path: config })) }))
  for (const [file, config] of Object.entries(configs)) fs.writeFileSync(path.join(root, file), JSON.stringify(config))
  return root
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('shared application config resolution', () => {
  it('does not borrow aliases from a tool config when the application declares none', () => {
    const root = project({
      'app.config.json': { compilerOptions: { jsx: 'react-jsx' }, include: ['src'] },
      'tools.config.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['tools/*'] } }, files: ['vite.config.ts'] },
    })
    const graph = resolveProjectConfigGraph(root, ts)
    expect(graph.application).toMatchObject({ status: 'supported', configPath: path.join(root, 'app.config.json') })
    expect(graph.aliases).toMatchObject({ status: 'unsupported', rules: [] })
    expect(toViteAliasRules(graph)).toEqual([])
  })

  it('preserves wildcard text boundaries for directory and filename aliases', () => {
    const root = project({
      'site.config.json': { compilerOptions: { jsx: 'react-jsx', baseUrl: '.', paths: { '@/*': ['src/*'], '@icon-*': ['src/icon-*'] } }, include: ['src'] },
    })
    const [directory, filename] = toViteAliasRules(resolveProjectConfigGraph(root, ts))
    expect(path.normalize('@/nested/Card'.replace(directory.find, directory.replacement))).toBe(path.join(root, 'src/nested/Card'))
    expect('@icon-star'.replace(filename.find, filename.replacement)).toBe(path.join(root, 'src/icon-star'))
  })

  it('keeps multiple application configs with conflicting aliases ambiguous', () => {
    const root = project({
      'first.config.json': { compilerOptions: { jsx: 'react-jsx', baseUrl: '.', paths: { '@/*': ['src/*'] } }, include: ['src'] },
      'second.config.json': { compilerOptions: { jsx: 'react-jsx', baseUrl: '.', paths: { '@/*': ['other/*'] } }, include: ['src'] },
    })
    const graph = resolveProjectConfigGraph(root, ts)
    expect(graph.application.status).toBe('ambiguous')
    expect(graph.aliases.status).toBe('ambiguous')
    expect(toViteAliasRules(graph)).toEqual([])
  })

  it('refuses unprefixed wildcard aliases that would capture package dependencies', () => {
    const root = project({
      'site.config.json': { compilerOptions: { jsx: 'react-jsx', baseUrl: '.', paths: { '*': ['src/*'] } }, include: ['src'] },
    })
    const graph = resolveProjectConfigGraph(root, ts)
    expect(graph.aliases).toMatchObject({ status: 'ambiguous', reason: expect.stringContaining('file-existence fallback') })
    expect(toViteAliasRules(graph)).toEqual([])
  })
})
