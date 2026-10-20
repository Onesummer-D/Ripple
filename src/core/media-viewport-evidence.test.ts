import { describe, expect, it } from 'vitest'
import {
  assertMediaViewportObservation,
  assetUrlMatches,
  buildMediaViewportEvidenceReport,
  computeCropGeometry,
  mediaEvidenceSummary,
  mediaViewportEvidenceSha256,
  MediaViewportEvidenceError,
  type MediaViewportObservation,
} from './media-viewport-evidence'

function observation(overrides: Partial<MediaViewportObservation> = {}): MediaViewportObservation {
  return {
    viewport: { name: 'desktop', width: 1440, height: 900 },
    pageUrl: 'http://preview:5173/',
    selector: 'main img[alt="hero"]',
    assetRef: '/media/hero-new.webp',
    currentSrc: 'http://preview:5173/media/hero-new.webp',
    loaded: true,
    naturalWidth: 1600,
    naturalHeight: 900,
    renderedBox: { x: 0, y: 100, width: 800, height: 450 },
    objectFit: 'cover',
    objectPosition: '50% 50%',
    errors: [],
    ...overrides,
  }
}

const FOUR = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
]

function observationsAcross(set: Partial<MediaViewportObservation> = {}): MediaViewportObservation[] {
  return FOUR.map(viewport => observation({ viewport, ...set }))
}

describe('assetUrlMatches', () => {
  it('相对 assetRef：规范化比较 pathname+search，容忍 origin 差异', () => {
    expect(assetUrlMatches('http://127.0.0.1:4619/media/x.jpeg', '/media/x.jpeg')).toBe(true)
    expect(assetUrlMatches('https://cdn.example.com/media/x.jpeg?w=100', '/media/x.jpeg?w=100')).toBe(true)
    expect(assetUrlMatches('http://127.0.0.1:4619/media/x.jpeg?w=100', '/media/x.jpeg')).toBe(false)
  })

  it('绝对 assetRef：origin 也必须一致', () => {
    expect(assetUrlMatches('https://images.pexels.com/photos/1/a.jpeg?h=100', 'https://images.pexels.com/photos/1/a.jpeg?h=100')).toBe(true)
    expect(assetUrlMatches('https://cdn.mirror.com/photos/1/a.jpeg?h=100', 'https://images.pexels.com/photos/1/a.jpeg?h=100')).toBe(false)
  })

  it('负例：相似前缀/后缀名不得子串误判', () => {
    expect(assetUrlMatches('http://127.0.0.1:4619/media/x.jpeg.bak', '/media/x.jpeg')).toBe(false)
    expect(assetUrlMatches('http://127.0.0.1:4619/media/x.jpeg2', '/media/x.jpeg')).toBe(false)
    expect(assetUrlMatches('http://127.0.0.1:4619/media/x.jpeg/extra', '/media/x.jpeg')).toBe(false)
    expect(assetUrlMatches('http://127.0.0.1:4619/media/xy.jpeg', '/media/x.jpeg')).toBe(false)
    expect(assetUrlMatches('', '/media/x.jpeg')).toBe(false)
    expect(assetUrlMatches('not a url', '/media/x.jpeg')).toBe(false)
  })
})

describe('computeCropGeometry', () => {
  it('cover 横向盒：整宽可见、上下裁切，比例与焦点位置正确', () => {
    // natural 1600x900（16:9），盒 800x450（同比例）：无裁切
    const geometry = computeCropGeometry(observation())
    expect(geometry.scaleMode).toBe('cover')
    expect(geometry.scale).toBeCloseTo(0.5)
    expect(geometry.visibleSourceRect).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
    // 焦点默认不在场
    expect(geometry.focalVisible).toBe('not-applied')
  })

  it('cover 纵向盒：按宽度缩放、纵向裁切，焦点在窗口内/外可判定', () => {
    // natural 1600x900，盒 400x900（纵向）：scale = max(400/1600, 900/900) = 1 → 可见 400x900 源窗口
    const narrow = observation({ renderedBox: { x: 0, y: 0, width: 400, height: 900 } })
    const geometry = computeCropGeometry(narrow)
    expect(geometry.scale).toBeCloseTo(1)
    expect(geometry.visibleSourceRect.x).toBeCloseTo(600)
    expect(geometry.visibleSourceRect.width).toBeCloseTo(400)
    expect(geometry.visibleSourceRect.height).toBeCloseTo(900)
    // 默认 50% 居中：窗口 [600,1000]，焦点 x=0.5 → 800 在内；x=0.25 → 400 在外
    expect(computeCropGeometry(narrow, { x: 0.5, y: 0.5 }).focalVisible).toBe(true)
    expect(computeCropGeometry(narrow, { x: 0.25, y: 0.5 }).focalVisible).toBe(false)
    // object-position 左移窗口后 0.25 变为可见
    const shifted = observation({ renderedBox: { x: 0, y: 0, width: 400, height: 900 }, objectPosition: '0% 50%' })
    expect(computeCropGeometry(shifted, { x: 0.25, y: 0.5 }).focalVisible).toBe(true)
  })

  it('object-position 百分比与像素值都能定位窗口（像素为绝对偏移，不钳制）', () => {
    const base = observation({ renderedBox: { x: 0, y: 0, width: 400, height: 900 } })
    const byPercent = computeCropGeometry({ ...base, objectPosition: '25% 50%' })
    // offset = (400-1600)*0.25 = -300 → 窗口 x = 300
    expect(byPercent.visibleSourceRect.x).toBeCloseTo(300)
    // CSS object-position 长度值 = 从左上角的绝对偏移（同 background-position），
    // 允许负值与溢出，不做钳制；已与真实 Chromium 渲染核对（offset=+100 → 窗口 x=-100）
    const byPx = computeCropGeometry({ ...base, objectPosition: '100px 0px' })
    expect(byPx.visibleSourceRect.x).toBeCloseTo(-100)
    const negativePx = computeCropGeometry({ ...base, objectPosition: '-100px 0px' })
    expect(negativePx.visibleSourceRect.x).toBeCloseTo(100)
  })

  it('contain：整图可见，窗口即完整源图', () => {
    const boxed = observation({ objectFit: 'contain', renderedBox: { x: 0, y: 0, width: 400, height: 900 } })
    const geometry = computeCropGeometry(boxed)
    expect(geometry.scaleMode).toBe('contain')
    expect(geometry.scale).toBeCloseTo(0.25)
    expect(geometry.visibleSourceRect).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
    expect(computeCropGeometry(boxed, { x: 0.1, y: 0.9 }).focalVisible).toBe(true)
  })

  it('不支持的 object-fit 如实记录 unknown 语义，不做几何猜测', () => {
    const geometry = computeCropGeometry(observation({ objectFit: 'fill' }), { x: 0.5, y: 0.5 })
    expect(geometry.scaleMode).toBe('unsupported-fit')
    expect(Number.isNaN(geometry.scale)).toBe(true)
    expect(geometry.focalVisible).toBe('not-applied')
  })

  it('无效观测（natural 或盒为 0）抛错，不产生假几何', () => {
    expect(() => computeCropGeometry(observation({ naturalWidth: 0 }))).toThrow(MediaViewportEvidenceError)
    expect(() => computeCropGeometry(observation({ renderedBox: { x: 0, y: 0, width: 0, height: 0 } }))).toThrow(MediaViewportEvidenceError)
  })
})

describe('assertMediaViewportObservation', () => {
  it('加载成功且替换命中：全部 pass', () => {
    const obs = observation()
    const assertions = assertMediaViewportObservation(obs, computeCropGeometry(obs))
    expect(assertions.every(assertion => assertion.result === 'pass')).toBe(true)
  })

  it('未加载 / 未替换 / 浏览器错误分别 failed，且报告仍能生成（几何记 not-loaded）', () => {
    const unloaded = observation({ loaded: false, naturalWidth: 0, naturalHeight: 0, renderedBox: { x: 0, y: 0, width: 10, height: 10 }, errors: ['net::ERR_ABORTED'] })
    const report = buildMediaViewportEvidenceReport({
      browser: { name: 'chromium' },
      candidate: { candidateId: 'c', baseSourceDigest: 'b'.repeat(64), patchHash: 'p'.repeat(64), candidateTreeDigest: 't'.repeat(64) },
      targetRef: 'media:hero',
      observations: [unloaded, ...observationsAcross().slice(1)],
    })
    const failed = report.observations[0]
    const byId = Object.fromEntries(failed.assertions.map(assertion => [assertion.id, assertion.result]))
    expect(byId['media-loaded']).toBe('failed')
    expect(byId['media-crop-geometry']).toBe('failed')
    expect(byId['media-browser-errors']).toBe('failed')
    expect(failed.geometry.scaleMode).toBe('not-loaded')
    expect(mediaEvidenceSummary(report)).toBe('failed')

    const wrongSrc = observation({ currentSrc: 'http://preview:5173/images/hero-old.webp' })
    const srcAssertions = assertMediaViewportObservation(wrongSrc, computeCropGeometry(wrongSrc))
    expect(srcAssertions.find(assertion => assertion.id === 'media-source-swapped')?.result).toBe('failed')
  })

  it('焦点被裁切时 media-focal-visible 为 failed', () => {
    const narrow = observation({ renderedBox: { x: 0, y: 0, width: 400, height: 900 } })
    const geometry = computeCropGeometry(narrow, { x: 0.25, y: 0.5 })
    const assertions = assertMediaViewportObservation(narrow, geometry, { x: 0.25, y: 0.5 })
    expect(assertions.find(assertion => assertion.id === 'media-focal-visible')?.result).toBe('failed')
  })
})

describe('buildMediaViewportEvidenceReport', () => {
  const candidate = { candidateId: 'candidate-1', baseSourceDigest: 'b'.repeat(64), patchHash: 'p'.repeat(64), candidateTreeDigest: 't'.repeat(64) }

  it('四视口齐全才能生成报告，且版本身份完整绑定', () => {
    const report = buildMediaViewportEvidenceReport({
      browser: { name: 'chromium', version: '1.64.0' },
      candidate, targetRef: 'media:hero',
      focalPoint: { x: 0.5, y: 0.5 },
      containerHint: { selector: 'main img[alt="hero"]', aspect: 16 / 9 },
      observations: observationsAcross(),
    })
    expect(report.schemaVersion).toBe('ripple-media-viewport-evidence/v1')
    expect(report.observations).toHaveLength(4)
    expect(report.candidate).toEqual(candidate)
    expect(mediaEvidenceSummary(report)).toBe('pass')
  })

  it('缺少视口拒绝生成（不静默降级）', () => {
    expect(() => buildMediaViewportEvidenceReport({
      browser: { name: 'chromium' }, candidate, targetRef: 'media:hero',
      observations: observationsAcross().slice(0, 3),
    })).toThrow(/缺少视口观测/)
  })

  it('summary：任一 failed → failed；仅 unknown → risks', () => {
    const failing = buildMediaViewportEvidenceReport({
      browser: { name: 'chromium' }, candidate, targetRef: 'media:hero',
      observations: observationsAcross({ loaded: false, naturalWidth: 0, naturalHeight: 0, renderedBox: { x: 0, y: 0, width: 10, height: 10 }, errors: ['boom'] }),
    })
    expect(mediaEvidenceSummary(failing)).toBe('failed')
    const unknownFit = buildMediaViewportEvidenceReport({
      browser: { name: 'chromium' }, candidate, targetRef: 'media:hero', focalPoint: { x: 0.5, y: 0.5 },
      observations: observationsAcross({ objectFit: 'fill' }),
    })
    expect(mediaEvidenceSummary(unknownFit)).toBe('risks')
  })

  it('报告哈希随版本身份变化（Evidence 与候选 SHA 绑定）', () => {
    const base = buildMediaViewportEvidenceReport({ browser: { name: 'chromium' }, candidate, targetRef: 'media:hero', observations: observationsAcross() })
    const other = buildMediaViewportEvidenceReport({
      browser: { name: 'chromium' },
      candidate: { ...candidate, patchHash: 'q'.repeat(64) },
      targetRef: 'media:hero',
      observations: observationsAcross(),
    })
    expect(mediaViewportEvidenceSha256(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(mediaViewportEvidenceSha256(base)).not.toBe(mediaViewportEvidenceSha256(other))
  })
})
