import { describe, expect, it } from 'vitest'
import { clusterChangedPixels, diffPixels, DIFF_IMAGE_LEGEND, MASK_ANTIALIASED, MASK_CHANGED, renderDiffImage, VisualResourceLimitError, type PixelDiffParameters } from './visual-diff'

const params: PixelDiffParameters = { threshold: 0.03, includeAA: false, mergeDistancePx: 4 }

function canvas(width: number, height: number, background: [number, number, number] = [255, 255, 255]) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...background, 255], i)
  const fill = (x: number, y: number, w: number, h: number, color: [number, number, number]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set([...color, 255], (yy * width + xx) * 4)
  }
  return { data, fill }
}

describe('pixel diff', () => {
  it('reports zero change for identical images', () => {
    const a = canvas(20, 10); a.fill(3, 3, 5, 4, [0, 0, 0])
    const result = diffPixels(a.data, new Uint8Array(a.data), 20, 10, params)
    expect(result).toMatchObject({ totalPixels: 200, changedPixels: 0, antialiasedPixels: 0, regions: [] })
  })

  it('reports one region with an exact bounding box', () => {
    const a = canvas(30, 20), b = canvas(30, 20)
    b.fill(5, 6, 7, 3, [220, 0, 0])
    const result = diffPixels(a.data, b.data, 30, 20, params)
    expect(result.changedPixels).toBe(21)
    expect(result.regions).toEqual([{ index: 0, bbox: { x: 5, y: 6, width: 7, height: 3 }, changedPixels: 21 }])
    expect(result.regionOfPixel(6 * 30 + 5)).toBe(0)
    expect(result.regionOfPixel(0)).toBe(-1)
  })

  it('separates distant changes into regions ordered top-to-bottom, left-to-right', () => {
    const a = canvas(60, 40), b = canvas(60, 40)
    b.fill(40, 2, 3, 3, [0, 0, 0])
    b.fill(2, 2, 3, 3, [0, 0, 0])
    b.fill(10, 30, 4, 4, [0, 0, 0])
    const result = diffPixels(a.data, b.data, 60, 40, params)
    expect(result.regions.map(region => region.bbox)).toEqual([
      { x: 2, y: 2, width: 3, height: 3 },
      { x: 40, y: 2, width: 3, height: 3 },
      { x: 10, y: 30, width: 4, height: 4 },
    ])
    expect(result.regions.map(region => region.changedPixels)).toEqual([9, 9, 16])
  })

  it('merges pixels within the merge distance and keeps pixels 2× apart separate', () => {
    const g = 4
    const mask = (points: Array<[number, number]>) => { const m = new Uint8Array(40 * 8); for (const [x, y] of points) m[y * 40 + x] = MASK_CHANGED; return m }
    // Chebyshev distance exactly g: always merged, wherever the grid falls.
    for (const start of [0, 1, 2, 3]) expect(clusterChangedPixels(mask([[start, 1], [start + g, 1]]), 40, 8, g).regions).toHaveLength(1)
    // Distance 2g: never merged directly.
    for (const start of [0, 1, 2, 3]) expect(clusterChangedPixels(mask([[start, 1], [start + 2 * g, 1]]), 40, 8, g).regions).toHaveLength(2)
    // A chain of nearby pixels merges transitively.
    expect(clusterChangedPixels(mask([[0, 0], [4, 0], [8, 0], [12, 0]]), 40, 8, g).regions).toHaveLength(1)
  })

  it('excludes anti-aliasing noise unless includeAA is set', () => {
    // A crisp black block versus the same block with one 50 % coverage column on its right edge.
    const a = canvas(40, 30), b = canvas(40, 30)
    a.fill(10, 8, 10, 14, [0, 0, 0])
    b.fill(10, 8, 10, 14, [0, 0, 0])
    b.fill(20, 8, 1, 14, [128, 128, 128])
    const excluded = diffPixels(a.data, b.data, 40, 30, params)
    expect(excluded).toMatchObject({ changedPixels: 0, antialiasedPixels: 14, regions: [] })
    expect(excluded.mask.filter(value => value === MASK_ANTIALIASED)).toHaveLength(14)
    const included = diffPixels(a.data, b.data, 40, 30, { ...params, includeAA: true })
    expect(included).toMatchObject({ changedPixels: 14, antialiasedPixels: 0 })
    expect(included.regions).toHaveLength(1)
  })

  it('applies the documented default sensitivity: one palette step counts, a near-white tint does not', () => {
    const pair = (from: [number, number, number], to: [number, number, number]) => {
      const a = canvas(8, 8, from), b = canvas(8, 8, to)
      return diffPixels(a.data, b.data, 8, 8, params).changedPixels
    }
    expect(pair([37, 99, 235], [29, 78, 216])).toBe(64) // Tailwind blue-600 → blue-700
    expect(pair([255, 255, 255], [240, 240, 240])).toBe(64)
    expect(pair([226, 232, 240], [254, 226, 226])).toBe(64) // slate-200 → red-100
    expect(pair([255, 255, 255], [250, 250, 250])).toBe(0)
  })

  it('validates its inputs', () => {
    const a = canvas(4, 4)
    expect(() => diffPixels(a.data, new Uint8Array(4 * 4 * 4 - 4), 4, 4, params)).toThrow(RangeError)
    expect(() => diffPixels(a.data, a.data, 4, 4, { ...params, threshold: 2 })).toThrow(RangeError)
    expect(() => diffPixels(a.data, a.data, 4, 4, { ...params, mergeDistancePx: 0 })).toThrow(RangeError)
  })

  it('rejects excessive merge grids and component explosions deterministically', () => {
    const oversized = new Uint8Array(2_250_000)
    expect(() => clusterChangedPixels(oversized, 1500, 1500, 1)).toThrow(VisualResourceLimitError)
    const width = 1001, height = 405
    const speckles = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) speckles[y * width + x] = MASK_CHANGED
    expect(() => clusterChangedPixels(speckles, width, height, 1)).toThrow(VisualResourceLimitError)
    const rgba = new Uint8Array(2_250_000 * 4)
    expect(() => diffPixels(rgba, rgba, 1500, 1500, { ...params, mergeDistancePx: 1 })).toThrow(VisualResourceLimitError)
    expect(() => renderDiffImage(new Uint8Array(12_000_001 * 4), new Uint8Array(12_000_001), 12_000_001, 1, [])).toThrow(VisualResourceLimitError)
  })

  it('renders changed, anti-aliased and outline pixels in the legend colours', () => {
    const base = canvas(12, 12)
    const mask = new Uint8Array(144)
    mask[5 * 12 + 5] = MASK_CHANGED
    mask[5 * 12 + 6] = MASK_ANTIALIASED
    const out = renderDiffImage(base.data, mask, 12, 12, [{ rect: { x: 5, y: 5, width: 1, height: 1 }, color: [1, 2, 3] }])
    const at = (x: number, y: number) => Array.from(out.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 4))
    expect(at(5, 5)).toEqual([...DIFF_IMAGE_LEGEND.changed, 255])
    expect(at(6, 5)).toEqual([...DIFF_IMAGE_LEGEND.antialiased, 255])
    expect(at(3, 3)).toEqual([1, 2, 3, 255]) // outline sits 2 px outside the box
    expect(at(0, 0)).toEqual([255, 255, 255, 255])
  })
})
