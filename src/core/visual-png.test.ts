import { deflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PNG_LIMITS, encodePng, inspectPng, pixelDigest, readPng, sha256Hex } from './visual-png'

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return data
}

// Hand-built PNG chunk writer, so headers can be forged without a decoder's help.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  out.set(data, 8)
  let crc = 0xffffffff
  for (const byte of out.subarray(4, 8 + data.length)) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length)
  return out
}
function forgePng(width: number, height: number, options: { interlace?: number; colorType?: number; bitDepth?: number; idat?: Uint8Array } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = options.bitDepth ?? 8; ihdr[9] = options.colorType ?? 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = options.interlace ?? 0
  const idat = options.idat ?? deflateSync(Buffer.alloc(1))
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())]))
}

describe('bounded PNG intake', () => {
  const valid = encodePng(4, 3, solid(4, 3, [10, 20, 30, 255]))

  it('decodes a valid PNG and records file and pixel digests', () => {
    const result = readPng(valid)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.png).toMatchObject({ width: 4, height: 3, sizeBytes: valid.length, opaque: true, header: { bitDepth: 8, colorType: 6, interlaced: false } })
    expect(result.png.sha256).toBe(sha256Hex(valid))
    expect(result.png.pixelSha256).toBe(pixelDigest(4, 3, solid(4, 3, [10, 20, 30, 255])))
    expect(Array.from(result.png.data.subarray(0, 4))).toEqual([10, 20, 30, 255])
  })

  it('keeps the pixel digest independent of PNG encoder settings while the file digest changes', () => {
    const pixels = solid(8, 8, [1, 2, 3, 255])
    pixels.set([200, 100, 50, 255], 4 * 9)
    const a = readPng(encodePng(8, 8, pixels))
    const other = new PNG({ width: 8, height: 8 })
    other.data = Buffer.from(pixels)
    const b = readPng(new Uint8Array(PNG.sync.write(other, { deflateLevel: 1, filterType: 0 })))
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.png.sha256).not.toBe(b.png.sha256)
      expect(a.png.pixelSha256).toBe(b.png.pixelSha256)
    }
  })

  it('reports transparency instead of assuming an opaque screenshot', () => {
    const result = readPng(encodePng(2, 2, solid(2, 2, [0, 0, 0, 128])))
    expect(result.ok && result.png.opaque).toBe(false)
  })

  it('rejects an empty file', () => {
    expect(readPng(new Uint8Array())).toMatchObject({ ok: false, code: 'png-empty', sha256: null, sizeBytes: 0 })
  })

  it('rejects bytes that are not a PNG', () => {
    expect(readPng(new TextEncoder().encode('<html>not a screenshot</html>'))).toMatchObject({ ok: false, code: 'png-signature-invalid' })
  })

  it('rejects a truncated PNG before decoding', () => {
    for (const length of [8, 20, 33, valid.length - 12, valid.length - 1]) {
      const result = readPng(valid.subarray(0, length))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['png-structure-invalid', 'png-crc-invalid']).toContain(result.code)
    }
  })

  it('rejects a corrupted chunk by CRC', () => {
    const corrupted = new Uint8Array(valid)
    corrupted[33 + 8 + 1] ^= 0xff // first IDAT data bytes (signature 8 + IHDR chunk 25 + IDAT header 8)
    expect(readPng(corrupted)).toMatchObject({ ok: false, code: 'png-crc-invalid' })
  })

  it('rejects bytes after IEND', () => {
    expect(readPng(new Uint8Array([...valid, 0]))).toMatchObject({ ok: false, code: 'png-structure-invalid' })
  })

  it('refuses oversized dimensions from the header alone, without inflating', () => {
    // 60000 × 60000 would need 14.4 GB of RGBA; the IDAT here is a single byte.
    expect(inspectPng(forgePng(60_000, 60_000))).toMatchObject({ ok: false, code: 'png-dimensions-out-of-bounds' })
    expect(readPng(forgePng(DEFAULT_PNG_LIMITS.maxWidth + 1, 1))).toMatchObject({ ok: false, code: 'png-dimensions-out-of-bounds' })
    expect(readPng(forgePng(8192, 4097))).toMatchObject({ ok: false, code: 'png-dimensions-out-of-bounds' })
    expect(readPng(forgePng(0, 10))).toMatchObject({ ok: false, code: 'png-dimensions-out-of-bounds' })
  })

  it('applies caller-tightened limits', () => {
    expect(readPng(valid, { ...DEFAULT_PNG_LIMITS, maxFileBytes: 10 })).toMatchObject({ ok: false, code: 'png-file-too-large', sha256: null })
    expect(readPng(valid, { ...DEFAULT_PNG_LIMITS, maxWidth: 3 })).toMatchObject({ ok: false, code: 'png-dimensions-out-of-bounds' })
  })

  it('refuses interlaced PNGs, whose decoder path has no inflate bound', () => {
    expect(readPng(forgePng(2, 2, { interlace: 1 }))).toMatchObject({ ok: false, code: 'png-unsupported-format' })
  })

  it('rejects invalid colour type / bit depth combinations', () => {
    expect(readPng(forgePng(2, 2, { colorType: 6, bitDepth: 4 }))).toMatchObject({ ok: false, code: 'png-structure-invalid' })
    expect(readPng(forgePng(2, 2, { colorType: 3, bitDepth: 8 }))).toMatchObject({ ok: false, code: 'png-unsupported-format' })
    expect(readPng(forgePng(2, 2, { colorType: 5 }))).toMatchObject({ ok: false, code: 'png-structure-invalid' })
  })

  it('rejects complete-but-short image data deterministically instead of decoding uninitialised memory', () => {
    // Valid chunks and CRCs, a complete zlib stream, but far fewer bytes than 256 × 256 RGBA needs.
    const forged = forgePng(256, 256, { idat: deflateSync(Buffer.alloc(3)) })
    for (let run = 0; run < 25; run++) {
      expect(readPng(forged)).toMatchObject({ ok: false, code: 'png-decode-failed', detail: expect.stringMatching(/exactly/) })
    }
    const padded = forgePng(2, 2, { idat: deflateSync(Buffer.alloc(2 * (1 + 8) + 5)) })
    expect(readPng(padded)).toMatchObject({ ok: false, code: 'png-decode-failed' })
    const truncatedStream = deflateSync(Buffer.alloc(16 * (1 + 64))).subarray(0, 6)
    expect(readPng(forgePng(16, 16, { idat: truncatedStream }))).toMatchObject({ ok: false, code: 'png-decode-failed' })
  })

  it('rejects an unknown scanline filter and unknown critical chunks', () => {
    const rows = Buffer.alloc(2 * (1 + 8))
    rows[0] = 7
    expect(readPng(forgePng(2, 2, { idat: deflateSync(rows) }))).toMatchObject({ ok: false, code: 'png-decode-failed', detail: expect.stringMatching(/filter/) })
    const valid = forgePng(2, 2, { idat: deflateSync(Buffer.alloc(2 * (1 + 8))) })
    expect(readPng(valid).ok).toBe(true)
    const withCritical = new Uint8Array(Buffer.concat([Buffer.from(valid.subarray(0, 33)), chunk('ABCD', new Uint8Array()), Buffer.from(valid.subarray(33))]))
    expect(readPng(withCritical)).toMatchObject({ ok: false, code: 'png-unsupported-format' })
    const withAncillary = new Uint8Array(Buffer.concat([Buffer.from(valid.subarray(0, 33)), chunk('tEXt', new TextEncoder().encode('k\u0000v')), Buffer.from(valid.subarray(33))]))
    expect(readPng(withAncillary).ok).toBe(true)
  })

  it('decodes every scanline filter for RGB and RGBA exactly and refuses non-browser formats', () => {
    const width = 37, height = 23
    const source = new Uint8Array(width * height * 4)
    for (let i = 0; i < source.length; i += 4) source.set([(i * 7) % 256, (i * 13 + 5) % 256, (i * 3) % 256, 255], i)
    for (const colorType of [2, 6] as const) {
      for (const filterType of [0, 1, 2, 3, 4, -1]) {
        const png = new PNG({ width, height })
        png.data = Buffer.from(source)
        const bytes = new Uint8Array(PNG.sync.write(png, { colorType, inputColorType: 6, inputHasAlpha: true, filterType }))
        const result = readPng(bytes)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.png.pixelSha256).toBe(pixelDigest(width, height, source))
      }
    }
    // 16-bit and greyscale are not browser screenshot formats and are refused before inflating.
    const grey = new PNG({ width: 4, height: 4 })
    grey.data = Buffer.from(solid(4, 4, [90, 90, 90, 255]))
    expect(readPng(new Uint8Array(PNG.sync.write(grey, { colorType: 0, inputColorType: 6, inputHasAlpha: true })))).toMatchObject({ ok: false, code: 'png-unsupported-format' })
    expect(readPng(forgePng(4096, 8192, { bitDepth: 16 }))).toMatchObject({ ok: false, code: 'png-unsupported-format' })
  })
})
