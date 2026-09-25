import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/codecs'
import { IPC } from '@shared/ipc'
import type {
  AppPreferences,
  ImagePreviewRequest,
  ImagePreviewResult,
  JobRequest,
  MediaFile,
  VideoPreviewRequest,
  VideoPreviewResult,
  WhenDone,
} from '@shared/types'
import { getHardwareProfile } from '../hardware'
import { connectApp, installCommand, integrationsInfo } from '../integrations'
import { runPowerAction } from '../power'
import { setPreferences } from '../preferences'
import { generateImagePreview, getDisplayableOriginal, makeImageThumbnail } from '../services/imageProcessor'
import type { HistoryStore } from '../services/history'
import type { JobQueue } from '../services/jobQueue'
import type { Updater } from '../updater'
import type { FolderWatcher } from '../watcher'
import { resolveMedia } from '../services/mediaResolver'
import { generateVideoPreview, makeVideoThumbnail } from '../services/videoProcessor'
import { AbortError } from '../utils/process'

const strip = (ext: string): string => ext.slice(1)
const imageExts = Object.keys(IMAGE_EXTENSIONS).map(strip)
const videoExts = [...VIDEO_EXTENSIONS].map(strip)

/**
 * Runs one preview at a time and keeps only the newest waiting request.
 * Dragging a quality slider fires many requests; only the last one matters.
 */
class LatestOnly<Req, Res> {
  private running = false
  private pending: { req: Req; resolve: (r: Res | null) => void; reject: (e: unknown) => void } | null = null

  constructor(private readonly work: (req: Req) => Promise<Res>) {}

  run(req: Req): Promise<Res | null> {
    return new Promise((resolve, reject) => {
      if (this.pending) this.pending.resolve(null)
      this.pending = { req, resolve, reject }
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.pending) {
      const job = this.pending
      this.pending = null
      try {
        job.resolve(await this.work(job.req))
      } catch (e) {
        job.reject(e)
      }
    }
    this.running = false
  }
}

function assertPath(p: unknown): string {
  if (typeof p !== 'string' || !isAbsolute(p)) throw new Error('Expected an absolute path')
  return p
}

export interface IpcServices {
  queue: JobQueue
  history: HistoryStore
  watcher: FolderWatcher
  updater: Updater
}

/** Starting at sign-in is a Windows and macOS feature in Electron. */
const loginItemsSupported = process.platform === 'win32' || process.platform === 'darwin'

export function registerIpcHandlers({ queue, history, watcher, updater }: IpcServices): void {
  // Quick and full previews queue separately so a slow full encode (say AVIF)
  // never holds up the instant feedback for the next slider move.
  const quickPreviews = new LatestOnly<ImagePreviewRequest, ImagePreviewResult>((req) => generateImagePreview(req))
  const fullPreviews = new LatestOnly<ImagePreviewRequest, ImagePreviewResult>((req) => generateImagePreview(req))
  let videoPreview: AbortController | null = null

  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.handle(IPC.hardware, () => getHardwareProfile())
  ipcMain.handle(IPC.setPreferences, (_e, prefs: Partial<AppPreferences>) => setPreferences(prefs))
  ipcMain.handle(IPC.powerAction, (_e, action: WhenDone) => {
    if (action === 'sleep' || action === 'shutdown') runPowerAction(action)
  })

  ipcMain.handle(IPC.openFiles, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Add photos and videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Photos and videos', extensions: [...imageExts, ...videoExts] },
        { name: 'Photos', extensions: imageExts },
        { name: 'Videos', extensions: videoExts },
      ],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.openFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: 'Add a folder', properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.chooseOutputFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Save compressed files to',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.resolveMedia, (_e, paths: unknown) => {
    if (!Array.isArray(paths)) throw new Error('Expected a list of paths')
    return resolveMedia(paths.map(assertPath))
  })

  ipcMain.handle(IPC.thumbnail, async (_e, file: MediaFile) => {
    try {
      assertPath(file.filePath)
      if (file.info.kind === 'image') return await makeImageThumbnail(file.filePath)
      return await makeVideoThumbnail(file.filePath, file.info)
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.imageOriginal, async (_e, filePath: unknown) => {
    const { data, mime } = await getDisplayableOriginal(assertPath(filePath))
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mime }
  })

  ipcMain.handle(IPC.previewImage, (_e, req: ImagePreviewRequest) => {
    assertPath(req.filePath)
    if (req.resultPath && !existsSync(req.resultPath)) req = { ...req, resultPath: undefined }
    return req.quick ? quickPreviews.run(req) : fullPreviews.run(req)
  })

  ipcMain.handle(IPC.previewVideo, async (_e, req: VideoPreviewRequest): Promise<VideoPreviewResult | null> => {
    assertPath(req.filePath)
    videoPreview?.abort()
    const controller = new AbortController()
    videoPreview = controller
    try {
      return await generateVideoPreview(req, await getHardwareProfile(), controller.signal)
    } catch (e) {
      if (e instanceof AbortError || controller.signal.aborted) return null
      throw e
    } finally {
      if (videoPreview === controller) videoPreview = null
    }
  })

  ipcMain.handle(IPC.cancelVideoPreview, () => {
    videoPreview?.abort()
    videoPreview = null
  })

  ipcMain.handle(IPC.enqueue, (_e, jobs: JobRequest[]) => {
    for (const job of jobs) assertPath(job.filePath)
    return queue.enqueue(jobs)
  })
  ipcMain.handle(IPC.cancelJob, (_e, id: string) => queue.cancel(id))
  ipcMain.handle(IPC.cancelAll, () => queue.cancelAll())

  ipcMain.handle(IPC.historyList, (_e, limit: unknown) => history.list(typeof limit === 'number' ? limit : 50))
  ipcMain.handle(IPC.historyUndoRun, (_e, runId: unknown) => history.undoRun(String(runId)))
  ipcMain.handle(IPC.historyUndoEntry, (_e, runId: unknown, jobId: unknown) => history.undoEntry(String(runId), String(jobId)))
  ipcMain.handle(IPC.copyText, (_e, text: unknown) => clipboard.writeText(String(text)))
  ipcMain.handle(IPC.getWatchStatus, () => watcher.status())
  ipcMain.handle(IPC.getUpdateState, () => updater.current)
  ipcMain.handle(IPC.integrations, () => integrationsInfo())
  ipcMain.handle(IPC.connectAiApp, (_e, id: unknown, connect: unknown) => connectApp(String(id), connect !== false))
  ipcMain.handle(IPC.installCommand, () => installCommand())
  ipcMain.handle(IPC.checkForUpdate, () => updater.check())
  ipcMain.handle(IPC.installUpdate, () => updater.install())
  ipcMain.handle(IPC.getLoginItem, () => (loginItemsSupported ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : null))
  ipcMain.handle(IPC.setLoginItem, (_e, open: unknown) => {
    if (loginItemsSupported) app.setLoginItemSettings({ openAtLogin: Boolean(open), args: ['--hidden'] })
  })

  ipcMain.handle(IPC.revealInFolder, (_e, p: unknown) => shell.showItemInFolder(assertPath(p)))
  ipcMain.handle(IPC.openPath, async (_e, p: unknown) => {
    await shell.openPath(assertPath(p))
  })
}
