import { create } from 'zustand'
import type { AppInfo, HardwareProfile, QueueStats, SystemLoad, WhenDone } from '@shared/types'

interface SystemState {
  app: AppInfo | null
  hardware: HardwareProfile | null
  load: SystemLoad | null
  stats: QueueStats | null
  /** The last run, once it has finished. Cleared when dismissed or a new run starts. */
  finished: QueueStats | null
  /** What to do when the queue finishes. Resets each session on purpose. */
  whenDone: WhenDone
  setApp: (a: AppInfo) => void
  setHardware: (h: HardwareProfile) => void
  setLoad: (l: SystemLoad) => void
  setStats: (s: QueueStats) => void
  setWhenDone: (w: WhenDone) => void
  dismissFinished: () => void
}

export const useSystem = create<SystemState>()((set, get) => ({
  app: null,
  hardware: null,
  load: null,
  stats: null,
  finished: null,
  whenDone: 'nothing',
  setApp: (app) => set({ app }),
  setHardware: (hardware) => set({ hardware }),
  setLoad: (load) => set({ load }),
  setStats: (stats) => {
    const prev = get().stats
    if (stats.active) set({ stats, finished: null })
    else if (prev?.active && stats.total > 0) set({ stats, finished: stats })
    else set({ stats })
  },
  setWhenDone: (whenDone) => set({ whenDone }),
  dismissFinished: () => set({ finished: null }),
}))
