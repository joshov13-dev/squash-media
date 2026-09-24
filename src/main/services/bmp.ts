// Minimal BMP decoder. sharp's prebuilt libvips has no BMP loader, so BMP
// files are decoded here into raw pixels and handed to sharp.
// Supports 1/4/8/16/24/32-bit, BI_RGB, RLE8, RLE4, BITFIELDS and ALPHABITFIELDS.

export interface DecodedBmp {
  width: number
  height: number
  channels: 3 | 4
  data: Buffer
}

const BI_RGB = 0
const BI_RLE8 = 1
const BI_RLE4 = 2
const BI_BITFIELDS = 3
const BI_ALPHABITFIELDS = 6

export function isBmp(buf: Buffer): boolean {
  return buf.length > 26 && buf[0] === 0x42 && buf[1] === 0x4d
}

interface Mask {
  mask: number
  shift: number
  max: number
}

function makeMask(mask: number): Mask {
  mask >>>= 0
  if (mask === 0) return { mask: 0, shift: 0, max: 0 }
  let shift = 0
  while (((mask >>> shift) & 1) === 0) shift++
  const max = mask >>> shift
  return { mask, shift, max }
}

function readMasked(value: number, m: Mask): number {
  if (m.max === 0) return 0
  return Math.round((((value & m.mask) >>> m.shift) * 255) / m.max)
}

export function decodeBmp(buf: Buffer): DecodedBmp {
  if (!isBmp(buf)) throw new Error('Not a BMP file')
  const pixelOffset = buf.readUInt32LE(10)
  const headerSize = buf.readUInt32LE(14)

  let width: number
  let rawHeight: number
  let bpp: number
  let compression = BI_RGB
  let colorsUsed = 0
  let paletteEntrySize = 4

  if (headerSize === 12) {
    width = buf.readUInt16LE(18)
    rawHeight = buf.readInt16LE(20)
    bpp = buf.readUInt16LE(24)
    paletteEntrySize = 3
  } else if (headerSize >= 40) {
    width = buf.readInt32LE(18)
    rawHeight = buf.readInt32LE(22)
    bpp = buf.readUInt16LE(28)
    compression = buf.readUInt32LE(30)
    colorsUsed = buf.readUInt32LE(46)
  } else {
    throw new Error(`Unsupported BMP header size ${headerSize}`)
  }

  const topDown = rawHeight < 0
  const height = Math.abs(rawHeight)
  if (width <= 0 || height <= 0 || width > 65535 || height > 65535) throw new Error('Invalid BMP dimensions')

  // Channel masks for 16/32-bit images.
  let masks: { r: Mask; g: Mask; b: Mask; a: Mask } | null = null
  let afterHeader = 14 + headerSize
  if (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS) {
    const base = 14 + 40
    const hasAlpha = compression === BI_ALPHABITFIELDS || headerSize >= 56
    masks = {
      r: makeMask(buf.readUInt32LE(base)),
      g: makeMask(buf.readUInt32LE(base + 4)),
      b: makeMask(buf.readUInt32LE(base + 8)),
      a: makeMask(hasAlpha ? buf.readUInt32LE(base + 12) : 0),
    }
    if (headerSize === 40) afterHeader += compression === BI_ALPHABITFIELDS ? 16 : 12
  } else if (bpp === 16) {
    masks = { r: makeMask(0x7c00), g: makeMask(0x03e0), b: makeMask(0x001f), a: makeMask(0) }
  }

  let palette: Uint8Array | null = null
  if (bpp <= 8) {
    const count = colorsUsed || 1 << bpp
    palette = new Uint8Array(count * 4)
    for (let i = 0; i < count; i++) {
      const p = afterHeader + i * paletteEntrySize
      if (p + 2 >= buf.length) break
      palette[i * 4] = buf[p + 2]
      palette[i * 4 + 1] = buf[p + 1]
      palette[i * 4 + 2] = buf[p]
      palette[i * 4 + 3] = 255
    }
  }

  const out = Buffer.alloc(width * height * 4)
  const setPixel = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    const row = topDown ? y : height - 1 - y
    const o = (row * width + x) * 4
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = a
  }
  const setIndex = (x: number, y: number, index: number): void => {
    if (!palette || x >= width || y >= height) return
    const i = (index * 4) % palette.length
    setPixel(x, y, palette[i], palette[i + 1], palette[i + 2], 255)
  }

  if (compression === BI_RLE8 || compression === BI_RLE4) {
    decodeRle(buf, pixelOffset, height, compression === BI_RLE4, setIndex)
    return finish(out, width, height, false)
  }

  if (compression !== BI_RGB && compression !== BI_BITFIELDS && compression !== BI_ALPHABITFIELDS) {
    throw new Error(`Unsupported BMP compression ${compression}`)
  }

  const stride = Math.floor((bpp * width + 31) / 32) * 4
  let usesAlpha = masks?.a.max ? true : false
  let anyAlpha = false

  for (let y = 0; y < height; y++) {
    const rowStart = pixelOffset + y * stride
    if (rowStart >= buf.length) break
    for (let x = 0; x < width; x++) {
      switch (bpp) {
        case 1:
        case 4:
        case 8: {
          const bitPos = x * bpp
          const byte = buf[rowStart + (bitPos >> 3)]
          const shift = 8 - bpp - (bitPos & 7)
          setIndex(x, y, (byte >> shift) & ((1 << bpp) - 1))
          break
        }
        case 16: {
          const v = buf.readUInt16LE(rowStart + x * 2)
          const m = masks!
          setPixel(x, y, readMasked(v, m.r), readMasked(v, m.g), readMasked(v, m.b), m.a.max ? readMasked(v, m.a) : 255)
          break
        }
        case 24: {
          const p = rowStart + x * 3
          setPixel(x, y, buf[p + 2], buf[p + 1], buf[p], 255)
          break
        }
        case 32: {
          const p = rowStart + x * 4
          if (masks) {
            const v = buf.readUInt32LE(p)
            const m = masks
            setPixel(x, y, readMasked(v, m.r), readMasked(v, m.g), readMasked(v, m.b), m.a.max ? readMasked(v, m.a) : 255)
          } else {
            // BI_RGB 32-bit: the fourth byte is officially unused, but many
            // tools store alpha there. Treat it as alpha unless it is all zero.
            const a = buf[p + 3]
            if (a !== 0) anyAlpha = true
            setPixel(x, y, buf[p + 2], buf[p + 1], buf[p], a)
          }
          break
        }
        default:
          throw new Error(`Unsupported BMP bit depth ${bpp}`)
      }
    }
  }

  if (bpp === 32 && !masks) {
    usesAlpha = anyAlpha
    if (!anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255
  }
  return finish(out, width, height, usesAlpha)
}

function decodeRle(
  buf: Buffer,
  offset: number,
  height: number,
  four: boolean,
  setIndex: (x: number, y: number, i: number) => void,
): void {
  let x = 0
  let y = 0
  let p = offset
  while (p + 1 < buf.length && y < height) {
    const count = buf[p++]
    const value = buf[p++]
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const index = four ? (i % 2 === 0 ? value >> 4 : value & 0x0f) : value
        setIndex(x++, y, index)
      }
      continue
    }
    if (value === 0) {
      x = 0
      y++
    } else if (value === 1) {
      return
    } else if (value === 2) {
      x += buf[p++] ?? 0
      y += buf[p++] ?? 0
    } else {
      // Absolute run of `value` pixels, padded to a 16-bit boundary.
      const bytes = four ? Math.ceil(value / 2) : value
      for (let i = 0; i < value; i++) {
        const byte = buf[p + (four ? i >> 1 : i)] ?? 0
        const index = four ? (i % 2 === 0 ? byte >> 4 : byte & 0x0f) : byte
        setIndex(x++, y, index)
      }
      p += bytes + (bytes % 2)
    }
  }
}

function finish(rgba: Buffer, width: number, height: number, alpha: boolean): DecodedBmp {
  if (alpha) return { width, height, channels: 4, data: rgba }
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]
    rgb[j + 1] = rgba[i + 1]
    rgb[j + 2] = rgba[i + 2]
  }
  return { width, height, channels: 3, data: rgb }
}
