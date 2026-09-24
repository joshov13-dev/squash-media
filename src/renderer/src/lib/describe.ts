import { CODECS, ENCODER_LABELS, IMAGE_FORMAT_LABELS, resolveImageFormat } from '@shared/codecs'
import { formatBytes, formatDuration } from '@shared/format'
import type { HardwareProfile, ImageInfo, ImageJobConfig, MediaJob, VideoInfo, VideoJobConfig } from '@shared/types'

const FORMAT_NAMES: Record<string, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  tiff: 'TIFF',
  bmp: 'BMP',
}

export const formatName = (f: string): string => FORMAT_NAMES[f] ?? f.toUpperCase()

const VIDEO_CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'H.265',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  prores: 'ProRes',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  mjpeg: 'MJPEG',
}

export const videoCodecName = (c: string): string => VIDEO_CODEC_NAMES[c] ?? c.toUpperCase()

export function describeSource(job: MediaJob): string {
  if (job.info.kind === 'image') {
    const i = job.info
    return `${i.width}×${i.height} · ${formatName(i.format)} · ${formatBytes(job.sizeBytes)}`
  }
  const v = job.info
  return `${v.width}×${v.height} · ${videoCodecName(v.videoCodec)} · ${formatDuration(v.durationSeconds)} · ${formatBytes(job.sizeBytes)}`
}

export function describeImagePlan(info: ImageInfo, c: ImageJobConfig): string {
  const format = formatName(resolveImageFormat(c.format, info.format))
  if (c.mode === 'lossless') return `${format} lossless`
  if (c.mode === 'targetSize') return `${format} under ${formatBytes(c.targetMaxSizeBytes, 0)}`
  return `${format} q${c.quality}`
}

export function describeVideoPlan(info: VideoInfo, c: VideoJobConfig, hw: HardwareProfile | null): string {
  const supported = hw?.encoderSupport[c.codec] ?? ['cpu']
  const mode = supported.includes(c.encoderMode) ? c.encoderMode : 'cpu'
  const parts = [videoCodecName(c.codec)]
  if (mode !== 'cpu') parts.push(ENCODER_LABELS[mode].split(' ').pop()!)
  if (c.rateControl === 'crf') parts.push(`${c.codec === 'h264' || c.codec === 'hevc' ? 'RF' : 'CRF'} ${c.crf}`)
  else if (c.rateControl === 'targetSize') parts.push(`under ${formatBytes(c.targetMaxSizeBytes, 0)}`)
  else parts.push(`${c.targetBitrateKbps} kbps`)
  if (c.scale !== 'original' && Math.min(info.width, info.height) > Number.parseInt(c.scale)) parts.push(c.scale)
  parts.push(c.container.toUpperCase())
  return parts.join(' · ')
}

export function codecLabel(codec: VideoJobConfig['codec']): string {
  return CODECS[codec].label
}

export function imageFormatLabel(f: ImageJobConfig['format']): string {
  return IMAGE_FORMAT_LABELS[f]
}
