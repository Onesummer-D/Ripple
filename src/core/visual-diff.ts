// Pixel-level comparison and change-region extraction for visual evidence.
//
// Pixel classification is delegated to pixelmatch 8 (ISC; OKLab HyAB colour
// distance with anti-aliasing detection). This module only turns its per-pixel
// verdicts into a mask, merges nearby changed pixels into explainable regions
// and renders a reviewable diff image. It draws no conclusions about intent or
// risk; see visual-evidence.ts for the evidence semantics.
import pixelmatch from 'pixelmatch'

/** Integer device-pixel rectangle in screenshot coordinates, half-open: [x, x + width) × [y, y + height). */
export interface PixelRect { x: number; y: number; width: number; height: number }

export interface PixelDiffParameters {
  /** pixelmatch threshold: maximum OKLab HyAB distance (0–1) at which two pixels still count as equal. */
  threshold: number
  /** false: pixels pixelmatch classifies as anti-aliasing are counted separately, not as changes. */
  includeAA: boolean
  /** Grid size in device pixels for merging changed pixels into regions (≥ 1). */
  mergeDistancePx: number
}

export const MASK_UNCHANGED = 0
export const MASK_CHANGED = 1
export const MASK_ANTIALIASED = 2

export interface RawDiffRegion {
  /** Position in `regions` (sorted top-to-bottom, then left-to-right). */
  index: number
  bbox: PixelRect
  changedPixels: number
}

export interface PixelDiff {
  width: number
  height: number
  totalPixels: number
  changedPixels: number
  antialiasedPixels: number
  /** One byte per pixel: MASK_UNCHANGED, MASK_CHANGED or MASK_ANTIALIASED. */
  mask: Uint8Array
  regions: RawDiffRegion[]
  /** Region index of a changed pixel (index = y × width + x), or -1. */
  regionOfPixel(pixelIndex: number): number
}

const DIFF_MARK: readonly [number, number, number] = [255, 0, 0]
const AA_MARK: readonly [number, number, number] = [255, 255, 0]

// Execution-side resource budgets are deliberately below PNG intake limits:
// two decoded RGBA images, pixelmatch output, masks, region maps, rendered
// diff PNG and zlib buffers coexist. Refuse workloads before allocation.
export const MAX_VISUAL_ANALYSIS_PIXELS = 12_000_000
export const MAX_VISUAL_GRID_CELLS = 2_000_000
export const MAX_VISUAL_COMPONENTS = 100_000

export class VisualResourceLimitError extends RangeError {
  constructor(message: string) { super(message); this.name = 'VisualResourceLimitError' }
}

export function assertVisualWorkBudget(width: number, height: number, mergeDistancePx: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    !Number.isSafeInteger(mergeDistancePx) || mergeDistancePx < 1 || mergeDistancePx > 256) {
    throw new RangeError('Invalid visual workload dimensions or merge grid')
  }
  const pixels = width * height
  if (pixels > MAX_VISUAL_ANALYSIS_PIXELS) throw new VisualResourceLimitError(`Visual workload ${pixels} pixels exceeds the ${MAX_VISUAL_ANALYSIS_PIXELS} pixel budget.`)
  const cells = Math.ceil(width / mergeDistancePx) * Math.ceil(height / mergeDistancePx)
  if (cells > MAX_VISUAL_GRID_CELLS) throw new VisualResourceLimitError(`Visual workload ${cells} merge-grid cells exceeds the ${MAX_VISUAL_GRID_CELLS} cell budget.`)
}

export function validatePixelDiffParameters(parameters: PixelDiffParameters): void {
  if (!Number.isFinite(parameters.threshold) || parameters.threshold < 0 || parameters.threshold > 1) throw new RangeError('threshold must be within 0..1')
  if (typeof parameters.includeAA !== 'boolean') throw new RangeError('includeAA must be boolean')
  if (!Number.isInteger(parameters.mergeDistancePx) || parameters.mergeDistancePx < 1 || parameters.mergeDistancePx > 256) throw new RangeError('mergeDistancePx must be an integer within 1..256')
}

/**
 * Compares two equally sized RGBA8 images. The caller is responsible for
 * establishing that the screenshots are comparable at all (same route,
 * viewport, device pixel ratio and interaction state).
 */
export function diffPixels(baseline: Uint8Array, candidate: Uint8Array, width: number, height: number, parameters: PixelDiffParameters): PixelDiff {
  validatePixelDiffParameters(parameters)
  assertVisualWorkBudget(width, height, parameters.mergeDistancePx)
  const totalPixels = width * height
  if (baseline.length !== totalPixels * 4 || candidate.length !== totalPixels * 4) throw new RangeError('Both images must be RGBA8 buffers of the same size')
  // pixelmatch reads 32-bit views, which need 4-byte-aligned offsets.
  if (baseline.byteOffset % 4) baseline = new Uint8Array(baseline)
  if (candidate.byteOffset % 4) candidate = new Uint8Array(candidate)
  // pixelmatch paints every compared pixel into `output`: changes in DIFF_MARK,
  // excluded anti-aliasing in AA_MARK and everything else in a grey that, with
  // alpha 0, is pure white. Neither mark is grey, so reading them back is exact.
  const output = new Uint8Array(totalPixels * 4)
  const counted = pixelmatch(baseline, candidate, output, width, height, {
    threshold: parameters.threshold,
    includeAA: parameters.includeAA,
    alpha: 0,
    diffColor: [...DIFF_MARK] as [number, number, number],
    diffColorAlt: [...DIFF_MARK] as [number, number, number],
    aaColor: [...AA_MARK] as [number, number, number],
    diffMask: false,
  })
  const mask = new Uint8Array(totalPixels)
  let changedPixels = 0
  let antialiasedPixels = 0
  for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
    const r = output[p], g = output[p + 1], b = output[p + 2]
    if (r === DIFF_MARK[0] && g === DIFF_MARK[1] && b === DIFF_MARK[2]) { mask[i] = MASK_CHANGED; changedPixels++ }
    else if (r === AA_MARK[0] && g === AA_MARK[1] && b === AA_MARK[2]) { mask[i] = MASK_ANTIALIASED; antialiasedPixels++ }
  }
  if (changedPixels !== counted) throw new Error(`Diff mask (${changedPixels}) disagrees with pixelmatch count (${counted})`)
  const clusters = clusterChangedPixels(mask, width, height, parameters.mergeDistancePx)
  return { width, height, totalPixels, changedPixels, antialiasedPixels, mask, regions: clusters.regions, regionOfPixel: clusters.regionOfPixel }
}

/**
 * Merges changed pixels into regions on a g×g grid (g = mergeDistancePx):
 * a grid cell is occupied when it contains a changed pixel, and 8-adjacent
 * occupied cells form one region. Consequently two changed pixels within
 * Chebyshev distance g always share a region, and pixels 2g or more apart are
 * only merged through other changed pixels between them. Deterministic and
 * linear in the number of pixels.
 */
export function clusterChangedPixels(mask: Uint8Array, width: number, height: number, mergeDistancePx: number): { regions: RawDiffRegion[]; regionOfPixel(pixelIndex: number): number } {
  assertVisualWorkBudget(width, height, mergeDistancePx)
  if (mask.length !== width * height) throw new RangeError('Change mask dimensions do not match')
  const g = mergeDistancePx
  const cols = Math.ceil(width / g)
  const rows = Math.ceil(height / g)
  const cellCount = cols * rows
  const occupied = new Uint8Array(cellCount)
  for (let y = 0; y < height; y++) {
    const row = y * width
    const cellRow = ((y / g) | 0) * cols
    for (let x = 0; x < width; x++) if (mask[row + x] === MASK_CHANGED) occupied[cellRow + ((x / g) | 0)] = 1
  }
  const parent = new Int32Array(cellCount).fill(-1)
  const find = (cell: number): number => {
    let root = cell
    while (parent[root] !== root) root = parent[root]
    while (parent[cell] !== root) { const next = parent[cell]; parent[cell] = root; cell = next }
    return root
  }
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) { if (ra < rb) parent[rb] = ra; else parent[ra] = rb }
  }
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx
      if (!occupied[cell]) continue
      parent[cell] = cell
      if (cx > 0 && occupied[cell - 1]) union(cell, cell - 1)
      if (cy > 0) {
        const up = cell - cols
        if (occupied[up]) union(cell, up)
        if (cx > 0 && occupied[up - 1]) union(cell, up - 1)
        if (cx < cols - 1 && occupied[up + 1]) union(cell, up + 1)
      }
    }
  }
  // Compact labels in row-major order of each component's first cell.
  const cellLabel = new Int32Array(cellCount).fill(-1)
  const rootLabel = new Map<number, number>()
  for (let cell = 0; cell < cellCount; cell++) {
    if (!occupied[cell]) continue
    const root = find(cell)
    let label = rootLabel.get(root)
    if (label === undefined) {
      if (rootLabel.size >= MAX_VISUAL_COMPONENTS) throw new VisualResourceLimitError(`Visual workload exceeds the ${MAX_VISUAL_COMPONENTS} connected-component budget.`)
      label = rootLabel.size; rootLabel.set(root, label)
    }
    cellLabel[cell] = label
  }
  const labels = rootLabel.size
  const minX = new Int32Array(labels).fill(width), minY = new Int32Array(labels).fill(height)
  const maxX = new Int32Array(labels).fill(-1), maxY = new Int32Array(labels).fill(-1)
  const count = new Float64Array(labels)
  for (let y = 0; y < height; y++) {
    const row = y * width
    const cellRow = ((y / g) | 0) * cols
    for (let x = 0; x < width; x++) {
      if (mask[row + x] !== MASK_CHANGED) continue
      const label = cellLabel[cellRow + ((x / g) | 0)]
      count[label]++
      if (x < minX[label]) minX[label] = x
      if (x > maxX[label]) maxX[label] = x
      if (y < minY[label]) minY[label] = y
      if (y > maxY[label]) maxY[label] = y
    }
  }
  const order = Array.from({ length: labels }, (_, label) => label)
    .sort((a, b) => minY[a] - minY[b] || minX[a] - minX[b] || maxY[a] - maxY[b] || maxX[a] - maxX[b] || a - b)
  const labelToRegion = new Int32Array(labels)
  const regions = order.map((label, index) => {
    labelToRegion[label] = index
    return { index, bbox: { x: minX[label], y: minY[label], width: maxX[label] - minX[label] + 1, height: maxY[label] - minY[label] + 1 }, changedPixels: count[label] }
  })
  return {
    regions,
    regionOfPixel(pixelIndex: number) {
      if (mask[pixelIndex] !== MASK_CHANGED) return -1
      const x = pixelIndex % width
      const y = (pixelIndex / width) | 0
      return labelToRegion[cellLabel[((y / g) | 0) * cols + ((x / g) | 0)]]
    },
  }
}

export type Rgb = readonly [number, number, number]

export const DIFF_IMAGE_LEGEND = Object.freeze({
  background: 'candidate screenshot as faded greyscale',
  changed: [220, 38, 38] as Rgb,
  antialiased: [234, 179, 8] as Rgb,
})

/**
 * Renders the reviewable diff image: the candidate as faded greyscale, a 2 px
 * outline just outside each listed rectangle, then changed pixels in red and
 * excluded anti-aliasing in amber on top, so outlines never hide either.
 */
export function renderDiffImage(candidate: Uint8Array, mask: Uint8Array, width: number, height: number, outlines: ReadonlyArray<{ rect: PixelRect; color: Rgb }>): Uint8Array {
  assertVisualWorkBudget(width, height, 256)
  if (candidate.length !== width * height * 4 || mask.length !== width * height) throw new RangeError('Diff render input dimensions do not match')
  const out = new Uint8Array(width * height * 4)
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const alpha = candidate[p + 3] / 255
    const luma = candidate[p] * 0.29889531 + candidate[p + 1] * 0.58662247 + candidate[p + 2] * 0.11448223
    const value = Math.round(255 + (luma - 255) * 0.3 * alpha)
    out[p] = out[p + 1] = out[p + 2] = value
    out[p + 3] = 255
  }
  const paint = (x: number, y: number, color: Rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const p = (y * width + x) * 4
    out[p] = color[0]; out[p + 1] = color[1]; out[p + 2] = color[2]; out[p + 3] = 255
  }
  for (const { rect, color } of outlines) {
    const x0 = rect.x - 2, y0 = rect.y - 2, x1 = rect.x + rect.width + 1, y1 = rect.y + rect.height + 1
    for (let t = 0; t < 2; t++) {
      for (let x = x0; x <= x1; x++) { paint(x, y0 + t, color); paint(x, y1 - t, color) }
      for (let y = y0; y <= y1; y++) { paint(x0 + t, y, color); paint(x1 - t, y, color) }
    }
  }
  // Changed and anti-aliased pixels are painted last so no outline hides them.
  for (let i = 0; i < width * height; i++) {
    const state = mask[i]
    if (state === MASK_CHANGED) paint(i % width, (i / width) | 0, DIFF_IMAGE_LEGEND.changed)
    else if (state === MASK_ANTIALIASED) paint(i % width, (i / width) | 0, DIFF_IMAGE_LEGEND.antialiased)
  }
  return out
}
