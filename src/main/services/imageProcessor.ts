import { open, readFile } from 'node:fs/promises'
import sharp, { type Sharp, type SharpOptions } from 'sharp'
import { resolveImageFormat, type ResolvedImageFormat } from '@shared/codecs'
import type {
  ImageInfo,
  ImageJobConfig,
  ImagePreviewRequest,
  ImagePreviewResult,
  ImageResizeConfig,
  ImageSourceFormat,
} from '@shared/types'
import { decodeBmp, isBmp } from './bmp'
import { stripJpegMetadata } from './jpegStrip'

// libvips' operation cache holds file handles open on Windows, which blocks
// overwriting or recycling the source. We always pass buffers and disable it.
sharp.cache(false)

/** Above this many pixels, previews run on a downsampled copy. */
export const PREVIEW_FULL_LIMIT = 24_000_000
/** Pixel budget for the downsampled preview. */
export const PREVIEW_PIXELS = 6_000_000

export interface LoadedImage {
  input: Buffer
  options: SharpOptions
  format: ImageSourceFormat
  /** Dimensions after EXIF orientation is applied. */
  width: number
  height: number
  hasAlpha: boolean
}

export interface CompressResult {
  data: Buffer
  format: ResolvedImageFormat
  width: number
  height: number
  qualityUsed?: number
  note?: string
  /** True when `data` is the untouched source (nothing to gain). */
  unchanged?: boolean
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function mapSharpFormat(format: string | undefined, compression?: string): ImageSourceFormat | null {
  switch (format) {
    case 'jpeg':
    case 'jpg':
      return 'jpeg'
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    case 'tiff':
      return 'tiff'
    case 'heif':
      return compression === 'av1' ? 'avif' : null
    default:
      return null
  }
}

function bmpHeaderInfo(buf: Buffer): ImageInfo {
  const headerSize = buf.readUInt32LE(14)
  const core = headerSize === 12
  const width = core ? buf.readUInt16LE(18) : buf.readInt32LE(18)
  const height = Math.abs(core ? buf.readInt16LE(20) : buf.readInt32LE(22))
  const bpp = core ? buf.readUInt16LE(24) : buf.readUInt16LE(28)
  return { kind: 'image', format: 'bmp', width, height, hasAlpha: bpp === 32 }
}

async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Reads only the header when given a path, so adding big folders stays fast. */
export async function readImageInfo(filePath: string, data?: Buffer): Promise<ImageInfo> {
  const head = data ?? (await readHead(filePath, 64))
  if (isBmp(head)) return bmpHeaderInfo(head)
  const meta = await sharp(data ?? filePath).metadata()
  const format = mapSharpFormat(meta.format, meta.compression)
  if (!format) throw new Error(`Unsupported image format: ${meta.format ?? 'unknown'}`)
  const width = meta.autoOrient?.width ?? meta.width ?? 0
  const height = meta.autoOrient?.height ?? meta.height ?? 0
  if (!width || !height) throw new Error('Could not read image dimensions')
  return {
    kind: 'image',
    format,
    width,
    height,
    hasAlpha: Boolean(meta.hasAlpha),
    orientation: meta.orientation,
  }
}

export async function loadImage(filePath: string, data?: Buffer): Promise<LoadedImage> {
  const buf = data ?? (await readFile(filePath))
  if (isBmp(buf)) {
    const bmp = decodeBmp(buf)
    return {
      input: bmp.data,
      options: { raw: { width: bmp.width, height: bmp.height, channels: bmp.channels } },
      format: 'bmp',
      width: bmp.width,
      height: bmp.height,
      hasAlpha: bmp.channels === 4,
    }
  }
  const info = await readImageInfo(filePath, buf)
  return {
    input: buf,
    options: { autoOrient: true },
    format: info.format,
    width: info.width,
    height: info.height,
    hasAlpha: info.hasAlpha,
  }
}

function openImage(img: LoadedImage): Sharp {
  return sharp(img.input, { ...img.options, failOn: 'none', limitInputPixels: false })
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Output size for a resize setting. Never enlarges. */
export function computeOutputSize(
  width: number,
  height: number,
  resize: ImageResizeConfig,
): { width: number; height: number } {
  let scale = 1
  if (resize.mode === 'percentage') {
    scale = Math.min(1, Math.max(0.01, resize.percentage / 100))
  } else if (resize.mode === 'fit') {
    const sw = resize.maxWidth > 0 ? resize.maxWidth / width : Infinity
    const sh = resize.maxHeight > 0 ? resize.maxHeight / height : Infinity
    scale = Math.min(1, sw, sh)
  }
  if (scale >= 1) return { width, height }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

interface EncodeOptions {
  lossless: boolean
  quality: number
  progressive: boolean
  megapixels: number
  pngAdaptiveFiltering?: boolean
}

export function applyEncoder(s: Sharp, format: ResolvedImageFormat, o: EncodeOptions): Sharp {
  const q = Math.round(Math.min(100, Math.max(1, o.quality)))
  const big = o.megapixels > 16
  switch (format) {
    case 'jpeg':
      return s.jpeg({
        quality: o.lossless ? 100 : q,
        mozjpeg: true,
        progressive: o.progressive,
        chromaSubsampling: o.lossless || q >= 90 ? '4:4:4' : '4:2:0',
      })
    case 'png':
      return o.lossless
        ? s.png({ compressionLevel: 9, adaptiveFiltering: o.pngAdaptiveFiltering ?? true, effort: 10, palette: false })
        : s.png({ palette: true, quality: q, effort: 10, compressionLevel: 9, dither: 1 })
    case 'webp':
      return o.lossless
        ? s.webp({ lossless: true, effort: big ? 4 : 6 })
        : s.webp({ quality: q, effort: big ? 4 : 5, smartSubsample: true })
    case 'avif':
      return o.lossless
        ? s.avif({ lossless: true, effort: 4 })
        : s.avif({ quality: q, effort: 4, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0' })
    case 'tiff':
      return o.lossless
        ? s.tiff({ compression: 'deflate', predictor: 'horizontal' })
        : s.tiff({ compression: 'jpeg', quality: q })
  }
}

interface PipelineOptions {
  width: number
  height: number
  config: ImageJobConfig
  format: ResolvedImageFormat
}

function pipeline(img: LoadedImage, p: PipelineOptions): Sharp {
  let s = openImage(img)
  if (p.width !== img.width || p.height !== img.height) {
    s = s.resize(p.width, p.height, { fit: 'fill', kernel: p.config.resize.kernel })
  }
  if (p.format === 'jpeg' && img.hasAlpha) s = s.flatten({ background: '#ffffff' })
  if (!p.config.stripMetadata && p.config.mode !== 'targetSize') s = s.keepMetadata()
  return s
}

async function encodeLossless(img: LoadedImage, p: PipelineOptions): Promise<Buffer> {
  const megapixels = (p.width * p.height) / 1e6
  const base = { lossless: true, quality: 100, progressive: p.config.progressive, megapixels }
  if (p.format !== 'png') return applyEncoder(pipeline(img, p), p.format, base).toBuffer()
  // Brute-force the two PNG filter strategies and keep the smaller file.
  const [a, b] = await Promise.all([
    applyEncoder(pipeline(img, p), 'png', { ...base, pngAdaptiveFiltering: true }).toBuffer(),
    applyEncoder(pipeline(img, p), 'png', { ...base, pngAdaptiveFiltering: false }).toBuffer(),
  ])
  return a.length <= b.length ? a : b
}

/**
 * Highest quality whose output fits in `targetBytes`. Decodes once into raw
 * pixels, then binary-searches the quality factor. If even the lowest quality
 * is too big, the image is scaled down and the search repeats.
 */
export async function encodeToTarget(
  img: LoadedImage,
  p: PipelineOptions,
  targetBytes: number,
): Promise<{ data: Buffer; quality: number; width: number; height: number; note?: string }> {
  const format = p.format
  let width = p.width
  let height = p.height
  let best: { data: Buffer; quality: number; width: number; height: number } | null = null

  for (let round = 0; round < 5; round++) {
    const raw = await pipeline(img, { ...p, width, height }).raw().toBuffer({ resolveWithObject: true })
    const rawOpts: SharpOptions = {
      raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels as 1 | 2 | 3 | 4 },
    }
    const megapixels = (width * height) / 1e6
    const encode = (quality: number): Promise<Buffer> =>
      applyEncoder(sharp(raw.data, rawOpts), format, {
        lossless: false,
        quality,
        progressive: p.config.progressive,
        megapixels,
      }).toBuffer()

    const top = await encode(95)
    if (top.length <= targetBytes) {
      return { data: top, quality: 95, width, height, note: round > 0 ? `Scaled to ${width}×${height} to fit` : undefined }
    }
    const bottom = await encode(1)
    if (bottom.length > targetBytes) {
      best = { data: bottom, quality: 1, width, height }
      // Area scales roughly with bytes, so shrink by the square root.
      const factor = Math.max(0.3, Math.min(0.9, Math.sqrt(targetBytes / bottom.length) * 0.92))
      width = Math.max(1, Math.round(width * factor))
      height = Math.max(1, Math.round(height * factor))
      continue
    }

    let lo = 1
    let hi = 95
    let fit = { data: bottom, quality: 1 }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      const out = await encode(mid)
      if (out.length <= targetBytes) {
        lo = mid
        fit = { data: out, quality: mid }
      } else {
        hi = mid
      }
    }
    return {
      ...fit,
      width,
      height,
      note: round > 0 ? `Scaled to ${width}×${height} to fit` : undefined,
    }
  }

  // Could not get under the target even after shrinking. Return the smallest.
  return { ...best!, note: 'Could not reach the target size' }
}

export interface CompressOptions {
  /** Override output dimensions (used by downsampled previews). */
  dims?: { width: number; height: number }
  /** Override the target size (used by downsampled previews). */
  targetBytes?: number
}

export async function compressLoaded(
  img: LoadedImage,
  original: Buffer,
  config: ImageJobConfig,
  opts: CompressOptions = {},
): Promise<CompressResult> {
  const format = resolveImageFormat(config.format, img.format)
  const dims = opts.dims ?? computeOutputSize(img.width, img.height, config.resize)
  const resized = dims.width !== img.width || dims.height !== img.height
  const sameFormat = format === img.format
  const p: PipelineOptions = { ...dims, config, format }

  if (config.mode === 'lossless') {
    if (format === 'jpeg' && img.format === 'jpeg' && !resized) {
      if (!config.stripMetadata) {
        return { data: original, format, ...dims, unchanged: true, note: 'Nothing to strip' }
      }
      return { data: stripJpegMetadata(original), format, ...dims, note: 'Metadata stripped, pixels untouched' }
    }
    const data = await encodeLossless(img, p)
    const note = format === 'jpeg' ? 'JPEG re-encoded at quality 100' : undefined
    return { data, format, ...dims, note }
  }

  if (config.mode === 'targetSize') {
    const target = opts.targetBytes ?? config.targetMaxSizeBytes
    if (!opts.dims && sameFormat && !resized && original.length <= target) {
      return { data: original, format, ...dims, unchanged: true, note: 'Already under the target size' }
    }
    const r = await encodeToTarget(img, p, target)
    return { data: r.data, format, width: r.width, height: r.height, qualityUsed: r.quality, note: r.note }
  }

  const data = await applyEncoder(pipeline(img, p), format, {
    lossless: false,
    quality: config.quality,
    progressive: config.progressive,
    megapixels: (dims.width * dims.height) / 1e6,
  }).toBuffer()
  return { data, format, ...dims, qualityUsed: config.quality }
}

export async function compressImage(filePath: string, config: ImageJobConfig): Promise<CompressResult & { originalBytes: number }> {
  const original = await readFile(filePath)
  const img = await loadImage(filePath, original)
  const result = await compressLoaded(img, original, config)
  return { ...result, originalBytes: original.length }
}

// ---------------------------------------------------------------------------
// Previews and thumbnails
// ---------------------------------------------------------------------------

const DISPLAYABLE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/** Something Chromium can show in an <img>. TIFF is converted to PNG. */
async function toDisplayable(data: Buffer, format: string): Promise<{ data: Buffer; mime: string }> {
  const mime = DISPLAYABLE[format]
  if (mime) return { data, mime }
  const img = await loadImage('', data)
  return { data: await openImage(img).png({ compressionLevel: 1 }).toBuffer(), mime: 'image/png' }
}

/** Downsampled copy of the source, as raw pixels, for large-image previews. */
async function downsample(img: LoadedImage, maxPixels: number): Promise<LoadedImage> {
  const scale = Math.sqrt(maxPixels / (img.width * img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const raw = await openImage(img).resize(width, height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return {
    input: raw.data,
    options: { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels as 1 | 2 | 3 | 4 } },
    format: img.format,
    width: raw.info.width,
    height: raw.info.height,
    hasAlpha: raw.info.channels === 4,
  }
}

const TILE = 512
const TILE_GRID = 3

/**
 * Estimate the full output size by compressing a 3x3 grid of full-resolution
 * tiles. Downsampling would smooth away the fine detail that drives file size,
 * so samples are taken at the real output resolution.
 */
export async function estimateFromTiles(
  img: LoadedImage,
  config: ImageJobConfig,
  dims: { width: number; height: number },
): Promise<number> {
  const format = resolveImageFormat(config.format, img.format)
  const tile = Math.min(TILE, dims.width, dims.height)
  const raw = await pipeline(img, { ...dims, config: { ...config, stripMetadata: true }, format })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const rawOpts: SharpOptions = {
    raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels as 1 | 2 | 3 | 4 },
  }
  const lossless = config.mode === 'lossless'
  const positions: Array<{ left: number; top: number }> = []
  for (let gy = 0; gy < TILE_GRID; gy++) {
    for (let gx = 0; gx < TILE_GRID; gx++) {
      positions.push({
        left: Math.round(((raw.info.width - tile) * gx) / (TILE_GRID - 1)),
        top: Math.round(((raw.info.height - tile) * gy) / (TILE_GRID - 1)),
      })
    }
  }
  const sizes = await Promise.all(
    positions.map(async ({ left, top }) => {
      const s = sharp(raw.data, rawOpts).extract({ left, top, width: tile, height: tile })
      const out = await applyEncoder(s, format, {
        lossless,
        quality: config.quality,
        progressive: config.progressive,
        megapixels: (tile * tile) / 1e6,
      }).toBuffer()
      return out.length
    }),
  )
  const bytesPerPixel = sizes.reduce((a, b) => a + b, 0) / (positions.length * tile * tile)
  return Math.round(bytesPerPixel * dims.width * dims.height)
}

function toUint8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export async function generateImagePreview(req: ImagePreviewRequest): Promise<ImagePreviewResult> {
  const started = Date.now()
  const original = await readFile(req.filePath)
  const img = await loadImage(req.filePath, original)
  const format = resolveImageFormat(req.config.format, img.format)
  const fullDims = computeOutputSize(img.width, img.height, req.config.resize)
  const large = fullDims.width * fullDims.height > PREVIEW_FULL_LIMIT

  // Comparing against an existing output file.
  if (req.resultPath) {
    const out = await readFile(req.resultPath)
    const outInfo = await readImageInfo(req.resultPath, out)
    const shown = await toDisplayable(out, outInfo.format)
    const before = req.includeBefore ? await toDisplayable(original, img.format) : undefined
    return {
      requestId: req.requestId,
      before: before ? toUint8(before.data) : undefined,
      beforeMime: before?.mime,
      after: toUint8(shown.data),
      afterMime: shown.mime,
      originalBytes: original.length,
      estimatedBytes: out.length,
      exact: true,
      outputWidth: outInfo.width,
      outputHeight: outInfo.height,
      outputFormat: outInfo.format,
      elapsedMs: Date.now() - started,
    }
  }

  const losslessJpegCopy =
    req.config.mode === 'lossless' && format === 'jpeg' && img.format === 'jpeg' && fullDims.width === img.width && fullDims.height === img.height

  if (!large || losslessJpegCopy) {
    const result = await compressLoaded(img, original, req.config)
    const after = await toDisplayable(result.data, result.format)
    const before = req.includeBefore ? await toDisplayable(original, img.format) : undefined
    return {
      requestId: req.requestId,
      before: before ? toUint8(before.data) : undefined,
      beforeMime: before?.mime,
      after: toUint8(after.data),
      afterMime: after.mime,
      originalBytes: original.length,
      estimatedBytes: result.data.length,
      exact: true,
      outputWidth: result.width,
      outputHeight: result.height,
      outputFormat: result.format,
      qualityUsed: result.qualityUsed,
      note: result.note,
      elapsedMs: Date.now() - started,
    }
  }

  // Large output: show a downsampled encode, estimate size from full-res tiles.
  const small = await downsample(img, PREVIEW_PIXELS)
  const ratio = small.width / img.width
  const dims = {
    width: Math.max(1, Math.min(small.width, Math.round(fullDims.width * ratio))),
    height: Math.max(1, Math.min(small.height, Math.round(fullDims.height * ratio))),
  }
  const pixelRatio = (fullDims.width * fullDims.height) / (dims.width * dims.height)
  const targetMode = req.config.mode === 'targetSize'
  const targetBytes = targetMode ? req.config.targetMaxSizeBytes / pixelRatio : undefined
  const [result, tileEstimate] = await Promise.all([
    compressLoaded(small, original, req.config, { dims, targetBytes }),
    targetMode ? Promise.resolve(0) : estimateFromTiles(img, req.config, fullDims),
  ])
  const after = await toDisplayable(result.data, result.format)
  const before = req.includeBefore
    ? { data: await openImage(small).png({ compressionLevel: 1 }).toBuffer(), mime: 'image/png' }
    : undefined
  return {
    requestId: req.requestId,
    before: before ? toUint8(before.data) : undefined,
    beforeMime: before?.mime,
    after: toUint8(after.data),
    afterMime: after.mime,
    originalBytes: original.length,
    estimatedBytes: targetMode ? Math.round(result.data.length * pixelRatio) : tileEstimate,
    exact: false,
    outputWidth: Math.round(result.width / ratio),
    outputHeight: Math.round(result.height / ratio),
    outputFormat: result.format,
    qualityUsed: result.qualityUsed,
    note: 'Large image: preview is downscaled and the size is estimated',
    elapsedMs: Date.now() - started,
  }
}

export async function makeImageThumbnail(filePath: string): Promise<string> {
  const img = await loadImage(filePath)
  const data = await openImage(img).resize(112, 112, { fit: 'cover' }).webp({ quality: 70 }).toBuffer()
  return `data:image/webp;base64,${data.toString('base64')}`
}
