// Keeping SquashForge up to date. The installed Windows version (and the
// Linux AppImage) download new releases in the background and install on
// restart. The portable exe and the unsigned Mac app cannot replace
// themselves, so for those the app points to the download page instead.
import { app, net, shell } from 'electron'
import type { UpdateState } from '@shared/types'
import { compareVersions } from '@shared/versions'

const OWNER = 'joshov13-dev'
const REPO = 'squash-media'
export const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Can this copy install an update by itself? */
export function canSelfUpdate(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE)
  return false
}

export class Updater {
  private state: UpdateState = { state: 'idle', current: app.getVersion(), selfUpdate: canSelfUpdate() }
  private timer: NodeJS.Timeout | null = null
  private started = false
  private autoUpdater: typeof import('electron-updater').autoUpdater | null = null

  constructor(private readonly emit: (state: UpdateState) => void) {}

  get current(): UpdateState {
    return this.state
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit(this.state)
  }

  /** Check now and then every few hours. Safe to call again. */
  startAutomatic(): void {
    if (this.started) return
    this.started = true
    // Give the app a moment to settle before going online.
    setTimeout(() => void this.check(), 15_000).unref()
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
    this.timer.unref()
  }

  stopAutomatic(): void {
    this.started = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<UpdateState> {
    if (this.state.state === 'checking' || this.state.state === 'downloading' || this.state.state === 'ready') return this.state
    this.set({ state: 'checking', error: undefined })
    try {
      if (this.state.selfUpdate) await this.checkWithUpdater()
      else await this.checkWithGitHub()
    } catch (e) {
      this.set({ state: 'error', error: friendly(e) })
    }
    this.set({ lastChecked: Date.now() })
    return this.state
  }

  /** Restart into the downloaded version. */
  install(): void {
    if (this.state.state === 'ready' && this.autoUpdater) {
      // isSilent=false shows the installer's progress; forceRunAfter reopens the app.
      this.autoUpdater.quitAndInstall(false, true)
    } else {
      void shell.openExternal(this.state.url ?? RELEASES_URL)
    }
  }

  private async checkWithGitHub(): Promise<void> {
    const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `SquashForge/${app.getVersion()}` },
    })
    if (res.status === 404) {
      this.set({ state: 'none' })
      return
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const release = (await res.json()) as { tag_name: string; html_url: string; body?: string; name?: string }
    const latest = release.tag_name.replace(/^v/i, '')
    if (compareVersions(latest, app.getVersion()) > 0) {
      this.set({ state: 'available', version: latest, url: release.html_url, notes: release.body?.slice(0, 4000) })
    } else {
      this.set({ state: 'none', version: latest })
    }
  }

  private async checkWithUpdater(): Promise<void> {
    if (!this.autoUpdater) {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.logger = null
      autoUpdater.on('update-available', (info) =>
        this.set({ state: 'downloading', version: info.version, percent: 0, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined }),
      )
      autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }))
      autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version, percent: 100 }))
      autoUpdater.on('update-not-available', (info) => this.set({ state: 'none', version: info.version }))
      autoUpdater.on('error', (e) => this.set({ state: 'error', error: friendly(e) }))
      this.autoUpdater = autoUpdater
    }
    const result = await this.autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable && this.state.state === 'checking') this.set({ state: 'none' })
  }
}

function friendly(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_|getaddrinfo/i.test(text)) return 'Could not reach GitHub. Check the internet connection.'
  if (/rate limit|403/i.test(text)) return 'GitHub is busy. SquashForge will try again later.'
  return text.split('\n')[0].slice(0, 200)
}
