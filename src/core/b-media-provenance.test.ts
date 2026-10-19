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

const assetEdges = (graph: SourceGraph, fromPrefix?: string) =>
  graph.edges.filter(edge => edge.kind === 'asset-consumer' && (!fromPrefix || edge.from.startsWith(fromPrefix)))

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
    const edges = assetEdges(graph)
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every(edge => edge.certainty === 'source-proven')).toBe(true)
    const mediaIds = new Set(edges.map(edge => edge.to))
    expect(mediaIds.size).toBe(2)

    const impact = sourceProvenPageImpact(graph, [...mediaIds][0])
    expect(impact.unresolved).toEqual([])
    expect(impact.pageRefs).toEqual(['page:home', 'page:list'])
    // Per-usage sourcing: home's media edge originates from HomePage, list's from ListPage —
    // a shared component does not merge the two bindings.
    expect(edges.some(edge => edge.from.startsWith('component:src/pages/HomePage'))).toBe(true)
    expect(edges.some(edge => edge.from.startsWith('component:src/pages/ListPage'))).toBe(true)
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

    // The drilled prop edge is now sourced from the USAGE site (ListPage), not the card.
    const listId = graph.nodes.find(node => node.kind === 'component' && node.label === 'ListPage')!.id
    const cardEdges = assetEdges(graph, listId)
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
    const edges = assetEdges(graph)
    // One access, one shared value, two indistinguishable media nodes → one
    // semantic-candidate edge per media node (2 total), no proven edges.
    expect(edges.length).toBe(2)
    expect(edges.every(edge => edge.certainty === 'semantic-candidate')).toBe(true)

    const mediaIds = new Set(graph.nodes.filter(node => node.kind === 'media').map(node => node.id))
    const impact = sourceProvenPageImpact(graph, [...mediaIds][0])
    expect(impact.certainty).not.toBe('source-proven')
  })

  it('names candidates through a spread but keeps the usage unproven and poisons the closure', () => {
    const root = temp()
    scaffold(root)
    const url = 'https://images.pexels.com/photos/222/pexels-photo-222.jpeg?auto=compress'
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: '${url}' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} {...product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const edges = assetEdges(graph)
    // Candidates are named (syntactic array reachable) but stay semantic-candidate.
    expect(edges.length).toBe(1)
    expect(edges[0].certainty).toBe('semantic-candidate')
    // The media's declaration file is poisoned: impact must fail closed even though the
    // consumption could not be proven — an invisible consumer must not disappear.
    const media = graph.nodes.find(node => node.kind === 'media')!
    const impact = sourceProvenPageImpact(graph, media.id)
    expect(impact.certainty).not.toBe('source-proven')
    expect(impact.unresolved.length).toBeGreaterThan(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-usage') || entry.includes('unproven-prop'))).toBe(true)
  })

  it('mixed proven and unproven consumers: impact closure is never overestimated', () => {
    const root = temp()
    scaffold(root)
    const url = 'https://images.pexels.com/photos/333/pexels-photo-333.jpeg?auto=compress'
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: '${url}' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    // Home: proven path. List: spread path (unproven) over the same array.
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.map((product) => <ProductCard key={product.id} {...product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const media = graph.nodes.find(node => node.kind === 'media')!
    const impact = sourceProvenPageImpact(graph, media.id)
    // page:home is provably affected, but the spread usage on page:list is unproven:
    // the closure must report incomplete, never silently claim full coverage.
    expect(impact.pageRefs).toContain('page:home')
    expect(impact.certainty).not.toBe('source-proven')
    expect(impact.unresolved.length).toBeGreaterThan(0)
  })

  it('dynamic array member (element access) names candidates but stays unproven', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [\n  { id: 'p1', image: 'https://images.pexels.com/photos/6/pexels-photo-6.jpeg?auto=compress' },\n  { id: 'p2', image: 'https://images.pexels.com/photos/7/pexels-photo-7.jpeg?auto=compress' },\n];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\ndeclare const index: number;\nexport function HomePage() { return <main><ProductCard product={products[index]} /></main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const edges = assetEdges(graph)
    expect(edges.length).toBe(2)
    expect(edges.every(edge => edge.certainty === 'semantic-candidate')).toBe(true)
    for (const edge of edges) {
      const impact = sourceProvenPageImpact(graph, edge.to)
      expect(impact.certainty).not.toBe('source-proven')
    }
  })

  it('namespace-tagged components stay visible: <Cards.ProductCard /> resolves via import * and fails closed', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [\n  { id: 'p1', image: 'https://images.pexels.com/photos/10/pexels-photo-10.jpeg?auto=compress' },\n  { id: 'p2', image: 'https://images.pexels.com/photos/11/pexels-photo-11.jpeg?auto=compress' },\n];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    // Home: element access through a namespace-qualified tag — the consumer must not
    // silently vanish (P1-1). List: plain named path stays fully provable.
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport * as Cards from '../components/ProductCard';\ndeclare const index: number;\nexport function HomePage() { return <main><Cards.ProductCard product={products[index]} /></main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport * as Cards from '../components/ProductCard';\nexport function ListPage() { return <main>{products.map((product) => <Cards.ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const edges = assetEdges(graph)
    // Both usage sites resolve to the same component: 2 proven (list map) + 2 candidates (home element access).
    expect(edges.filter(edge => edge.certainty === 'source-proven').length).toBe(2)
    expect(edges.filter(edge => edge.certainty === 'semantic-candidate').length).toBe(2)
    for (const edge of edges) {
      const impact = sourceProvenPageImpact(graph, edge.to)
      expect(impact.certainty).not.toBe('source-proven')
    }
    expect(graph.unresolved.some(entry => entry.includes('unproven-usage') || entry.includes('unproven-prop'))).toBe(true)
  })

  it('sibling media in the same declaration file are poisoned too (file-granularity fail-closed)', () => {
    const root = temp()
    scaffold(root)
    // productsA is consumed through an unprovable spread; productsB through a provable
    // map. Both live in the same declaration file, so the unproven-usage poison on that
    // file must degrade productsB from source-proven to partial — this assertion is what
    // makes the poison emission load-bearing against regressions.
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const productsA: Product[] = [{ id: 'a1', image: 'https://images.pexels.com/photos/20/pexels-photo-20.jpeg?auto=compress' }];\nexport const productsB: Product[] = [{ id: 'b1', image: 'https://images.pexels.com/photos/21/pexels-photo-21.jpeg?auto=compress' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { productsA } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{productsA.map((product) => <ProductCard key={product.id} {...product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { productsB } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{productsB.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const mediaB = graph.nodes.find(node => node.kind === 'media' && node.value?.includes('pexels-photo-21'))!
    const impactB = sourceProvenPageImpact(graph, mediaB.id)
    expect(impactB.pageRefs).toContain('page:list')
    expect(impactB.certainty).toBe('partial')
    expect(impactB.unresolved.some(entry => entry.includes('unproven-usage'))).toBe(true)
  })

  it('numeric literal index (products[1]) resolves exactly and stays source-proven', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [\n  { id: 'p1', image: 'https://images.pexels.com/photos/30/pexels-photo-30.jpeg?auto=compress' },\n  { id: 'p2', image: 'https://images.pexels.com/photos/31/pexels-photo-31.jpeg?auto=compress' },\n];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main><ProductCard product={products[1]} /></main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const edges = assetEdges(graph)
    expect(edges.length).toBe(1)
    expect(edges[0].certainty).toBe('source-proven')
    const media = graph.nodes.find(node => node.id === edges[0].to)!
    expect(media.value).toContain('pexels-photo-31')
    const impact = sourceProvenPageImpact(graph, media.id)
    expect(impact.certainty).toBe('source-proven')
    expect(impact.pageRefs).toEqual(['page:home'])
    // The sibling at index 0 has no consumer and must not gain one via this usage.
    const sibling = graph.nodes.find(node => node.kind === 'media' && node.value?.includes('pexels-photo-30'))!
    expect(graph.edges.filter(edge => edge.kind === 'asset-consumer' && edge.to === sibling.id).length).toBe(0)
  })

  it('locally aliased components are recorded as unresolvable instead of vanishing', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: 'https://images.pexels.com/photos/40/pexels-photo-40.jpeg?auto=compress' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    // Card2 aliases ProductCard locally (not imported): the tag cannot be resolved to a
    // component today, so the usage must be recorded as an unknown consumer path instead
    // of dropping out of the graph silently.
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nconst Card2 = ProductCard;\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}{typeof Card2 === 'function' ? <Card2 product={products[0]} /> : null}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(graph.unresolved.some(entry => entry.includes('unresolvable-component:Card2'))).toBe(true)
  })

  it('imported external components do not produce unresolvable-component noise', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/pages/HomePage.tsx', `import { Link } from 'react-router';\nexport function HomePage() { return <main><Link to="/x">Home</Link></main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(graph.unresolved.filter(entry => entry.includes('unresolvable-component'))).toEqual([])
  })
})

describe('media provenance soundness guardrails (independent review P1 regressions)', () => {
  const cardFixture = (root: string, dataBody: string) => {
    scaffold(root)
    write(root, 'src/data/products.ts', dataBody)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';
import { ProductCard } from '../components/ProductCard';
export function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)
  }
  const cardEdgesOf = (root: string) => {
    const graph = analyzeProject(root)
    return assetEdges(graph)
  }

  it('refuses to drill a reassigned let declaration', () => {
    const root = temp()
    cardFixture(root, `export type Product = { id: string; image: string };
let products: Product[] = [{ id: 'p1', image: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress' }];
products = [];
export { products };`)
    expect(cardEdgesOf(root).length).toBe(0)
  })

  it('refuses to upgrade when only one conditional arm is drillable', () => {
    const root = temp()
    cardFixture(root, `export type Product = { id: string; image: string };
const fresh: Product[] = [{ id: 'p1', image: 'https://images.pexels.com/photos/2/pexels-photo-2.jpeg?auto=compress' }];
declare const coin: boolean;
function loadRemote(): Product[] { return [] }
const products = coin ? fresh : loadRemote();
export { products };`)
    expect(cardEdgesOf(root).length).toBe(0)
  })

  it('skips object literals with a spread that may override the property', () => {
    const root = temp()
    cardFixture(root, `export type Product = { id: string; image: string };
declare const overrides: Partial<Product>;
export const products: Product[] = [{ id: 'p1', image: 'https://images.pexels.com/photos/3/pexels-photo-3.jpeg?auto=compress', ...overrides } as Product];`)
    expect(cardEdgesOf(root).length).toBe(0)
  })

  it('skips duplicated property keys instead of emitting a possibly-dead edge', () => {
    const root = temp()
    cardFixture(root, `export const products = [{ id: 'p1', image: 'https://images.pexels.com/photos/4/pexels-photo-4.jpeg?auto=compress', image: 'https://images.pexels.com/photos/5/pexels-photo-5.jpeg?auto=compress' }];`)
    const edges = cardEdgesOf(root)
    expect(edges.filter(edge => edge.certainty === 'source-proven').length).toBe(0)
  })

  it('does not apply the @/ fallback when tsconfig declares paths', () => {
    const root = temp()
    scaffold(root)
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', baseUrl: '.', paths: { '@/*': ['./lib/*'] } }, include: ['src'] }))
    write(root, 'src/assets/hero.jpg', Buffer.from([0xff, 0xd8]))
    write(root, 'src/pages/HomePage.tsx', `import heroImage from '@/assets/hero.jpg';
export function HomePage() { return <main><img src={heroImage} alt="hero" /></main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)
    const graph = analyzeProject(root)
    expect(graph.unresolved.some(entry => entry.includes('@/assets/hero.jpg'))).toBe(true)
  })
})

describe('css token resolution (two-phase, order-independent)', () => {
  const cssFixture = (root: string, files: Record<string, string>) => {
    scaffold(root)
    for (const [relative, content] of Object.entries(files)) write(root, relative, content)
    write(root, 'src/pages/HomePage.tsx', `import '../styles/card.css';\nexport function HomePage() { return <main><p className="eyebrow">Home</p></main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)
  }
  const tokenEdgesFrom = (graph: SourceGraph, file: string) =>
    graph.edges.filter(edge => edge.kind === 'uses-token' && edge.from === `file:${file}`)

  it('resolves var() uses against definitions in a later-sorting stylesheet', () => {
    const root = temp()
    // card.css sorts BEFORE theme.css in tracked-file order yet consumes its token —
    // the uses-token edge must exist regardless of ordering.
    cssFixture(root, {
      'src/styles/card.css': `.eyebrow { color: var(--brand-accent); font-weight: 600; }`,
      'src/styles/theme.css': `:root { --brand-accent: #b5522d; }`,
    })
    const graph = analyzeProject(root)
    const edges = tokenEdgesFrom(graph, 'src/styles/card.css')
    expect(edges.length).toBe(1)
    expect(edges[0].certainty).toBe('source-proven')
    const token = graph.nodes.find(node => node.id === edges[0].to)!
    expect(token.location?.path).toBe('src/styles/theme.css')
    expect(token.label).toBe('--brand-accent')
  })

  it('duplicate definitions across files stay unresolved (no uses-token edge)', () => {
    const root = temp()
    cssFixture(root, {
      'src/styles/card.css': `.eyebrow { color: var(--brand-accent); }`,
      'src/styles/theme.css': `:root { --brand-accent: #b5522d; }`,
      'src/styles/base.css': `:root { --brand-accent: #246; }`,
    })
    const graph = analyzeProject(root)
    expect(tokenEdgesFrom(graph, 'src/styles/card.css')).toEqual([])
  })
})

describe('integrated cross-page media bindings (merged A/B scope semantics)', () => {
  it('same shared component on two routes keeps per-page media bindings distinct', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const productsA: Product[] = [{ id: 'a1', image: 'https://images.pexels.com/photos/50/pexels-photo-50.jpeg?auto=compress' }];\nexport const productsB: Product[] = [{ id: 'b1', image: 'https://images.pexels.com/photos/51/pexels-photo-51.jpeg?auto=compress' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    // The SAME component is rendered on both routes with different arrays: the binding
    // that matters is per-page (which array feeds the map), not component/module reuse.
    write(root, 'src/pages/HomePage.tsx', `import { productsA } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{productsA.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { productsB } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{productsB.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const mediaA = graph.nodes.find(node => node.kind === 'media' && node.value?.includes('pexels-photo-50'))!
    const mediaB = graph.nodes.find(node => node.kind === 'media' && node.value?.includes('pexels-photo-51'))!
    const impactA = sourceProvenPageImpact(graph, mediaA.id)
    const impactB = sourceProvenPageImpact(graph, mediaB.id)
    expect(impactA.pageRefs).toEqual(['page:home'])
    expect(impactA.certainty).toBe('source-proven')
    expect(impactB.pageRefs).toEqual(['page:list'])
    expect(impactB.certainty).toBe('source-proven')
  })

  it('ambiguous shared value across pages stays partial, never silently proven', () => {
    const root = temp()
    scaffold(root)
    // Both arrays share the same image URL: the media node is ambiguous, so every
    // consuming page must stay non-proven rather than guess a binding.
    const shared = 'https://images.pexels.com/photos/60/pexels-photo-60.jpeg?auto=compress'
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const productsA: Product[] = [{ id: 'a1', image: '${shared}' }];\nexport const productsB: Product[] = [{ id: 'b1', image: '${shared}' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { productsA } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{productsA.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { productsB } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{productsB.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const edges = assetEdges(graph)
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every(edge => edge.certainty === 'semantic-candidate')).toBe(true)
    for (const edge of edges) {
      const impact = sourceProvenPageImpact(graph, edge.to)
      expect(impact.certainty).not.toBe('source-proven')
    }
  })

  it('an unconsumed media definition does not acquire all-page impact via file imports (A scope rule)', () => {
    const root = temp()
    scaffold(root)
    // productsC is declared in the shared data module but never consumed by any
    // component. Under the merged Scope semantics, imports of the definition file do
    // NOT prove consumption — the closure must be empty/unknown, not all four pages.
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const productsA: Product[] = [{ id: 'a1', image: 'https://images.pexels.com/photos/70/pexels-photo-70.jpeg?auto=compress' }];\nexport const productsC: Product[] = [{ id: 'c1', image: 'https://images.pexels.com/photos/71/pexels-photo-71.jpeg?auto=compress' }];`)
    write(root, 'src/components/ProductCard.tsx', `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`)
    write(root, 'src/pages/HomePage.tsx', `import { productsA } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{productsA.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const mediaC = graph.nodes.find(node => node.kind === 'media' && node.value?.includes('pexels-photo-71'))!
    const impactC = sourceProvenPageImpact(graph, mediaC.id)
    expect(impactC.pageRefs).toEqual([])
    expect(impactC.certainty).toBe('unknown')
    // Sanity: the consumed sibling still proves its own page.
    const mediaA = graph.nodes.find(node => node.kind === 'media' && node.value?.includes('pexels-photo-70'))!
    const impactA = sourceProvenPageImpact(graph, mediaA.id)
    expect(impactA.pageRefs).toEqual(['page:home'])
    expect(impactA.certainty).toBe('source-proven')
  })
})

describe('fail-closed drilling guards (A-side recheck 2026-10-19)', () => {
  const card = `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`
  const urlA = 'https://images.pexels.com/photos/81/pexels-photo-81.jpeg?auto=compress'
  const urlB = 'https://images.pexels.com/photos/82/pexels-photo-82.jpeg?auto=compress'
  const data = (body: string) => `export type Product = { id: string; image: string };\n${body}`

  it('refuses to drill a const array mutated after initialization (map and numeric index)', () => {
    const root = temp()
    scaffold(root)
    // `const` does not freeze the array: the module-level push makes every literal
    // element unreliable, so neither the map path nor the exact products[1] path may
    // produce a proven edge.
    write(root, 'src/data/products.ts', data(`export const products: Product[] = [{ id: 'p1', image: '${urlA}' }, { id: 'p2', image: '${urlB}' }];\nproducts.push({ id: 'p3', image: 'https://images.pexels.com/photos/83/pexels-photo-83.jpeg?auto=compress' });`))
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main><ProductCard product={products[1]} /></main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven').length).toBe(0)
    // The unproven consumption is recorded, not silently dropped.
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
    const mediaA = graph.nodes.find(node => node.kind === 'media' && node.value === urlA)!
    const impact = sourceProvenPageImpact(graph, mediaA.id)
    expect(impact.pageRefs).toEqual([])
    expect(impact.certainty).not.toBe('source-proven')
  })

  it('detects cross-file mutations of the drilled binding', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', data(`export const products: Product[] = [{ id: 'p1', image: '${urlA}' }];`))
    write(root, 'src/components/ProductCard.tsx', card)
    // The mutation happens in a CONSUMER file, not next to the declaration.
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nproducts.reverse();\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven').length).toBe(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
  })

  it('a JSX spread after the named prop fails closed (later spread may override it)', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', data(`export const products: Product[] = [{ id: 'p1', image: '${urlA}' }];\nexport const overrides: Record<string, unknown> = { product: { id: 'x', image: '${urlB}' } };`))
    write(root, 'src/components/ProductCard.tsx', card)
    // Home: plain named prop (proven). List: a spread AFTER the named prop can override
    // `product` at runtime — the drilled binding is not provably the live one.
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { overrides } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} {...overrides} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const mediaA = graph.nodes.find(node => node.kind === 'media' && node.value === urlA)!
    const impact = sourceProvenPageImpact(graph, mediaA.id)
    // Only the home usage is proven; the spread-overridden list usage must not upgrade.
    expect(impact.pageRefs).toEqual(['page:home'])
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
  })

  it('a partially unresolvable array never upgrades its resolvable subset', () => {
    const root = temp()
    scaffold(root)
    // The middle element comes from a function call: which images the array really
    // holds at runtime is unknown, so NONE of the literal elements may be proven —
    // a subset result would hide makeItem()'s consumer.
    write(root, 'src/data/products.ts', data(`function makeItem(): Product { return { id: 'm', image: 'https://images.pexels.com/photos/84/pexels-photo-84.jpeg?auto=compress' } }\nexport const products: Product[] = [{ id: 'p1', image: '${urlA}' }, makeItem(), { id: 'p3', image: '${urlB}' }];`))
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven').length).toBe(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
    for (const url of [urlA, urlB]) {
      const media = graph.nodes.find(node => node.kind === 'media' && node.value === url)!
      const impact = sourceProvenPageImpact(graph, media.id)
      expect(impact.pageRefs).toEqual([])
      expect(impact.certainty).not.toBe('source-proven')
    }
  })
})

describe('fail-closed drilling guards (independent review P1 follow-ups)', () => {
  const card = `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`
  const urlA = 'https://images.pexels.com/photos/91/pexels-photo-91.jpeg?auto=compress'
  const urlB = 'https://images.pexels.com/photos/92/pexels-photo-92.jpeg?auto=compress'

  it('detects mutations through a local const alias of the binding', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: '${urlA}' }, { id: 'p2', image: '${urlB}' }];`)
    write(root, 'src/components/ProductCard.tsx', card)
    // `reversed` is a const alias of the SAME array: the mutation reference resolves to
    // the alias declaration, but the drilled binding must still fail closed.
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nconst reversed = products;\nreversed.reverse();\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven').length).toBe(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
  })

  it('refuses to drill an array produced by a transforming map callback', () => {
    const root = temp()
    scaffold(root)
    // `normalized` rewrites image at runtime: drilling it back to `raw`'s literal image
    // would claim a consumer for a URL that is never consumed.
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const raw: Product[] = [{ id: 'p1', image: '${urlA}' }];\nexport const normalized: Product[] = raw.map((p) => ({ ...p, image: '${urlB}' }));`)
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { normalized } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{normalized.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven').length).toBe(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
  })

  it('keeps an identity map callback drillable (supported boundary)', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const raw: Product[] = [{ id: 'p1', image: '${urlA}' }];\nexport const same: Product[] = raw.map((p) => p);`)
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { same } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{same.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `export function ListPage() { return <main>List</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const edges = assetEdges(graph)
    expect(edges.length).toBe(1)
    expect(edges[0].certainty).toBe('source-proven')
    expect(edges[0].to).toBe(graph.nodes.find(node => node.kind === 'media' && node.value === urlA)!.id)
  })
})

describe('filter/slice precision (proven impact must match rendered elements)', () => {
  const card = `export function ProductCard({ product }: { product: { image: string } }) { return <img src={product.image} alt="" /> }`
  const urlA = 'https://images.pexels.com/photos/93/pexels-photo-93.jpeg?auto=compress'
  const urlB = 'https://images.pexels.com/photos/94/pexels-photo-94.jpeg?auto=compress'

  it('filter that keeps only one product does not prove the filtered-out media', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: '${urlA}' }, { id: 'p2', image: '${urlB}' }];`)
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.filter((p) => p.id === 'p1').map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const mediaA = graph.nodes.find(node => node.kind === 'media' && node.value === urlA)!
    const mediaB = graph.nodes.find(node => node.kind === 'media' && node.value === urlB)!
    // p1 renders on both pages; p2 is filtered out on the list page and must NOT be
    // proven there — the drill now resolves exactly the kept elements.
    expect(sourceProvenPageImpact(graph, mediaA.id).pageRefs).toEqual(['page:home', 'page:list'])
    expect(sourceProvenPageImpact(graph, mediaB.id).pageRefs).toEqual(['page:home'])
    const listId = graph.nodes.find(node => node.kind === 'component' && node.label === 'ListPage')!.id
    expect(assetEdges(graph, listId).filter(edge => edge.to === mediaB.id && edge.certainty === 'source-proven').length).toBe(0)
  })

  it('unsupported filter predicates fail closed instead of upgrading the whole array', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string; score: number };\nexport const products: Product[] = [{ id: 'p1', image: '${urlA}', score: 5 }, { id: 'p2', image: '${urlB}', score: 1 }];`)
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    // `p.score > 2` is outside the supported predicate boundary: the list usage must
    // stay unproven rather than assume all elements render.
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.filter((p) => p.score > 2).map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven' && edge.from.startsWith('component:src/pages/ListPage')).length).toBe(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
    const mediaA = graph.nodes.find(node => node.kind === 'media' && node.value === urlA)!
    expect(sourceProvenPageImpact(graph, mediaA.id).pageRefs).toEqual(['page:home'])
  })

  it('slice with literal bounds proves exactly the sliced elements', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: '${urlA}' }, { id: 'p2', image: '${urlB}' }];`)
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.slice(0, 1).map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    const mediaB = graph.nodes.find(node => node.kind === 'media' && node.value === urlB)!
    expect(sourceProvenPageImpact(graph, mediaB.id).pageRefs).toEqual(['page:home'])
  })

  it('slice with non-literal bounds fails closed', () => {
    const root = temp()
    scaffold(root)
    write(root, 'src/data/products.ts', `export type Product = { id: string; image: string };\nexport const products: Product[] = [{ id: 'p1', image: '${urlA}' }, { id: 'p2', image: '${urlB}' }];\nexport const count = 1;`)
    write(root, 'src/components/ProductCard.tsx', card)
    write(root, 'src/pages/HomePage.tsx', `import { products } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main>{products.map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    write(root, 'src/pages/ListPage.tsx', `import { products, count } from '../data/products';\nimport { ProductCard } from '../components/ProductCard';\nexport function ListPage() { return <main>{products.slice(count).map((product) => <ProductCard key={product.id} product={product} />)}</main> }`)
    commit(root)

    const graph = analyzeProject(root)
    expect(assetEdges(graph).filter(edge => edge.certainty === 'source-proven' && edge.from.startsWith('component:src/pages/ListPage')).length).toBe(0)
    expect(graph.unresolved.some(entry => entry.includes('unproven-prop:product'))).toBe(true)
  })
})
