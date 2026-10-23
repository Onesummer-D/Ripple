// N11 复现证据采集：无显式返回类型标注的工厂函数，其返回体内的媒体
// 在类型流闭包中未被覆盖，消费者边被静默删除 → PageImpact 误成 source-proven → 候选误放。
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeProject } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate } from '../src/core/candidate.ts'

const container = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.tmp', 'n11-evidence-'))
const root = path.join(container, 'site')
fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'n11' }))
fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { HomePage } from './pages/HomePage';\nimport { AutumnPage } from './pages/AutumnPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <><button aria-label="Home route" onClick={() => setCurrentPage('home')} /><button aria-label="Autumn route" onClick={() => setCurrentPage('autumn')} />{currentPage === 'home' && <HomePage />}{currentPage === 'autumn' && <AutumnPage />}</>; }`)
fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true })
fs.writeFileSync(path.join(root, 'src', 'data', 'factory.ts'), `export interface Product { image: string }
export const hero = { image: '/images/shared.webp' }
export function makeProducts() {
  return [{ image: hero.image }]
}
export const products: Product[] = makeProducts()
export const categories = [{ image: '/images/cat.webp' }]
`)
fs.writeFileSync(path.join(root, 'src', 'components', 'ProductCard.tsx'), `import type { Product } from '../data/factory'
export function ProductCard({ product }: { product: Product }) {
  return <img src={product.image} />
}
`)
fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `import { hero } from '../data/factory'
export function HomePage() {
  return <main><h1 className="text-ink-900">Home title</h1><img src={hero.image} /></main>
}
`)
fs.writeFileSync(path.join(root, 'src', 'pages', 'AutumnPage.tsx'), `import { products } from '../data/factory'
import { ProductCard } from '../components/ProductCard'
export function AutumnPage() {
  return <main><h1>Autumn title</h1>{products.map((p) => <ProductCard key={p.image} product={p} />)}</main>
}
`)
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
git('init', '-q'); git('config', 'user.email', 'e@e.e'); git('config', 'user.name', 'e'); git('add', '.'); git('commit', '-qm', 'n11')

const graph = analyzeProject(root)
const shared = graph.nodes.find(n => n.kind === 'media' && n.location?.path === 'src/data/factory.ts' && n.value === '/images/shared.webp')!
const card = graph.nodes.find(n => n.kind === 'component' && n.label === 'ProductCard')!
const cardEdges = graph.edges.filter(e => e.from === card.id && e.kind === 'asset-consumer').map(e => ({ to: e.to, certainty: e.certainty }))
const impact = sourceProvenPageImpact(graph, shared.id)
console.log('Card asset-consumer edges =', JSON.stringify(cardEdges))
console.log('PageImpact(shared) =', JSON.stringify(impact))

const bytes = Buffer.from([1, 2, 3])
const { createHash } = await import('node:crypto')
const assetHash = createHash('sha256').update(bytes).digest('hex')
const operation = { id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: shared.id, before: shared.value, after: '/media/new.webp', payload: { assetRef: 'public/media/new.webp', assetHash } }
const executor = {
  kind: 'MEDIA', action: 'asset-swap',
  validate: (v: unknown) => !!v && typeof v === 'object',
  plan: ({ operation: op, target }: any) => ({ sourceEdits: [{ path: target.location.path, start: target.location.start, end: target.location.end, before: op.before, after: op.after }], fileWrites: [{ path: op.payload.assetRef, bytes }] }),
}
const scope: any = { id: 's', version: 1, includedRefs: [shared.id, 'page:home'], excludedRefs: [], protectedRefs: [], decidedBy: 'tester', decidedAt: new Date().toISOString() }
try {
  const candidate = createCandidate({ projectRoot: root, candidateRoot: path.join(container, 'cand'), artifactRoot: path.join(container, 'art'), graph, scope, operations: [operation], executors: [executor], readStagedAsset: () => bytes } as any)
  console.log('createCandidate = ACCEPTED（漏洞：Scope 漏掉 AutumnPage 真实消费者）', candidate.id)
} catch (error: any) {
  console.log('createCandidate = REJECTED:', error?.message)
}
