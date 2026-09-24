import { DEFAULT_IMAGE_CONFIG, DEFAULT_VIDEO_CONFIG, type Preset } from '@shared/presets'
import type { ImageJobConfig, MediaJob, VideoJobConfig } from '@shared/types'
import { useQueue, useSelectedJob } from './queueStore'
import { normaliseVideo, useSettings } from './settingsStore'

export type SettingsScope = 'all' | 'file'

interface Editor<T> {
  config: T
  /** Editing the shared settings, or the selected file's own copy. */
  scope: SettingsScope
  /** The selected file of this type, if any. */
  job?: MediaJob
  presetId: string | null
  set: (patch: Partial<T>) => void
  applyPreset: (preset: Preset<T>) => void
  reset: () => void
  setScope: (scope: SettingsScope) => void
}

const cloneImage = (c: ImageJobConfig): ImageJobConfig => ({ ...c, resize: { ...c.resize } })

export function useImageEditor(): Editor<ImageJobConfig> & { setResize: (patch: Partial<ImageJobConfig['resize']>) => void } {
  const selected = useSelectedJob()
  const job = selected?.type === 'image' ? selected : undefined
  const shared = useSettings((s) => s.image)
  const presetId = useSettings((s) => s.imagePresetId)
  const setShared = useSettings((s) => s.setImage)
  const setSharedResize = useSettings((s) => s.setImageResize)
  const applySharedPreset = useSettings((s) => s.applyImagePreset)
  const resetShared = useSettings((s) => s.resetImage)
  const setOverride = useQueue((s) => s.setImageOverride)
  const own = job?.imageOverride

  return {
    config: own ?? shared,
    scope: own ? 'file' : 'all',
    job,
    presetId: own ? null : presetId,
    set: (patch) => (own && job ? setOverride(job.id, { ...own, ...patch }) : setShared(patch)),
    setResize: (patch) => (own && job ? setOverride(job.id, { ...own, resize: { ...own.resize, ...patch } }) : setSharedResize(patch)),
    applyPreset: (preset) => (own && job ? setOverride(job.id, cloneImage(preset.config)) : applySharedPreset(preset)),
    reset: () => (own && job ? setOverride(job.id, cloneImage(DEFAULT_IMAGE_CONFIG)) : resetShared()),
    setScope: (scope) => job && setOverride(job.id, scope === 'file' ? cloneImage(shared) : undefined),
  }
}

export function useVideoEditor(): Editor<VideoJobConfig> {
  const selected = useSelectedJob()
  const job = selected?.type === 'video' ? selected : undefined
  const shared = useSettings((s) => s.video)
  const presetId = useSettings((s) => s.videoPresetId)
  const setShared = useSettings((s) => s.setVideo)
  const applySharedPreset = useSettings((s) => s.applyVideoPreset)
  const resetShared = useSettings((s) => s.resetVideo)
  const setOverride = useQueue((s) => s.setVideoOverride)
  const own = job?.videoOverride

  return {
    config: own ?? shared,
    scope: own ? 'file' : 'all',
    job,
    presetId: own ? null : presetId,
    set: (patch) => (own && job ? setOverride(job.id, normaliseVideo(own, { ...own, ...patch })) : setShared(patch)),
    applyPreset: (preset) =>
      own && job ? setOverride(job.id, normaliseVideo(own, { ...preset.config, encoderMode: own.encoderMode })) : applySharedPreset(preset),
    reset: () =>
      own && job ? setOverride(job.id, { ...DEFAULT_VIDEO_CONFIG, encoderMode: own.encoderMode }) : resetShared(),
    setScope: (scope) => job && setOverride(job.id, scope === 'file' ? { ...shared } : undefined),
  }
}
