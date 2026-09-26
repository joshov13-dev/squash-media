import { create } from 'zustand'
import { formatEta } from '@shared/format'
import { looksLikeOutput } from '@shared/naming'
import { FFMPEG_MISSING } from '@shared/messages'
import { GOALS } from '@shared/presets'
import type { ImageJobConfig, JobRequest, JobStatus, JobUpdate, MediaFile, MediaJob, OutputSettings, TrimRange, VideoJobConfig } from '@shared/types'
import { api } from '@renderer/lib/api'
import { effectiveImageConfig, effectiveVideoConfig } from '@renderer/lib/effective'
import { problemReport } from '@renderer/lib/report'
import { useSettings } from './settingsStore'
import { useSystem } from './systemStore'

const RUNNABLE: JobStatus[] = ['pending', 'failed', 'cancelled']
export const FINISHED: JobStatus[] = ['completed', 'skipped', 'failed', 'cancelled']
export const ACTIVE: JobStatus[] = ['queued', 'analyzing', 'processing']

interface QueueState {
  jobs: MediaJob[]
  selectedId: string | null
  thumbnails: Record<string, string>
  adding: number
  notice: string | null

  addPaths: (paths: string[]) => Promise<void>
  /** New files from a watched folder: add them with that folder's goal and start them. */
  addWatched: (watchId: string, paths: string[]) => Promise<void>
  select: (id: string | null) => void
  selectNext: (delta: number) => void
  remove: (id: string) => void
  clearFinished: () => void
  clearAll: () => void
  requeueFinished: () => void
  retry: (id: string) => void
  /** Start every waiting job, or just these. */
  start: (ids?: string[]) => Promise<void>
  cancel: (id: string) => void
  stopAll: () => void
  applyUpdate: (u: JobUpdate) => void
  dismissNotice: () => void
  showNotice: (text: string) => void
  /** Copy a problem report for these jobs (or every failed one) to the clipboard. */
  copyReport: (ids?: string[]) => Promise<void>
  setImageOverride: (id: string, config: ImageJobConfig | undefined) => void
  setVideoOverride: (id: string, config: VideoJobConfig | undefined) => void
  setTrim: (id: string, trim: TrimRange | undefined) => void
}

const idleProgress = (jobId: string) => ({ jobId, percent: 0, estimatedSecondsRemaining: 0, humanReadableEta: formatEta(Number.NaN) })

function toJob(file: MediaFile): MediaJob {
  return { ...file, status: 'pending', progress: idleProgress(file.id) }
}

function resetJob(job: MediaJob): MediaJob {
  return {
    ...job,
    status: 'pending',
    progress: idleProgress(job.id),
    compressedSizeBytes: undefined,
    outputPath: undefined,
    note: undefined,
    error: undefined,
    errorDetail: undefined,
    startedAt: undefined,
    finishedAt: undefined,
  }
}

async function loadThumbnails(files: MediaFile[]): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++]
      const thumb = await api.getThumbnail(file).catch(() => null)
      if (thumb) useQueue.setState((s) => ({ thumbnails: { ...s.thumbnails, [file.id]: thumb } }))
    }
  }
  await Promise.all([worker(), worker(), worker()])
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const useQueue = create<QueueState>()((set, get) => ({
  jobs: [],
  selectedId: null,
  thumbnails: {},
  adding: 0,
  notice: null,

  addPaths: async (paths) => {
    if (!paths.length) return
    set((s) => ({ adding: s.adding + 1 }))
    try {
      const { files: found, rejected } = await api.resolveMedia(paths)
      // Adding a folder again should not pick up the copies made last time.
      const { preferences, output } = useSettings.getState()
      const earlierOutput = (f: MediaFile): boolean =>
        preferences.skipCompressedNames && f.relativeDir !== undefined && looksLikeOutput(f.fileName.replace(/\.[^.]+$/, ''), output.nameTemplate)
      const files = found.filter((f) => !earlierOutput(f))
      const leftOut = found.length - files.length
      const known = new Set(get().jobs.map((j) => j.filePath.toLowerCase()))
      const fresh = files.filter((f) => !known.has(f.filePath.toLowerCase()))
      set((s) => ({
        jobs: [...s.jobs, ...fresh.map(toJob)],
        selectedId: s.selectedId ?? fresh[0]?.id ?? null,
      }))
      const dupes = files.length - fresh.length
      const parts: string[] = []
      if (rejected.length) {
        const reasons = new Set(rejected.map((r) => r.reason))
        // The FFmpeg problem already has its own message at the top of the queue.
        const reason = rejected[0].reason === FFMPEG_MISSING ? 'FFmpeg is missing (see the message above)' : rejected[0].reason
        parts.push(`${rejected.length} skipped: ${reason}${reasons.size > 1 ? ' (and other reasons)' : ''}`)
      }
      if (dupes) parts.push(`${dupes} already in the queue`)
      if (leftOut) parts.push(`${leftOut} earlier compressed ${leftOut === 1 ? 'copy' : 'copies'} left out`)
      if (!found.length && !rejected.length) parts.push('No photos or videos found there')
      if (parts.length) get().showNotice(parts.join(' · '))
      void loadThumbnails(fresh)
    } finally {
      set((s) => ({ adding: s.adding - 1 }))
    }
  },

  select: (id) => set({ selectedId: id }),

  selectNext: (delta) => {
    const { jobs, selectedId } = get()
    if (!jobs.length) return
    const i = jobs.findIndex((j) => j.id === selectedId)
    const next = Math.max(0, Math.min(jobs.length - 1, (i < 0 ? 0 : i) + delta))
    set({ selectedId: jobs[next].id })
  },

  remove: (id) => {
    const job = get().jobs.find((j) => j.id === id)
    if (job && ACTIVE.includes(job.status)) void api.cancelJob(id)
    set((s) => {
      const index = s.jobs.findIndex((j) => j.id === id)
      const jobs = s.jobs.filter((j) => j.id !== id)
      const selectedId = s.selectedId === id ? (jobs[Math.min(index, jobs.length - 1)]?.id ?? null) : s.selectedId
      return { jobs, selectedId }
    })
  },

  clearFinished: () =>
    set((s) => {
      const jobs = s.jobs.filter((j) => j.status !== 'completed' && j.status !== 'skipped')
      return { jobs, selectedId: jobs.some((j) => j.id === s.selectedId) ? s.selectedId : (jobs[0]?.id ?? null) }
    }),

  clearAll: () => {
    for (const j of get().jobs) if (ACTIVE.includes(j.status)) void api.cancelJob(j.id)
    set({ jobs: [], selectedId: null })
  },

  requeueFinished: () => set((s) => ({ jobs: s.jobs.map((j) => (FINISHED.includes(j.status) ? resetJob(j) : j)) })),

  retry: (id) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? resetJob(j) : j)) })),

  start: async (only) => {
    const settings = useSettings.getState()
    const hardware = useSystem.getState().hardware
    const runnable = get().jobs.filter((j) => RUNNABLE.includes(j.status) && (!only || only.includes(j.id)))
    if (!runnable.length) return

    const requests: JobRequest[] = []
    const blocked = new Set<string>()
    for (const job of runnable) {
      if (job.type === 'video' && hardware && !hardware.ffmpegAvailable) {
        blocked.add(job.id)
        continue
      }
      requests.push({
        id: job.id,
        filePath: job.filePath,
        relativeDir: job.relativeDir,
        type: job.type,
        sizeBytes: job.sizeBytes,
        info: job.info,
        imageConfig: job.type === 'image' ? effectiveImageConfig(job, settings.image) : undefined,
        videoConfig: job.type === 'video' ? effectiveVideoConfig(job, settings.video) : undefined,
        output: job.outputOverride ?? settings.output,
        origin: job.origin ?? 'app',
      })
    }
    const ids = new Set(requests.map((r) => r.id))
    set((s) => ({
      jobs: s.jobs.map((j) => {
        if (blocked.has(j.id)) return { ...resetJob(j), status: 'failed', error: FFMPEG_MISSING }
        if (ids.has(j.id)) return { ...resetJob(j), status: 'queued', startedAt: Date.now() }
        return j
      }),
    }))
    if (requests.length) await api.enqueue(requests)
  },

  cancel: (id) => void api.cancelJob(id),

  stopAll: () => {
    void api.cancelAll()
  },

  applyUpdate: (u) =>
    set((s) => ({
      jobs: s.jobs.map((j) => {
        if (j.id !== u.jobId) return j
        const finished = FINISHED.includes(u.status)
        return {
          ...j,
          status: u.status,
          progress: u.progress,
          compressedSizeBytes: u.compressedSizeBytes ?? j.compressedSizeBytes,
          outputPath: u.outputPath ?? j.outputPath,
          note: u.note ?? j.note,
          error: u.error,
          errorDetail: u.errorDetail,
          finishedAt: finished ? Date.now() : j.finishedAt,
        }
      }),
    })),

  addWatched: async (watchId, paths) => {
    const { preferences, output, video } = useSettings.getState()
    const watch = preferences.watchFolders.find((w) => w.id === watchId)
    if (!watch?.enabled) return
    const goal = GOALS.find((g) => g.id === watch.goalId) ?? GOALS[0]
    const { files } = await api.resolveMedia(paths)
    const outputs = new Set(get().jobs.map((j) => j.outputPath?.toLowerCase()).filter(Boolean))
    const known = new Set(get().jobs.map((j) => j.filePath.toLowerCase()))
    const fresh = files.filter(
      (f) =>
        !known.has(f.filePath.toLowerCase()) &&
        !outputs.has(f.filePath.toLowerCase()) &&
        // Copies saved into the watched folder itself must not be picked up again.
        !looksLikeOutput(f.fileName.replace(/\.[^.]+$/, ''), output.nameTemplate),
    )
    if (!fresh.length) return
    const jobOutput: OutputSettings = watch.outputFolder
      ? { ...output, mode: 'folder', folder: watch.outputFolder, keepFolderStructure: true, renameInFolder: false }
      : { ...output, mode: 'suffix' }
    const jobs = fresh.map((f): MediaJob => {
      const folder = f.filePath.slice(0, f.filePath.length - f.fileName.length - 1)
      const below = folder.length > watch.path.length ? folder.slice(watch.path.length).replace(/^[\\/]+/, '') : ''
      return {
        ...toJob(f),
        relativeDir: below || undefined,
        imageOverride: f.type === 'image' ? { ...goal.image, resize: { ...goal.image.resize } } : undefined,
        // Keep the graphics card choice from the Videos tab.
        videoOverride: f.type === 'video' ? { ...goal.video, encoderMode: video.encoderMode, keepLocation: video.keepLocation } : undefined,
        outputOverride: jobOutput,
        origin: 'watch',
      }
    })
    set((s) => ({ jobs: [...s.jobs, ...jobs], selectedId: s.selectedId ?? jobs[0].id }))
    void loadThumbnails(fresh)
    const name = watch.path.split(/[\\/]/).filter(Boolean).pop() ?? watch.path
    get().showNotice(`${jobs.length} new ${jobs.length === 1 ? 'file' : 'files'} in ${name}, compressing with "${goal.name}"`)
    await get().start(jobs.map((j) => j.id))
  },

  dismissNotice: () => set({ notice: null }),

  showNotice: (text) => {
    clearTimeout(noticeTimer)
    set({ notice: text })
    noticeTimer = setTimeout(() => set({ notice: null }), 6000)
  },

  copyReport: async (ids) => {
    const jobs = get().jobs.filter((j) => (ids ? ids.includes(j.id) : j.status === 'failed'))
    if (!jobs.length) return
    const { image, video } = useSettings.getState()
    const { app, hardware } = useSystem.getState()
    await api.copyText(problemReport(jobs, { app, hardware, image, video }))
    get().showNotice(`Copied the details of ${jobs.length === 1 ? jobs[0].fileName : `${jobs.length} files`}. Paste them into a bug report.`)
  },

  setImageOverride: (id, config) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, imageOverride: config } : j)) })),
  setVideoOverride: (id, config) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, videoOverride: config } : j)) })),
  setTrim: (id, trim) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, trim } : j)) })),
}))

/** The job currently selected in the queue. */
export function useSelectedJob(): MediaJob | undefined {
  return useQueue((s) => s.jobs.find((j) => j.id === s.selectedId))
}

/** Which kinds of file are in the queue, so settings for the other kind can be hidden. */
export function useQueueKinds(): { photos: boolean; videos: boolean } {
  const photos = useQueue((s) => s.jobs.some((j) => j.type === 'image'))
  const videos = useQueue((s) => s.jobs.some((j) => j.type === 'video'))
  return { photos, videos }
}

/** Whether a run is going, and how many files a press of Compress would start. */
export function useRunState(): { running: boolean; runnable: number } {
  const active = useSystem((s) => s.stats?.active ?? false)
  const running = useQueue((s) => s.jobs.some((j) => ACTIVE.includes(j.status)))
  const runnable = useQueue((s) => s.jobs.filter((j) => RUNNABLE.includes(j.status)).length)
  return { running: active || running, runnable }
}
