import { readFileSync, writeFileSync } from 'node:fs'
import type {
  EncoderMode,
  ImageCompressionMode,
  VideoCodec,
  VideoInfo,
  VideoSpeedPreset,
} from '@shared/types'
import type { ResolvedImageFormat } from '@shared/codecs'

// ---------------------------------------------------------------------------
// Calibration: remembers how far real runs were from the model on this PC,
// so estimates get better the more the app is used.
// ---------------------------------------------------------------------------

export class CalibrationStore {
  private factors = new Map<string, number>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private readonly filePath?: string) {
    if (!filePath) return
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, number>
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number' && Number.isFinite(v)) this.factors.set(k, v)
      }
    } catch {
      // First run or unreadable file: start fresh.
    }
  }

  get(key: string): number {
    return this.factors.get(key) ?? 1
  }

  /** Blend in a new measured/predicted ratio. */
  record(key: string, ratio: number, alpha = 0.35): void {
    if (!Number.isFinite(ratio) || ratio <= 0) return
    const clamped = Math.min(10, Math.max(0.1, ratio))
    const prev = this.factors.get(key)
    this.factors.set(key, prev === undefined ? clamped : prev * (1 - alpha) + clamped * alpha)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (!this.filePath || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        writeFileSync(this.filePath!, JSON.stringify(Object.fromEntries(this.factors), null, 2))
      } catch {
        // Not fatal: calibration only improves estimates.
      }
    }, 2000)
  }
}

// ---------------------------------------------------------------------------
// Video: prior throughput model
// ---------------------------------------------------------------------------

/** Megapixels per second one encoder manages at performance score 1.0. */
const CPU_MPX_PER_SEC: Record<VideoCodec, Record<VideoSpeedPreset, number>> = {
  h264: { ultrafast: 900, fast: 320, medium: 200, slow: 100 },
  hevc: { ultrafast: 260, fast: 90, medium: 45, slow: 18 },
  av1: { ultrafast: 320, fast: 150, medium: 60, slow: 18 },
  vp9: { ultrafast: 160, fast: 70, medium: 35, slow: 14 },
}

/** GPU encoders barely care about the CPU; these are fixed-function speeds. */
const GPU_MPX_PER_SEC: Record<Exclude<EncoderMode, 'cpu'>, number> = {
  nvenc: 520,
  qsv: 380,
  amf: 380,
}

const GPU_PRESET_FACTOR: Record<VideoSpeedPreset, number> = {
  ultrafast: 1.35,
  fast: 1.1,
  medium: 1,
  slow: 0.7,
}

/** Decoding the source also costs time. Megapixels per second at score 1.0. */
function decodeMpxPerSec(sourceCodec: string): number {
  const c = sourceCodec.toLowerCase()
  if (c.includes('av1')) return 300
  if (c.includes('hevc') || c.includes('h265')) return 500
  if (c.includes('vp9')) return 420
  if (c.includes('prores') || c.includes('dnxh')) return 350
  return 800
}

/** How much faster the first pass runs than the second. */
export function firstPassSpeedRatio(codec: VideoCodec, mode: EncoderMode): number {
  if (mode !== 'cpu') return 1
  if (codec === 'vp9') return 2.5
  if (codec === 'hevc') return 1.6
  return 2
}

export interface VideoWorkload {
  info: VideoInfo
  codec: VideoCodec
  mode: EncoderMode
  preset: VideoSpeedPreset
  outputWidth: number
  outputHeight: number
  outputFps: number
  passes: number
}

export function calibrationKey(codec: VideoCodec, mode: EncoderMode, preset: VideoSpeedPreset): string {
  return `video:${codec}:${mode}:${preset}`
}

/** Frames per second expected before any measurement exists. */
export function predictVideoFps(w: VideoWorkload, performanceScore: number, calibration?: CalibrationStore): number {
  const outMpx = Math.max(0.01, (w.outputWidth * w.outputHeight) / 1e6)
  const srcMpx = Math.max(0.01, (w.info.width * w.info.height) / 1e6)
  const encodeMpx =
    w.mode === 'cpu'
      ? CPU_MPX_PER_SEC[w.codec][w.preset] * performanceScore
      : GPU_MPX_PER_SEC[w.mode] * GPU_PRESET_FACTOR[w.preset]
  const encodeFps = encodeMpx / outMpx
  const decodeFps = (decodeMpxPerSec(w.info.videoCodec) * performanceScore) / srcMpx
  // Encode and decode run in a pipeline but compete for the same CPU.
  const fps = 1 / (1 / encodeFps + 1 / decodeFps)
  const factor = calibration?.get(calibrationKey(w.codec, w.mode, w.preset)) ?? 1
  return Math.max(0.2, fps / factor)
}

export function outputFrameCount(info: VideoInfo, outputFps: number): number {
  if (info.durationSeconds > 0 && outputFps > 0) return Math.max(1, Math.round(info.durationSeconds * outputFps))
  return Math.max(1, info.totalFrames)
}

/** Whole-job estimate in seconds, before encoding starts. */
export function predictVideoSeconds(w: VideoWorkload, performanceScore: number, calibration?: CalibrationStore): number {
  const fps = predictVideoFps(w, performanceScore, calibration)
  const frames = outputFrameCount(w.info, w.outputFps)
  const secondPass = frames / fps
  if (w.passes < 2) return secondPass
  return secondPass + secondPass / firstPassSpeedRatio(w.codec, w.mode)
}

// ---------------------------------------------------------------------------
// Video: live ETA while ffmpeg runs
// ---------------------------------------------------------------------------

interface Sample {
  t: number
  frame: number
}

export interface VideoEtaSnapshot {
  fps: number
  etaSeconds: number
  percent: number
}

/**
 * Remaining time = remaining frames / current fps, where "current fps" leans
 * on the last few seconds so thermal throttling and scene changes show up
 * quickly, and on the hardware prior while the encoder is still warming up.
 */
export class VideoEtaTracker {
  private samples: Sample[] = []
  private passStart = 0
  private pass = 1
  private lastFps: number

  constructor(
    private readonly totalFrames: number,
    private readonly priorFps: number,
    private readonly passes = 1,
    private readonly firstPassRatio = 2,
    private readonly windowMs = 5000,
    private readonly recentWeight = 0.7,
  ) {
    this.lastFps = priorFps
  }

  startPass(pass: number, now = Date.now()): void {
    this.pass = pass
    this.samples = []
    this.passStart = now
  }

  update(frame: number, now = Date.now()): VideoEtaSnapshot {
    if (this.samples.length === 0 && this.passStart === 0) this.passStart = now
    this.samples.push({ t: now, frame })
    while (this.samples.length > 2 && now - this.samples[0].t > this.windowMs) this.samples.shift()

    const elapsed = (now - this.passStart) / 1000
    const overallFps = elapsed > 0 ? frame / elapsed : 0
    const first = this.samples[0]
    const dt = (now - first.t) / 1000
    const recentFps = dt >= 0.5 ? (frame - first.frame) / dt : overallFps

    let measured = overallFps
    if (elapsed > this.windowMs / 1000 && recentFps > 0) {
      measured = this.recentWeight * recentFps + (1 - this.recentWeight) * overallFps
    } else if (recentFps > 0) {
      measured = recentFps
    }

    // Warm-up: trust the prior at first, then hand over to measurements.
    const trust = Math.min(1, elapsed / 3, frame / 30)
    let fps = measured > 0 ? trust * measured + (1 - trust) * this.passPrior() : this.passPrior()
    if (!Number.isFinite(fps) || fps <= 0) fps = this.lastFps
    this.lastFps = fps

    const remainingThisPass = Math.max(0, this.totalFrames - frame) / fps
    let etaSeconds = remainingThisPass
    if (this.passes > 1 && this.pass === 1) {
      // Second pass runs slower than the first.
      etaSeconds += this.totalFrames / (fps / this.firstPassRatio)
    }

    const passFraction = Math.min(1, frame / this.totalFrames)
    let percent = passFraction * 100
    if (this.passes > 1) {
      const firstWeight = 1 / (this.firstPassRatio + 1)
      percent = this.pass === 1 ? passFraction * firstWeight * 100 : (firstWeight + passFraction * (1 - firstWeight)) * 100
    }

    return { fps, etaSeconds, percent: Math.min(99.9, percent) }
  }

  private passPrior(): number {
    if (this.passes > 1 && this.pass === 1) return this.priorFps * this.firstPassRatio
    return this.priorFps
  }
}

// ---------------------------------------------------------------------------
// Images: seconds per megapixel, learned per format
// ---------------------------------------------------------------------------

const IMAGE_SEC_PER_MPX: Record<ResolvedImageFormat, Record<ImageCompressionMode, number>> = {
  jpeg: { quality: 0.05, lossless: 0.01, targetSize: 0.22 },
  png: { quality: 0.12, lossless: 0.45, targetSize: 0.6 },
  webp: { quality: 0.08, lossless: 0.6, targetSize: 0.4 },
  avif: { quality: 0.35, lossless: 1.1, targetSize: 1.8 },
  tiff: { quality: 0.03, lossless: 0.05, targetSize: 0.15 },
}

export function imageKey(format: ResolvedImageFormat, mode: ImageCompressionMode): string {
  return `image:${format}:${mode}`
}

export function predictImageSeconds(
  megapixels: number,
  format: ResolvedImageFormat,
  mode: ImageCompressionMode,
  performanceScore: number,
  calibration?: CalibrationStore,
): number {
  const base = IMAGE_SEC_PER_MPX[format][mode] * Math.max(0.05, megapixels)
  const factor = calibration?.get(imageKey(format, mode)) ?? 1
  // Fixed overhead for file IO and pipeline setup.
  return (0.04 + base / performanceScore) * factor
}

/** Parallel image jobs share libvips threads, so extra lanes help less than linearly. */
export function imageLaneSpeedup(concurrency: number): number {
  return 1 + 0.5 * Math.max(0, concurrency - 1)
}
