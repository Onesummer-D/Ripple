import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeProject, digestTrackedTree } from './project'
import { assertCandidateCurrent, createCandidate, removeCandidate } from './candidate'
import { createStagedAssetStore, type StagedAssetStore } from './media-asset-staging'
import { mediaAssetSwapExecutor, type MediaAssetSwapOperation } from './media-asset-swap'
import {
  AssetImportError,
  attachImportToCandidate,
  createAssetImport,
  listAssetImports,
  readAssetImport,
  verifyImportTraceability,
  type AssetImportRecord,
} from './asset-import-record'
import type { ScopeDecision } from './model'
import { removeTree } from './test-fixture-dir'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-asset-import-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) removeTree(root)
})

/** 真实 8x6 JPEG（PIL 生成，含 SOF 段，随仓库分发保证 CI 可复现）；截断版只有 JFIF 头，不可解码。 */
const FIXTURE_JPEG = path.join(process.cwd(), 'test', 'fixtures', 'asset-import', 'tiny-8x6.jpg')
const realJpeg = () => fs.readFileSync(FIXTURE_JPEG)
/** 合法 JFIF 头 + 垃圾体的截断 JPEG：格式头通过、完整文件不可解码（能力边界用例）。 */
const truncatedJpeg = () => Buffer.concat([realJpeg().subarray(0, 16), Buffer.from([0xde, 0xad, 0xbe, 0xef])])
/** 最小 PNG 魔数字节（格式嗅探足够，不需要完整 PNG）。 */
const pngHeaderBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
/** 最小 WebP 头字节（RIFF….WEBP）。 */
const webpHeaderBytes = () => Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 1, 2, 3])

const PEXELS_URL = 'https://images.pexels.com/photos/39692059/pexels-photo-39692059.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'

interface ImportFixture {
  container: string
  store: StagedAssetStore
  importsRoot: string
}

function importFixture(): ImportFixture {
  const container = temp()
  return {
    container,
    store: createStagedAssetStore(path.join(container, 'staged-assets')),
    importsRoot: path.join(container, 'imports'),
  }
}

function localInput(overrides: Record<string, unknown> = {}) {
  return {
    bytes: realJpeg(),
    assetRef: '/media/imported-hero.jpg',
    source: { kind: 'local-file', value: 'user-upload/hero-tall.jpg' },
    confirmedBy: 'test-user',
    ...overrides,
  } as Parameters<typeof createAssetImport>[2]
}

/** 与 A 的 fixture 同一约定的最小真实 Git 工程（analyzer 可识别结构）。 */
function sampleProject() {
  const container = temp()
  const root = path.join(container, 'site')
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-import', scripts: { build: 'vite build' } }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { HomePage } from './pages/HomePage';\nimport { AboutPage } from './pages/AboutPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <>{currentPage === 'home' ? <HomePage /> : <AboutPage />}</>; }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `export function HomePage() { return <main><h1>Home title</h1><img src="/images/hero.webp" alt="hero" /></main> }`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'AboutPage.tsx'), `export function AboutPage() { return <main><h1>About title</h1></main> }`)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return { container, root }
}

/** 青野 B2 同形态夹具：外链媒体字面量经"整对象 prop 透传 + 内部成员取值"消费，
 *  SourceGraph 产生 asset-candidate 非确定消费关系，PageImpact 不可证明（unknown）。 */
function mappedDataProject() {
  const container = temp()
  const root = path.join(container, 'site')
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mapped-data', scripts: { build: 'vite build' } }))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }))
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `import { useState } from 'react';\nimport { HomePage } from './pages/HomePage';\nimport { ProductsPage } from './pages/ProductsPage';\nexport function App() { const [currentPage, setCurrentPage] = useState('home'); return <>{currentPage === 'home' ? <HomePage /> : <ProductsPage />}</>; }`)
  fs.writeFileSync(path.join(root, 'src', 'data.ts'), `export const products = [{ name: '陶', image: 'https://images.pexels.com/photos/39692059/x.jpeg' }, { name: '茶', image: 'https://images.pexels.com/photos/8952094/x.jpeg' }]\n`)
  fs.writeFileSync(path.join(root, 'src', 'components', 'ProductCard.tsx'), `export function ProductCard({ product }: { product: { name: string; image: string } }) { return <img src={product.image} alt={product.name} /> }\n`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `import { products } from '../data';\nimport { ProductCard } from '../components/ProductCard';\nexport function HomePage() { return <main><h1>Home title</h1>{products.map(p => <ProductCard key={p.name} product={p} />)}</main> }\n`)
  fs.writeFileSync(path.join(root, 'src', 'pages', 'ProductsPage.tsx'), `import { products } from '../data';\nimport { ProductCard } from '../components/ProductCard';\nexport function ProductsPage() { return <main><h1>Products title</h1>{products.map(p => <ProductCard key={p.name} product={p} />)}</main> }\n`)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return { container, root }
}

describe('asset-import-record 导入记录', () => {
  it('CI-1 合法图片导入：暂存、哈希核对、尺寸解析、记录字段完整', () => {
    const { store, importsRoot } = importFixture()
    const bytes = realJpeg()
    const record = createAssetImport(store, importsRoot, localInput({ targetRef: 'media:src/pages/HomePage.tsx#142' }))
    expect(record.schema).toBe('asset-import-record/v1')
    expect(record.importId).toMatch(/^import-[0-9a-f]{12}$/)
    expect(record.stagedAssetHash).toMatch(/^[0-9a-f]{64}$/)
    expect(record.format).toBe('jpeg')
    expect(record.canonicalExtension).toBe('.jpg')
    expect(record.byteSize).toBe(bytes.byteLength)
    expect(record.dimensions).toEqual({ width: 8, height: 6 })
    expect(record.targetRef).toBe('media:src/pages/HomePage.tsx#142')
    expect(record.confirmation.confirmedBy).toBe('test-user')
    expect(record.validation.extensionMatch).toBe(true)
    // 暂存字节与记录哈希真实一致（重算核对，不是抄字段）
    const staged = store.readStagedAsset(record.stagedAssetHash)
    expect(verifyImportTraceability(store, record)).toEqual({ ok: true, byteSize: bytes.byteLength })
    expect(Buffer.from(staged)).toEqual(bytes)
    // 持久化记录可读回
    expect(readAssetImport(importsRoot, record.importId).stagedAssetHash).toBe(record.stagedAssetHash)
    expect(listAssetImports(importsRoot)).toHaveLength(1)
    // 同一字节、同一语义字段重复导入幂等（同一 importId，不产生第二条记录）
    const again = createAssetImport(store, importsRoot, localInput({ targetRef: 'media:src/pages/HomePage.tsx#142' }))
    expect(again.importId).toBe(record.importId)
    expect(listAssetImports(importsRoot)).toHaveLength(1)
  })

  it('CI-2 文件头不匹配拒绝：HTML/SVG 脚本字节不能以 .jpg 导入', () => {
    const { store, importsRoot } = importFixture()
    expect(() => createAssetImport(store, importsRoot, localInput({ bytes: Buffer.from('<html><script>alert(1)</script></html>') })))
      .toThrow(/不是受支持的图片格式/)
    expect(() => createAssetImport(store, importsRoot, localInput({ bytes: Buffer.from('MZ\x90\x00executable') })))
      .toThrow(/不是受支持的图片格式/)
    expect(listAssetImports(importsRoot)).toHaveLength(0)
  })

  it('CI-3 扩展名与实际格式不匹配拒绝：PNG 字节配 .jpg 路径', () => {
    const { store, importsRoot } = importFixture()
    expect(() => createAssetImport(store, importsRoot, localInput({ bytes: pngHeaderBytes() }))).toThrow(/不一致/)
    expect(() => createAssetImport(store, importsRoot, localInput({ bytes: pngHeaderBytes(), assetRef: '/media/x.png' }))).not.toThrow()
    expect(listAssetImports(importsRoot)).toHaveLength(1)
  })

  it('CI-4 暂存哈希丢失或篡改拒绝：追溯核对 fail-closed 且原因可区分', () => {
    const { store, importsRoot } = importFixture()
    const record = createAssetImport(store, importsRoot, localInput())
    // 暂存文件被删（丢失）
    removeTree(store.root)
    expect(() => verifyImportTraceability(store, record)).toThrow(/暂存资产缺失/)
    // 重建暂存区并写入错误字节（篡改：同名哈希目录下内容不符）
    fs.mkdirSync(path.join(store.root, record.stagedAssetHash.slice(0, 2)), { recursive: true })
    fs.writeFileSync(path.join(store.root, record.stagedAssetHash.slice(0, 2), record.stagedAssetHash), 'tampered-bytes')
    expect(() => store.readStagedAsset(record.stagedAssetHash)).toThrow(/字节与身份不匹配/)
    expect(() => verifyImportTraceability(store, record)).toThrow(/字节与身份不匹配/)
    // 记录文件本身被篡改（非法 JSON / schema 不符）
    const recordFile = path.join(importsRoot, `${record.importId}.json`)
    fs.writeFileSync(recordFile, '{"schema":"asset-import-record/v1","importId":"import-000000000000","stagedAssetHash":"bad"}')
    expect(() => readAssetImport(importsRoot, record.importId)).toThrow(AssetImportError)
  })

  it('CI-5 能力边界：格式头合法但完整文件不可解码的截断 JPEG——头识别放行、decodeGuarantee 显式 header-only', () => {
    const { store, importsRoot } = importFixture()
    const truncated = truncatedJpeg()
    expect(truncated.byteLength).toBeLessThan(realJpeg().byteLength)
    const record = createAssetImport(store, importsRoot, localInput({ bytes: truncated }))
    // 导入层只承诺格式头识别；记录显式声明不保证可解码，真实可解码性由浏览器 naturalWidth 证据兜底
    expect(record.format).toBe('jpeg')
    expect(record.validation.decodeGuarantee).toBe('header-only')
    expect(record.dimensions).toBeUndefined()   // 截断文件没有 SOF 段，尺寸解析如实缺省
    expect(() => verifyImportTraceability(store, record)).not.toThrow()
  })

  it('用户显式导入确认必填：缺失 confirmedBy 的隐式导入被拒绝', () => {
    const { store, importsRoot } = importFixture()
    expect(() => createAssetImport(store, importsRoot, localInput({ confirmedBy: '' }))).toThrow(/显式导入确认/)
    expect(() => createAssetImport(store, importsRoot, localInput({ confirmedBy: '   ' }))).toThrow(/显式导入确认/)
    expect(listAssetImports(importsRoot)).toHaveLength(0)
  })

  it('来源记录：external-url-reference 仅追溯不抓取，非法来源形态拒绝', () => {
    const { store, importsRoot } = importFixture()
    const record = createAssetImport(store, importsRoot, localInput({
      source: { kind: 'external-url-reference', value: PEXELS_URL },
      targetRef: 'media:src/data/products.ts#430',
    }))
    expect(record.source).toEqual({ kind: 'external-url-reference', value: PEXELS_URL })
    expect(record.targetRef).toBe('media:src/data/products.ts#430')
    expect(() => verifyImportTraceability(store, record)).not.toThrow()
    // 非 http/https 引用拒绝
    expect(() => createAssetImport(store, importsRoot, localInput({ source: { kind: 'external-url-reference', value: 'ftp://example.com/x.jpg' } }))).toThrow(/http\/https/)
    expect(() => createAssetImport(store, importsRoot, localInput({ source: { kind: 'local-file', value: '' } }))).toThrow(/原始素材描述/)
  })
})

describe('asset-import-record 与候选生命周期集成', () => {
  it('CI-6 未证明 PageImpact 拒绝候选：青野 B2 同形态（数据层字面量经属性映射）即使用户全量 Scope 也不豁免', () => {
    const { container, root } = mappedDataProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'media' && String(node.value).includes('39692059') && node.location)
    if (!target?.location) throw new Error('夹具需要 analyzer 产出数据层媒体节点')
    const { store } = importFixture()
    const bytes = webpHeaderBytes()
    const record = createAssetImport(store, temp(), {
      bytes, assetRef: '/media/imported-p1.webp',
      source: { kind: 'external-url-reference', value: 'https://cdn.example.invalid/p1.webp' },
      confirmedBy: 'test-user', targetRef: target.id,
    })
    const sourceSlice = fs.readFileSync(path.join(root, target.location.path), 'utf8').slice(target.location.start, target.location.end)
    const operation: MediaAssetSwapOperation = {
      id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
      before: sourceSlice, after: '/media/imported-p1.webp',
      payload: { assetRef: '/media/imported-p1.webp', assetHash: record.stagedAssetHash },
    }
    const pageRefs = graph.nodes.filter(node => node.id.startsWith('page:')).map(node => node.id)
    const scope: ScopeDecision = {
      id: 'full-user-scope', version: 1, strategy: 'shared',
      includedRefs: [target.id, ...pageRefs], excludedRefs: [], protectedRefs: [],
      decidedBy: 'test-user', decidedAt: new Date().toISOString(),
    }
    expect(() => createCandidate({
      projectRoot: root, candidateRoot: path.join(container, 'rejected-candidate'), artifactRoot: path.join(container, 'rejected-artifacts'),
      graph, scope, operations: [operation], executors: [mediaAssetSwapExecutor], readStagedAsset: store.readStagedAsset,
    })).toThrow(/无法证明目标的完整页面影响/)
  })

  it('CI-6 正例对照：导入记录关联的候选在可证明目标上创建成功，关联幂等且拒绝串改', () => {
    const { container, root } = sampleProject()
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'media' && node.value === '/images/hero.webp' && node.location)
    if (!target?.location) throw new Error('夹具媒体节点未命中')
    const { store, importsRoot } = importFixture()
    const bytes = webpHeaderBytes()
    const record = createAssetImport(store, importsRoot, {
      bytes, assetRef: '/media/imported-hero.webp',
      source: { kind: 'local-file', value: 'user-upload/hero.webp' },
      confirmedBy: 'test-user', targetRef: target.id,
    })
    const sourceSlice = fs.readFileSync(path.join(root, target.location.path), 'utf8').slice(target.location.start, target.location.end)
    const operation: MediaAssetSwapOperation = {
      id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
      before: sourceSlice, after: '/media/imported-hero.webp',
      payload: { assetRef: '/media/imported-hero.webp', assetHash: record.stagedAssetHash },
    }
    const scope: ScopeDecision = {
      id: 'media-scope', version: 1, includedRefs: [target.id, 'page:home'], excludedRefs: [], protectedRefs: [],
      decidedBy: 'test-user', decidedAt: new Date().toISOString(),
    }
    const candidate = createCandidate({
      projectRoot: root, candidateRoot: path.join(container, 'candidate'), artifactRoot: path.join(container, 'artifacts'),
      graph, scope, operations: [operation], executors: [mediaAssetSwapExecutor], readStagedAsset: store.readStagedAsset,
    })
    try {
      assertCandidateCurrent(candidate)
      expect(candidate.modifiedPaths).toContain('public/media/imported-hero.webp')
      const linked = attachImportToCandidate(store, importsRoot, record.importId, {
        candidateId: candidate.id, sourceRevision: candidate.baseSourceDigest, linkedBy: 'test-user',
      })
      expect(linked.candidateId).toBe(candidate.id)
      expect(linked.sourceRevision).toBe(candidate.baseSourceDigest)
      expect(linked.source.value).toBe('user-upload/hero.webp')   // 来源追溯保持
      // 幂等：同一组合重复登记
      expect(attachImportToCandidate(store, importsRoot, record.importId, {
        candidateId: candidate.id, sourceRevision: candidate.baseSourceDigest, linkedBy: 'test-user',
      }).candidateId).toBe(candidate.id)
      // 拒绝串改到其他候选
      expect(() => attachImportToCandidate(store, importsRoot, record.importId, {
        candidateId: 'candidate-other', sourceRevision: candidate.baseSourceDigest, linkedBy: 'test-user',
      })).toThrow(/拒绝改关联/)
    } finally { removeCandidate(candidate) }
  })

  it('CI-7 追溯一致性：原外链 URL ↔ 暂存哈希 ↔ 候选目标三方互查，记录字段级篡改即拒读', () => {
    const { store, importsRoot } = importFixture()
    const record = createAssetImport(store, importsRoot, localInput({
      source: { kind: 'external-url-reference', value: PEXELS_URL },
      targetRef: 'media:src/data/products.ts#430',
    }))
    // 三方一致：来源 URL 原样保留、暂存字节哈希可复核、目标可定位
    expect(record.source.value).toBe(PEXELS_URL)
    expect(() => verifyImportTraceability(store, record)).not.toThrow()
    const linked = attachImportToCandidate(store, importsRoot, record.importId, {
      candidateId: 'candidate-demo', sourceRevision: 'rev-demo', linkedBy: 'test-user',
    })
    expect(linked.source.value).toBe(PEXELS_URL)
    expect(JSON.stringify(linked)).toContain(PEXELS_URL)
    expect(() => readAssetImport(importsRoot, record.importId)).not.toThrow()  // 关联更新后完整性哈希已重算
    // 篡改来源 URL（字段级篡改）→ 完整性哈希校验拒读
    const recordFile = path.join(importsRoot, `${record.importId}.json`)
    const tampered = JSON.parse(fs.readFileSync(recordFile, 'utf8')) as AssetImportRecord
    tampered.source = { kind: 'external-url-reference', value: 'https://evil.example.invalid/x.jpg' }
    fs.writeFileSync(recordFile, JSON.stringify(tampered, null, 2))
    expect(() => readAssetImport(importsRoot, record.importId)).toThrow(/完整性校验失败/)
    // 篡改字节侧 → 追溯核对拒（字节与身份不匹配）
    const record2 = createAssetImport(store, importsRoot, {
      bytes: pngHeaderBytes(), assetRef: '/media/another.png',
      source: { kind: 'local-file', value: 'another-upload.png' },
      confirmedBy: 'test-user',
    })
    expect(record2.format).toBe('png')
    const stagedFile = path.join(store.root, record2.stagedAssetHash.slice(0, 2), record2.stagedAssetHash)
    fs.writeFileSync(stagedFile, 'tampered')
    expect(() => verifyImportTraceability(store, record2)).toThrow(/字节与身份不匹配/)
  })

  it('CI-8 失败路径不修改原项目：非法导入与拒绝候选后工程 digest 不变、无资产残留', () => {
    const { container, root } = sampleProject()
    const digestBefore = digestTrackedTree(root)
    const { store, importsRoot } = importFixture()
    // 三种导入失败：头不匹配 / 扩展名不符 / 缺确认
    expect(() => createAssetImport(store, importsRoot, localInput({ bytes: Buffer.from('<html></html>') }))).toThrow()
    expect(() => createAssetImport(store, importsRoot, localInput({ bytes: pngHeaderBytes() }))).toThrow()
    expect(() => createAssetImport(store, importsRoot, localInput({ confirmedBy: '' }))).toThrow()
    // 候选被拒绝（scope 不含目标）也不产生候选树
    const graph = analyzeProject(root)
    const target = graph.nodes.find(node => node.kind === 'media' && node.value === '/images/hero.webp' && node.location)
    if (!target?.location) throw new Error('夹具媒体节点未命中')
    const record = createAssetImport(store, importsRoot, {
      bytes: webpHeaderBytes(), assetRef: '/media/imported-hero.webp',
      source: { kind: 'local-file', value: 'user-upload/hero.webp' },
      confirmedBy: 'test-user', targetRef: target.id,
    })
    const sourceSlice = fs.readFileSync(path.join(root, target.location.path), 'utf8').slice(target.location.start, target.location.end)
    const operation: MediaAssetSwapOperation = {
      id: 'media-swap', kind: 'MEDIA', action: 'asset-swap', targetRef: target.id,
      before: sourceSlice, after: '/media/imported-hero.webp',
      payload: { assetRef: '/media/imported-hero.webp', assetHash: record.stagedAssetHash },
    }
    const badScope: ScopeDecision = {
      id: 'bad-scope', version: 1, includedRefs: ['page:home'], excludedRefs: [], protectedRefs: [],
      decidedBy: 'test-user', decidedAt: new Date().toISOString(),
    }
    expect(() => createCandidate({
      projectRoot: root, candidateRoot: path.join(container, 'rejected'), artifactRoot: path.join(container, 'rejected-artifacts'),
      graph, scope: badScope, operations: [operation], executors: [mediaAssetSwapExecutor], readStagedAsset: store.readStagedAsset,
    })).toThrow(/Scope 不允许修改目标/)
    expect(fs.existsSync(path.join(container, 'rejected'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'public', 'media', 'imported-hero.webp'))).toBe(false)
    expect(digestTrackedTree(root)).toBe(digestBefore)
  })
})
