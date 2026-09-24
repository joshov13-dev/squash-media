import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_CONFIG } from '@shared/presets'
import type { ImageJobConfig } from '@shared/types'
import {
  compressImage,
  computeOutputSize,
  generateImagePreview,
  getDisplayableOriginal,
  PREVIEW_FULL_LIMIT,
  QUICK_PIXELS,
  readImageInfo,
} from '../src/main/services/imageProcessor'
import { buildOrientationExif, readExifOrientation, stripJpegMetadata } from '../src/main/services/jpegStrip'
import { tempDir } from './helpers'

const cfg = (patch: Partial<ImageJobConfig>): ImageJobConfig => ({
  ...DEFAULT_IMAGE_CONFIG,
  ...patch,
  resize: { ...DEFAULT_IMAGE_CONFIG.resize, ...patch.resize },
})

/** A photo-like image: smooth gradients plus noise, so encoders have work to do. */
async function photo(width: number, height: number): Promise<Sharp> {
  const noise = await sharp({
    create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  })
    .png()
    .toBuffer()
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff7a1a"/><stop offset="1" stop-color="#1a6bff"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${width / 2}" cy="${height / 2}" r="${height / 4}" fill="#fff" opacity="0.7"/>
    </svg>`,
  )
  return sharp(gradient).composite([{ input: noise, blend: 'soft-light' }])
}

let dir: string
let jpegPath: string
let pngPath: string

beforeAll(async () => {
  dir = await tempDir()
  jpegPath = join(dir, 'photo.jpg')
  pngPath = join(dir, 'graphic.png')
  await (await photo(1600, 1200))
    .jpeg({ quality: 97 })
    .withExif({ IFD0: { Artist: 'Someone', Copyright: 'Private', Orientation: '1' } })
    .toFile(jpegPath)
  await (await photo(800, 600)).png({ compressionLevel: 0 }).toFile(pngPath)
})

describe('geometry', () => {
  it('fits inside a bounding box without enlarging', () => {
    const fit = { ...DEFAULT_IMAGE_CONFIG.resize, mode: 'fit' as const, maxWidth: 1000, maxHeight: 1000 }
    expect(computeOutputSize(4000, 3000, fit)).toEqual({ width: 1000, height: 750 })
    expect(computeOutputSize(800, 600, fit)).toEqual({ width: 800, height: 600 })
    const pct = { ...DEFAULT_IMAGE_CONFIG.resize, mode: 'percentage' as const, percentage: 25 }
    expect(computeOutputSize(4000, 3000, pct)).toEqual({ width: 1000, height: 750 })
  })
})

describe('compressImage', () => {
  it('shrinks a JPEG in quality mode', async () => {
    const original = (await readFile(jpegPath)).length
    const r = await compressImage(jpegPath, cfg({ quality: 70 }))
    expect(r.format).toBe('jpeg')
    expect(r.data.length).toBeLessThan(original * 0.6)
    const meta = await sharp(r.data).metadata()
    expect(meta.exif).toBeUndefined()
  })

  it('keeps metadata when asked', async () => {
    const r = await compressImage(jpegPath, cfg({ quality: 70, stripMetadata: false }))
    const meta = await sharp(r.data).metadata()
    expect(meta.exif).toBeDefined()
  })

  it('converts formats and resizes', async () => {
    const r = await compressImage(
      jpegPath,
      cfg({ format: 'webp', quality: 75, resize: { ...DEFAULT_IMAGE_CONFIG.resize, mode: 'fit', maxWidth: 800, maxHeight: 800 } }),
    )
    const meta = await sharp(r.data).metadata()
    expect(meta.format).toBe('webp')
    expect([meta.width, meta.height]).toEqual([800, 600])
    expect([r.width, r.height]).toEqual([800, 600])
  })

  it('encodes AVIF', async () => {
    const r = await compressImage(pngPath, cfg({ format: 'avif', quality: 50 }))
    const meta = await sharp(r.data).metadata()
    expect(meta.format).toBe('heif')
    expect(meta.compression).toBe('av1')
  })

  it('lossless PNG keeps every pixel', async () => {
    const r = await compressImage(pngPath, cfg({ mode: 'lossless' }))
    expect(r.data.length).toBeLessThan((await readFile(pngPath)).length)
    const a = await sharp(pngPath).raw().toBuffer()
    const b = await sharp(r.data).raw().toBuffer()
    expect(Buffer.compare(a, b)).toBe(0)
  })

  it('lossless JPEG strips metadata without touching the pixels', async () => {
    const r = await compressImage(jpegPath, cfg({ mode: 'lossless' }))
    expect(r.data.length).toBeLessThan((await readFile(jpegPath)).length)
    expect((await sharp(r.data).metadata()).exif).toBeUndefined()
    const a = await sharp(jpegPath).raw().toBuffer()
    const b = await sharp(r.data).raw().toBuffer()
    expect(Buffer.compare(a, b)).toBe(0)
  })

  it('hits a target size with the best quality that fits', async () => {
    const target = 120 * 1024
    const r = await compressImage(jpegPath, cfg({ mode: 'targetSize', targetMaxSizeBytes: target }))
    expect(r.data.length).toBeLessThanOrEqual(target)
    expect(r.qualityUsed).toBeGreaterThan(1)
    // One step higher quality should no longer fit (or we were already at the top).
    if (r.qualityUsed! < 95) {
      const higher = await sharp(jpegPath).jpeg({ quality: r.qualityUsed! + 2, mozjpeg: true, progressive: true }).toBuffer()
      expect(higher.length).toBeGreaterThan(target * 0.9)
    }
  })

  it('downscales when even the lowest quality is too big', async () => {
    const floor = (await sharp(jpegPath).jpeg({ quality: 1, mozjpeg: true, progressive: true }).toBuffer()).length
    const target = Math.round(floor * 0.5)
    const r = await compressImage(jpegPath, cfg({ format: 'jpeg', mode: 'targetSize', targetMaxSizeBytes: target }))
    expect(r.data.length).toBeLessThanOrEqual(target)
    expect(r.width).toBeLessThan(1600)
    expect(r.note).toMatch(/Scaled/)
  })

  it('reports files already under the target as unchanged', async () => {
    const r = await compressImage(jpegPath, cfg({ mode: 'targetSize', targetMaxSizeBytes: 50 * 1024 * 1024 }))
    expect(r.unchanged).toBe(true)
  })

  it('flattens transparency onto white for JPEG output', async () => {
    const path = join(dir, 'alpha.png')
    await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(path)
    const r = await compressImage(path, cfg({ format: 'jpeg', quality: 90 }))
    const { data } = await sharp(r.data).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(245)
  })
})

describe('JPEG metadata stripping', () => {
  it('reads and writes the orientation tag', () => {
    const exif = buildOrientationExif(6)
    expect(readExifOrientation(exif.subarray(4))).toBe(6)
  })

  it('keeps orientation but drops everything else', async () => {
    const src = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: 'Someone', Make: 'Camera' } })
      .toBuffer()
    expect(src.includes(Buffer.from('Someone'))).toBe(true)
    const out = stripJpegMetadata(src)
    const meta = await sharp(out).metadata()
    expect(meta.orientation).toBe(6)
    expect(out.includes(Buffer.from('Someone'))).toBe(false)
    expect(out.length).toBeLessThan(src.length)
  })

  it('returns non-JPEG data untouched', () => {
    const junk = Buffer.from('not a jpeg')
    expect(stripJpegMetadata(junk)).toBe(junk)
  })
})

describe('previews', () => {
  it('returns an exact live preview for normal images', async () => {
    const r = await generateImagePreview({ requestId: 7, filePath: jpegPath, config: cfg({ format: 'webp', quality: 60 }) })
    expect(r.requestId).toBe(7)
    expect(r.exact).toBe(true)
    expect(r.afterMime).toBe('image/webp')
    expect(r.estimatedBytes).toBe(r.after.byteLength)
    expect((await getDisplayableOriginal(jpegPath)).mime).toBe('image/jpeg')
  })

  it('gives instant feedback from a small copy without claiming a size', async () => {
    const r = await generateImagePreview({ requestId: 8, filePath: jpegPath, config: cfg({ format: 'avif', quality: 50 }), quick: true })
    expect(r.quick).toBe(true)
    expect(r.estimatedBytes).toBe(0)
    expect(r.outputWidth).toBe(1600)
    const meta = await sharp(Buffer.from(r.after)).metadata()
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(QUICK_PIXELS * 1.01)
  })

  it('estimates from a downsampled copy for huge images', async () => {
    const path = join(dir, 'huge.jpg')
    const side = Math.ceil(Math.sqrt(PREVIEW_FULL_LIMIT)) + 200
    await (await photo(side, side)).jpeg({ quality: 90 }).toFile(path)
    const r = await generateImagePreview({ requestId: 1, filePath: path, config: cfg({ quality: 70 }) })
    expect(r.exact).toBe(false)
    const shown = await getDisplayableOriginal(path)
    expect(shown.mime).toBe('image/png')
    expect((await sharp(shown.data).metadata()).width).toBe((await sharp(Buffer.from(r.after)).metadata()).width)
    expect(r.outputWidth).toBeGreaterThan(side - 5)
    const real = await compressImage(path, cfg({ quality: 70 }))
    // Tile sampling should land within about 25% of the real size.
    expect(r.estimatedBytes / real.data.length).toBeGreaterThan(0.75)
    expect(r.estimatedBytes / real.data.length).toBeLessThan(1.33)
  })

  it('converts TIFF output to something the UI can show', async () => {
    const path = join(dir, 'scan.tif')
    await (await photo(300, 200)).tiff().toFile(path)
    expect((await readImageInfo(path)).format).toBe('tiff')
    const r = await generateImagePreview({ requestId: 2, filePath: path, config: cfg({ quality: 60 }) })
    expect(r.outputFormat).toBe('tiff')
    expect(r.afterMime).toBe('image/png')
    expect((await getDisplayableOriginal(path)).mime).toBe('image/png')
  })

  it('compares against an existing output file', async () => {
    const out = join(dir, 'result.webp')
    await writeFile(out, (await compressImage(jpegPath, cfg({ format: 'webp' }))).data)
    const r = await generateImagePreview({ requestId: 3, filePath: jpegPath, config: cfg({}), resultPath: out })
    expect(r.afterMime).toBe('image/webp')
    expect(r.exact).toBe(true)
  })
})
