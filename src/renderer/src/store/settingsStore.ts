import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CODECS, isCodecAllowedInContainer } from '@shared/codecs'
import {
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_OUTPUT,
  DEFAULT_VIDEO_CONFIG,
  IMAGE_PRESETS,
  VIDEO_PRESETS,
  type Preset,
} from '@shared/presets'
import type { ImageJobConfig, OutputSettings, VideoJobConfig } from '@shared/types'

export type SettingsTab = 'image' | 'video' | 'output'

interface SettingsState {
  image: ImageJobConfig
  video: VideoJobConfig
  output: OutputSettings
  imagePresetId: string | null
  videoPresetId: string | null
  customImagePresets: Preset<ImageJobConfig>[]
  customVideoPresets: Preset<VideoJobConfig>[]
  tab: SettingsTab

  setImage: (patch: Partial<ImageJobConfig>) => void
  setImageResize: (patch: Partial<ImageJobConfig['resize']>) => void
  setVideo: (patch: Partial<VideoJobConfig>) => void
  setOutput: (patch: Partial<OutputSettings>) => void
  applyImagePreset: (preset: Preset<ImageJobConfig>) => void
  applyVideoPreset: (preset: Preset<VideoJobConfig>) => void
  saveImagePreset: (name: string) => void
  saveVideoPreset: (name: string) => void
  deletePreset: (id: string) => void
  setTab: (tab: SettingsTab) => void
  resetImage: () => void
  resetVideo: () => void
  resetOutput: () => void
}

/** Keep codec, container and quality scale consistent after any change. */
export function normaliseVideo(prev: VideoJobConfig, next: VideoJobConfig): VideoJobConfig {
  const v = { ...next }
  if (!isCodecAllowedInContainer(v.codec, v.container)) {
    // Prefer changing the container when the user picked a codec, and vice versa.
    if (prev.codec !== v.codec) v.container = CODECS[v.codec].containers[0]
    else v.codec = v.container === 'webm' ? 'vp9' : 'h264'
  }
  if (prev.codec !== v.codec && next.crf === prev.crf) v.crf = CODECS[v.codec].crfDefault
  v.crf = Math.min(CODECS[v.codec].crfMax, Math.max(CODECS[v.codec].crfMin, v.crf))
  if (v.container === 'webm' && v.audioCodec === 'aac') v.audioCodec = 'opus'
  return v
}

let presetCounter = 0
const newId = (kind: string): string => `${kind}-custom-${Date.now().toString(36)}-${presetCounter++}`

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      image: DEFAULT_IMAGE_CONFIG,
      video: DEFAULT_VIDEO_CONFIG,
      output: DEFAULT_OUTPUT,
      imagePresetId: IMAGE_PRESETS[0].id,
      videoPresetId: VIDEO_PRESETS[0].id,
      customImagePresets: [],
      customVideoPresets: [],
      tab: 'image',

      setImage: (patch) => set((s) => ({ image: { ...s.image, ...patch }, imagePresetId: null })),
      setImageResize: (patch) =>
        set((s) => ({ image: { ...s.image, resize: { ...s.image.resize, ...patch } }, imagePresetId: null })),
      setVideo: (patch) => set((s) => ({ video: normaliseVideo(s.video, { ...s.video, ...patch }), videoPresetId: null })),
      setOutput: (patch) => set((s) => ({ output: { ...s.output, ...patch } })),

      applyImagePreset: (preset) =>
        set({ image: { ...preset.config, resize: { ...preset.config.resize } }, imagePresetId: preset.id, tab: 'image' }),
      applyVideoPreset: (preset) =>
        set((s) => ({
          // Keep the GPU choice: presets describe the result, not the hardware.
          video: normaliseVideo(s.video, { ...preset.config, encoderMode: s.video.encoderMode }),
          videoPresetId: preset.id,
          tab: 'video',
        })),

      saveImagePreset: (name) => {
        const preset: Preset<ImageJobConfig> = { id: newId('img'), name, description: 'Saved preset', config: get().image }
        set((s) => ({ customImagePresets: [...s.customImagePresets, preset], imagePresetId: preset.id }))
      },
      saveVideoPreset: (name) => {
        const preset: Preset<VideoJobConfig> = { id: newId('vid'), name, description: 'Saved preset', config: get().video }
        set((s) => ({ customVideoPresets: [...s.customVideoPresets, preset], videoPresetId: preset.id }))
      },
      deletePreset: (id) =>
        set((s) => ({
          customImagePresets: s.customImagePresets.filter((p) => p.id !== id),
          customVideoPresets: s.customVideoPresets.filter((p) => p.id !== id),
          imagePresetId: s.imagePresetId === id ? null : s.imagePresetId,
          videoPresetId: s.videoPresetId === id ? null : s.videoPresetId,
        })),
      setTab: (tab) => set({ tab }),
      resetImage: () => set({ image: DEFAULT_IMAGE_CONFIG, imagePresetId: IMAGE_PRESETS[0].id }),
      resetVideo: () => set((s) => ({ video: { ...DEFAULT_VIDEO_CONFIG, encoderMode: s.video.encoderMode }, videoPresetId: VIDEO_PRESETS[0].id })),
      resetOutput: () => set({ output: DEFAULT_OUTPUT }),
    }),
    {
      name: 'squashforge-settings',
      version: 1,
      // Merge saved settings over defaults so new fields get sensible values.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...p,
          image: { ...current.image, ...p.image, resize: { ...current.image.resize, ...p.image?.resize } },
          video: { ...current.video, ...p.video },
          output: { ...current.output, ...p.output },
        }
      },
    },
  ),
)

export const allImagePresets = (custom: Preset<ImageJobConfig>[]): Preset<ImageJobConfig>[] => [...IMAGE_PRESETS, ...custom]
export const allVideoPresets = (custom: Preset<VideoJobConfig>[]): Preset<VideoJobConfig>[] => [...VIDEO_PRESETS, ...custom]
