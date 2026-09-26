// The compression engine without a window: used by the command line and by
// the MCP server that AI apps talk to. Runs batches on the same queue, ETA
// model and history as the app.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolveImageFormat } from '@shared/codecs'
import { formatBytes, formatEta } from '@shared/format'
import type { HardwareProfile, ImageInfo, JobRequest, JobStatus, JobUpdate, MediaFile, ResolveResult, RunOrigin } from '@shared/types'
import { userDataFile } from '../appPaths'
import { getHardwareProfile } from '../hardware'
import { logger, setVerboseLogging } from '../logger'
import { applyOwnPriority, getPreferences, usePreferencesFile } from '../preferences'
import { CalibrationStore } from '../services/etaCalculator'
import { HistoryStore } from '../services/history'
import { JobQueue } from '../services/jobQueue'
import { resolveMedia } from '../services/mediaResolver'
import { imageOutputExtension, planOutputPath, samePath, uniquePath, videoOutputExtension } from '../services/outputPaths'
import { moveToTrash } from '../trash'
import type { ResolvedOptions } from './options'

const FINISHED: JobStatus[] = ['completed', 'skipped', 'failed', 'cancelled']

export interface FileStatus {
  path: string
  type: 'image' | 'video'
  status: JobStatus
  percent: number
  before_bytes: number
  after_bytes?: number
  output?: string
  note?: string
  error?: string
  error_detail?: string
}

export interface BatchStatus {
  batch_id: string
  state: 'running' | 'finished' | 'cancelled'
  total: number
  completed: number
  skipped: number
  failed: number
  cancelled: number
  running: number
  percent: number
  eta_seconds: number
  eta: string
  elapsed_seconds: number
  before_bytes: number
  after_bytes: number
  saved: string
  files: FileStatus[]
}

export interface PlannedFile {
  path: string
  type: 'image' | 'video'
  before_bytes: number
  output: string
  replaces_original: boolean
  estimated_seconds: number
}

interface Batch {
  id: string
  jobs: JobRequest[]
  startedAt: number
  cancelled: boolean
}

export class Engine {
  readonly queue: JobQueue
  readonly history: HistoryStore
  private updates = new Map<string, JobUpdate>()
  /** Batches already logged as finished, so a repeat status() call doesn't log twice. */
  private logged = new Set<string>()
  private batches = new Map<string, Batch>()
  private waiters = new Set<() => void>()
  private listeners = new Set<(u: JobUpdate) => void>()

  constructor(private readonly origin: RunOrigin) {
    usePreferencesFile(userDataFile('preferences.json'))
    applyOwnPriority()
    setVerboseLogging(getPreferences().verboseLogging)
    logger.info('engine', `Started (${origin})`, { version: __APP_VERSION__, platform: process.platform })
    this.history = new HistoryStore(userDataFile('history.json'), { trash: moveToTrash })
    this.queue = new JobQueue({
      getHardware: getHardwareProfile,
      getPreferences,
      calibration: new CalibrationStore(userDataFile('eta-calibration.json')),
      emitUpdate: (u) => {
        this.updates.set(u.jobId, { ...this.updates.get(u.jobId), ...u })
        if (u.status === 'failed') logger.warn('queue', `Failed: ${u.error}`, { jobId: u.jobId, detail: u.errorDetail })
        for (const l of this.listeners) l(u)
        if (FINISHED.includes(u.status)) this.wake()
      },
      emitStats: () => this.wake(),
      trash: moveToTrash,
      history: this.history,
    })
  }

  hardware(): Promise<HardwareProfile> {
    return getHardwareProfile()
  }

  onUpdate(cb: (u: JobUpdate) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Expand files and folders and read each file's details. */
  inspect(paths: string[]): Promise<ResolveResult> {
    return resolveMedia(paths)
  }

  private requests(files: MediaFile[], o: ResolvedOptions): JobRequest[] {
    return files.map((f) => ({
      id: randomUUID(),
      origin: this.origin,
      filePath: f.filePath,
      relativeDir: f.relativeDir,
      type: f.type,
      sizeBytes: f.sizeBytes,
      info: f.info,
      imageConfig: f.type === 'image' ? o.image : undefined,
      videoConfig: f.type === 'video' ? o.video : undefined,
      output: o.output,
    }))
  }

  /** What would happen, without writing anything. */
  async plan(files: MediaFile[], o: ResolvedOptions): Promise<{ files: PlannedFile[]; estimated_seconds: number; estimate: string }> {
    const reqs = this.requests(files, o)
    const { perFile, total } = await this.queue.estimate(reqs)
    // Number clashing names the way a real run does, so the plan matches what gets written.
    const taken = new Set<string>()
    const key = (p: string): string => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p)
    const planned = reqs.map((r, i): PlannedFile => {
      const ext =
        r.type === 'image'
          ? imageOutputExtension(r.filePath, (r.info as ImageInfo).format, resolveImageFormat(o.image.format, (r.info as ImageInfo).format))
          : videoOutputExtension(o.video.container)
      const out = planOutputPath(r.filePath, ext, o.output, r.relativeDir, { index: i + 1 })
      const own = out.replacesSource && samePath(out.finalPath, r.filePath)
      const output = own ? out.finalPath : uniquePath(out.finalPath, (p) => taken.has(key(p)) || existsSync(p))
      taken.add(key(output))
      return {
        path: r.filePath,
        type: r.type,
        before_bytes: r.sizeBytes,
        output,
        replaces_original: out.replacesSource,
        estimated_seconds: Math.round(perFile[i]),
      }
    })
    return { files: planned, estimated_seconds: Math.round(total), estimate: formatEta(total) }
  }

  async start(files: MediaFile[], o: ResolvedOptions): Promise<string> {
    const batch: Batch = { id: randomUUID().slice(0, 8), jobs: this.requests(files, o), startedAt: Date.now(), cancelled: false }
    this.batches.set(batch.id, batch)
    await this.queue.enqueue(batch.jobs)
    return batch.id
  }

  status(batchId: string): BatchStatus | null {
    const batch = this.batches.get(batchId)
    if (!batch) return null
    const stats = this.queue.computeStats()
    const files: FileStatus[] = batch.jobs.map((j) => {
      const u = this.updates.get(j.id)
      return {
        path: j.filePath,
        type: j.type,
        status: u?.status ?? 'queued',
        percent: u?.progress.percent ?? 0,
        before_bytes: j.sizeBytes,
        after_bytes: u?.compressedSizeBytes,
        output: u?.outputPath,
        note: u?.note,
        error: u?.error,
        error_detail: u?.errorDetail && u.errorDetail !== u.error ? u.errorDetail : undefined,
      }
    })
    const count = (s: JobStatus): number => files.filter((f) => f.status === s).length
    const done = files.filter((f) => FINISHED.includes(f.status))
    const measured = files.filter((f) => f.after_bytes !== undefined)
    const before = measured.reduce((n, f) => n + f.before_bytes, 0)
    const after = measured.reduce((n, f) => n + (f.after_bytes ?? 0), 0)
    const finished = done.length === files.length
    const weight = files.reduce((n, f) => n + Math.max(1, f.before_bytes), 0)
    const progress = files.reduce((n, f) => n + Math.max(1, f.before_bytes) * (FINISHED.includes(f.status) ? 100 : f.percent), 0) / weight
    const result: BatchStatus = {
      batch_id: batch.id,
      state: finished ? (batch.cancelled ? 'cancelled' : 'finished') : 'running',
      total: files.length,
      completed: count('completed'),
      skipped: count('skipped'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      running: files.filter((f) => f.status === 'processing' || f.status === 'analyzing').length,
      percent: Math.round(progress * 10) / 10,
      eta_seconds: finished ? 0 : stats.estimatedSecondsRemaining,
      eta: finished ? '' : stats.humanReadableEta,
      elapsed_seconds: Math.round((Date.now() - batch.startedAt) / 1000),
      before_bytes: before,
      after_bytes: after,
      saved: `${formatBytes(Math.max(0, before - after))}${before ? ` (${Math.round((1 - after / before) * 100)}%)` : ''}`,
      files,
    }
    if (finished && !this.logged.has(batch.id)) {
      this.logged.add(batch.id)
      logger.info('engine', `Batch ${batch.id} finished: ${result.completed} of ${result.total} done, ${result.failed} failed`, {
        origin: this.origin,
        elapsedSeconds: result.elapsed_seconds,
        beforeBytes: before,
        afterBytes: after,
      })
    }
    return result
  }

  /** Resolves when the batch finishes or the time runs out, whichever is first. */
  async wait(batchId: string, ms: number): Promise<BatchStatus | null> {
    const deadline = Date.now() + ms
    for (;;) {
      const s = this.status(batchId)
      if (!s || s.state !== 'running' || Date.now() >= deadline) return s
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, Math.min(1000, Math.max(0, deadline - Date.now())))
        function done(): void {
          clearTimeout(t)
          resolve()
        }
        this.waiters.add(done)
      })
    }
  }

  cancel(batchId: string): boolean {
    const batch = this.batches.get(batchId)
    if (!batch) return false
    batch.cancelled = true
    for (const j of batch.jobs) this.queue.cancel(j.id)
    return true
  }

  /** The source path of a job, for progress lines. */
  jobPath(jobId: string): string | undefined {
    for (const b of this.batches.values()) {
      const j = b.jobs.find((x) => x.id === jobId)
      if (j) return j.filePath
    }
    return undefined
  }

  batchIds(): string[] {
    return [...this.batches.keys()]
  }

  /** Stop everything and save the history. */
  async close(): Promise<void> {
    this.queue.cancelAll()
    for (let i = 0; i < 50 && this.queue.busy; i++) await new Promise((r) => setTimeout(r, 100))
    await this.history.flush()
  }

  private wake(): void {
    const waiting = [...this.waiters]
    this.waiters.clear()
    for (const w of waiting) w()
  }
}
