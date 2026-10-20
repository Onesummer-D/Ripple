import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EditOperation, SourceGraph, SourceNode } from './model'
import { resolveAssetRefToRelativePath, stageMediaAsset, verifyStagedMediaAsset, MediaAssetStagingError } from './media-asset-staging'
import { applyEditsToFile, applyMediaAssetSwapOperations, planMediaAssetSwap, MediaAssetSwapError, type MediaAssetSwapContext } from './media-asset-swap'

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

const HERO_SOURCE = `export function Hero() {
  return <img src="/images/hero.jpg" alt="hero" />
}
`

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ripple-media-swap-${randomUUID()}-`))
}

function writeFixture(root: string, sourceText: string = HERO_SOURCE): { file: string; node: SourceNode } {
  const file = 'src/components/Hero.tsx'
  const absolute = path.join(root, file)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, sourceText, 'utf8')
  const start = sourceText.indexOf('"/images/hero.jpg"')
  const node: SourceNode = {
    id: 'media:hero',
    kind: 'media',
    label: '/images/hero.jpg',
    location: { path: file, start, end: start + '"/images/hero.jpg"'.length },
  }
  return { file, node }
}

function makeGraph(node: SourceNode): SourceGraph {
  return {
    id: 'graph-1',
    revision: { projectId: 'p1', sourceDigest: 'd', gitCommit: 'c', runtimeFingerprint: 'f' },
    nodes: [node],
    edges: [],
    unresolved: [],
  }
}

type MediaSwapOverrides = Partial<Extract<EditOperation, { kind: 'MEDIA' }>>

function swapOperation(overrides: MediaSwapOverrides = {}): EditOperation {
  return {
    id: 'op-1',
    kind: 'MEDIA',
    action: 'asset-swap',
    targetRef: 'media:hero',
    before: '"/images/hero.jpg"',
    after: '"/images/hero-v2.jpg"',
    payload: { assetRef: '/images/hero-v2.jpg', assetHash: sha256('new-hero-bytes') },
    ...overrides,
  } as EditOperation
}

describe('media-asset-staging', () => {
  let root: string
  let bytesRoot: string
  beforeEach(() => { root = makeTempRoot(); bytesRoot = makeTempRoot() })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(bytesRoot, { recursive: true, force: true }) })

  it('resolveAssetRefToRelativePath：/ 开头进 public，相对引用按消费文件解析，外部 URL 拒绝', () => {
    expect(resolveAssetRefToRelativePath('/images/a.jpg', 'src/components/Hero.tsx')).toBe(path.posix.join('public', 'images/a.jpg'))
    expect(resolveAssetRefToRelativePath('./a.jpg', 'src/components/Hero.tsx')).toBe('src/components/a.jpg')
    expect(resolveAssetRefToRelativePath('../assets/a.jpg', 'src/components/Hero.tsx')).toBe('src/assets/a.jpg')
    expect(() => resolveAssetRefToRelativePath('https://cdn.example.com/a.jpg', 'src/x.tsx')).toThrow(MediaAssetStagingError)
    expect(() => resolveAssetRefToRelativePath('../../../etc/passwd.jpg', 'src/x.tsx')).toThrow(MediaAssetStagingError)
  })

  it('stageMediaAsset：哈希一致才暂存，可复核，拒绝覆盖', () => {
    const source = path.join(bytesRoot, 'hero-v2.jpg')
    fs.writeFileSync(source, 'new-hero-bytes')
    const staged = stageMediaAsset(root, path.posix.join('public', 'images/hero-v2.jpg'), source, sha256('new-hero-bytes'))
    expect(staged.sha256).toBe(sha256('new-hero-bytes'))
    expect(fs.existsSync(path.join(root, 'public', 'images', 'hero-v2.jpg'))).toBe(true)
    const verified = verifyStagedMediaAsset(root, staged.relativePath, staged.sha256)
    expect(verified.bytes).toBe('new-hero-bytes'.length)
    expect(() => stageMediaAsset(root, staged.relativePath, source, staged.sha256)).toThrow(/已存在/)
  })

  it('stageMediaAsset：哈希不匹配拒绝且不落盘（fail-closed）', () => {
    const source = path.join(bytesRoot, 'hero-v2.jpg')
    fs.writeFileSync(source, 'tampered-bytes')
    expect(() => stageMediaAsset(root, 'public/images/hero-v2.jpg', source, sha256('new-hero-bytes'))).toThrow(MediaAssetStagingError)
    expect(fs.existsSync(path.join(root, 'public', 'images', 'hero-v2.jpg'))).toBe(false)
  })

  it('verifyStagedMediaAsset：字节被改动后复核失败', () => {
    const source = path.join(bytesRoot, 'hero-v2.jpg')
    fs.writeFileSync(source, 'new-hero-bytes')
    const staged = stageMediaAsset(root, 'public/images/hero-v2.jpg', source, sha256('new-hero-bytes'))
    fs.writeFileSync(path.join(root, staged.relativePath), 'tampered')
    expect(() => verifyStagedMediaAsset(root, staged.relativePath, staged.sha256)).toThrow(MediaAssetStagingError)
  })
})

describe('media-asset-swap', () => {
  let root: string
  let bytesRoot: string
  let context: MediaAssetSwapContext
  let node: SourceNode
  beforeEach(() => {
    root = makeTempRoot()
    bytesRoot = makeTempRoot()
    node = writeFixture(root).node
    context = { candidateRoot: root, graph: makeGraph(node), nodes: new Map([[node.id, node]]), assetBytes: {} }
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(bytesRoot, { recursive: true, force: true }) })

  let bytesCounter = 0
  const provideBytes = (assetRef: string, content: string) => {
    const source = path.join(bytesRoot, `asset-${bytesCounter++}.bin`)
    fs.writeFileSync(source, content)
    context.assetBytes[assetRef] = source
  }

  it('替换 src 引用并暂存字节，返回源码与资产路径', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    const modified = applyMediaAssetSwapOperations(context, [swapOperation()])
    const updated = fs.readFileSync(path.join(root, 'src/components/Hero.tsx'), 'utf8')
    expect(updated).toContain('src="/images/hero-v2.jpg"')
    expect(updated).not.toContain('hero.jpg" alt')
    expect(modified).toContain('src/components/Hero.tsx')
    expect(modified).toContain(path.posix.join('public', 'images/hero-v2.jpg'))
  })

  it('operation.before 与源内容不一致时拒绝，且不暂存', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    const stale = swapOperation({ before: '"/images/old.jpg"' } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [stale])).toThrow(MediaAssetSwapError)
    expect(fs.existsSync(path.join(root, 'public', 'images', 'hero-v2.jpg'))).toBe(false)
  })

  it('缺少字节源或哈希不匹配时拒绝', () => {
    expect(() => applyMediaAssetSwapOperations(context, [swapOperation()])).toThrow(/资产字节源/)
    provideBytes('/images/hero-v2.jpg', 'tampered')
    expect(() => applyMediaAssetSwapOperations(context, [swapOperation()])).toThrow(MediaAssetStagingError)
  })

  it('srcset variant：同一 JSX 元素追加 srcSet，并暂存 variant 字节', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    provideBytes('/images/hero-small.jpg', 'small-bytes')
    const operation = swapOperation({
      after: '"/images/hero-v2.jpg"',
      payload: {
        assetRef: '/images/hero-v2.jpg',
        assetHash: sha256('new-hero-bytes'),
        focalPoint: { x: 0.5, y: 0.4 },
        variants: [{ mechanism: 'srcset', condition: '768w', assetRef: '/images/hero-small.jpg', assetHash: sha256('small-bytes') }],
      },
    } as MediaSwapOverrides)
    const modified = applyMediaAssetSwapOperations(context, [operation])
    const updated = fs.readFileSync(path.join(root, 'src/components/Hero.tsx'), 'utf8')
    expect(updated).toContain(`srcSet="/images/hero-small.jpg 768w"`)
    expect(updated.indexOf('srcSet')).toBeGreaterThan(updated.indexOf('src='))
    expect(modified).toContain(path.posix.join('public', 'images/hero-small.jpg'))
  })

  it('srcset variant：已有 srcSet 被替换而不是重复追加', () => {
    const withSrcset = `export function Hero() {
  return <img src="/images/hero.jpg" srcSet="/images/legacy.jpg 320w" alt="hero" />
}
`
    node = writeFixture(root, withSrcset).node
    context.nodes = new Map([[node.id, node]])
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    provideBytes('/images/hero-small.jpg', 'small-bytes')
    const operation = swapOperation({
      payload: {
        assetRef: '/images/hero-v2.jpg',
        assetHash: sha256('new-hero-bytes'),
        variants: [{ mechanism: 'srcset', condition: '768w', assetRef: '/images/hero-small.jpg', assetHash: sha256('small-bytes') }],
      },
    } as MediaSwapOverrides)
    applyMediaAssetSwapOperations(context, [operation])
    const updated = fs.readFileSync(path.join(root, 'src/components/Hero.tsx'), 'utf8')
    expect(updated).toContain(`srcSet="/images/hero-small.jpg 768w"`)
    expect(updated).not.toContain('legacy.jpg')
    expect(updated.match(/srcSet=/g)).toHaveLength(1)
  })

  it('不支持的 variant mechanism（css/container-rule/picture）显式拒绝', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    provideBytes('/images/hero-dark.jpg', 'dark-bytes')
    const operation = swapOperation({
      payload: {
        assetRef: '/images/hero-v2.jpg',
        assetHash: sha256('new-hero-bytes'),
        variants: [{ mechanism: 'css', condition: 'prefers-color-scheme: dark', assetRef: '/images/hero-dark.jpg', assetHash: sha256('dark-bytes') }],
      },
    } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [operation])).toThrow(/暂不支持的 variant mechanism/)
  })

  it('operation.after 与执行器计算结果不一致时拒绝（保持操作记录真实）', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    const operation = swapOperation({ after: '"/images/something-else.jpg"' } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [operation])).toThrow(/operation\.after/)
  })

  it('编辑结果通过 TSX 语法检查', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    const planned = planMediaAssetSwap(swapOperation(), node, context)
    expect(planned.edits).toHaveLength(1)
    const updated = fs.readFileSync(path.join(root, 'src/components/Hero.tsx'), 'utf8')
    const broken = planned.edits.map(edit => ({ ...edit, replacement: '{' }))
    expect(() => applyEditsToFile(path.join(root, 'src/components/Hero.tsx'), 'src/components/Hero.tsx', broken)).toThrow(/语法错误/)
    expect(fs.readFileSync(path.join(root, 'src/components/Hero.tsx'), 'utf8')).toBe(updated)
  })

  it('assetRef 含引号/空格等不安全字符时拒绝（防 JSX 属性注入）', () => {
    const evilRef = '/a.jpg" data-evil="1'
    provideBytes(evilRef, 'evil-bytes')
    const operation = swapOperation({
      after: '"&#x2f;a.jpg" data-evil="1"',
      payload: { assetRef: evilRef, assetHash: sha256('evil-bytes') },
    } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [operation])).toThrow(/不安全字符/)
    expect(fs.readFileSync(path.join(root, 'src/components/Hero.tsx'), 'utf8')).toBe(HERO_SOURCE)
  })

  it('/ 开头 assetRef 中的 .. 段在折叠前拒绝（不依赖 normalize 后检查）', () => {
    const sneakyRef = '/../src/App.tsx'
    provideBytes(sneakyRef, 'sneaky-bytes')
    const operation = swapOperation({
      after: '"/../src/App.tsx"',
      payload: { assetRef: sneakyRef, assetHash: sha256('sneaky-bytes') },
    } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [operation])).toThrow(MediaAssetStagingError)
    expect(fs.existsSync(path.join(root, 'src', 'App.tsx'))).toBe(false)
  })

  it('非 JSX 消费文件带 srcset variant：显式拒绝且不暂存任何字节', () => {
    const tsFile = 'src/data/banner.ts'
    const sourceText = `export const banner = { src: "/images/hero.jpg" }\n`
    const absolute = path.join(root, tsFile)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, sourceText, 'utf8')
    const start = sourceText.indexOf('"/images/hero.jpg"')
    const tsNode: SourceNode = {
      id: 'media:banner', kind: 'media', label: '/images/hero.jpg',
      location: { path: tsFile, start, end: start + '"/images/hero.jpg"'.length },
    }
    context.nodes = new Map([[tsNode.id, tsNode]])
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    provideBytes('/images/hero-small.jpg', 'small-bytes')
    const operation = swapOperation({
      targetRef: 'media:banner',
      payload: {
        assetRef: '/images/hero-v2.jpg',
        assetHash: sha256('new-hero-bytes'),
        variants: [{ mechanism: 'srcset', condition: '768w', assetRef: '/images/hero-small.jpg', assetHash: sha256('small-bytes') }],
      },
    } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [operation])).toThrow(/找不到 src 属性所在的 JSX 元素/)
    expect(fs.existsSync(path.join(root, 'public', 'images', 'hero-v2.jpg'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'public', 'images', 'hero-small.jpg'))).toBe(false)
  })

  it('批次中后序操作失败时，先序操作的暂存字节保留、由调用方整体丢弃 worktree', () => {
    provideBytes('/images/hero-v2.jpg', 'new-hero-bytes')
    const secondNode: SourceNode = {
      id: 'media:other', kind: 'media', label: '/images/other.jpg',
      location: { path: 'src/components/Other.tsx', start: 10, end: 28 },
    }
    context.nodes.set(secondNode.id, secondNode)
    const stale = swapOperation({ id: 'op-2', targetRef: 'media:other', before: '"/images/stale.jpg"' } as MediaSwapOverrides)
    expect(() => applyMediaAssetSwapOperations(context, [swapOperation(), stale])).toThrow(MediaAssetSwapError)
    // op-1 的字节已暂存（文档化行为：失败即整体丢弃候选 worktree，不单独清理）
    expect(fs.existsSync(path.join(root, 'public', 'images', 'hero-v2.jpg'))).toBe(true)
  })
})
