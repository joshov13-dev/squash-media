import { create } from 'zustand'
import type { HardwareProfile, QueueStats, SystemLoad } from '@shared/types'

interface SystemState {
  hardware: HardwareProfile | null
  load: SystemLoad | null
  stats: QueueStats | null
  setHardware: (h: HardwareProfile) => void
  setLoad: (l: SystemLoad) => void
  setStats: (s: QueueStats) => void
}

export const useSystem = create<SystemState>()((set) => ({
  hardware: null,
  load: null,
  stats: null,
  setHardware: (hardware) => set({ hardware }),
  setLoad: (load) => set({ load }),
  setStats: (stats) => set({ stats }),
}))
