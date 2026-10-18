import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeProject } from './project'
import { sourceProvenPageImpact } from './scope'
import type { SourceGraph } from './model'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-media-provenance-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })

afterEach(() => { for (const root of temporaryRoots.splice(0)) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* Windows file-handle lag; directory is under node_modules/.tmp */ } } })

const write = (root: string, relative: string, content: string | Buffer) => {
  const absolute = path.join(root, relative)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
}

function scaffold(root: string) {
  write(root, 'package.json', JSON.stringify({ name: 'media-fixture', scripts: { build: 'vite build' } }))
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  write(root, 'index.html', `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  write(root, 'src/main.tsx', `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
  write(root, 'src/App.tsx', `import { useState } from 'react';\nimport { HomePage } from './pages/HomePage';\nimport { ListPage } from './pages/ListPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <><button aria-label="Home route" onClick={() => setCurrentPage('home')} /><button aria-label="List route" onClick={() => setCurrentPage('list')} />{currentPage === 'home' && <HomePage />}{currentPage === 'list' && <ListPage />}</>; }`)
}

const commit = (root: string) => { git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fixture') }

const assetEdges = (graph: SourceGraph, fromPrefix: string) =>
  graph.edges.filter(edge => edge.kind === 'asset-consumer' && edge.from.startsWith(fromPrefix))

describe('media provenance upgrade', () => {
  it('upgrades prop-drilled external URLs to source-proven (qingye ProductCard pattern)', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [\n  { id: 'p1', image: 'https://images.pexels.com/photos/39692059/pexels-photo-39692059.jpeg?auto=compress' },\n  { id: 'p2', image: 'https://images.pexels.com/photos/8952094/pexels-photo-8952094.jpeg?auto=compress' },\n];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.filter((p) => p.id !== 'p2').map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const cardId = graph.nodes.find(node => node.kind === 'component' && node.label === 'ProductCard')!.id
    const edges = assetEdges(graph, cardId)
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every(edge => edge.certainty === 'source-proven')).toBe(true)
    const mediaIds = new Set(edges.map(edge => edge.to))
    expect(mediaIds.size).toBe(2)

    const impact = sourceProvenPageImpact(graph, [...mediaIds][0])
    expect(impact.unresolved).toEqual([])
    expect(impact.pageRefs).toEqual(['page:home', 'page:list'])
  })

  it('resolves @/ alias imports and identifier-bound assets (mountain-spirit pattern)', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/assets/hero.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    write(root, 'src/assets/item-1.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    write(root, 'src/pages/HomePage.tsx', `import heroImage from '@/assets/hero.jpg';\nexport function HomePage() { return <main><img src={heroImage} alt="hero" /></main> }`)
    write(root, 'src/data/products.ts', `import item1 from '@/assets/item-1.jpg';\nexport type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: item1 }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(graph.unresolved.filter(entry => entry.includes('@/'))).toEqual([])

    const assetNodes = graph.nodes.filter(node => node.kind === 'media' && node.value === 'src/assets/hero.jpg')
    expect(assetNodes.length).toBe(1)
    expect(assetNodes[0].location?.start).toBeUndefined()

    const homeId = graph.nodes.find(node => node.kind === 'component' && node.label === 'HomePage')!.id
    const homeEdges = assetEdges(graph, homeId)
    expect(homeEdges.length).toBe(1)
    expect(homeEdges[0].certainty).toBe('source-proven')
    expect(homeEdges[0].to).toBe('media:src/assets/hero.jpg#asset')

    const cardId = graph.nodes.find(node => node.kind === 'component' && node.label === 'ProductCard')!.id
    const cardEdges = assetEdges(graph, cardId)
    expect(cardEdges.length).toBe(1)
    expect(cardEdges[0].certainty).toBe('source-proven')
    expect(cardEdges[0].to).toBe('media:src/assets/item-1.jpg#asset')
  })

  it('keeps ambiguous shared values as semantic-candidate and does not double-emit', () => {
    const root = temp()
    scaffold(root)
    const shared = 'https://images.pexels.com/photos/111/pexels-photo-111.jpeg?auto=compress'
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [\n  { id: 'p1', image: '${shared}' },\n  { id: 'p2', image: '${shared}' },\n];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const cardId = graph.nodes.find(node => node.kind === 'component' && node.label === 'ProductCard')!.id
    const edges = assetEdges(graph, cardId)
    // One access, one value, two indistinguishable media nodes → one candidate pair, no proven edges.
    expect(edges.length).toBe(2)
    expect(edges.every(edge => edge.certainty === 'semantic-candidate')).toBe(true)

    const mediaIds = new Set(graph.nodes.filter(node => node.kind === 'media').map(node => node.id))
    const impact = sourceProvenPageImpact(graph, [...mediaIds][0])
    expect(impact.certainty).not.toBe('source-proven')
  })

  it('leaves spread-propped components unproven instead of guessing', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: 'https://images.pexels.com/photos/222/pexels-photo-222.jpeg?auto=compress' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} {...product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const cardId = graph.nodes.find(node => node.kind === 'component' && node.label === 'ProductCard')!.id
    const edges = assetEdges(graph, cardId)
    // No drilling possible through a spread, and the coarse name-based fallback is
    // suppressed for prop-sourced accesses: honestly unproven means no fabricated edges.
    expect(edges.length).toBe(0)
  })
})
