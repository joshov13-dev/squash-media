import { formatBytes } from '@shared/format'
import type { AppInfo, HardwareProfile, ImageJobConfig, MediaJob, VideoJobConfig } from '@shared/types'
import { effectiveImageConfig, effectiveVideoConfig } from './effective'

interface ReportContext {
  app: AppInfo | null
  hardware: HardwareProfile | null
  image: ImageJobConfig
  video: VideoJobConfig
}

function systemLines(ctx: ReportContext): string[] {
  const hw = ctx.hardware
  return [
    `SquashMedia ${ctx.app?.version ?? '?'} on ${ctx.app?.platform ?? navigator.platform}`,
    hw ? `CPU: ${hw.cpuModel} (${hw.logicalCores} threads)` : '',
    hw?.gpus.length ? `Graphics: ${hw.gpus.map((g) => g.model).join(', ')}` : '',
    hw ? `FFmpeg: ${hw.ffmpegVersion ?? 'not found'} · GPU encoders: ${hw.availableGpuEncoders.join(', ') || 'none'}` : '',
  ].filter(Boolean)
}

function jobLines(job: MediaJob, ctx: ReportContext): string[] {
  const config = job.type === 'image' ? effectiveImageConfig(job, ctx.image) : effectiveVideoConfig(job, ctx.video)
  return [
    `File: ${job.fileName} (${job.type}, ${formatBytes(job.sizeBytes)})`,
    `Details: ${JSON.stringify(job.info)}`,
    `Settings: ${JSON.stringify(config)}`,
    `Problem: ${job.error ?? job.status}`,
    job.errorDetail && job.errorDetail !== job.error ? `Technical detail: ${job.errorDetail}` : '',
  ].filter(Boolean)
}

/**
 * Plain text to paste into a bug report. File names are kept but folder
 * paths are left out, since they can hold people's names.
 */
export function problemReport(jobs: MediaJob[], ctx: ReportContext): string {
  const sections = jobs.map((j) => jobLines(j, ctx).join('\n'))
  return ['SquashMedia problem report', ...systemLines(ctx), '', ...sections.flatMap((s) => [s, ''])].join('\n').trim() + '\n'
}
