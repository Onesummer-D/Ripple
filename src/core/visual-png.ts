// Bounded PNG intake for visual-difference evidence.
//
// Screenshots are untrusted bytes until proven otherwise: the chunk structure
// is walked and the IHDR dimensions are checked BEFORE anything is inflated, so
// an oversized or malformed file is refused without allocating its pixels.
// PNG decoding is bounded and implemented below; pngjs (MIT) is used only for encoding.
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { PNG } from 'pngjs'

export interface PngLimits {
  /** Largest accepted encoded file. */
  maxFileBytes: number
  maxWidth: number
  maxHeight: number
  /** width × height; bounds every RGBA buffer the comparison allocates (4 bytes per pixel). */
  maxPixels: number
  /** Bounds the chunk walk; Chromium screenshots use a handful of chunks. */
  maxChunks: number
}

// 2^25 pixels covers a 1440 × 23 300 CSS-px page at DPR 1 or 390 × 9 600 at
// DPR 3 (Chromium itself does not capture much beyond 16 384 px per side). One
// RGBA copy at the limit is 128 MiB; the comparison holds about four.
export const DEFAULT_PNG_LIMITS: Readonly<PngLimits> = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 32768,
  maxPixels: 33_554_432,
  maxChunks: 4096,
})

export type PngFailureCode =
  | 'png-empty'
  | 'png-file-too-large'
  | 'png-signature-invalid'
  | 'png-structure-invalid'
  | 'png-crc-invalid'
  | 'png-dimensions-out-of-bounds'
  | 'png-unsupported-format'
  | 'png-decode-failed'

export interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlaced: boolean
}

export interface DecodedPng {
  width: number
  height: number
  /** Normalised RGBA, 8 bits per channel, row-major, no padding. */
  data: Uint8Array
  /** SHA-256 of the encoded file bytes exactly as received. */
  sha256: string
  /** SHA-256 over a width/height prefix and the decoded RGBA bytes; independent of PNG encoder settings. */
  pixelSha256: string
  sizeBytes: number
  header: PngHeader
  /** True when every decoded pixel has alpha 255. */
  opaque: boolean
}

export type PngReadResult =
  | { ok: true; png: DecodedPng }
  | { ok: false; code: PngFailureCode; detail: string; sha256: string | null; sizeBytes: number }

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
// Valid (colorType → bit depths) combinations from the PNG specification.
const VALID_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

export const sha256Hex = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

export function pixelDigest(width: number, height: number, rgba: Uint8Array): string {
  return createHash('sha256').update(`ripple-rgba8:${width}x${height}\n`).update(rgba).digest('hex')
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0

type HeaderResult = { ok: true; header: PngHeader; idat: Array<[number, number]> } | { ok: false; code: PngFailureCode; detail: string }

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Exact length of the inflated, still-filtered image data of a non-interlaced PNG. */
export function filteredDataLength(header: PngHeader): number {
  return header.height * (1 + Math.ceil((header.width * CHANNELS[header.colorType] * header.bitDepth) / 8))
}

/**
 * Walks the chunk list without inflating anything. Requires the signature, a
 * leading 13-byte IHDR, at least one IDAT, a terminal IEND with no trailing
 * bytes, valid CRCs, and dimensions inside `limits`.
 */
export function inspectPng(bytes: Uint8Array, limits: PngLimits = DEFAULT_PNG_LIMITS): HeaderResult {
  if (bytes.length === 0) return { ok: false, code: 'png-empty', detail: 'Screenshot file is empty.' }
  if (bytes.length > limits.maxFileBytes) return { ok: false, code: 'png-file-too-large', detail: `Screenshot is ${bytes.length} bytes; the limit is ${limits.maxFileBytes}.` }
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    return { ok: false, code: 'png-signature-invalid', detail: 'File does not start with the PNG signature.' }
  }
  let offset = SIGNATURE.length
  let header: PngHeader | undefined
  let chunks = 0
  const idat: Array<[number, number]> = []
  let previousType = ''
  let ended = false
  while (offset < bytes.length) {
    if (ended) return { ok: false, code: 'png-structure-invalid', detail: 'Bytes follow the IEND chunk.' }
    if (++chunks > limits.maxChunks) return { ok: false, code: 'png-structure-invalid', detail: `More than ${limits.maxChunks} chunks.` }
    if (offset + 12 > bytes.length) return { ok: false, code: 'png-structure-invalid', detail: 'Truncated chunk header.' }
    const length = u32(bytes, offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (length > 0x7fffffff || dataEnd + 4 > bytes.length) return { ok: false, code: 'png-structure-invalid', detail: 'Chunk length exceeds the file.' }
    const type = String.fromCharCode(bytes[typeStart], bytes[typeStart + 1], bytes[typeStart + 2], bytes[typeStart + 3])
    if (!/^[A-Za-z]{4}$/.test(type)) return { ok: false, code: 'png-structure-invalid', detail: 'Chunk type is not four ASCII letters.' }
    if (crc32(bytes, typeStart, dataEnd) !== u32(bytes, dataEnd)) return { ok: false, code: 'png-crc-invalid', detail: `CRC mismatch in ${type} chunk.` }
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) return { ok: false, code: 'png-structure-invalid', detail: 'IHDR must be the first chunk and 13 bytes long.' }
      const width = u32(bytes, dataStart)
      const height = u32(bytes, dataStart + 4)
      const bitDepth = bytes[dataStart + 8]
      const colorType = bytes[dataStart + 9]
      const compression = bytes[dataStart + 10]
      const filter = bytes[dataStart + 11]
      const interlace = bytes[dataStart + 12]
      if (width === 0 || height === 0 || width > limits.maxWidth || height > limits.maxHeight || width * height > limits.maxPixels) {
        return { ok: false, code: 'png-dimensions-out-of-bounds', detail: `Image is ${width}×${height}; limits are ${limits.maxWidth}×${limits.maxHeight} and ${limits.maxPixels} pixels.` }
      }
      if (!(VALID_DEPTHS[colorType] ?? []).includes(bitDepth) || compression !== 0 || filter !== 0 || interlace > 1) {
        return { ok: false, code: 'png-structure-invalid', detail: 'IHDR declares an invalid colour type, bit depth, compression, filter or interlace method.' }
      }
      // Browser screenshots are never interlaced; refusing Adam7 keeps the exact
      // inflated-length check below simple and avoids pngjs's unbounded path.
      if (interlace === 1) return { ok: false, code: 'png-unsupported-format', detail: 'Interlaced PNGs are not accepted as screenshot evidence.' }
      // Browsers emit 8-bit RGB or RGBA screenshots. Other formats (16-bit,
      // palette, greyscale) are refused: they are not browser evidence and
      // decoding them would need a different, less bounded path.
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return { ok: false, code: 'png-unsupported-format', detail: `Only 8-bit RGB/RGBA screenshots are accepted (got colour type ${colorType}, bit depth ${bitDepth}).` }
      header = { width, height, bitDepth, colorType, interlaced: false }
    } else if (type === 'IHDR') {
      return { ok: false, code: 'png-structure-invalid', detail: 'Duplicate IHDR chunk.' }
    } else if (type === 'IDAT') {
      if (idat.length && previousType !== 'IDAT') return { ok: false, code: 'png-structure-invalid', detail: 'IDAT chunks are not consecutive.' }
      idat.push([dataStart, dataEnd])
    } else if (type === 'IEND') {
      if (length !== 0) return { ok: false, code: 'png-structure-invalid', detail: 'IEND must be empty.' }
      ended = true
    } else if (type[0] === type[0].toUpperCase() && type !== 'PLTE') {
      return { ok: false, code: 'png-unsupported-format', detail: `Unknown critical chunk ${type}.` }
    }
    previousType = type
    offset = dataEnd + 4
  }
  if (!header) return { ok: false, code: 'png-structure-invalid', detail: 'No IHDR chunk.' }
  if (!idat.length) return { ok: false, code: 'png-structure-invalid', detail: 'No IDAT chunk.' }
  if (!ended) return { ok: false, code: 'png-structure-invalid', detail: 'Missing IEND chunk (file truncated?).' }
  return { ok: true, header, idat }
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Unfilters 8-bit RGB / RGBA scanlines (the formats browsers emit) straight into RGBA. */
function decodeRgb8(header: PngHeader, filtered: Uint8Array): Uint8Array | string {
  const { width, height } = header
  const bpp = CHANNELS[header.colorType]
  const stride = width * bpp
  let previous = new Uint8Array(stride)
  let current = new Uint8Array(stride)
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = filtered[rowStart]
    const row = filtered.subarray(rowStart + 1, rowStart + 1 + stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? current[i - bpp] : 0
      const up = previous[i]
      const upLeft = i >= bpp ? previous[i - bpp] : 0
      let value: number
      switch (filter) {
        case 0: value = row[i]; break
        case 1: value = row[i] + left; break
        case 2: value = row[i] + up; break
        case 3: value = row[i] + ((left + up) >> 1); break
        case 4: value = row[i] + paeth(left, up, upLeft); break
        default: return `Scanline ${y} uses unknown filter type ${filter}.`
      }
      current[i] = value & 0xff
    }
    const base = y * width * 4
    if (bpp === 4) out.set(current, base)
    else for (let x = 0, s = 0, d = base; x < width; x++, s += 3, d += 4) { out[d] = current[s]; out[d + 1] = current[s + 1]; out[d + 2] = current[s + 2]; out[d + 3] = 255 }
    const swap = previous; previous = current; current = swap
  }
  return out
}

/**
 * Validates, then decodes to RGBA8. Never throws for bad input; reports a failure code instead.
 *
 * The image data is inflated here with an output bound and must have exactly
 * the length the header implies before any pixel is produced: pngjs 7's sync
 * inflater can return an uninitialised buffer for a complete-but-short zlib
 * stream, which would turn a truncated screenshot into random (or recycled)
 * pixels. The 8-bit RGB/RGBA scanlines are then unfiltered here; pngjs is
 * only used to encode.
 */
export function readPng(bytes: Uint8Array, limits: PngLimits = DEFAULT_PNG_LIMITS): PngReadResult {
  const sizeBytes = bytes.length
  // Hashing an over-limit file would still read it all; report its size only.
  const sha256 = sizeBytes > 0 && sizeBytes <= limits.maxFileBytes ? sha256Hex(bytes) : null
  const inspected = inspectPng(bytes, limits)
  if (!inspected.ok) return { ok: false, code: inspected.code, detail: inspected.detail, sha256, sizeBytes }
  const { header } = inspected
  const { width, height } = header
  const expected = filteredDataLength(header)
  let filtered: Uint8Array
  try {
    const compressed = Buffer.concat(inspected.idat.map(([start, end]) => bytes.subarray(start, end)))
    const inflated = inflateSync(compressed, { maxOutputLength: expected + 1 })
    filtered = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    return { ok: false, code: 'png-decode-failed', detail: code === 'ERR_BUFFER_TOO_LARGE' ? 'Image data inflates to more bytes than the header allows.' : `Image data does not inflate cleanly (${String((error as Error)?.message ?? error).slice(0, 120)}).`, sha256, sizeBytes }
  }
  if (filtered.length !== expected) {
    return { ok: false, code: 'png-decode-failed', detail: `Image data inflates to ${filtered.length} bytes; the header requires exactly ${expected} (truncated or padded image).`, sha256, sizeBytes }
  }
  const decoded = decodeRgb8(header, filtered)
  if (typeof decoded === 'string') return { ok: false, code: 'png-decode-failed', detail: decoded, sha256, sizeBytes }
  const data = decoded
  let opaque = true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break }
  return {
    ok: true,
    png: { width, height, data, sha256: sha256!, pixelSha256: pixelDigest(width, height, data), sizeBytes, header, opaque },
  }
}

/** Encodes RGBA8 as a non-interlaced colour-type-6 PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 12_000_000) throw new RangeError('PNG encoding exceeds the bounded visual analysis pixel budget')
  if (rgba.length !== width * height * 4) throw new Error('RGBA buffer does not match the image size')
  const png = new PNG({ width, height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  const encoded = PNG.sync.write(png, { colorType: 6, inputColorType: 6, bitDepth: 8, inputHasAlpha: true, deflateLevel: 9, filterType: 4 })
  return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength)
}
