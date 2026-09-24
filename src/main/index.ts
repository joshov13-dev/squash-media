import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { IPC } from '@shared/ipc'
import { getHardwareProfile } from './hardware'
import { registerIpcHandlers } from './ipc/handlers'
import { CalibrationStore } from './services/etaCalculator'
import { JobQueue } from './services/jobQueue'
import { SystemMonitor } from './systemMonitor'

let mainWindow: BrowserWindow | null = null
let monitor: SystemMonitor | null = null

const BACKGROUND = '#121110'

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/** Media paths passed on the command line (e.g. files dropped onto the .exe). */
function pathsFromArgv(argv: string[]): string[] {
  const skip = new Set([resolve(app.getAppPath()), resolve(process.execPath)])
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && isAbsolute(a) && !skip.has(resolve(a)) && existsSync(a))
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

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Never open other windows or navigate away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  mainWindow.webContents.on('did-finish-load', () => {
    const initial = pathsFromArgv(process.argv)
    if (initial.length) send(IPC.openPaths, initial)
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      const paths = pathsFromArgv(argv)
      if (paths.length) send(IPC.openPaths, paths)
    }
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.squashforge.app')

    const calibration = new CalibrationStore(join(app.getPath('userData'), 'eta-calibration.json'))
    const queue = new JobQueue({
      getHardware: getHardwareProfile,
      calibration,
      emitUpdate: (u) => send(IPC.jobUpdate, u),
      emitStats: (s) => send(IPC.queueStats, s),
      trash: (p) => shell.trashItem(p),
    })
    registerIpcHandlers(queue)
    createWindow()

    void getHardwareProfile().then((hw) => {
      monitor = new SystemMonitor(hw.gpus, (load) => send(IPC.systemLoad, load))
      monitor.start()
    })

    app.on('before-quit', () => {
      queue.cancelAll()
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
