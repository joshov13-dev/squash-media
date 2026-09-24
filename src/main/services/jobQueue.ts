import { copyFile, mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveImageFormat } from '@shared/codecs'
import { formatEta } from '@shared/format'
import type {
  HardwareProfile,
  ImageInfo,
  JobRequest,
  JobStatus,
  JobUpdate,
  OutputSettings,
  ProgressStatus,
  QueueStats,
  VideoInfo,
} from '@shared/types'
import { AbortError } from '../utils/process'
import {
  calibrationKey,
  imageKey,
  imageLaneSpeedup,
  predictImageSeconds,
  predictVideoFps,
  predictVideoSeconds,
  type CalibrationStore,
} from './etaCalculator'
import { compressImage } from './imageProcessor'
import { imageOutputExtension, planOutputPath, samePath, tempPathFor, videoOutputExtension, type OutputPlan } from './outputPaths'
import { encodeVideo, planWorkload, resolveEncoder } from './videoProcessor'

interface QueueItem {
  req: JobRequest
  status: JobStatus
  percent: number
  /** Estimated total seconds at enqueue time; used to weight overall progress. */
  weight: number
  /** Latest estimate of seconds remaining. */
  remaining: number
  predicted: number
  startedAt?: number
  controller?: AbortController
  lastEmit: number
  fps?: number
  speed?: number
  phase?: string
}

export interface JobQueueDeps {
  getHardware: () => Promise<HardwareProfile>
  calibration: CalibrationStore
  emitUpdate: (update: JobUpdate) => void
  emitStats: (stats: QueueStats) => void
  /** Move a file to the recycle bin. */
  trash: (path: string) => Promise<void>
}

const FINISHED: JobStatus[] = ['completed', 'skipped', 'failed', 'cancelled']

export class JobQueue {
  private items: QueueItem[] = []
  private hardware: HardwareProfile | null = null
  private runningImages = 0
  private runningVideos = 0
  private runStartedAt = 0
  private ticker: NodeJS.Timeout | null = null

  constructor(private readonly deps: JobQueueDeps) {}

  async enqueue(requests: JobRequest[]): Promise<void> {
    this.hardware = await this.deps.getHardware()
    // A fresh run once everything before has finished.
    if (this.items.every((i) => FINISHED.includes(i.status))) {
      this.items = []
      this.runStartedAt = Date.now()
    }
    for (const req of requests) {
      const existing = this.items.find((i) => i.req.id === req.id)
      if (existing && !FINISHED.includes(existing.status)) continue
      if (existing) this.items.splice(this.items.indexOf(existing), 1)
      const predicted = this.predict(req)
      const item: QueueItem = {
        req,
        status: 'queued',
        percent: 0,
        weight: Math.max(0.05, predicted),
        remaining: predicted,
        predicted,
        lastEmit: 0,
      }
      this.items.push(item)
      this.emit(item, true)
    }
    this.startTicker()
    this.pump()
  }

  cancel(jobId: string): void {
    const item = this.items.find((i) => i.req.id === jobId)
    if (!item) return
    if (item.status === 'queued') {
      item.status = 'cancelled'
      this.emit(item, true)
    } else {
      item.controller?.abort()
    }
  }

  cancelAll(): void {
    for (const item of this.items) this.cancel(item.req.id)
  }

  get busy(): boolean {
    return this.items.some((i) => !FINISHED.includes(i.status))
  }

  // -------------------------------------------------------------------------

  private predict(req: JobRequest): number {
    const score = this.hardware?.performanceScore ?? 1
    if (req.type === 'image' && req.imageConfig) {
      const info = req.info as ImageInfo
      const format = resolveImageFormat(req.imageConfig.format, info.format)
      return predictImageSeconds((info.width * info.height) / 1e6, format, req.imageConfig.mode, score, this.deps.calibration)
    }
    if (req.type === 'video' && req.videoConfig) {
      const info = req.info as VideoInfo
      const encoder = resolveEncoder(req.videoConfig, this.hardware)
      return predictVideoSeconds(planWorkload(info, req.videoConfig, encoder), score, this.deps.calibration)
    }
    return 1
  }

  private pump(): void {
    const concurrency = this.hardware?.imageConcurrency ?? 2
    for (const item of this.items) {
      if (item.status !== 'queued') continue
      if (item.req.type === 'image' && this.runningImages < concurrency) {
        this.runningImages++
        void this.run(item).finally(() => {
          this.runningImages--
          this.pump()
        })
      } else if (item.req.type === 'video' && this.runningVideos < 1) {
        this.runningVideos++
        void this.run(item).finally(() => {
          this.runningVideos--
          this.pump()
        })
      }
    }
    if (!this.busy) {
      this.emitStats()
      this.stopTicker()
    }
  }

  private async run(item: QueueItem): Promise<void> {
    item.status = 'processing'
    item.startedAt = Date.now()
    item.controller = new AbortController()
    this.emit(item, true)
    try {
      if (item.req.type === 'image') await this.runImage(item)
      else await this.runVideo(item)
    } catch (e) {
      if (e instanceof AbortError || item.controller.signal.aborted) {
        item.status = 'cancelled'
        this.emit(item, true)
      } else {
        item.status = 'failed'
        this.emit(item, true, { error: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      item.controller = undefined
    }
  }

  private async runImage(item: QueueItem): Promise<void> {
    const { req } = item
    const config = req.imageConfig!
    const info = req.info as ImageInfo
    const sourceStat = await stat(req.filePath)
    const started = Date.now()

    const result = await compressImage(req.filePath, config)
    if (item.controller?.signal.aborted) throw new AbortError()

    const elapsed = (Date.now() - started) / 1000
    const format = resolveImageFormat(config.format, info.format)
    const base = predictImageSeconds((info.width * info.height) / 1e6, format, config.mode, this.hardware?.performanceScore ?? 1)
    this.deps.calibration.record(imageKey(format, config.mode), elapsed / base)

    const ext = imageOutputExtension(req.filePath, info.format, result.format)
    const plan = planOutputPath(req.filePath, ext, req.output)
    const larger = result.data.length >= result.originalBytes && req.output.keepOriginalIfLarger
    if (result.unchanged || larger) {
      const note = result.unchanged ? result.note : 'Original kept: compressed file was larger'
      await this.keepOriginal(item, sourceStat, note)
      return
    }
    const temp = tempPathFor(plan.finalPath, req.id)
    await mkdir(dirname(plan.finalPath), { recursive: true })
    await writeFile(temp, result.data)
    const note = await this.commit(temp, plan, req.filePath, sourceStat, req.output)
    this.complete(item, result.data.length, plan.finalPath, [result.note, note].filter(Boolean).join(' · ') || undefined)
  }

  private async runVideo(item: QueueItem): Promise<void> {
    const { req } = item
    const config = req.videoConfig!
    const info = req.info as VideoInfo
    const sourceStat = await stat(req.filePath)
    const plan = planOutputPath(req.filePath, videoOutputExtension(config.container), req.output)
    const temp = tempPathFor(plan.finalPath, req.id)
    await mkdir(dirname(plan.finalPath), { recursive: true })

    try {
      const started = Date.now()
      const result = await encodeVideo({
        input: req.filePath,
        output: temp,
        info,
        config,
        hardware: this.hardware,
        calibration: this.deps.calibration,
        signal: item.controller!.signal,
        onProgress: (p) => {
          item.percent = p.percent
          item.remaining = p.etaSeconds
          item.fps = p.fps
          item.speed = p.speed ?? undefined
          item.phase = p.phase
          this.emit(item, false)
        },
      })

      // Calibrate: how far off was the uncalibrated model?
      if ((Date.now() - started) / 1000 > 3 && result.measuredFps > 0) {
        const raw = predictVideoFps(planWorkload(info, config, result.encoder), this.hardware?.performanceScore ?? 1)
        this.deps.calibration.record(calibrationKey(config.codec, result.encoder.mode, config.preset), raw / result.measuredFps)
      }

      const larger = result.bytes >= req.sizeBytes && req.output.keepOriginalIfLarger && config.rateControl !== 'targetSize'
      if (larger) {
        await rm(temp, { force: true })
        await this.keepOriginal(item, sourceStat, 'Original kept: compressed file was larger')
        return
      }
      const note = await this.commit(temp, plan, req.filePath, sourceStat, req.output)
      this.complete(item, result.bytes, plan.finalPath, [...result.notes, note].filter(Boolean).join(' · ') || undefined)
    } catch (e) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw e
    }
  }

  /** Move the temp file into place. Returns a note if something needs saying. */
  private async commit(temp: string, plan: OutputPlan, source: string, sourceStat: Stats, output: OutputSettings): Promise<string | undefined> {
    let note: string | undefined
    if (plan.replacesSource) {
      try {
        await this.deps.trash(source)
      } catch {
        if (!samePath(plan.finalPath, source)) note = 'Original left in place: it could not be moved to the Recycle Bin'
      }
    }
    await rename(temp, plan.finalPath)
    if (output.preserveTimestamps) {
      await utimes(plan.finalPath, sourceStat.atime, sourceStat.mtime).catch(() => undefined)
    }
    return note
  }

  private async keepOriginal(item: QueueItem, sourceStat: Stats, note?: string): Promise<void> {
    const { req } = item
    let outputPath: string | undefined
    // In folder mode the destination should still end up with every file.
    if (req.output.mode === 'folder' && req.output.folder) {
      const dest = join(req.output.folder, basename(req.filePath))
      if (!samePath(dest, req.filePath)) {
        await mkdir(req.output.folder, { recursive: true })
        await copyFile(req.filePath, dest)
        if (req.output.preserveTimestamps) await utimes(dest, sourceStat.atime, sourceStat.mtime).catch(() => undefined)
        outputPath = dest
      }
    }
    item.status = 'skipped'
    item.percent = 100
    item.remaining = 0
    this.emit(item, true, { compressedSizeBytes: req.sizeBytes, outputPath, note })
  }

  private complete(item: QueueItem, bytes: number, outputPath: string, note?: string): void {
    item.status = 'completed'
    item.percent = 100
    item.remaining = 0
    this.emit(item, true, { compressedSizeBytes: bytes, outputPath, note })
  }

  // -------------------------------------------------------------------------
  // Progress reporting
  // -------------------------------------------------------------------------

  private progressOf(item: QueueItem): ProgressStatus {
    return {
      jobId: item.req.id,
      percent: Math.round(item.percent * 10) / 10,
      currentFps: item.fps !== undefined ? Math.round(item.fps * 10) / 10 : undefined,
      currentSpeed: item.speed !== undefined ? Math.round(item.speed * 100) / 100 : undefined,
      phase: item.phase,
      estimatedSecondsRemaining: Math.max(0, Math.round(item.remaining)),
      humanReadableEta: formatEta(item.remaining),
    }
  }

  private emit(item: QueueItem, force: boolean, extra: Partial<JobUpdate> = {}): void {
    const now = Date.now()
    if (!force && now - item.lastEmit < 200) return
    item.lastEmit = now
    this.deps.emitUpdate({ jobId: item.req.id, status: item.status, progress: this.progressOf(item), ...extra })
  }

  /** Images have no progress stream, so estimate it from the elapsed time. */
  private tickImages(): void {
    const now = Date.now()
    for (const item of this.items) {
      if (item.status !== 'processing' || item.req.type !== 'image' || !item.startedAt) continue
      const elapsed = (now - item.startedAt) / 1000
      const expected = Math.max(item.predicted, elapsed * 1.05)
      item.percent = Math.min(95, (elapsed / expected) * 100)
      item.remaining = Math.max(0.2, item.predicted - elapsed)
      this.emit(item, true)
    }
  }

  computeStats(): QueueStats {
    const concurrency = this.hardware?.imageConcurrency ?? 2
    let imageLane = 0
    let videoLane = 0
    let weightTotal = 0
    let weightDone = 0
    let completed = 0
    let failed = 0
    let running = 0
    for (const item of this.items) {
      const finished = FINISHED.includes(item.status)
      weightTotal += item.weight
      weightDone += finished ? item.weight : (item.weight * item.percent) / 100
      if (item.status === 'completed' || item.status === 'skipped') completed++
      if (item.status === 'failed') failed++
      if (item.status === 'processing' || item.status === 'analyzing') running++
      if (finished) continue
      const remaining = item.status === 'queued' ? item.predicted : item.remaining
      if (item.req.type === 'image') imageLane += remaining
      else videoLane += remaining
    }
    // Image and video lanes run side by side; the slower lane sets the finish time.
    const eta = Math.max(imageLane / imageLaneSpeedup(concurrency), videoLane)
    const active = this.busy
    return {
      active,
      total: this.items.length,
      completed,
      failed,
      running,
      percent: weightTotal > 0 ? Math.min(100, Math.round((weightDone / weightTotal) * 1000) / 10) : 0,
      estimatedSecondsRemaining: Math.round(eta),
      humanReadableEta: active ? formatEta(eta) : '--',
      elapsedSeconds: this.runStartedAt ? Math.round((Date.now() - this.runStartedAt) / 1000) : 0,
    }
  }

  private emitStats(): void {
    this.deps.emitStats(this.computeStats())
  }

  private startTicker(): void {
    if (this.ticker) return
    this.ticker = setInterval(() => {
      this.tickImages()
      this.emitStats()
    }, 500)
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
  }
}
