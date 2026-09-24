import os from 'node:os'
import { DEFAULT_PREFERENCES } from '@shared/presets'
import type { AppPreferences } from '@shared/types'

let current: AppPreferences = { ...DEFAULT_PREFERENCES }

export function getPreferences(): AppPreferences {
  return current
}

/** The UI owns the saved copy and sends it here on start and on every change. */
export function setPreferences(next: Partial<AppPreferences>): void {
  const merged = { ...current, ...next }
  merged.videosAtOnce = Math.max(1, Math.min(4, Math.round(merged.videosAtOnce) || 1))
  merged.photosAtOnce = Math.max(0, Math.min(16, Math.round(merged.photosAtOnce) || 0))
  const priorityChanged = merged.lowPriority !== current.lowPriority
  current = merged
  if (priorityChanged) applyOwnPriority()
}

/** Photos are compressed inside this process, so its own priority matters too. */
function applyOwnPriority(): void {
  const { PRIORITY_BELOW_NORMAL, PRIORITY_NORMAL } = os.constants.priority
  try {
    os.setPriority(0, current.lowPriority ? PRIORITY_BELOW_NORMAL : PRIORITY_NORMAL)
  } catch {
    // Raising priority back can need extra rights on some systems.
  }
}
