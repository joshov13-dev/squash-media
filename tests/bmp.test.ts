import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { decodeBmp, isBmp } from '../src/main/services/bmp'
import { loadImage, readImageInfo } from '../src/main/services/imageProcessor'

/** Build a BITMAPINFOHEADER BMP. `rows` are top-to-bottom, pixel bytes as stored. */
function buildBmp(opts: {
  width: number
  height: number
  bpp: number
  rows: number[][]
  palette?: number[][]
  compression?: number
  topDown?: boolean
  pixelData?: number[]
}): Buffer {
  const { width, height, bpp, palette = [], compression = 0, topDown = false } = opts
  const stride = Math.floor((bpp * width + 31) / 32) * 4
  let pixels: Buffer
  if (opts.pixelData) {
    pixels = Buffer.from(opts.pixelData)
  } else {
    pixels = Buffer.alloc(stride * height)
    const ordered = topDown ? opts.rows : [...opts.rows].reverse()
    ordered.forEach((row, y) => Buffer.from(row).copy(pixels, y * stride))
  }
  const paletteBuf = Buffer.alloc(palette.length * 4)
  palette.forEach(([r, g, b], i) => {
    paletteBuf[i * 4] = b
    paletteBuf[i * 4 + 1] = g
    paletteBuf[i * 4 + 2] = r
  })
  const offset = 14 + 40 + paletteBuf.length
  const header = Buffer.alloc(54)
  header.write('BM', 0, 'latin1')
  header.writeUInt32LE(offset + pixels.length, 2)
  header.writeUInt32LE(offset, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(topDown ? -height : height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(bpp, 28)
  header.writeUInt32LE(compression, 30)
  header.writeUInt32LE(pixels.length, 34)
  header.writeUInt32LE(palette.length, 46)
  return Buffer.concat([header, paletteBuf, pixels])
}

describe('BMP decoder', () => {
  it('decodes 24-bit bottom-up images', () => {
    // Top row: red, green. Bottom row: blue, white. Stored as BGR.
    const bmp = buildBmp({
      width: 2,
      height: 2,
      bpp: 24,
      rows: [
        [0, 0, 255, 0, 255, 0],
        [255, 0, 0, 255, 255, 255],
      ],
    })
    expect(isBmp(bmp)).toBe(true)
    const out = decodeBmp(bmp)
    expect(out.channels).toBe(3)
    expect([...out.data]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
  })

  it('decodes 32-bit images with alpha and top-down order', () => {
    const bmp = buildBmp({
      width: 1,
      height: 2,
      bpp: 32,
      topDown: true,
      rows: [
        [0, 0, 255, 128],
        [255, 0, 0, 255],
      ],
    })
    const out = decodeBmp(bmp)
    expect(out.channels).toBe(4)
    expect([...out.data]).toEqual([255, 0, 0, 128, 0, 0, 255, 255])
  })

  it('treats an all-zero fourth byte as opaque', () => {
    const bmp = buildBmp({ width: 1, height: 1, bpp: 32, rows: [[10, 20, 30, 0]] })
    const out = decodeBmp(bmp)
    expect(out.channels).toBe(3)
    expect([...out.data]).toEqual([30, 20, 10])
  })

  it('decodes 8-bit and 1-bit palette images', () => {
    const eight = buildBmp({
      width: 3,
      height: 1,
      bpp: 8,
      palette: [
        [0, 0, 0],
        [200, 100, 50],
      ],
      rows: [[1, 0, 1]],
    })
    expect([...decodeBmp(eight).data]).toEqual([200, 100, 50, 0, 0, 0, 200, 100, 50])

    const one = buildBmp({
      width: 3,
      height: 1,
      bpp: 1,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      rows: [[0b10100000]],
    })
    expect([...decodeBmp(one).data]).toEqual([255, 255, 255, 0, 0, 0, 255, 255, 255])
  })

  it('decodes RLE8', () => {
    // Bottom row: 3x index 1, end of line. Top row: absolute run [0,1,0], end of bitmap.
    const bmp = buildBmp({
      width: 3,
      height: 2,
      bpp: 8,
      compression: 1,
      palette: [
        [0, 0, 0],
        [255, 0, 0],
      ],
      rows: [],
      pixelData: [3, 1, 0, 0, 0, 3, 0, 1, 0, 0, 0, 1],
    })
    const out = decodeBmp(bmp)
    expect([...out.data]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0])
  })

  it('feeds sharp through loadImage', async () => {
    const bmp = buildBmp({ width: 2, height: 1, bpp: 24, rows: [[0, 0, 255, 255, 0, 0]] })
    const info = await readImageInfo('', bmp)
    expect(info).toMatchObject({ format: 'bmp', width: 2, height: 1 })
    const img = await loadImage('', bmp)
    const png = await sharp(img.input, img.options).png().toBuffer()
    const raw = await sharp(png).raw().toBuffer()
    expect([...raw]).toEqual([255, 0, 0, 0, 0, 255])
  })
})
