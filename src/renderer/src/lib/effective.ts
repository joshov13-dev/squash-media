import type { ImageJobConfig, MediaJob, VideoJobConfig } from '@shared/types'

/** The photo settings a job will actually use. */
export function effectiveImageConfig(job: MediaJob, shared: ImageJobConfig): ImageJobConfig {
  return job.imageOverride ?? shared
}

/** The video settings a job will actually use, including its trim. */
export function effectiveVideoConfig(job: MediaJob, shared: VideoJobConfig): VideoJobConfig {
  const base = job.videoOverride ?? shared
  return job.trim ? { ...base, trimStart: job.trim.start, trimEnd: job.trim.end } : base
}
