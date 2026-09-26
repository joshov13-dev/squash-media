import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import {
  CODECS,
  CONTAINER_EXTENSIONS,
  ENCODER_NAMES,
  ENCODER_LABELS,
  pickEncoderMode,
  SCALE_HEIGHTS,
  resolveAudioMode,
} from '@shared/codecs'
import type {
  AudioMode,
  EncoderMode,
  HardwareProfile,
  VideoContainer,
  VideoInfo,
  VideoJobConfig,
  VideoPreviewRequest,
  VideoPreviewResult,
  VideoSpeedPreset,
} from '@shared/types'
import { getBinaryPaths } from '../binaries'
import { AbortError, runProcess, tailError } from '../utils/process'
import {
  firstPassSpeedRatio,
  outputFrameCount,
  predictVideoFps,
  VideoEtaTracker,
  type CalibrationStore,
  type VideoWorkload,
} from './etaCalculator'

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  pix_fmt?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  nb_frames?: string
  duration?: string
  bit_rate?: string
  bits_per_raw_sample?: string
  channels?: number
  tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number }>
  disposition?: { attached_pic?: number }
}

interface ProbeJson {
  streams?: ProbeStream[]
  format?: { format_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string> }
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!d) return Number.isFinite(n) ? n : 0
  return n / d
}

function num(value: string | number | undefined): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
  return Number.isFinite(n) ? n : null
}

export function parseProbe(json: ProbeJson): VideoInfo {
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!video || !video.width || !video.height) throw new Error('No video stream found')
  const audio = streams.filter((s) => s.codec_type === 'audio')
  const subs = streams.filter((s) => s.codec_type === 'subtitle')

  const avg = parseRate(video.avg_frame_rate)
  const fps = avg > 0 && avg < 1000 ? avg : parseRate(video.r_frame_rate) || 30
  const duration = num(json.format?.duration) ?? num(video.duration) ?? 0
  const nbFrames = num(video.nb_frames)
  const totalFrames = nbFrames && nbFrames > 0 ? nbFrames : Math.max(1, Math.round(duration * fps))

  const pix = video.pix_fmt ?? 'yuv420p'
  const depthMatch = pix.match(/p(10|12|16)/)
  const bitDepth = depthMatch ? Number(depthMatch[1]) : num(video.bits_per_raw_sample) ?? 8

  // Phones store portrait video as landscape plus a rotation flag.
  const rotation = video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? num(video.tags?.rotate) ?? 0
  const sideways = Math.abs(rotation) % 180 === 90
  const bitrate = num(json.format?.bit_rate)
  const audioBitrate = num(audio[0]?.bit_rate)
  // FFmpeg's demuxer exposes this specially; some muxers only write it back
  // when it is set explicitly, rather than through -map_metadata alone.
  const creationTime = json.format?.tags?.creation_time ?? video.tags?.creation_time

  return {
    kind: 'video',
    container: (json.format?.format_name ?? 'unknown').split(',')[0],
    durationSeconds: duration,
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    fps: Math.round(fps * 1000) / 1000,
    totalFrames,
    videoCodec: video.codec_name ?? 'unknown',
    pixelFormat: pix,
    bitDepth,
    bitrateKbps: bitrate ? Math.round(bitrate / 1000) : null,
    audioCodec: audio[0]?.codec_name ?? null,
    audioChannels: audio[0]?.channels ?? null,
    audioBitrateKbps: audioBitrate ? Math.round(audioBitrate / 1000) : null,
    audioStreams: audio.length,
    subtitleStreams: subs.length,
    creationTime: creationTime || undefined,
  }
}

export async function probeVideo(filePath: string): Promise<VideoInfo> {
  const { ffprobe } = getBinaryPaths()
  const { code, stdout, stderr } = await runProcess(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeoutMs: 30_000 },
  )
  if (code !== 0) throw new Error(tailError(stderr) || 'ffprobe failed')
  return parseProbe(JSON.parse(stdout.toString('utf8')) as ProbeJson)
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Output size for a scale preset. The short side is capped; never upscales. */
export function computeVideoOutputSize(info: VideoInfo, scale: VideoJobConfig['scale']): { width: number; height: number } {
  const { width, height } = info
  if (scale !== 'original') {
    const cap = SCALE_HEIGHTS[scale]
    const short = Math.min(width, height)
    if (short > cap) {
      const factor = cap / short
      return { width: even(width * factor), height: even(height * factor) }
    }
  }
  return { width: even(width), height: even(height) }
}

export interface TrimWindow {
  start: number
  /** Seconds that will be encoded. Falls back to the full length. */
  duration: number
  trimmed: boolean
}

/** The part of the source a job encodes, clamped to the real duration. */
export function trimWindow(info: VideoInfo, config: Pick<VideoJobConfig, 'trimStart' | 'trimEnd'>): TrimWindow {
  const total = info.durationSeconds
  const start = Math.max(0, Math.min(config.trimStart ?? 0, total > 0 ? total : Number.POSITIVE_INFINITY))
  let end = config.trimEnd && config.trimEnd > 0 ? config.trimEnd : total
  if (total > 0) end = Math.min(end, total)
  const trimmed = start > 0.01 || (total > 0 && end < total - 0.01)
  const duration = end - start
  return { start, duration: trimmed && duration > 0 ? duration : total, trimmed: trimmed && duration > 0 }
}

export function computeOutputFps(info: VideoInfo, fpsLimit: number): number {
  if (fpsLimit > 0 && info.fps > fpsLimit + 0.01) return fpsLimit
  return info.fps
}

export interface ResolvedEncoder {
  mode: EncoderMode
  name: string
  note?: string
}

export function cpuEncoder(config: VideoJobConfig): ResolvedEncoder {
  return { mode: 'cpu', name: ENCODER_NAMES[config.codec].cpu! }
}

/**
 * The encoder a job will use. "auto" takes the first graphics card encoder
 * that passed the start-up test for this codec, otherwise the CPU. A named
 * encoder this PC cannot run also falls back to the CPU, with a note.
 */
export function resolveEncoder(config: VideoJobConfig, hw: Pick<HardwareProfile, 'encoderSupport'> | null): ResolvedEncoder {
  const supported = hw?.encoderSupport[config.codec] ?? ['cpu']
  const wanted = config.encoderMode
  if (wanted === 'auto') {
    const mode = pickEncoderMode('auto', config.codec, supported)
    return { mode, name: ENCODER_NAMES[config.codec][mode]! }
  }
  const name = ENCODER_NAMES[config.codec][wanted]
  if (name && (wanted === 'cpu' || supported.includes(wanted))) return { mode: wanted, name }
  return {
    ...cpuEncoder(config),
    note: `${ENCODER_LABELS[wanted]} is not available for ${CODECS[config.codec].label}, used the CPU`,
  }
}

/** Video bitrate (kbps) that lands the whole file under `targetBytes`. */
export function computeTargetBitrate(
  durationSeconds: number,
  targetBytes: number,
  audioKbps: number,
  audioStreams: number,
): number {
  if (durationSeconds <= 0) return 1000
  // Keep ~4% back for container overhead and encoder overshoot.
  const totalKbps = (targetBytes * 8 * 0.96) / 1000 / durationSeconds
  const videoKbps = totalKbps - audioKbps * Math.max(0, audioStreams)
  return Math.max(40, Math.floor(videoKbps))
}

export function audioKbpsFor(config: VideoJobConfig, info: VideoInfo, audio: AudioMode): number {
  if (audio === 'none') return 0
  if (audio === 'copy') return info.audioBitrateKbps ?? 192
  return config.audioBitrateKbps
}

// ---------------------------------------------------------------------------
// Argument building
// ---------------------------------------------------------------------------

const X26X_PRESET: Record<VideoSpeedPreset, string> = { ultrafast: 'ultrafast', fast: 'fast', medium: 'medium', slow: 'slow' }
const SVT_PRESET: Record<VideoSpeedPreset, string> = { ultrafast: '12', fast: '10', medium: '8', slow: '5' }
const NVENC_PRESET: Record<VideoSpeedPreset, string> = { ultrafast: 'p1', fast: 'p3', medium: 'p5', slow: 'p7' }
const QSV_PRESET: Record<VideoSpeedPreset, string> = { ultrafast: 'veryfast', fast: 'faster', medium: 'medium', slow: 'slower' }
const AMF_QUALITY: Record<VideoSpeedPreset, string> = { ultrafast: 'speed', fast: 'speed', medium: 'balanced', slow: 'quality' }

const MUXERS: Record<VideoContainer, string> = { mp4: 'mp4', mkv: 'matroska', webm: 'webm' }

/** Where phones and cameras put the GPS position in a video's metadata. */
export const LOCATION_TAGS = ['location', 'location-eng', 'com.apple.quicktime.location.ISO6709']

export interface BuildArgsInput {
  input: string
  /** Output file, or null for an analysis pass that discards output. */
  output: string | null
  info: VideoInfo
  config: VideoJobConfig
  encoder: ResolvedEncoder
  audio: AudioMode
  videoBitrateKbps?: number
  pass?: 1 | 2
  /** File name (relative to the working directory) for two-pass statistics. */
  passLogFile?: string
  seekSeconds?: number
  durationSeconds?: number
  /** Decode on the graphics card (-hwaccel auto). */
  hwDecode?: boolean
}

function wantsTenBit(input: BuildArgsInput): boolean {
  if (input.info.bitDepth <= 8) return false
  if (input.config.codec === 'h264') return false
  if (input.config.codec === 'vp9' && input.encoder.mode !== 'cpu') return false
  return true
}

function pixelFormat(input: BuildArgsInput): string {
  const ten = wantsTenBit(input)
  if (input.encoder.mode === 'cpu') return ten ? 'yuv420p10le' : 'yuv420p'
  return ten ? 'p010le' : 'nv12'
}

function qualityArgs(input: BuildArgsInput): string[] {
  const { config, encoder, videoBitrateKbps: kbps, pass, passLogFile } = input
  const crf = Math.round(config.crf)
  const bitrateMode = kbps !== undefined
  const args: string[] = []

  switch (encoder.name) {
    case 'libx264': {
      args.push('-preset', X26X_PRESET[config.preset])
      if (bitrateMode) args.push('-b:v', `${kbps}k`)
      else args.push('-crf', String(crf))
      if (pass) args.push('-pass', String(pass), '-passlogfile', passLogFile ?? 'ffpass')
      break
    }
    case 'libx265': {
      args.push('-preset', X26X_PRESET[config.preset])
      const params = ['log-level=error']
      if (bitrateMode) args.push('-b:v', `${kbps}k`)
      else args.push('-crf', String(crf))
      // x265 splits its params on ':', so the stats file must be a plain relative name.
      if (pass) params.push(`pass=${pass}`, `stats=${passLogFile ?? 'x265'}.log`)
      args.push('-x265-params', params.join(':'))
      break
    }
    case 'libsvtav1': {
      args.push('-preset', SVT_PRESET[config.preset])
      if (bitrateMode) args.push('-b:v', `${kbps}k`)
      else args.push('-crf', String(Math.min(63, crf)))
      break
    }
    case 'libvpx-vp9': {
      if (config.preset === 'ultrafast') args.push('-deadline', 'realtime', '-cpu-used', '8')
      else args.push('-deadline', 'good', '-cpu-used', { fast: '4', medium: '2', slow: '1' }[config.preset])
      args.push('-row-mt', '1', '-tile-columns', '2')
      if (bitrateMode) args.push('-b:v', `${kbps}k`)
      else args.push('-crf', String(Math.min(63, crf)), '-b:v', '0')
      if (pass) args.push('-pass', String(pass), '-passlogfile', passLogFile ?? 'ffpass')
      break
    }
    default: {
      if (encoder.mode === 'nvenc') {
        args.push('-preset', NVENC_PRESET[config.preset], '-tune', 'hq', '-rc', 'vbr')
        if (bitrateMode) {
          args.push('-multipass', 'fullres', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps! * 1.3)}k`, '-bufsize', `${kbps! * 2}k`)
        } else {
          args.push('-cq', String(crf), '-b:v', '0')
        }
      } else if (encoder.mode === 'qsv') {
        args.push('-preset', QSV_PRESET[config.preset])
        if (bitrateMode) {
          args.push('-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps! * 1.5)}k`, '-bufsize', `${kbps! * 2}k`)
        } else {
          // QSV's ICQ scale is 1-51 for every codec.
          const scaled = CODECS[config.codec].crfMax > 51 ? Math.round((crf * 51) / 63) : crf
          args.push('-global_quality', String(Math.max(1, scaled)))
        }
      } else if (encoder.mode === 'videotoolbox') {
        if (bitrateMode) {
          args.push('-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps! * 1.5)}k`, '-bufsize', `${kbps! * 2}k`)
        } else {
          // Constant quality runs 1-100 (higher is better). Map the CRF so
          // each codec's sweet spot lands around 55-65.
          const spec = CODECS[config.codec]
          const q = Math.round(100 - ((crf - spec.crfMin) / (spec.crfMax - spec.crfMin)) * 100 * 1.1)
          args.push('-q:v', String(Math.max(1, Math.min(100, q))))
        }
        // Fall back to Apple's software encoder instead of failing on odd sizes.
        args.push('-allow_sw', '1')
      } else if (encoder.mode === 'amf') {
        args.push('-quality', AMF_QUALITY[config.preset])
        if (bitrateMode) {
          args.push('-rc', 'vbr_peak', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps! * 1.5)}k`, '-bufsize', `${kbps! * 2}k`)
        } else {
          // AV1 on AMF uses a 0-255 QP scale.
          const qp = config.codec === 'av1' ? Math.min(255, crf * 4) : crf
          args.push('-rc', 'cqp', '-qp_i', String(qp), '-qp_p', String(qp))
          if (config.codec === 'h264') args.push('-qp_b', String(qp))
        }
      }
    }
  }
  return args
}

function audioArgs(input: BuildArgsInput): string[] {
  const { audio, config, info } = input
  if (audio === 'none' || input.pass === 1) return ['-an']
  if (audio === 'copy') return ['-c:a', 'copy']
  const args = audio === 'aac' ? ['-c:a', 'aac'] : ['-c:a', 'libopus']
  args.push('-b:a', `${config.audioBitrateKbps}k`)
  if (config.downmixStereo && (info.audioChannels ?? 2) > 2) {
    args.push('-ac', '2')
  } else if (audio === 'opus' && (info.audioChannels ?? 2) > 2) {
    // libopus rejects some surround layouts (e.g. 5.1(side)); normalise them.
    args.push('-mapping_family', '1', '-af', 'aformat=channel_layouts=7.1|5.1|stereo')
  }
  return args
}

export function buildVideoArgs(input: BuildArgsInput): string[] {
  const { info, config, encoder } = input
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error']
  // Preview clips pass an explicit window; jobs use the file's trim.
  const trim = trimWindow(info, config)
  const seek = input.seekSeconds ?? (trim.trimmed ? trim.start : 0)
  const length = input.durationSeconds ?? (trim.trimmed ? trim.duration : 0)
  if (input.hwDecode) args.push('-hwaccel', 'auto')
  if (seek > 0) args.push('-ss', seek.toFixed(3))
  args.push('-i', input.input)
  if (length > 0) args.push('-t', length.toFixed(3))

  const analysis = input.pass === 1
  const keepSubs = !analysis && config.container === 'mkv' && info.container === 'matroska' && info.subtitleStreams > 0
  args.push('-map', '0:v:0')
  if (!analysis && input.audio !== 'none') args.push('-map', '0:a?')
  if (keepSubs) args.push('-map', '0:s?', '-map', '0:t?', '-c:s', 'copy', '-c:t', 'copy')
  if (!analysis) args.push('-map_metadata', '0', '-map_chapters', '0')
  // Dates and titles are kept, but where the video was filmed is private.
  // An empty value removes the tag; these are the names phones use.
  if (!analysis && !config.keepLocation) {
    for (const tag of LOCATION_TAGS) args.push('-metadata', `${tag}=`)
  }
  // -map_metadata should carry this across on its own, but re-asserting it
  // explicitly means the recording date survives even on a muxer that does
  // not otherwise round-trip it. Phones store it on the video stream itself,
  // not just the container, so it is set in both places.
  if (!analysis && info.creationTime) {
    args.push('-metadata', `creation_time=${info.creationTime}`, '-metadata:s:v:0', `creation_time=${info.creationTime}`)
  }

  // Filters: drop frames first, then scale fewer of them.
  const filters: string[] = []
  const outFps = computeOutputFps(info, config.fpsLimit)
  if (outFps < info.fps) filters.push(`fps=${outFps}`)
  const size = computeVideoOutputSize(info, config.scale)
  if (size.width !== info.width || size.height !== info.height) {
    filters.push(`scale=${size.width}:${size.height}:flags=lanczos`)
  }
  if (filters.length) args.push('-vf', filters.join(','))

  args.push('-c:v', encoder.name, ...qualityArgs(input), '-pix_fmt', pixelFormat(input))
  if (config.codec === 'hevc' && config.container === 'mp4') args.push('-tag:v', 'hvc1')
  args.push(...audioArgs(input))

  args.push('-progress', 'pipe:1', '-nostats')
  if (analysis || !input.output) {
    args.push('-f', 'null', '-')
  } else {
    // +use_metadata_tags: some FFmpeg builds otherwise drop creation_time
    // from MP4 output, since it isn't one of the handful of tags the mov
    // muxer writes by default.
    if (config.container === 'mp4') args.push('-movflags', '+faststart+use_metadata_tags')
    args.push('-f', MUXERS[config.container], input.output)
  }
  return args
}

// ---------------------------------------------------------------------------
// Progress parsing
// ---------------------------------------------------------------------------

export interface FfmpegProgress {
  frame: number | null
  fps: number | null
  outTimeSeconds: number | null
  speed: number | null
  totalSizeBytes: number | null
  done: boolean
}

/** Parses `-progress pipe:1` output. Feed it chunks; it emits once per block. */
export class ProgressParser {
  private buffer = ''
  private current: Record<string, string> = {}

  constructor(private readonly onProgress: (p: FfmpegProgress) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq)
      const value = line.slice(eq + 1)
      this.current[key] = value
      if (key === 'progress') {
        this.onProgress(this.snapshot(value === 'end'))
        this.current = {}
      }
    }
  }

  private snapshot(done: boolean): FfmpegProgress {
    const c = this.current
    const f = (k: string): number | null => {
      const n = Number.parseFloat(c[k] ?? '')
      return Number.isFinite(n) ? n : null
    }
    const us = f('out_time_us') ?? f('out_time_ms')
    return {
      frame: f('frame'),
      fps: f('fps'),
      outTimeSeconds: us !== null && us >= 0 ? us / 1e6 : null,
      speed: c.speed ? Number.parseFloat(c.speed) || null : null,
      totalSizeBytes: f('total_size'),
      done,
    }
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export interface VideoProgressEvent {
  percent: number
  fps: number
  speed: number | null
  etaSeconds: number
  phase?: string
}

export interface EncodeVideoOptions {
  input: string
  output: string
  info: VideoInfo
  config: VideoJobConfig
  hardware: HardwareProfile | null
  calibration?: CalibrationStore
  signal?: AbortSignal
  onProgress?: (p: VideoProgressEvent) => void
  /** Decode on the graphics card when a graphics card encoder is used. */
  hwDecode?: boolean
  /** Run FFmpeg at below-normal priority. */
  lowPriority?: boolean
}

export interface EncodeVideoResult {
  bytes: number
  encoder: ResolvedEncoder
  notes: string[]
  /** Measured average encode fps, for calibration. */
  measuredFps: number
  predictedFps: number
}

const svtEnv = { ...process.env, SVT_LOG: '1' }

async function runFfmpeg(
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal; onProgress?: (p: FfmpegProgress) => void; lowPriority?: boolean },
): Promise<void> {
  const { ffmpeg } = getBinaryPaths()
  const parser = new ProgressParser((p) => opts.onProgress?.(p))
  const { code, stderr } = await runProcess(ffmpeg, args, {
    cwd: opts.cwd,
    env: svtEnv,
    signal: opts.signal,
    priority: opts.lowPriority ? os.constants.priority.PRIORITY_BELOW_NORMAL : undefined,
    onStdout: (chunk) => parser.push(chunk.toString('utf8')),
  })
  if (code !== 0) throw new Error(tailError(stderr))
}

export function planWorkload(info: VideoInfo, config: VideoJobConfig, encoder: ResolvedEncoder): VideoWorkload {
  const size = computeVideoOutputSize(info, config.scale)
  const bitrateMode = config.rateControl !== 'crf'
  return {
    info,
    codec: config.codec,
    mode: encoder.mode,
    preset: config.preset,
    outputWidth: size.width,
    outputHeight: size.height,
    outputFps: computeOutputFps(info, config.fpsLimit),
    durationSeconds: trimWindow(info, config).duration,
    passes: bitrateMode && config.twoPass && supportsTwoPass(encoder) ? 2 : 1,
  }
}

export function supportsTwoPass(encoder: ResolvedEncoder): boolean {
  return encoder.name === 'libx264' || encoder.name === 'libx265' || encoder.name === 'libvpx-vp9'
}

interface Attempt {
  encoder: ResolvedEncoder
  hwDecode: boolean
}

/**
 * Graphics card encodes can fail on driver quirks or unusual files. Rather
 * than fail the job (and stall a big batch), try again without GPU decoding,
 * then on the CPU.
 */
export function planAttempts(primary: ResolvedEncoder, config: VideoJobConfig, hwDecode: boolean): Attempt[] {
  if (primary.mode === 'cpu') return [{ encoder: primary, hwDecode: false }]
  const attempts: Attempt[] = []
  if (hwDecode) attempts.push({ encoder: primary, hwDecode: true })
  attempts.push({ encoder: primary, hwDecode: false })
  attempts.push({ encoder: cpuEncoder(config), hwDecode: false })
  return attempts
}

export async function encodeVideo(o: EncodeVideoOptions): Promise<EncodeVideoResult> {
  const primary = resolveEncoder(o.config, o.hardware)
  const attempts = planAttempts(primary, o.config, o.hwDecode ?? false)
  let firstError: unknown
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]
    try {
      const result = await encodeWith(o, attempt, i > 0 && attempt.encoder.mode === 'cpu' && primary.mode !== 'cpu')
      if (attempt.encoder.mode !== primary.mode) {
        result.notes.unshift(`The ${ENCODER_LABELS[primary.mode]} encoder failed, so the CPU was used`)
      }
      return result
    } catch (e) {
      if (e instanceof AbortError || o.signal?.aborted) throw e
      firstError ??= e
      if (i === attempts.length - 1) throw firstError
    }
  }
  throw firstError
}

async function encodeWith(o: EncodeVideoOptions, plan: Attempt, retryingOnCpu: boolean): Promise<EncodeVideoResult> {
  const { info, config } = o
  const { encoder } = plan
  const audio = resolveAudioMode(config.container, config.audioCodec, info.audioCodec)
  const notes: string[] = []
  if (encoder.note) notes.push(encoder.note)
  if (audio !== config.audioCodec && config.audioCodec !== 'none' && info.audioCodec) {
    notes.push(audio === 'none' ? 'No audio' : `Audio re-encoded as ${audio.toUpperCase()} for ${config.container.toUpperCase()}`)
  }

  const workload = planWorkload(info, config, encoder)
  const predictedFps = predictVideoFps(workload, o.hardware?.performanceScore ?? 1, o.calibration)
  const totalFrames = outputFrameCount(info, workload.outputFps, workload.durationSeconds)

  let bitrate: number | undefined
  if (config.rateControl === 'bitrate') bitrate = config.targetBitrateKbps
  if (config.rateControl === 'targetSize') {
    bitrate = computeTargetBitrate(workload.durationSeconds, config.targetMaxSizeBytes, audioKbpsFor(config, info, audio), audio === 'none' ? 0 : info.audioStreams)
    if (bitrate < 150) notes.push(`Very low bitrate (${bitrate} kbps). Try a smaller resolution`)
  }

  const workDir = await mkdtemp(join(os.tmpdir(), 'squashmedia-'))
  let frameSeconds = 0
  let framesDone = 0
  try {
    const maxAttempts = config.rateControl === 'targetSize' ? 3 : 1
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tracker = new VideoEtaTracker(totalFrames, predictedFps, workload.passes, firstPassSpeedRatio(config.codec, encoder.mode))
      for (let pass = 1; pass <= workload.passes; pass++) {
        const passArg = workload.passes > 1 ? (pass as 1 | 2) : undefined
        const args = buildVideoArgs({
          input: o.input,
          output: pass === workload.passes ? o.output : null,
          info,
          config,
          encoder,
          audio,
          videoBitrateKbps: bitrate,
          pass: passArg,
          passLogFile: 'ffpass',
          hwDecode: plan.hwDecode,
        })
        const started = Date.now()
        tracker.startPass(pass, started)
        let lastFrame = 0
        const phaseParts: string[] = []
        if (retryingOnCpu) phaseParts.push('Retrying on the CPU')
        if (workload.passes > 1) phaseParts.push(`Pass ${pass} of ${workload.passes}`)
        if (attempt > 1) phaseParts.push(`Refit ${attempt - 1}`)
        await runFfmpeg(args, {
          cwd: workDir,
          signal: o.signal,
          lowPriority: o.lowPriority,
          onProgress: (p) => {
            const frame = p.outTimeSeconds !== null ? p.outTimeSeconds * workload.outputFps : (p.frame ?? 0)
            lastFrame = Math.max(lastFrame, frame)
            const snap = tracker.update(lastFrame)
            o.onProgress?.({
              percent: snap.percent,
              fps: p.fps && p.fps > 0 ? p.fps : snap.fps,
              speed: p.speed,
              etaSeconds: snap.etaSeconds,
              phase: phaseParts.join(' · ') || undefined,
            })
          },
        })
        if (pass === workload.passes) {
          frameSeconds += (Date.now() - started) / 1000
          framesDone += lastFrame
        }
      }

      const bytes = (await stat(o.output)).size
      if (config.rateControl !== 'targetSize' || bytes <= config.targetMaxSizeBytes || attempt === maxAttempts || !bitrate) {
        if (config.rateControl === 'targetSize' && bytes > config.targetMaxSizeBytes) notes.push('Still over the target size')
        if (attempt > 1) notes.push(`Re-encoded ${attempt - 1}× to fit the target`)
        return {
          bytes,
          encoder,
          notes,
          measuredFps: frameSeconds > 0 ? framesDone / frameSeconds : predictedFps,
          predictedFps,
        }
      }
      // Overshot: scale the bitrate down by the miss and go again.
      bitrate = Math.max(40, Math.floor(bitrate * (config.targetMaxSizeBytes / bytes) * 0.97))
    }
    throw new Error('Unreachable')
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Frames, thumbnails and preview clips
// ---------------------------------------------------------------------------

export async function extractFrame(
  filePath: string,
  atSeconds: number,
  opts: { width?: number; format?: 'png' | 'jpeg'; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const { ffmpeg } = getBinaryPaths()
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error']
  if (atSeconds > 0) args.push('-ss', atSeconds.toFixed(3))
  args.push('-i', filePath, '-frames:v', '1', '-map', '0:v:0')
  if (opts.width) args.push('-vf', `scale=${opts.width}:-2`)
  if (opts.format === 'jpeg') args.push('-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', '-')
  else args.push('-c:v', 'png', '-compression_level', '1', '-f', 'image2pipe', '-')
  const { code, stdout, stderr } = await runProcess(ffmpeg, args, { timeoutMs: 60_000, signal: opts.signal })
  if (code !== 0 || stdout.length === 0) throw new Error(tailError(stderr) || 'Could not read a frame')
  return stdout
}

export async function makeVideoThumbnail(filePath: string, info: VideoInfo): Promise<string> {
  const at = Math.min(10, info.durationSeconds * 0.1)
  const data = await extractFrame(filePath, at, { width: 640, format: 'jpeg' })
  return `data:image/jpeg;base64,${data.toString('base64')}`
}

function toUint8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

/**
 * Encode a short clip from the middle of the video with the current settings,
 * then grab the same frame from source and clip for a side-by-side view.
 * The clip also gives a real measured encode speed and a size estimate.
 */
export async function generateVideoPreview(
  req: VideoPreviewRequest,
  hardware: HardwareProfile | null,
  signal?: AbortSignal,
): Promise<VideoPreviewResult> {
  const { info, config } = req
  const window = trimWindow(info, config)
  const length = window.duration
  const sampleSeconds = Math.min(4, length > 0 ? length : 4)
  const start = window.start + (length > sampleSeconds * 2 ? length * 0.4 : 0)
  let encoder = resolveEncoder(config, hardware)
  const audio = resolveAudioMode(config.container, config.audioCodec, info.audioCodec)
  const audioKbps = audioKbpsFor(config, info, audio)

  let bitrate: number | undefined
  if (config.rateControl === 'bitrate') bitrate = config.targetBitrateKbps
  if (config.rateControl === 'targetSize') {
    bitrate = computeTargetBitrate(length, config.targetMaxSizeBytes, audioKbps, audio === 'none' ? 0 : info.audioStreams)
  }
  let fallbackNote: string | undefined

  const workDir = await mkdtemp(join(os.tmpdir(), 'squashmedia-preview-'))
  const samplePath = join(workDir, `sample${CONTAINER_EXTENSIONS[config.container]}`)
  try {
    let firstAt = 0
    let firstFrame = 0
    let lastAt = 0
    let lastFrame = 0
    const outFps = computeOutputFps(info, config.fpsLimit)
    let began = Date.now()
    const sample = (): Promise<void> => {
      firstAt = firstFrame = lastAt = lastFrame = 0
      began = Date.now()
      const args = buildVideoArgs({
        input: req.filePath,
        output: samplePath,
        info,
        config,
        encoder,
        audio,
        videoBitrateKbps: bitrate,
        seekSeconds: start,
        durationSeconds: sampleSeconds,
      })
      return runFfmpeg(args, {
        cwd: workDir,
        signal,
        onProgress: (p) => {
          const frame = p.outTimeSeconds !== null ? p.outTimeSeconds * outFps : (p.frame ?? 0)
          const now = Date.now()
          if (!firstAt && frame > 0) {
            firstAt = now
            firstFrame = frame
          }
          lastAt = now
          lastFrame = frame
        },
      })
    }
    try {
      await sample()
    } catch (e) {
      // Same safety net as real jobs: a graphics card failure falls back to the CPU.
      if (encoder.mode === 'cpu' || signal?.aborted) throw e
      fallbackNote = `The ${ENCODER_LABELS[encoder.mode]} encoder failed, so the CPU was used`
      encoder = cpuEncoder(config)
      await sample()
    }
    const elapsed = (Date.now() - began) / 1000
    const steady = lastAt > firstAt && lastFrame > firstFrame ? (lastFrame - firstFrame) / ((lastAt - firstAt) / 1000) : 0
    const encodeFps = steady > 0 ? steady : (sampleSeconds * outFps) / Math.max(0.1, elapsed)

    const sampleBytes = (await stat(samplePath)).size
    const mid = sampleSeconds / 2
    const [before, after] = await Promise.all([
      extractFrame(req.filePath, start + mid, { signal }),
      extractFrame(samplePath, mid, { signal }),
    ])

    let estimatedBytes = Math.round((sampleBytes / sampleSeconds) * length)
    if (config.rateControl === 'targetSize') estimatedBytes = Math.min(estimatedBytes, config.targetMaxSizeBytes)
    if (config.rateControl === 'bitrate') estimatedBytes = Math.round(((bitrate! + audioKbps) * 1000 * length) / 8)

    const workload = planWorkload(info, config, encoder)
    const frames = outputFrameCount(info, workload.outputFps, workload.durationSeconds)
    let estimatedEncodeSeconds = frames / encodeFps
    if (workload.passes > 1) estimatedEncodeSeconds += estimatedEncodeSeconds / firstPassSpeedRatio(config.codec, encoder.mode)

    const size = computeVideoOutputSize(info, config.scale)
    return {
      before: toUint8(before),
      after: toUint8(after),
      mime: 'image/png',
      sampleSeconds,
      sampleBytes,
      estimatedBytes,
      encodeFps: Math.round(encodeFps * 10) / 10,
      estimatedEncodeSeconds,
      outputWidth: size.width,
      outputHeight: size.height,
      encoderUsed: encoder.name,
      note: fallbackNote ?? encoder.note,
    }
  } catch (e) {
    if (signal?.aborted) throw new AbortError()
    throw e
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
