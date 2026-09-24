import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname } from 'node:path'
import { DEFAULT_PREFERENCES } from '@shared/presets'
import type { AppPreferences } from '@shared/types'

let current: AppPreferences = { ...DEFAULT_PREFERENCES }
let file: string | null = null
let listeners: Array<(prefs: AppPreferences) => void> = []

export function getPreferences(): AppPreferences {
  return current
}

function clamp(p: AppPreferences): AppPreferences {
  return {
    ...p,
    videosAtOnce: Math.max(1, Math.min(4, Math.round(p.videosAtOnce) || 1)),
    photosAtOnce: Math.max(0, Math.min(16, Math.round(p.photosAtOnce) || 0)),
    watchFolders: Array.isArray(p.watchFolders) ? p.watchFolders : [],
  }
}

/** Read a saved copy, falling back to the defaults for anything missing. */
export function readPreferencesFile(path: string): AppPreferences {
  try {
    return clamp({ ...DEFAULT_PREFERENCES, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<AppPreferences>) })
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

/**
 * Keep a copy in the settings folder so the command line and AI server use
 * the same choices (low priority, videos at once, and so on) as the app.
 */
export function usePreferencesFile(path: string): void {
  file = path
  current = readPreferencesFile(path)
}

/** Called with the new preferences after every change. */
export function onPreferencesChanged(cb: (prefs: AppPreferences) => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

/** The UI owns the saved copy and sends it here on start and on every change. */
export function setPreferences(next: Partial<AppPreferences>): void {
  const merged = clamp({ ...current, ...next })
  const priorityChanged = merged.lowPriority !== current.lowPriority
  current = merged
  if (priorityChanged) applyOwnPriority()
  for (const l of listeners) l(current)
  if (file) void save(file, current)
}

async function save(path: string, prefs: AppPreferences): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(prefs, null, 2))
    await rename(temp, path)
  } catch {
    // Only the command line reads this copy; the app keeps its own.
  }
}

/** Photos are compressed inside this process, so its own priority matters too. */
export function applyOwnPriority(): void {
  const { PRIORITY_BELOW_NORMAL, PRIORITY_NORMAL } = os.constants.priority
  try {
    os.setPriority(0, current.lowPriority ? PRIORITY_BELOW_NORMAL : PRIORITY_NORMAL)
  } catch {
    // Raising priority back can need extra rights on some systems.
  }
}
