import { DEFAULT_NAME_TEMPLATE } from './naming'
import type { AppPreferences, ImageJobConfig, OutputSettings, VideoJobConfig } from './types'

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
  encoderMode: 'auto',
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

export const DEFAULT_PREFERENCES: AppPreferences = {
  videosAtOnce: 1,
  photosAtOnce: 0,
  gpuDecoding: true,
  lowPriority: false,
  skipCompressedNames: true,
  skipExisting: false,
  notifyWhenDone: true,
  keepAwake: true,
  confirmQuit: true,
  checkForUpdates: true,
  watchFolders: [],
  verboseLogging: false,
}

export const DEFAULT_OUTPUT: OutputSettings = {
  mode: 'suffix',
  nameTemplate: DEFAULT_NAME_TEMPLATE,
  renameInFolder: false,
  folder: null,
  keepOriginalIfLarger: true,
  preserveTimestamps: true,
  keepFolderStructure: true,
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

/** One-click goals for the Quick tab. Each sets both photo and video settings. */
export interface Goal {
  id: string
  name: string
  description: string
  image: ImageJobConfig
  /** The encoder choice is left as the user set it. */
  video: VideoJobConfig
  imagePresetId?: string
  videoPresetId?: string
}

export const VIDEO_PRESETS: Preset<VideoJobConfig>[] = [
  {
    id: 'vid-standard',
    name: 'Standard (H.264)',
    description: 'Plays on anything. Keeps the size and frame rate, RF 22.',
    config: vid({}),
  },
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

const fit = (px: number): ImageJobConfig['resize'] => ({ ...DEFAULT_IMAGE_CONFIG.resize, mode: 'fit', maxWidth: px, maxHeight: px })

export const GOALS: Goal[] = [
  {
    id: 'goal-smaller',
    name: 'Smaller, same look',
    description: 'Keeps each file’s format and size. Most files shrink by half or more and look the same.',
    image: img({}),
    video: vid({}),
    imagePresetId: 'img-balanced',
    videoPresetId: 'vid-standard',
  },
  {
    id: 'goal-share',
    name: 'Share online',
    description: 'WebP photos up to 2560 px and 1080p videos that play on any phone or browser.',
    image: img({ format: 'webp', quality: 78, resize: fit(2560) }),
    video: vid({ scale: '1080p', fpsLimit: 30, crf: 23, audioBitrateKbps: 128 }),
    imagePresetId: 'img-web-webp',
  },
  {
    id: 'goal-smallest',
    name: 'As small as possible',
    description: 'AVIF photos and H.265 video. The smallest files that still look good, but slower to make.',
    image: img({ format: 'avif', quality: 55 }),
    video: vid({ codec: 'hevc', crf: 28, scale: '1080p', audioBitrateKbps: 96 }),
    imagePresetId: 'img-avif-max',
  },
  {
    id: 'goal-discord',
    name: 'Discord (under 10 MB)',
    description: 'Every photo and video fits Discord’s free 10 MB upload limit.',
    image: img({ mode: 'targetSize', targetMaxSizeBytes: 8 * MB }),
    video: vid({ rateControl: 'targetSize', targetMaxSizeBytes: 10 * MB, scale: '720p', fpsLimit: 30, audioBitrateKbps: 96 }),
    videoPresetId: 'vid-discord-10',
  },
  {
    id: 'goal-email',
    name: 'Email (under 20 MB)',
    description: 'Photos under 2 MB and videos under 20 MB, small enough to attach to an email.',
    image: img({ mode: 'targetSize', targetMaxSizeBytes: 2 * MB }),
    video: vid({ rateControl: 'targetSize', targetMaxSizeBytes: 20 * MB, scale: '720p', fpsLimit: 30, audioBitrateKbps: 96, downmixStereo: true }),
    imagePresetId: 'img-under-2mb',
    videoPresetId: 'vid-email-20',
  },
  {
    id: 'goal-quality',
    name: 'Best quality',
    description: 'Photos keep every pixel and videos stay close to the original. Saves less space.',
    image: img({ mode: 'lossless' }),
    video: vid({ codec: 'hevc', crf: 20, preset: 'slow', audioCodec: 'copy' }),
    imagePresetId: 'img-lossless',
  },
]
