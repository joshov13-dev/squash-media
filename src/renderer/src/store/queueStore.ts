import { create } from 'zustand'
import { formatEta } from '@shared/format'
import type { ImageJobConfig, JobRequest, JobStatus, JobUpdate, MediaFile, MediaJob, TrimRange, VideoJobConfig } from '@shared/types'
import { api } from '@renderer/lib/api'
import { effectiveImageConfig, effectiveVideoConfig } from '@renderer/lib/effective'
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
  select: (id: string | null) => void
  selectNext: (delta: number) => void
  remove: (id: string) => void
  clearFinished: () => void
  clearAll: () => void
  requeueFinished: () => void
  retry: (id: string) => void
  start: () => Promise<void>
  cancel: (id: string) => void
  stopAll: () => void
  applyUpdate: (u: JobUpdate) => void
  dismissNotice: () => void
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
      const suffix = (output.suffix.trim() || '_compressed').toLowerCase()
      const earlierOutput = (f: MediaFile): boolean =>
        preferences.skipCompressedNames && f.relativeDir !== undefined && f.fileName.replace(/\.[^.]+$/, '').toLowerCase().endsWith(suffix)
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
      if (rejected.length) parts.push(`${rejected.length} skipped (${rejected[0].reason.toLowerCase()}${rejected.length > 1 ? ', ...' : ''})`)
      if (dupes) parts.push(`${dupes} already in the queue`)
      if (leftOut) parts.push(`${leftOut} earlier ${leftOut === 1 ? 'copy' : 'copies'} ending in ${suffix} left out`)
      if (!found.length && !rejected.length) parts.push('No photos or videos found there')
      if (parts.length) {
        clearTimeout(noticeTimer)
        set({ notice: parts.join(' · ') })
        noticeTimer = setTimeout(() => set({ notice: null }), 6000)
      }
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

  start: async () => {
    const settings = useSettings.getState()
    const hardware = useSystem.getState().hardware
    const runnable = get().jobs.filter((j) => RUNNABLE.includes(j.status))
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
        output: settings.output,
      })
    }
    const ids = new Set(requests.map((r) => r.id))
    set((s) => ({
      jobs: s.jobs.map((j) => {
        if (blocked.has(j.id)) return { ...resetJob(j), status: 'failed', error: 'FFmpeg was not found, so videos cannot be encoded' }
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

  dismissNotice: () => set({ notice: null }),

  setImageOverride: (id, config) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, imageOverride: config } : j)) })),
  setVideoOverride: (id, config) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, videoOverride: config } : j)) })),
  setTrim: (id, trim) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, trim } : j)) })),
}))

/** The job currently selected in the queue. */
export function useSelectedJob(): MediaJob | undefined {
  return useQueue((s) => s.jobs.find((j) => j.id === s.selectedId))
}
