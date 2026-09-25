import { app, BrowserWindow, dialog, ipcMain, Notification, powerSaveBlocker, shell } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { formatBytes } from '@shared/format'
import { IPC } from '@shared/ipc'
import type { AppPreferences, QueueStats } from '@shared/types'
import { getHardwareProfile } from './hardware'
import { registerIpcHandlers } from './ipc/handlers'
import { CalibrationStore } from './services/etaCalculator'
import { userDataDir, userDataFile } from './appPaths'
import { flushLogs, logger, setVerboseLogging } from './logger'
import { getPreferences, onPreferencesChanged, usePreferencesFile } from './preferences'
import { HistoryStore } from './services/history'
import { JobQueue } from './services/jobQueue'
import { SystemMonitor } from './systemMonitor'
import { Updater } from './updater'
import { FolderWatcher } from './watcher'

let mainWindow: BrowserWindow | null = null
let monitor: SystemMonitor | null = null
let queue: JobQueue | null = null

const BACKGROUND = '#121110'

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

// Files opened from Explorer can arrive before the UI is listening, so hold
// them until the renderer asks.
let rendererReady = false
const pendingPaths: string[] = []

function openPaths(paths: string[]): void {
  if (!paths.length) return
  if (rendererReady) send(IPC.openPaths, paths)
  else pendingPaths.push(...paths)
}

/** Media paths passed on the command line (e.g. files dropped onto the .exe). */
function pathsFromArgv(argv: string[]): string[] {
  const skip = new Set([resolve(app.getAppPath()), resolve(process.execPath)])
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && isAbsolute(a) && !skip.has(resolve(a)) && existsSync(a))
}

let wasActive = false
let sleepBlocker: number | null = null

/** Taskbar progress, keep-awake and the "all done" notification follow the queue. */
function onQueueStats(stats: QueueStats): void {
  send(IPC.queueStats, stats)
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (stats.active) {
    win.setProgressBar(Math.max(0.01, stats.percent / 100))
    // Long encodes should not be cut short by the PC going to sleep.
    if (sleepBlocker === null && getPreferences().keepAwake) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
  } else {
    win.setProgressBar(-1)
    if (sleepBlocker !== null) {
      powerSaveBlocker.stop(sleepBlocker)
      sleepBlocker = null
    }
    if (wasActive && stats.total > 0) notifyFinished(win, stats)
  }
  wasActive = stats.active
}

function notifyFinished(win: BrowserWindow, stats: QueueStats): void {
  if (win.isFocused() || !getPreferences().notifyWhenDone) return
  win.flashFrame(true)
  if (!Notification.isSupported()) return
  const saved = Math.max(0, stats.originalBytes - stats.outputBytes)
  const body = [
    `${stats.completed} of ${stats.total} ${stats.total === 1 ? 'file' : 'files'} done.`,
    saved > 0 ? `Saved ${formatBytes(saved)}.` : '',
    stats.failed ? `${stats.failed} could not be compressed.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const note = new Notification({ title: stats.failed ? 'SquashForge finished with problems' : 'SquashForge is done', body })
  note.on('click', () => {
    win.show()
    win.focus()
  })
  note.show()
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'SquashForge',
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : { titleBarOverlay: { color: BACKGROUND, symbolColor: '#aca69c', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  // Started at sign-in: sit in the taskbar so watched folders keep working.
  const hidden = process.argv.includes('--hidden')
  mainWindow.on('ready-to-show', () => (hidden ? mainWindow?.minimize() : mainWindow?.show()))
  mainWindow.on('focus', () => mainWindow?.flashFrame(false))

  // Closing mid-run throws away the files in progress, so ask first.
  mainWindow.on('close', (e) => {
    if (!queue?.busy || !mainWindow || !getPreferences().confirmQuit) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'SquashForge is still working',
      message: 'Files are still being compressed.',
      detail: 'If you quit now, the files being worked on are stopped and not saved. Files that already finished are kept.',
      buttons: ['Keep working', 'Stop and quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (choice === 0) e.preventDefault()
    else queue.cancelAll()
  })

  // Never open other windows or navigate away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  // A reload starts a fresh renderer that has to ask again.
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// One settings folder for the app, the command line and the AI server.
// SQUASHFORGE_USER_DATA picks a separate one, for testing or running side by side.
app.setPath('userData', userDataDir())

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    openPaths(pathsFromArgv(argv))
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.squashforge.app')

    usePreferencesFile(userDataFile('preferences.json'))
    logger.info('app', 'SquashForge started', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    })
    void getHardwareProfile().then((hw) =>
      logger.info('hardware', 'Detected hardware', {
        cpu: hw.cpuModel,
        threads: hw.logicalCores,
        gpus: hw.gpus.map((g) => g.model),
        gpuEncoders: hw.availableGpuEncoders,
        ffmpeg: hw.ffmpegAvailable ? hw.ffmpegVersion : 'missing',
      }),
    )
    const watcher = new FolderWatcher({
      onFound: (watchId, paths) => {
        logger.info('watch', `${paths.length} new ${paths.length === 1 ? 'file' : 'files'}`, { watchId, paths })
        send(IPC.watchFound, { watchId, paths })
      },
      onStatus: (status) => {
        for (const s of status) if (s.error) logger.warn('watch', `Folder problem: ${s.error}`, { id: s.id })
        send(IPC.watchStatus, status)
      },
    })
    watcher.update(getPreferences().watchFolders)
    const updater = new Updater((state) => {
      if (state.state === 'error') logger.warn('update', state.error ?? 'Update check failed')
      else if (state.state === 'available' || state.state === 'ready') logger.info('update', `Version ${state.version} ${state.state}`)
      send(IPC.updateState, state)
    })
    const followPreferences = (prefs: AppPreferences): void => {
      watcher.update(prefs.watchFolders)
      setVerboseLogging(prefs.verboseLogging)
      if (prefs.checkForUpdates) updater.startAutomatic()
      else updater.stopAutomatic()
    }
    followPreferences(getPreferences())
    onPreferencesChanged(followPreferences)
    const calibration = new CalibrationStore(userDataFile('eta-calibration.json'))
    const history = new HistoryStore(userDataFile('history.json'), { trash: (p) => shell.trashItem(p) })
    queue = new JobQueue({
      getHardware: getHardwareProfile,
      getPreferences,
      calibration,
      emitUpdate: (u) => {
        if (u.outputPath) watcher.ignore(u.outputPath)
        if (u.status === 'failed') logger.warn('queue', `Failed: ${u.error}`, { jobId: u.jobId, detail: u.errorDetail })
        send(IPC.jobUpdate, u)
      },
      emitStats: (stats) => {
        if (!stats.active && wasActive && stats.total > 0) {
          logger.info('queue', `Run finished: ${stats.completed} of ${stats.total} done, ${stats.failed} failed`, {
            elapsedSeconds: stats.elapsedSeconds,
            originalBytes: stats.originalBytes,
            outputBytes: stats.outputBytes,
          })
        }
        onQueueStats(stats)
      },
      trash: (p) => shell.trashItem(p),
      history,
    })
    registerIpcHandlers({ queue, history, watcher, updater })
    ipcMain.handle(IPC.takeOpenPaths, () => {
      rendererReady = true
      return pendingPaths.splice(0)
    })
    openPaths(pathsFromArgv(process.argv))
    createWindow()

    void getHardwareProfile().then((hw) => {
      monitor = new SystemMonitor(hw.gpus, (load) => send(IPC.systemLoad, load))
      monitor.start()
    })

    app.on('before-quit', () => {
      logger.info('app', 'Quitting')
      watcher.stop()
      void history.flush()
      void flushLogs()
      queue?.cancelAll()
      monitor?.stop()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
