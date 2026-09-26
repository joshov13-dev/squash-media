import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveImageFormat } from '@shared/codecs'
import { formatEta } from '@shared/format'
import type {
  AppPreferences,
  HardwareProfile,
  HistoryEntry,
  ImageInfo,
  JobRequest,
  JobStatus,
  JobUpdate,
  ProgressStatus,
  QueueStats,
  RunOrigin,
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
import { friendlyError } from './friendlyErrors'
import {
  imageOutputExtension,
  planOutputPath,
  samePath,
  tempPathFor,
  uniquePath,
  videoOutputExtension,
  type NamingInput,
  type OutputPlan,
} from './outputPaths'
import { encodeVideo, planWorkload, resolveEncoder, trimWindow } from './videoProcessor'

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
  /** Size on disk after the job, for run totals. */
  outputBytes?: number
  /** Output path reserved for this job in the current run. */
  claimedPath?: string
  sourceMtimeMs?: number
}

export interface JobQueueDeps {
  getHardware: () => Promise<HardwareProfile>
  getPreferences: () => AppPreferences
  calibration: CalibrationStore
  emitUpdate: (update: JobUpdate) => void
  emitStats: (stats: QueueStats) => void
  /** Move a file to the recycle bin. */
  trash: (path: string) => Promise<void>
  /** Keeps a record of each file written, for undo. */
  history?: { record: (runId: string, origin: RunOrigin, startedAt: number, entry: HistoryEntry) => Promise<void> | void }
}

const FINISHED: JobStatus[] = ['completed', 'skipped', 'failed', 'cancelled']

export class JobQueue {
  private items: QueueItem[] = []
  private hardware: HardwareProfile | null = null
  private runningImages = 0
  private runningVideos = 0
  private runStartedAt = 0
  private runId = randomUUID().slice(0, 8)
  private ticker: NodeJS.Timeout | null = null
  /** Output paths handed out in this run, so two jobs never share one. */
  private claimed = new Set<string>()

  constructor(private readonly deps: JobQueueDeps) {}

  async enqueue(requests: JobRequest[]): Promise<void> {
    this.hardware = await this.deps.getHardware()
    // A fresh run once everything before has finished.
    if (this.items.every((i) => FINISHED.includes(i.status))) {
      this.items = []
      this.claimed.clear()
      this.runStartedAt = Date.now()
      this.runId = randomUUID().slice(0, 8)
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
    // Report "active" straight away, even if the run finishes before the next tick.
    this.emitStats()
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

  /**
   * Predicted seconds for each request, and for the whole lot with photos and
   * videos running side by side. Used for dry runs.
   */
  async estimate(requests: JobRequest[]): Promise<{ perFile: number[]; total: number }> {
    this.hardware ??= await this.deps.getHardware()
    const perFile = requests.map((r) => this.predict(r))
    let images = 0
    let videos = 0
    requests.forEach((r, i) => (r.type === 'image' ? (images += perFile[i]) : (videos += perFile[i])))
    const total = Math.max(images / imageLaneSpeedup(this.imageLanes()), videos / imageLaneSpeedup(this.deps.getPreferences().videosAtOnce))
    return { perFile, total }
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

  private imageLanes(): number {
    return this.deps.getPreferences().photosAtOnce || this.hardware?.imageConcurrency || 2
  }

  private pump(): void {
    const imageLanes = this.imageLanes()
    const videoLanes = this.deps.getPreferences().videosAtOnce
    for (const item of this.items) {
      if (item.status !== 'queued') continue
      if (item.req.type === 'image' && this.runningImages < imageLanes) {
        this.runningImages++
        void this.run(item).finally(() => {
          this.runningImages--
          this.pump()
        })
      } else if (item.req.type === 'video' && this.runningVideos < videoLanes) {
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
        this.release(item)
        item.status = 'cancelled'
        this.emit(item, true)
      } else {
        this.release(item)
        item.status = 'failed'
        const { message, detail } = friendlyError(e)
        this.emit(item, true, { error: message, errorDetail: detail })
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
    item.sourceMtimeMs = sourceStat.mtimeMs
    const format = resolveImageFormat(config.format, info.format)
    const natural = planOutputPath(req.filePath, imageOutputExtension(req.filePath, info.format, format), req.output, req.relativeDir, this.naming(item, sourceStat))
    if (await this.skipIfDone(item, natural)) return
    const plan = this.claim(item, natural)
    const started = Date.now()

    const result = await compressImage(req.filePath, config)
    if (item.controller?.signal.aborted) throw new AbortError()

    const elapsed = (Date.now() - started) / 1000
    const base = predictImageSeconds((info.width * info.height) / 1e6, format, config.mode, this.hardware?.performanceScore ?? 1)
    this.deps.calibration.record(imageKey(format, config.mode), elapsed / base)

    const larger = result.data.length >= result.originalBytes && req.output.keepOriginalIfLarger
    if (result.unchanged || larger) {
      const note = result.unchanged ? result.note : 'Original kept: compressed file was larger'
      await this.keepOriginal(item, sourceStat, note)
      return
    }
    const temp = tempPathFor(plan.finalPath, req.id)
    await mkdir(dirname(plan.finalPath), { recursive: true })
    try {
      await writeFile(temp, result.data)
      const { note, replaced, finalPath } = await this.commit(item, temp, plan, sourceStat)
      this.complete(item, result.data.length, finalPath, [result.note, note].filter(Boolean).join(' · ') || undefined, replaced)
    } catch (e) {
      // A half-written temp file (say the disk filled up) must not be left behind.
      await rm(temp, { force: true }).catch(() => undefined)
      throw e
    }
  }

  private async runVideo(item: QueueItem): Promise<void> {
    const { req } = item
    let config = req.videoConfig!
    const info = req.info as VideoInfo
    const sourceStat = await stat(req.filePath)
    item.sourceMtimeMs = sourceStat.mtimeMs
    // A trimmed clip is a new file the user asked for, so never swap it for the original.
    const trimmed = trimWindow(info, config).trimmed
    if (config.rateControl === 'targetSize' && req.sizeBytes <= config.targetMaxSizeBytes && !trimmed) {
      // Encoding up to the target would only make the file bigger.
      if (req.output.keepOriginalIfLarger) {
        await this.keepOriginal(item, sourceStat, 'Already under the target size')
        return
      }
      config = { ...config, targetMaxSizeBytes: req.sizeBytes }
    }
    const natural = planOutputPath(req.filePath, videoOutputExtension(config.container), req.output, req.relativeDir, this.naming(item, sourceStat))
    if (await this.skipIfDone(item, natural)) return
    const plan = this.claim(item, natural)
    const prefs = this.deps.getPreferences()
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
        hwDecode: prefs.gpuDecoding,
        lowPriority: prefs.lowPriority,
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

      const larger = result.bytes >= req.sizeBytes && req.output.keepOriginalIfLarger && !trimmed
      if (larger) {
        await rm(temp, { force: true })
        await this.keepOriginal(item, sourceStat, 'Original kept: compressed file was larger')
        return
      }
      const { note, replaced, finalPath } = await this.commit(item, temp, plan, sourceStat)
      this.complete(item, result.bytes, finalPath, [...result.notes, note].filter(Boolean).join(' · ') || undefined, replaced)
    } catch (e) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw e
    }
  }

  private naming(item: QueueItem, sourceStat: Stats): NamingInput {
    return { modified: sourceStat.mtime, index: this.items.indexOf(item) + 1 }
  }

  /** "Skip files compressed in an earlier session": the output is already there. */
  private async skipIfDone(item: QueueItem, plan: OutputPlan): Promise<boolean> {
    if (!this.deps.getPreferences().skipExisting || plan.replacesSource || !existsSync(plan.finalPath)) return false
    if (this.claimed.has(this.pathKey(plan.finalPath))) return false
    const size = (await stat(plan.finalPath)).size
    item.status = 'skipped'
    item.percent = 100
    item.remaining = 0
    item.outputBytes = size
    this.emit(item, true, { compressedSizeBytes: size, outputPath: plan.finalPath, note: 'Already compressed earlier' })
    return true
  }

  private pathKey(p: string): string {
    return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p
  }

  /**
   * A name for the output that is free: not handed to another job in this run,
   * and not a file already on disk. The only file ever written over is the
   * job's own source, in Replace mode (after it has gone to the bin).
   */
  private freePath(item: QueueItem, plan: OutputPlan): string {
    if (plan.replacesSource && samePath(plan.finalPath, item.req.filePath)) return plan.finalPath
    return uniquePath(plan.finalPath, (p) => this.claimed.has(this.pathKey(p)) || existsSync(p))
  }

  /** Reserve the output path for this run, numbering it if the name is taken. */
  private claim(item: QueueItem, plan: OutputPlan): OutputPlan {
    const finalPath = this.freePath(item, plan)
    this.claimed.add(this.pathKey(finalPath))
    item.claimedPath = finalPath
    return { ...plan, finalPath }
  }

  private release(item: QueueItem): void {
    if (item.claimedPath) this.claimed.delete(this.pathKey(item.claimedPath))
    item.claimedPath = undefined
  }

  /**
   * Move the temp file into place. Returns a note if something needs saying,
   * and whether the original went to the bin.
   */
  private async commit(item: QueueItem, temp: string, claimed: OutputPlan, sourceStat: Stats): Promise<{ note?: string; replaced: boolean; finalPath: string }> {
    const source = item.req.filePath
    const output = item.req.output
    // Something may have appeared at the claimed name while this job ran (the
    // command line and the app can run at once). Rename would replace it.
    let plan = claimed
    if (existsSync(plan.finalPath) && !(plan.replacesSource && samePath(plan.finalPath, source))) {
      this.release(item)
      plan = this.claim(item, plan)
    }
    let note: string | undefined
    let replaced = false
    if (plan.replacesSource) {
      try {
        await this.deps.trash(source)
        replaced = true
      } catch {
        // Writing over the original with no copy in the bin could lose it for good.
        if (samePath(plan.finalPath, source)) {
          await rm(temp, { force: true }).catch(() => undefined)
          throw new Error('The original could not be moved to the Recycle Bin, so it was not replaced')
        }
        note = 'Original left in place: it could not be moved to the Recycle Bin'
      }
    }
    await rename(temp, plan.finalPath)
    if (output.preserveTimestamps) {
      await utimes(plan.finalPath, sourceStat.atime, sourceStat.mtime).catch(() => undefined)
    }
    return { note, replaced, finalPath: plan.finalPath }
  }

  private record(item: QueueItem, output: string, outputBytes: number, replaced: boolean, copied = false): void {
    if (!this.deps.history) return
    const { req } = item
    const origin = req.origin ?? 'app'
    const entry: HistoryEntry = {
      jobId: req.id,
      type: req.type,
      source: req.filePath,
      output,
      originalBytes: req.sizeBytes,
      outputBytes,
      replaced,
      copied: copied || undefined,
      sourceMtimeMs: item.sourceMtimeMs ?? 0,
      finishedAt: Date.now(),
    }
    void Promise.resolve(this.deps.history.record(`${this.runId}-${origin}`, origin, this.runStartedAt, entry)).catch(() => undefined)
  }

  private async keepOriginal(item: QueueItem, sourceStat: Stats, note?: string): Promise<void> {
    const { req } = item
    let outputPath: string | undefined
    // In folder mode the destination should still end up with every file.
    if (req.output.mode === 'folder' && req.output.folder) {
      const folder = req.output.keepFolderStructure && req.relativeDir ? join(req.output.folder, req.relativeDir) : req.output.folder
      const natural = join(folder, basename(req.filePath))
      if (!samePath(natural, req.filePath)) {
        // The name reserved for the compressed file is not needed now.
        this.release(item)
        const dest = this.claim(item, { finalPath: natural, replacesSource: false }).finalPath
        await mkdir(folder, { recursive: true })
        // EXCL: never replace a file that turned up there in the meantime.
        await copyFile(req.filePath, dest, fsConstants.COPYFILE_EXCL)
        if (req.output.preserveTimestamps) await utimes(dest, sourceStat.atime, sourceStat.mtime).catch(() => undefined)
        outputPath = dest
        this.record(item, dest, req.sizeBytes, false, true)
      }
    }
    item.status = 'skipped'
    item.percent = 100
    item.remaining = 0
    item.outputBytes = req.sizeBytes
    this.emit(item, true, { compressedSizeBytes: req.sizeBytes, outputPath, note })
  }

  private complete(item: QueueItem, bytes: number, outputPath: string, note: string | undefined, replaced: boolean): void {
    this.record(item, outputPath, bytes, replaced)
    item.status = 'completed'
    item.percent = 100
    item.remaining = 0
    item.outputBytes = bytes
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
    const concurrency = this.imageLanes()
    const videoLanes = this.deps.getPreferences().videosAtOnce
    let imageLane = 0
    let videoLane = 0
    let weightTotal = 0
    let weightDone = 0
    let completed = 0
    let failed = 0
    let running = 0
    let originalBytes = 0
    let outputBytes = 0
    for (const item of this.items) {
      if (item.outputBytes !== undefined) {
        originalBytes += item.req.sizeBytes
        outputBytes += item.outputBytes
      }
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
    // Parallel videos share the encoder, so each extra lane adds about half a lane.
    const eta = Math.max(imageLane / imageLaneSpeedup(concurrency), videoLane / imageLaneSpeedup(videoLanes))
    const active = this.busy
    return {
      active,
      total: this.items.length,
      completed,
      failed,
      running,
      percent: weightTotal > 0 ? Math.min(100, Math.round((weightDone / weightTotal) * 1000) / 10) : 0,
      estimatedSecondsRemaining: Math.round(eta),
      humanReadableEta: active ? formatEta(eta) : '',
      elapsedSeconds: this.runStartedAt ? Math.round((Date.now() - this.runStartedAt) / 1000) : 0,
      originalBytes,
      outputBytes,
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
