import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_CONFIG } from '@shared/presets'
import { addPngExif, exifTiff, resetTiffOrientation } from '../src/main/services/heic'
import { compressImage, readImageInfo } from '../src/main/services/imageProcessor'
import { hasFfmpeg, makeTestExif, makeTestHeic, tempDir } from './helpers'

describe('HEIC helpers', () => {
  it('resets the EXIF orientation in place', () => {
    const tiff = makeTestExif(6, 'Test')
    resetTiffOrientation(tiff)
    expect(tiff.readUInt16LE(8 + 2 + 12 + 8)).toBe(1)
  })

  it('finds the TIFF inside EXIF blocks with and without headers', () => {
    const tiff = makeTestExif(1, 'X')
    expect(exifTiff(tiff)?.equals(tiff)).toBe(true)
    expect(exifTiff(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]))?.equals(tiff)).toBe(true)
    expect(exifTiff(Buffer.concat([Buffer.from([0, 0, 0, 6]), Buffer.from('Exif\0\0', 'latin1'), tiff]))?.equals(tiff)).toBe(true)
    expect(exifTiff(Buffer.from('nonsense'))).toBeNull()
  })

  it('adds an eXIf chunk libvips can read', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } }).png().toBuffer()
    const withExif = addPngExif(png, makeTestExif(1, 'ChunkTest'))
    const meta = await sharp(withExif).metadata()
    expect(meta.exif?.includes(Buffer.from('ChunkTest'))).toBe(true)
  })
})

describe.skipIf(!(await hasFfmpeg()))('HEIC photos', () => {
  it('reads, decodes and compresses a HEIC to JPEG, keeping EXIF upright', async () => {
    const dir = await tempDir()
    const file = join(dir, 'IMG_0001.HEIC')
    await makeTestHeic(file, { width: 320, height: 240, exif: makeTestExif(1, 'SquashTestCam') })
    const info = await readImageInfo(file)
    expect(info).toMatchObject({ format: 'heic', width: 320, height: 240 })

    const result = await compressImage(file, { ...DEFAULT_IMAGE_CONFIG, stripMetadata: false })
    expect(result.format).toBe('jpeg')
    const meta = await sharp(result.data).metadata()
    expect(meta).toMatchObject({ format: 'jpeg', width: 320, height: 240 })
    expect(meta.exif?.includes(Buffer.from('SquashTestCam'))).toBe(true)
    // The original is a test pattern, so it should not come out blank.
    const stats = await sharp(result.data).stats()
    expect(stats.channels[0].stdev).toBeGreaterThan(20)
  })

  it('applies the HEIF rotation once', async () => {
    const dir = await tempDir()
    const file = join(dir, 'turned.heic')
    await makeTestHeic(file, { width: 320, height: 240, rotateQuarterTurns: 1 })
    const info = await readImageInfo(file)
    expect([info.width, info.height]).toEqual([240, 320])
    const result = await compressImage(file, DEFAULT_IMAGE_CONFIG)
    const meta = await sharp(result.data).metadata()
    expect([meta.width, meta.height]).toEqual([240, 320])
  })

  it('strips EXIF when asked', async () => {
    const dir = await tempDir()
    const file = join(dir, 'private.heic')
    await makeTestHeic(file, { exif: makeTestExif(1, 'SecretCam') })
    const result = await compressImage(file, { ...DEFAULT_IMAGE_CONFIG, stripMetadata: true })
    expect(result.data.includes(Buffer.from('SecretCam'))).toBe(false)
    expect((await readFile(file)).includes(Buffer.from('SecretCam'))).toBe(true)
  })
})
