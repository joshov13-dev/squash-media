// Models shared by the main process, the preload bridge and the React UI.

export type MediaType = 'image' | 'video'

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export type GpuVendor = 'nvidia' | 'intel' | 'amd' | 'apple' | 'other'
export type EncoderMode = 'cpu' | 'nvenc' | 'qsv' | 'amf'
export type HardwareEncoderMode = Exclude<EncoderMode, 'cpu'>
export type VideoCodec = 'h264' | 'hevc' | 'av1' | 'vp9'

export interface GpuInfo {
  vendor: GpuVendor
  model: string
  vramMB: number | null
}

export interface HardwareProfile {
  cpuModel: string
  physicalCores: number
  logicalCores: number
  baseClockGHz: number
  boostClockGHz: number
  totalMemoryGB: number
  gpus: GpuInfo[]
  /** GPU encoder families that passed a real test encode. */
  availableGpuEncoders: HardwareEncoderMode[]
  /** Encoder modes that work for each codec, CPU first. */
  encoderSupport: Record<VideoCodec, EncoderMode[]>
  /** Relative speed score. 1.0 is roughly an 8 thread CPU at 4 GHz. */
  performanceScore: number
  /** Number of images compressed in parallel. */
  imageConcurrency: number
  ffmpegVersion: string | null
  ffmpegAvailable: boolean
}

export interface SystemLoad {
  cpuPercent: number
  memoryPercent: number
  gpuPercent: number | null
  gpuEncoderPercent: number | null
}

// ---------------------------------------------------------------------------
// Media info
// ---------------------------------------------------------------------------

export type ImageSourceFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'bmp'

export interface ImageInfo {
  kind: 'image'
  format: ImageSourceFormat
  width: number
  height: number
  hasAlpha: boolean
  /** EXIF orientation 1-8, when present. */
  orientation?: number
}

export interface VideoInfo {
  kind: 'video'
  container: string
  durationSeconds: number
  width: number
  height: number
  fps: number
  totalFrames: number
  videoCodec: string
  pixelFormat: string
  bitDepth: number
  bitrateKbps: number | null
  audioCodec: string | null
  audioChannels: number | null
  audioBitrateKbps: number | null
  audioStreams: number
  subtitleStreams: number
}

export type MediaInfo = ImageInfo | VideoInfo

export interface MediaFile {
  id: string
  filePath: string
  fileName: string
  type: MediaType
  sizeBytes: number
  info: MediaInfo
}

// ---------------------------------------------------------------------------
// Job configuration
// ---------------------------------------------------------------------------

export type ImageOutputFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif'
export type ImageCompressionMode = 'quality' | 'lossless' | 'targetSize'
export type ResizeMode = 'none' | 'percentage' | 'fit'
export type ResampleKernel = 'lanczos3' | 'mitchell' | 'nearest'

export interface ImageResizeConfig {
  mode: ResizeMode
  percentage: number
  maxWidth: number
  maxHeight: number
  kernel: ResampleKernel
}

export interface ImageJobConfig {
  format: ImageOutputFormat
  mode: ImageCompressionMode
  /** 1-100, used in quality mode. */
  quality: number
  /** Used in targetSize mode. */
  targetMaxSizeBytes: number
  stripMetadata: boolean
  /** Progressive JPEG output. */
  progressive: boolean
  resize: ImageResizeConfig
}

export type VideoContainer = 'mp4' | 'mkv' | 'webm'
export type VideoRateControl = 'crf' | 'targetSize' | 'bitrate'
export type VideoSpeedPreset = 'ultrafast' | 'fast' | 'medium' | 'slow'
export type AudioMode = 'copy' | 'aac' | 'opus' | 'none'
export type VideoScale = 'original' | '2160p' | '1440p' | '1080p' | '720p' | '480p'

export interface VideoJobConfig {
  container: VideoContainer
  codec: VideoCodec
  encoderMode: EncoderMode
  rateControl: VideoRateControl
  /** Constant quality value on the codec's own scale (x264/x265 0-51, AV1/VP9 0-63). */
  crf: number
  preset: VideoSpeedPreset
  targetBitrateKbps: number
  targetMaxSizeBytes: number
  /** Two-pass for bitrate/target-size modes on CPU encoders. */
  twoPass: boolean
  audioCodec: AudioMode
  audioBitrateKbps: number
  downmixStereo: boolean
  scale: VideoScale
  /** 0 keeps the source frame rate. */
  fpsLimit: number
}

export type OutputMode = 'suffix' | 'folder' | 'overwrite'

export interface OutputSettings {
  mode: OutputMode
  suffix: string
  folder: string | null
  /** Keep the original when the compressed file would be bigger. */
  keepOriginalIfLarger: boolean
  /** Copy the source file's modified date onto the output. */
  preserveTimestamps: boolean
}

// ---------------------------------------------------------------------------
// Jobs and progress
// ---------------------------------------------------------------------------

export type JobStatus =
  | 'pending'
  | 'queued'
  | 'analyzing'
  | 'processing'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled'

export interface ProgressStatus {
  jobId: string
  percent: number
  currentFps?: number
  /** Encoding speed relative to real time, e.g. 1.45 */
  currentSpeed?: number
  /** e.g. "Pass 1 of 2" */
  phase?: string
  estimatedSecondsRemaining: number
  humanReadableEta: string
}

export interface MediaJob extends MediaFile {
  status: JobStatus
  progress: ProgressStatus
  compressedSizeBytes?: number
  outputPath?: string
  /** Short human note, e.g. "Original kept: output was larger". */
  note?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface JobRequest {
  id: string
  filePath: string
  type: MediaType
  sizeBytes: number
  info: MediaInfo
  imageConfig?: ImageJobConfig
  videoConfig?: VideoJobConfig
  output: OutputSettings
}

export interface JobUpdate {
  jobId: string
  status: JobStatus
  progress: ProgressStatus
  compressedSizeBytes?: number
  outputPath?: string
  note?: string
  error?: string
}

export interface QueueStats {
  active: boolean
  total: number
  completed: number
  failed: number
  running: number
  /** 0-100 across the whole queue, weighted by estimated work. */
  percent: number
  estimatedSecondsRemaining: number
  humanReadableEta: string
  elapsedSeconds: number
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

export interface ImagePreviewRequest {
  requestId: number
  filePath: string
  config: ImageJobConfig
  /** Fast encode of a small copy for instant feedback. Reports no size. */
  quick?: boolean
  /** Compare against an existing output file instead of a live encode. */
  resultPath?: string
}

/** The source image in a form the UI can display. */
export interface ImageOriginal {
  data: Uint8Array
  mime: string
}

export interface ImagePreviewResult {
  requestId: number
  quick?: boolean
  after: Uint8Array
  afterMime: string
  originalBytes: number
  /** Output size. Exact when `exact` is true, otherwise scaled from a downsampled encode. */
  estimatedBytes: number
  exact: boolean
  outputWidth: number
  outputHeight: number
  outputFormat: string
  /** Quality actually used (target-size mode picks one). */
  qualityUsed?: number
  note?: string
  elapsedMs: number
}

export interface VideoPreviewRequest {
  filePath: string
  info: VideoInfo
  config: VideoJobConfig
}

export interface VideoPreviewResult {
  before: Uint8Array
  after: Uint8Array
  mime: string
  sampleSeconds: number
  sampleBytes: number
  estimatedBytes: number
  encodeFps: number
  estimatedEncodeSeconds: number
  outputWidth: number
  outputHeight: number
  encoderUsed: string
  note?: string
}

export interface ResolveResult {
  files: MediaFile[]
  rejected: Array<{ path: string; reason: string }>
}
