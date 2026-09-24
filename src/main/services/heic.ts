// HEIC photos (the iPhone default) are HEVC stills. sharp's prebuilt libvips
// can read their headers but not decode HEVC, so the bundled FFmpeg decodes
// them to PNG. FFmpeg stitches the tile grid and applies the rotation, and
// the photo's EXIF (date taken, location) is carried across in an eXIf chunk.
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { getBinaryPaths } from '../binaries'
import { runProcess, tailError } from '../utils/process'

/** Set the EXIF orientation tag to 1 in a TIFF-structured EXIF block, in place. */
export function resetTiffOrientation(tiff: Buffer): void {
  if (tiff.length < 8) return
  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return
  const u16 = (o: number): number => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
  const u32 = (o: number): number => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return
    if (u16(entry) === 0x0112) {
      if (little) tiff.writeUInt16LE(1, entry + 8)
      else tiff.writeUInt16BE(1, entry + 8)
      return
    }
  }
}

/** The raw TIFF part of an EXIF block, whether or not it starts with "Exif\0\0". */
export function exifTiff(exif: Buffer): Buffer | null {
  let start = 0
  if (exif.subarray(0, 6).toString('latin1') === 'Exif\0\0') start = 6
  // libheif keeps a 4-byte offset in front of the header in some files.
  else if (exif.length > 10 && exif.subarray(4, 10).toString('latin1') === 'Exif\0\0') start = 10
  const tiff = Buffer.from(exif.subarray(start))
  const order = tiff.subarray(0, 2).toString('latin1')
  return order === 'II' || order === 'MM' ? tiff : null
}

/** Put an eXIf chunk straight after IHDR so libvips reads the metadata. */
export function addPngExif(png: Buffer, tiff: Buffer): Buffer {
  // 8-byte signature, then IHDR: 4 length + 4 type + 13 data + 4 CRC.
  const afterIhdr = 8 + 25
  if (png.length < afterIhdr || png.subarray(12, 16).toString('latin1') !== 'IHDR') return png
  const type = Buffer.from('eXIf', 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(tiff.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, tiff])) >>> 0)
  return Buffer.concat([png.subarray(0, afterIhdr), length, type, tiff, crc, png.subarray(afterIhdr)])
}

const ROTATE_FOR: Record<number, number> = { 5: 90, 6: 90, 7: 270, 8: 270 }

export interface DecodedHeic {
  png: Buffer
  width: number
  height: number
}

/**
 * Decode a HEIC file to PNG. `expected` is the upright size libheif reports;
 * if FFmpeg left the picture on its side, it is turned to match.
 */
export async function decodeHeic(
  filePath: string,
  data: Buffer,
  expected: { width: number; height: number; orientation?: number },
): Promise<DecodedHeic> {
  const { ffmpeg } = getBinaryPaths()
  let input = filePath
  let temp: string | null = null
  if (!input) {
    // FFmpeg needs to seek inside HEIF files, so a pipe will not do.
    temp = join(os.tmpdir(), `sqf-${randomUUID()}.heic`)
    await writeFile(temp, data)
    input = temp
  }
  try {
    let result
    try {
      result = await runProcess(
        ffmpeg,
        ['-hide_banner', '-v', 'error', '-i', input, '-frames:v', '1', '-pix_fmt', 'rgb24', '-c:v', 'png', '-compression_level', '1', '-f', 'image2pipe', 'pipe:1'],
        { timeoutMs: 120_000 },
      )
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('HEIC photos need FFmpeg, which could not be found')
      throw e
    }
    if (result.code !== 0 || !result.stdout.length) throw new Error(`Could not decode the HEIC photo: ${tailError(result.stderr)}`)
    let png = result.stdout
    let meta = await sharp(png).metadata()
    let width = meta.width ?? 0
    let height = meta.height ?? 0
    if (width !== height && width === expected.height && height === expected.width) {
      png = await sharp(png).rotate(ROTATE_FOR[expected.orientation ?? 6] ?? 90).png({ compressionLevel: 1 }).toBuffer()
      meta = await sharp(png).metadata()
      width = meta.width ?? 0
      height = meta.height ?? 0
    }
    const exif = (await sharp(data).metadata().catch(() => null))?.exif
    const tiff = exif ? exifTiff(exif) : null
    if (tiff) {
      // The pixels are upright now, so viewers must not rotate them again.
      resetTiffOrientation(tiff)
      png = addPngExif(png, tiff)
    }
    return { png, width, height }
  } finally {
    if (temp) await rm(temp, { force: true }).catch(() => undefined)
  }
}
