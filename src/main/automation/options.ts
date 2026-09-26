// Turns the options people (and AI apps) give the command line or the MCP
// server into the settings the queue runs with. Starts from a Quick tab goal
// and applies only what was asked for on top.
import { CODECS, isCodecAllowedInContainer } from '@shared/codecs'
import { DEFAULT_NAME_TEMPLATE } from '@shared/naming'
import { DEFAULT_OUTPUT, GOALS, KB, MB, type Goal } from '@shared/presets'
import type {
  AudioMode,
  EncoderChoice,
  ImageJobConfig,
  ImageOutputFormat,
  OutputSettings,
  VideoCodec,
  VideoContainer,
  VideoJobConfig,
  VideoScale,
  VideoSpeedPreset,
} from '@shared/types'

export class OptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OptionError'
  }
}

export interface PhotoOptions {
  /** "original" keeps each file's format. */
  format?: ImageOutputFormat
  /** 1-100. */
  quality?: number
  /** Longest side in pixels. Never enlarges. */
  max_dimension?: number
  /** e.g. "500KB" or "2MB". Finds the best quality that fits. */
  target_size?: string | number
  lossless?: boolean
  /** Keep EXIF (camera, date, location). Stripped by default for privacy. */
  keep_metadata?: boolean
}

export interface VideoOptions {
  codec?: VideoCodec
  container?: VideoContainer
  /** Constant quality (CRF/RF). Lower is better quality and bigger. */
  quality?: number
  /** e.g. "10MB". Two-pass encode that fits the size. */
  target_size?: string | number
  resolution?: VideoScale
  /** Cap the frame rate, e.g. 30. 0 keeps the original. */
  max_fps?: number
  audio?: 'keep' | 'aac' | 'opus' | 'none'
  audio_kbps?: number
  /** "auto" uses the graphics card when one can encode the codec. */
  encoder?: EncoderChoice
  speed?: 'fastest' | 'fast' | 'medium' | 'slow'
  /** Keep the GPS location recorded by phones. Default false (removed for privacy). */
  keep_location?: boolean
}

export interface OutputOptions {
  /** same-folder (default), folder, or replace. */
  mode?: 'same-folder' | 'folder' | 'replace'
  folder?: string
  /** File name pattern, e.g. "{name}_compressed". */
  name_pattern?: string
  keep_subfolders?: boolean
  /** Keep the original when the compressed copy would be bigger. Default true. */
  keep_original_if_larger?: boolean
  /** Copy the original's modified date. Default true. */
  keep_dates?: boolean
}

export interface CompressOptions {
  goal?: string
  photo?: PhotoOptions
  video?: VideoOptions
  output?: OutputOptions
}

export interface ResolvedOptions {
  goal: Goal
  image: ImageJobConfig
  video: VideoJobConfig
  output: OutputSettings
}

/** Short names for goals, for typing and for AI apps. */
export const GOAL_ALIASES: Record<string, string> = {
  smaller: 'goal-smaller',
  default: 'goal-smaller',
  share: 'goal-share',
  web: 'goal-share',
  smallest: 'goal-smallest',
  discord: 'goal-discord',
  email: 'goal-email',
  quality: 'goal-quality',
  best: 'goal-quality',
  lossless: 'goal-quality',
}

export const goalShortName = (goal: Goal): string => goal.id.replace(/^goal-/, '')

export function resolveGoal(name?: string): Goal {
  if (!name) return GOALS[0]
  const key = name.trim().toLowerCase()
  const id = GOAL_ALIASES[key] ?? key
  const goal = GOALS.find((g) => g.id === id || g.id === `goal-${id}` || g.name.toLowerCase() === key)
  if (!goal) throw new OptionError(`Unknown goal "${name}". Use one of: ${GOALS.map(goalShortName).join(', ')}.`)
  return goal
}

/** "500KB", "10 MB", "1.5GB" or a plain number of megabytes, to bytes. */
export function parseSize(value: string | number): number {
  if (typeof value === 'number') {
    if (!(value > 0)) throw new OptionError('Sizes must be above zero')
    return Math.round(value * MB)
  }
  const m = /^\s*([\d.]+)\s*(b|kb|k|kib|mb|m|mib|gb|g|gib)?\s*$/i.exec(value)
  if (!m || !(Number(m[1]) > 0)) throw new OptionError(`"${value}" is not a size. Try "500KB" or "10MB".`)
  const n = Number(m[1])
  const unit = (m[2] ?? 'mb').toLowerCase()
  const mult = unit === 'b' ? 1 : unit.startsWith('k') ? KB : unit.startsWith('g') ? 1024 * MB : MB
  return Math.round(n * mult)
}

const IMAGE_FORMATS: ImageOutputFormat[] = ['original', 'jpeg', 'png', 'webp', 'avif']
const SCALES: VideoScale[] = ['original', '2160p', '1440p', '1080p', '720p', '480p']
const SPEEDS: Record<string, VideoSpeedPreset> = { fastest: 'ultrafast', ultrafast: 'ultrafast', fast: 'fast', medium: 'medium', slow: 'slow' }
const AUDIO: Record<string, AudioMode> = { keep: 'copy', copy: 'copy', aac: 'aac', opus: 'opus', none: 'none' }
const ENCODERS: EncoderChoice[] = ['auto', 'cpu', 'nvenc', 'qsv', 'amf', 'videotoolbox']

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  const v = value.toLowerCase() as T
  if (!allowed.includes(v)) throw new OptionError(`Unknown ${what} "${value}". Use one of: ${allowed.join(', ')}.`)
  return v
}

function intIn(value: number, min: number, max: number, what: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new OptionError(`${what} must be between ${min} and ${max}`)
  return Math.round(value)
}

export function resolveOptions(opts: CompressOptions = {}): ResolvedOptions {
  const goal = resolveGoal(opts.goal)
  const image: ImageJobConfig = { ...goal.image, resize: { ...goal.image.resize } }
  const video: VideoJobConfig = { ...goal.video }

  const p = opts.photo ?? {}
  if (p.format !== undefined) {
    image.format = oneOf(p.format === ('jpg' as ImageOutputFormat) ? 'jpeg' : p.format, IMAGE_FORMATS, 'photo format')
  }
  if (p.quality !== undefined) {
    image.quality = intIn(p.quality, 1, 100, 'Photo quality')
    image.mode = 'quality'
  }
  if (p.target_size !== undefined) {
    image.mode = 'targetSize'
    image.targetMaxSizeBytes = parseSize(p.target_size)
  }
  if (p.lossless) image.mode = 'lossless'
  if (p.max_dimension !== undefined) {
    const px = intIn(p.max_dimension, 16, 65535, 'max_dimension')
    image.resize = { ...image.resize, mode: 'fit', maxWidth: px, maxHeight: px }
  }
  if (p.keep_metadata !== undefined) image.stripMetadata = !p.keep_metadata

  const v = opts.video ?? {}
  if (v.codec !== undefined) {
    video.codec = oneOf(v.codec, Object.keys(CODECS) as VideoCodec[], 'video codec')
    video.crf = CODECS[video.codec].crfDefault
  }
  if (v.container !== undefined) video.container = oneOf(v.container, ['mp4', 'mkv', 'webm'] as const, 'container')
  if (!isCodecAllowedInContainer(video.codec, video.container)) {
    if (v.container !== undefined && v.codec !== undefined) {
      throw new OptionError(`${CODECS[video.codec].label} cannot go in ${video.container.toUpperCase()}. Use ${CODECS[video.codec].containers.join(' or ')}.`)
    }
    if (v.codec !== undefined) video.container = CODECS[video.codec].containers[0]
    else video.codec = video.container === 'webm' ? 'vp9' : 'h264'
  }
  if (video.container === 'webm' && video.audioCodec === 'aac') video.audioCodec = 'opus'
  if (v.quality !== undefined) {
    const spec = CODECS[video.codec]
    video.crf = intIn(v.quality, spec.crfMin, spec.crfMax, `Video quality for ${spec.label}`)
    video.rateControl = 'crf'
  }
  if (v.target_size !== undefined) {
    video.rateControl = 'targetSize'
    video.targetMaxSizeBytes = parseSize(v.target_size)
  }
  if (v.resolution !== undefined) video.scale = oneOf(v.resolution, SCALES, 'resolution')
  if (v.max_fps !== undefined) video.fpsLimit = intIn(v.max_fps, 0, 240, 'max_fps')
  if (v.audio !== undefined) {
    const a = AUDIO[v.audio.toLowerCase()]
    if (!a) throw new OptionError(`Unknown audio "${v.audio}". Use keep, aac, opus or none.`)
    if (a === 'aac' && video.container === 'webm') throw new OptionError('WebM files cannot hold AAC audio. Use opus.')
    video.audioCodec = a
  }
  if (v.audio_kbps !== undefined) video.audioBitrateKbps = intIn(v.audio_kbps, 32, 512, 'audio_kbps')
  if (v.encoder !== undefined) video.encoderMode = oneOf(v.encoder, ENCODERS, 'encoder')
  if (v.keep_location !== undefined) video.keepLocation = v.keep_location === true
  if (v.speed !== undefined) {
    const sp = SPEEDS[v.speed.toLowerCase()]
    if (!sp) throw new OptionError(`Unknown speed "${v.speed}". Use fastest, fast, medium or slow.`)
    video.preset = sp
  }

  const o = opts.output ?? {}
  const output: OutputSettings = { ...DEFAULT_OUTPUT }
  const mode = o.mode ?? (o.folder ? 'folder' : 'same-folder')
  if (mode === 'folder') {
    if (!o.folder) throw new OptionError('output.folder is needed when output.mode is "folder"')
    output.mode = 'folder'
    output.folder = o.folder
    output.renameInFolder = o.name_pattern !== undefined
  } else if (mode === 'replace') {
    output.mode = 'overwrite'
  } else if (mode === 'same-folder') {
    output.mode = 'suffix'
  } else {
    throw new OptionError(`Unknown output mode "${String(mode)}". Use same-folder, folder or replace.`)
  }
  output.nameTemplate = o.name_pattern?.trim() || DEFAULT_NAME_TEMPLATE
  if (o.keep_subfolders !== undefined) output.keepFolderStructure = o.keep_subfolders
  if (o.keep_original_if_larger !== undefined) output.keepOriginalIfLarger = o.keep_original_if_larger
  if (o.keep_dates !== undefined) output.preserveTimestamps = o.keep_dates

  return { goal, image, video, output }
}
