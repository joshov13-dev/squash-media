import type { ImageJobConfig, OutputSettings, VideoJobConfig } from './types'

export const MB = 1024 * 1024
export const KB = 1024

export const DEFAULT_IMAGE_CONFIG: ImageJobConfig = {
  format: 'original',
  mode: 'quality',
  quality: 80,
  targetMaxSizeBytes: 500 * KB,
  stripMetadata: true,
  progressive: true,
  resize: {
    mode: 'none',
    percentage: 50,
    maxWidth: 1920,
    maxHeight: 1920,
    kernel: 'lanczos3',
  },
}

export const DEFAULT_VIDEO_CONFIG: VideoJobConfig = {
  container: 'mp4',
  codec: 'h264',
  encoderMode: 'cpu',
  rateControl: 'crf',
  crf: 22,
  preset: 'medium',
  targetBitrateKbps: 4000,
  targetMaxSizeBytes: 25 * MB,
  twoPass: true,
  audioCodec: 'aac',
  audioBitrateKbps: 160,
  downmixStereo: false,
  scale: 'original',
  fpsLimit: 0,
}

export const DEFAULT_OUTPUT: OutputSettings = {
  mode: 'suffix',
  suffix: '_compressed',
  folder: null,
  keepOriginalIfLarger: true,
  preserveTimestamps: true,
}

export interface Preset<T> {
  id: string
  name: string
  description: string
  config: T
  builtIn?: boolean
}

const img = (patch: Partial<ImageJobConfig>): ImageJobConfig => ({
  ...DEFAULT_IMAGE_CONFIG,
  ...patch,
  resize: { ...DEFAULT_IMAGE_CONFIG.resize, ...patch.resize },
})

const vid = (patch: Partial<VideoJobConfig>): VideoJobConfig => ({ ...DEFAULT_VIDEO_CONFIG, ...patch })

export const IMAGE_PRESETS: Preset<ImageJobConfig>[] = [
  {
    id: 'img-balanced',
    name: 'Balanced',
    description: 'Keeps the format, quality 80. Hard to tell apart from the original.',
    config: img({}),
  },
  {
    id: 'img-web-webp',
    name: 'Web (WebP)',
    description: 'WebP at quality 78, fitted inside 2560 px.',
    config: img({ format: 'webp', quality: 78, resize: { ...DEFAULT_IMAGE_CONFIG.resize, mode: 'fit', maxWidth: 2560, maxHeight: 2560 } }),
  },
  {
    id: 'img-avif-max',
    name: 'Smallest (AVIF)',
    description: 'AVIF at quality 55. Slow to encode, tiny files.',
    config: img({ format: 'avif', quality: 55 }),
  },
  {
    id: 'img-lossless',
    name: 'Lossless',
    description: 'Strips metadata and squeezes the encoding. Pixels are untouched.',
    config: img({ mode: 'lossless' }),
  },
  {
    id: 'img-under-500k',
    name: 'Under 500 KB',
    description: 'Finds the best JPEG quality that fits in 500 KB.',
    config: img({ format: 'jpeg', mode: 'targetSize', targetMaxSizeBytes: 500 * KB }),
  },
  {
    id: 'img-under-2mb',
    name: 'Under 2 MB',
    description: 'Finds the best quality that fits in 2 MB, keeping the format.',
    config: img({ mode: 'targetSize', targetMaxSizeBytes: 2 * MB }),
  },
].map((p) => ({ ...p, builtIn: true }))

export const VIDEO_PRESETS: Preset<VideoJobConfig>[] = [
  {
    id: 'vid-fast-1080p',
    name: 'Fast 1080p (H.264)',
    description: 'Plays everywhere. CRF 22, capped at 1080p30.',
    config: vid({ scale: '1080p', fpsLimit: 30, preset: 'fast' }),
  },
  {
    id: 'vid-hq-hevc',
    name: 'HQ 1080p (H.265)',
    description: 'Half the size of H.264 for the same quality.',
    config: vid({ codec: 'hevc', crf: 24, scale: '1080p', preset: 'medium' }),
  },
  {
    id: 'vid-av1-archive',
    name: 'Archive (AV1)',
    description: 'SVT-AV1 in MKV with Opus audio. Best compression.',
    config: vid({ container: 'mkv', codec: 'av1', crf: 32, audioCodec: 'opus', audioBitrateKbps: 128 }),
  },
  {
    id: 'vid-web-vp9',
    name: 'Web (VP9 WebM)',
    description: 'VP9 and Opus for browsers, 720p.',
    config: vid({ container: 'webm', codec: 'vp9', crf: 34, audioCodec: 'opus', audioBitrateKbps: 96, scale: '720p' }),
  },
  {
    id: 'vid-discord-10',
    name: 'Discord (10 MB)',
    description: 'Two-pass H.264 that fits the free upload limit.',
    config: vid({ rateControl: 'targetSize', targetMaxSizeBytes: 10 * MB, scale: '720p', fpsLimit: 30, audioBitrateKbps: 96, preset: 'medium' }),
  },
  {
    id: 'vid-discord-50',
    name: 'Discord (50 MB)',
    description: 'Two-pass H.264 for Nitro Basic uploads.',
    config: vid({ rateControl: 'targetSize', targetMaxSizeBytes: 50 * MB, scale: '1080p', audioBitrateKbps: 128 }),
  },
  {
    id: 'vid-email-20',
    name: 'Email (20 MB)',
    description: 'Fits most email attachment limits.',
    config: vid({ rateControl: 'targetSize', targetMaxSizeBytes: 20 * MB, scale: '720p', fpsLimit: 30, audioBitrateKbps: 96, downmixStereo: true }),
  },
].map((p) => ({ ...p, builtIn: true }))
