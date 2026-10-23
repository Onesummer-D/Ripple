// Minimal ambient types for pngjs 7 (MIT), covering only the synchronous API
// used by src/core/visual-png.ts. The package ships no declarations and the
// repository does not depend on @types/pngjs; remove this file if that changes.
declare module 'pngjs' {
  interface PngSyncReadResult {
    width: number
    height: number
    data: Buffer
    depth: number
    colorType: number
    interlace: boolean
    alpha: boolean
  }
  interface PngSyncWriteOptions {
    colorType?: 0 | 2 | 4 | 6
    inputColorType?: 0 | 2 | 4 | 6
    bitDepth?: 8 | 16
    inputHasAlpha?: boolean
    deflateLevel?: number
    filterType?: number
  }
  export class PNG {
    constructor(options?: { width?: number; height?: number })
    width: number
    height: number
    data: Buffer
    static sync: {
      read(buffer: Buffer, options?: { checkCRC?: boolean; skipRescale?: boolean }): PngSyncReadResult
      write(png: PNG, options?: PngSyncWriteOptions): Buffer
    }
  }
}
