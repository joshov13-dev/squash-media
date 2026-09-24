import type {
  AudioMode,
  EncoderChoice,
  EncoderMode,
  HardwareEncoderMode,
  ImageOutputFormat,
  ImageSourceFormat,
  VideoCodec,
  VideoContainer,
  VideoScale,
} from './types'

export const IMAGE_EXTENSIONS: Record<string, ImageSourceFormat> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.jfif': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.avif': 'avif',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.bmp': 'bmp',
}

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.wmv',
  '.flv',
  '.mts',
  '.m2ts',
  '.ts',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ogv',
])

export interface CodecSpec {
  label: string
  /** Lowest and highest quality value on the encoder's own scale. */
  crfMin: number
  crfMax: number
  crfDefault: number
  /** Range HandBrake-style users usually want. */
  sweetSpot: [number, number]
  containers: VideoContainer[]
}

export const CODECS: Record<VideoCodec, CodecSpec> = {
  h264: {
    label: 'H.264 (AVC)',
    crfMin: 0,
    crfMax: 51,
    crfDefault: 22,
    sweetSpot: [18, 28],
    containers: ['mp4', 'mkv'],
  },
  hevc: {
    label: 'H.265 (HEVC)',
    crfMin: 0,
    crfMax: 51,
    crfDefault: 26,
    sweetSpot: [20, 30],
    containers: ['mp4', 'mkv'],
  },
  av1: {
    label: 'AV1',
    crfMin: 0,
    crfMax: 63,
    crfDefault: 32,
    sweetSpot: [24, 40],
    containers: ['mp4', 'mkv', 'webm'],
  },
  vp9: {
    label: 'VP9',
    crfMin: 0,
    crfMax: 63,
    crfDefault: 33,
    sweetSpot: [24, 40],
    containers: ['webm', 'mkv', 'mp4'],
  },
}

/** Order "auto" tries graphics card encoders in. */
export const GPU_ENCODER_ORDER: HardwareEncoderMode[] = ['nvenc', 'qsv', 'amf']

/**
 * The encoder a choice resolves to on this PC. "auto" takes the first
 * graphics card encoder that passed the start-up test for the codec.
 */
export function pickEncoderMode(choice: EncoderChoice, codec: VideoCodec, supported: EncoderMode[]): EncoderMode {
  if (choice === 'auto') {
    return GPU_ENCODER_ORDER.find((m) => supported.includes(m) && ENCODER_NAMES[codec][m] !== null) ?? 'cpu'
  }
  return choice === 'cpu' || (supported.includes(choice) && ENCODER_NAMES[codec][choice] !== null) ? choice : 'cpu'
}

export const ENCODER_LABELS: Record<EncoderMode, string> = {
  cpu: 'CPU',
  nvenc: 'NVIDIA NVENC',
  qsv: 'Intel Quick Sync',
  amf: 'AMD AMF',
}

/** FFmpeg encoder name for each codec and encoder family. `null` means not offered. */
export const ENCODER_NAMES: Record<VideoCodec, Record<EncoderMode, string | null>> = {
  h264: { cpu: 'libx264', nvenc: 'h264_nvenc', qsv: 'h264_qsv', amf: 'h264_amf' },
  hevc: { cpu: 'libx265', nvenc: 'hevc_nvenc', qsv: 'hevc_qsv', amf: 'hevc_amf' },
  av1: { cpu: 'libsvtav1', nvenc: 'av1_nvenc', qsv: 'av1_qsv', amf: 'av1_amf' },
  vp9: { cpu: 'libvpx-vp9', nvenc: null, qsv: 'vp9_qsv', amf: null },
}

export const SCALE_HEIGHTS: Record<Exclude<VideoScale, 'original'>, number> = {
  '2160p': 2160,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
}

export const CONTAINER_EXTENSIONS: Record<VideoContainer, string> = {
  mp4: '.mp4',
  mkv: '.mkv',
  webm: '.webm',
}

/** Audio codecs each container can hold when stream-copying. */
export const CONTAINER_AUDIO_COPY: Record<VideoContainer, Set<string> | 'any'> = {
  mp4: new Set(['aac', 'mp3', 'ac3', 'eac3', 'opus', 'alac', 'flac']),
  mkv: 'any',
  webm: new Set(['opus', 'vorbis']),
}

/** Pick the audio codec that will actually be used for a container and source. */
export function resolveAudioMode(
  container: VideoContainer,
  requested: AudioMode,
  sourceAudioCodec: string | null,
): AudioMode {
  if (requested === 'none' || !sourceAudioCodec) return 'none'
  if (container === 'webm' && requested === 'aac') return 'opus'
  if (requested === 'copy') {
    const allowed = CONTAINER_AUDIO_COPY[container]
    if (allowed === 'any' || allowed.has(sourceAudioCodec)) return 'copy'
    return container === 'webm' ? 'opus' : 'aac'
  }
  return requested
}

export function isCodecAllowedInContainer(codec: VideoCodec, container: VideoContainer): boolean {
  return CODECS[codec].containers.includes(container)
}

export const IMAGE_FORMAT_LABELS: Record<ImageOutputFormat, string> = {
  original: 'Same as input',
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
}

export type ResolvedImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff'

/** Map the requested output format onto a format sharp can write. */
export function resolveImageFormat(
  requested: ImageOutputFormat,
  source: ImageSourceFormat,
): ResolvedImageFormat {
  if (requested !== 'original') return requested
  if (source === 'bmp') return 'png'
  return source
}

export const IMAGE_FORMAT_EXTENSIONS: Record<ResolvedImageFormat, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif',
  tiff: '.tif',
}
