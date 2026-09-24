import type {
  HardwareProfile,
  ImagePreviewRequest,
  ImagePreviewResult,
  JobRequest,
  JobUpdate,
  MediaFile,
  QueueStats,
  ResolveResult,
  SystemLoad,
  VideoPreviewRequest,
  VideoPreviewResult,
} from './types'

export const IPC = {
  hardware: 'hardware:get',
  openFiles: 'dialog:open-files',
  openFolder: 'dialog:open-folder',
  chooseOutputFolder: 'dialog:output-folder',
  resolveMedia: 'media:resolve',
  thumbnail: 'media:thumbnail',
  previewImage: 'preview:image',
  previewVideo: 'preview:video',
  cancelVideoPreview: 'preview:video-cancel',
  enqueue: 'queue:enqueue',
  cancelJob: 'queue:cancel',
  cancelAll: 'queue:cancel-all',
  revealInFolder: 'shell:reveal',
  openPath: 'shell:open',
  // main -> renderer
  jobUpdate: 'queue:update',
  queueStats: 'queue:stats',
  systemLoad: 'system:load',
  openPaths: 'app:open-paths',
} as const

export type Unsubscribe = () => void

/** The API exposed to the renderer as `window.api`. */
export interface SquashApi {
  platform: NodeJS.Platform
  getHardwareProfile(): Promise<HardwareProfile>
  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string | null>
  chooseOutputFolder(): Promise<string | null>
  getPathForFile(file: File): string
  resolveMedia(paths: string[]): Promise<ResolveResult>
  getThumbnail(file: MediaFile): Promise<string | null>
  /** Resolves null when a newer request replaced this one. */
  previewImage(req: ImagePreviewRequest): Promise<ImagePreviewResult | null>
  previewVideo(req: VideoPreviewRequest): Promise<VideoPreviewResult | null>
  cancelVideoPreview(): Promise<void>
  enqueue(jobs: JobRequest[]): Promise<void>
  cancelJob(jobId: string): Promise<void>
  cancelAll(): Promise<void>
  revealInFolder(path: string): Promise<void>
  openPath(path: string): Promise<void>
  onJobUpdate(cb: (update: JobUpdate) => void): Unsubscribe
  onQueueStats(cb: (stats: QueueStats) => void): Unsubscribe
  onSystemLoad(cb: (load: SystemLoad) => void): Unsubscribe
  onOpenPaths(cb: (paths: string[]) => void): Unsubscribe
}
