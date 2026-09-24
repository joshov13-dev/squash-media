import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type SquashApi, type Unsubscribe } from '@shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SquashApi = {
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getHardwareProfile: () => ipcRenderer.invoke(IPC.hardware),
  pickFiles: () => ipcRenderer.invoke(IPC.openFiles),
  pickFolder: () => ipcRenderer.invoke(IPC.openFolder),
  chooseOutputFolder: () => ipcRenderer.invoke(IPC.chooseOutputFolder),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  resolveMedia: (paths) => ipcRenderer.invoke(IPC.resolveMedia, paths),
  getThumbnail: (file) => ipcRenderer.invoke(IPC.thumbnail, file),
  getImageOriginal: (filePath) => ipcRenderer.invoke(IPC.imageOriginal, filePath),
  previewImage: (req) => ipcRenderer.invoke(IPC.previewImage, req),
  previewVideo: (req) => ipcRenderer.invoke(IPC.previewVideo, req),
  cancelVideoPreview: () => ipcRenderer.invoke(IPC.cancelVideoPreview),
  enqueue: (jobs) => ipcRenderer.invoke(IPC.enqueue, jobs),
  cancelJob: (jobId) => ipcRenderer.invoke(IPC.cancelJob, jobId),
  cancelAll: () => ipcRenderer.invoke(IPC.cancelAll),
  revealInFolder: (path) => ipcRenderer.invoke(IPC.revealInFolder, path),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  powerAction: (action) => ipcRenderer.invoke(IPC.powerAction, action),
  onJobUpdate: (cb) => subscribe(IPC.jobUpdate, cb),
  onQueueStats: (cb) => subscribe(IPC.queueStats, cb),
  onSystemLoad: (cb) => subscribe(IPC.systemLoad, cb),
  onOpenPaths: (cb) => subscribe(IPC.openPaths, cb),
  takeOpenPaths: () => ipcRenderer.invoke(IPC.takeOpenPaths),
}

contextBridge.exposeInMainWorld('api', api)
