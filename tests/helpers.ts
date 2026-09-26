import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { getBinaryPaths } from '../src/main/binaries'
import { runProcess } from '../src/main/utils/process'

export async function tempDir(prefix = 'sqm-test-'): Promise<string> {
  return mkdtemp(join(os.tmpdir(), prefix))
}

let ffmpegOk: boolean | null = null

/**
 * True when an ffmpeg binary is available (bundled or on PATH). Video and
 * HEIC tests skip without it. CI sets SQUASHMEDIA_REQUIRE_FFMPEG so a failed
 * download fails the run instead of quietly skipping those tests.
 */
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegOk === null) {
    const { ffmpeg, bundled } = getBinaryPaths()
    if (bundled && !existsSync(ffmpeg)) ffmpegOk = false
    else {
      try {
        const { code } = await runProcess(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 })
        ffmpegOk = code === 0
      } catch {
        ffmpegOk = false
      }
    }
  }
  if (!ffmpegOk && process.env.SQUASHMEDIA_REQUIRE_FFMPEG) {
    throw new Error('FFmpeg was not found, so the video and HEIC tests would be skipped. Run npm run fetch:ffmpeg first.')
  }
  return ffmpegOk
}

/** Render a short synthetic test clip with ffmpeg's lavfi sources. */
export async function makeTestVideo(
  path: string,
  opts: { seconds?: number; width?: number; height?: number; fps?: number; audio?: boolean; codec?: string } = {},
): Promise<void> {
  const { ffmpeg } = getBinaryPaths()
  const { seconds = 3, width = 640, height = 360, fps = 30, audio = true, codec = 'libx264' } = opts
  const args = ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=${fps}:d=${seconds}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-ac', '2')
  args.push('-c:v', codec, '-pix_fmt', 'yuv420p', '-b:v', '3M')
  if (audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest')
  args.push(path)
  const { code, stderr } = await runProcess(ffmpeg, args, { timeoutMs: 120_000 })
  if (code !== 0) throw new Error(stderr)
}

// ---------------------------------------------------------------------------
// A tiny HEIC writer, so tests need no third-party sample photos. FFmpeg
// encodes one HEVC frame into an MP4; the hvcC box and sample are lifted out
// and wrapped in the HEIF boxes an iPhone photo uses.
// ---------------------------------------------------------------------------

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length + 8)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

function fullBox(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  const vf = Buffer.alloc(4)
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff))
  return box(type, vf, ...parts)
}

const u8 = (n: number): Buffer => Buffer.from([n])
const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

/** Find a child box by path, e.g. ['moov', 'trak', 'mdia']. Returns the whole box. */
function findBox(buf: Buffer, path: string[], start = 0, end = buf.length): Buffer | null {
  const skip: Record<string, number> = { stsd: 8, hvc1: 78 }
  let o = start
  while (o + 8 <= end) {
    const size = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    if (size < 8) return null
    if (type === path[0]) {
      if (path.length === 1) return buf.subarray(o, o + size)
      return findBox(buf, path.slice(1), o + 8 + (skip[type] ?? 0), o + size)
    }
    o += size
  }
  return null
}

/** Little-endian TIFF with an Orientation tag and a Make string, for EXIF tests. */
export function makeTestExif(orientation: number, make: string): Buffer {
  const makeBytes = Buffer.from(make + '\0', 'latin1')
  const ifd = Buffer.alloc(2 + 2 * 12 + 4)
  ifd.writeUInt16LE(2, 0)
  // 0x010F Make, ASCII, stored after the IFD.
  ifd.writeUInt16LE(0x010f, 2)
  ifd.writeUInt16LE(2, 4)
  ifd.writeUInt32LE(makeBytes.length, 6)
  ifd.writeUInt32LE(8 + ifd.length, 10)
  // 0x0112 Orientation, SHORT.
  ifd.writeUInt16LE(0x0112, 14)
  ifd.writeUInt16LE(3, 16)
  ifd.writeUInt32LE(1, 18)
  ifd.writeUInt16LE(orientation, 22)
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])
  return Buffer.concat([header, ifd, makeBytes])
}

export async function makeTestHeic(
  path: string,
  opts: { width?: number; height?: number; exif?: Buffer; rotateQuarterTurns?: number } = {},
): Promise<void> {
  const { width = 320, height = 240, exif, rotateQuarterTurns = 0 } = opts
  const { ffmpeg } = getBinaryPaths()
  const mp4 = `${path}.mp4`
  const { code, stderr } = await runProcess(
    ffmpeg,
    ['-hide_banner', '-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:d=1`, '-frames:v', '1', '-c:v', 'libx265', '-x265-params', 'log-level=none', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', mp4],
    { timeoutMs: 60_000 },
  )
  if (code !== 0) throw new Error(stderr)
  const { readFile, rm, writeFile } = await import('node:fs/promises')
  const video = await readFile(mp4)
  await rm(mp4, { force: true })
  const hvcC = findBox(video, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'hvc1', 'hvcC'])
  const mdat = findBox(video, ['mdat'])
  if (!hvcC || !mdat) throw new Error('Could not read the HEVC sample')
  const image = mdat.subarray(8)
  const exifItem = exif ? Buffer.concat([u32(6), Buffer.from('Exif\0\0', 'latin1'), exif]) : null

  const ftyp = box('ftyp', Buffer.from('heic', 'latin1'), u32(0), Buffer.from('mif1heic', 'latin1'))
  const buildMeta = (imageOffset: number): Buffer => {
    const items = [{ id: 1, offset: imageOffset, length: image.length }]
    if (exifItem) items.push({ id: 2, offset: imageOffset + image.length, length: exifItem.length })
    const iloc = fullBox(
      'iloc',
      0,
      0,
      u8(0x44),
      u8(0x00),
      u16(items.length),
      ...items.map((it) => Buffer.concat([u16(it.id), u16(0), u16(1), u32(it.offset), u32(it.length)])),
    )
    const infe = (id: number, type: string): Buffer => fullBox('infe', 2, 0, u16(id), u16(0), Buffer.from(type, 'latin1'), u8(0))
    const infes = [infe(1, 'hvc1')]
    if (exifItem) infes.push(infe(2, 'Exif'))
    const props = [hvcC, fullBox('ispe', 0, 0, u32(width), u32(height))]
    const assoc = [0x81, 0x02]
    if (rotateQuarterTurns) {
      props.push(box('irot', u8(rotateQuarterTurns & 3)))
      assoc.push(0x83)
    }
    const parts = [
      fullBox('hdlr', 0, 0, u32(0), Buffer.from('pict', 'latin1'), u32(0), u32(0), u32(0), u8(0)),
      fullBox('pitm', 0, 0, u16(1)),
      iloc,
      fullBox('iinf', 0, 0, u16(infes.length), ...infes),
    ]
    if (exifItem) parts.push(fullBox('iref', 0, 0, box('cdsc', u16(2), u16(1), u16(1))))
    parts.push(box('iprp', box('ipco', ...props), fullBox('ipma', 0, 0, u32(1), u16(1), u8(assoc.length), Buffer.from(assoc))))
    return fullBox('meta', 0, 0, ...parts)
  }
  const metaSize = buildMeta(0).length
  const meta = buildMeta(ftyp.length + metaSize + 8)
  await writeFile(path, Buffer.concat([ftyp, meta, box('mdat', image, ...(exifItem ? [exifItem] : []))]))
}
