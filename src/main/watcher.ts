// Watches folders for new photos and videos. A file is reported once it has
// stopped growing, so a video still being copied or recorded is not picked
// up half-written. Files already in the folder when watching starts are left
// alone.
import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { WatchFolder, WatchStatus } from '@shared/types'
import { classifyPath } from './services/mediaResolver'

interface Pending {
  watchId: string
  /** The path as the system spells it. */
  path: string
  size: number
  mtimeMs: number
  steady: number
  firstSeen: number
}

export interface WatcherOptions {
  onFound: (watchId: string, paths: string[]) => void
  onStatus?: (status: WatchStatus[]) => void
  /** How often a waiting file is checked. */
  pollMs?: number
  /** Checks in a row with no change before a file counts as finished. */
  steadyChecks?: number
}

/** Skip our own temp files, hidden files and system clutter. */
export function isCandidate(path: string): boolean {
  const name = basename(path)
  if (name.startsWith('.') || name.startsWith('~$') || name.includes('.sqf-')) return false
  if (/\.(tmp|part|crdownload|download)$/i.test(name)) return false
  return classifyPath(path) !== null
}

export class FolderWatcher {
  private watchers = new Map<string, { folder: WatchFolder; fsw: FSWatcher | null; error?: string }>()
  private pending = new Map<string, Pending>()
  /** Paths already reported, so edits and our own renames do not repeat them. */
  private reported = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private readonly pollMs: number
  private readonly steadyChecks: number

  constructor(private readonly opts: WatcherOptions) {
    this.pollMs = opts.pollMs ?? 1000
    this.steadyChecks = opts.steadyChecks ?? 2
  }

  /** Start and stop watchers to match the list. */
  update(folders: WatchFolder[]): void {
    const wanted = new Map(folders.filter((f) => f.enabled && f.path).map((f) => [f.id, f]))
    for (const [id, w] of this.watchers) {
      const next = wanted.get(id)
      if (!next || next.path !== w.folder.path) {
        w.fsw?.close()
        this.watchers.delete(id)
      } else {
        w.folder = next
      }
    }
    for (const [id, folder] of wanted) if (!this.watchers.has(id)) this.start(folder)
    this.emitStatus()
  }

  /** Paths SquashForge writes itself are never picked up as new. */
  ignore(path: string): void {
    this.reported.add(this.key(path))
  }

  stop(): void {
    for (const w of this.watchers.values()) w.fsw?.close()
    this.watchers.clear()
    this.pending.clear()
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.timer = this.retryTimer = null
  }

  status(): WatchStatus[] {
    return [...this.watchers.values()].map((w) => ({ id: w.folder.id, watching: w.fsw !== null, error: w.error }))
  }

  private key(p: string): string {
    return process.platform === 'linux' ? p : p.toLowerCase()
  }

  private start(folder: WatchFolder): void {
    const entry: { folder: WatchFolder; fsw: FSWatcher | null; error?: string } = { folder, fsw: null }
    this.watchers.set(folder.id, entry)
    try {
      const fsw = watch(folder.path, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename) return
        this.seen(folder.id, join(folder.path, filename.toString()))
      })
      fsw.on('error', (e) => {
        fsw.close()
        entry.fsw = null
        entry.error = friendly(e)
        this.emitStatus()
        this.scheduleRetry()
      })
      entry.fsw = fsw
      entry.error = undefined
    } catch (e) {
      entry.error = friendly(e)
      this.scheduleRetry()
    }
  }

  /** A folder on a drive that was unplugged comes back when it returns. */
  private scheduleRetry(): void {
    if (this.retryTimer) return
    this.retryTimer = setInterval(() => {
      let broken = 0
      for (const w of [...this.watchers.values()]) {
        if (w.fsw) continue
        this.start(w.folder)
        if (!this.watchers.get(w.folder.id)?.fsw) broken++
      }
      this.emitStatus()
      if (!broken && this.retryTimer) {
        clearInterval(this.retryTimer)
        this.retryTimer = null
      }
    }, 30_000)
  }

  private seen(watchId: string, path: string): void {
    if (!isCandidate(path)) return
    const key = this.key(path)
    if (this.reported.has(key) || this.pending.has(key)) return
    this.pending.set(key, { watchId, path, size: -1, mtimeMs: 0, steady: 0, firstSeen: Date.now() })
    if (!this.timer) this.timer = setInterval(() => void this.poll(), this.pollMs)
  }

  private async poll(): Promise<void> {
    const ready = new Map<string, string[]>()
    for (const [key, p] of [...this.pending]) {
      // Written by SquashForge while it waited.
      if (this.reported.has(key)) {
        this.pending.delete(key)
        continue
      }
      const s = await stat(p.path).catch(() => null)
      if (!s?.isFile()) {
        // Gone again (a temporary file, or moved away).
        if (!s || Date.now() - p.firstSeen > 60_000) this.pending.delete(key)
        continue
      }
      if (s.size > 0 && s.size === p.size && s.mtimeMs === p.mtimeMs) p.steady++
      else p.steady = 0
      p.size = s.size
      p.mtimeMs = s.mtimeMs
      if (p.steady < this.steadyChecks || !(await readable(p.path))) continue
      this.pending.delete(key)
      this.reported.add(key)
      ready.set(p.watchId, [...(ready.get(p.watchId) ?? []), p.path])
    }
    for (const [watchId, paths] of ready) this.opts.onFound(watchId, paths)
    if (!this.pending.size && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private emitStatus(): void {
    this.opts.onStatus?.(this.status())
  }
}

/** Another program still writing a file often holds it locked on Windows. */
async function readable(path: string): Promise<boolean> {
  try {
    const h = await open(path, 'r')
    await h.close()
    return true
  } catch {
    return false
  }
}

function friendly(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'The folder could not be found. Is the drive plugged in?'
  if (code === 'EACCES' || code === 'EPERM') return 'SquashForge is not allowed to read this folder.'
  return e instanceof Error ? e.message : String(e)
}
