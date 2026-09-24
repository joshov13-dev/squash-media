import type {
  AppInfo,
  AppPreferences,
  HardwareProfile,
  HistoryRun,
  ImageOriginal,
  ImagePreviewRequest,
  ImagePreviewResult,
  JobRequest,
  JobUpdate,
  MediaFile,
  QueueStats,
  ResolveResult,
  SystemLoad,
  UndoResult,
  VideoPreviewRequest,
  VideoPreviewResult,
  WhenDone,
} from './types'

export const IPC = {
  appInfo: 'app:info',
  hardware: 'hardware:get',
  openFiles: 'dialog:open-files',
  openFolder: 'dialog:open-folder',
  chooseOutputFolder: 'dialog:output-folder',
  resolveMedia: 'media:resolve',
  thumbnail: 'media:thumbnail',
  imageOriginal: 'preview:image-original',
  previewImage: 'preview:image',
  previewVideo: 'preview:video',
  cancelVideoPreview: 'preview:video-cancel',
  enqueue: 'queue:enqueue',
  cancelJob: 'queue:cancel',
  cancelAll: 'queue:cancel-all',
  revealInFolder: 'shell:reveal',
  openPath: 'shell:open',
  powerAction: 'power:action',
  setPreferences: 'app:set-preferences',
  historyList: 'history:list',
  historyUndoRun: 'history:undo-run',
  historyUndoEntry: 'history:undo-entry',
  copyText: 'clipboard:write',
  // main -> renderer
  jobUpdate: 'queue:update',
  queueStats: 'queue:stats',
  systemLoad: 'system:load',
  openPaths: 'app:open-paths',
  takeOpenPaths: 'app:take-open-paths',
} as const

export type Unsubscribe = () => void

/** The API exposed to the renderer as `window.api`. */
export interface SquashApi {
  platform: NodeJS.Platform
  getAppInfo(): Promise<AppInfo>
  getHardwareProfile(): Promise<HardwareProfile>
  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string | null>
  chooseOutputFolder(): Promise<string | null>
  getPathForFile(file: File): string
  resolveMedia(paths: string[]): Promise<ResolveResult>
  getThumbnail(file: MediaFile): Promise<string | null>
  getImageOriginal(filePath: string): Promise<ImageOriginal>
  /** Resolves null when a newer request replaced this one. */
  previewImage(req: ImagePreviewRequest): Promise<ImagePreviewResult | null>
  previewVideo(req: VideoPreviewRequest): Promise<VideoPreviewResult | null>
  cancelVideoPreview(): Promise<void>
  enqueue(jobs: JobRequest[]): Promise<void>
  cancelJob(jobId: string): Promise<void>
  cancelAll(): Promise<void>
  revealInFolder(path: string): Promise<void>
  openPath(path: string): Promise<void>
  setPreferences(prefs: AppPreferences): Promise<void>
  /** Newest first, including runs from the command line and AI apps. */
  listHistory(limit?: number): Promise<HistoryRun[]>
  undoRun(runId: string): Promise<UndoResult[]>
  undoEntry(runId: string, jobId: string): Promise<UndoResult>
  copyText(text: string): Promise<void>
  /** Put the PC to sleep or shut it down once the queue is finished. */
  powerAction(action: Exclude<WhenDone, 'nothing'>): Promise<void>
  onJobUpdate(cb: (update: JobUpdate) => void): Unsubscribe
  onQueueStats(cb: (stats: QueueStats) => void): Unsubscribe
  onSystemLoad(cb: (load: SystemLoad) => void): Unsubscribe
  onOpenPaths(cb: (paths: string[]) => void): Unsubscribe
  /** Paths opened before the window was ready (from the command line or Explorer). */
  takeOpenPaths(): Promise<string[]>
}
