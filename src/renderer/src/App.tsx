import * as Tooltip from '@radix-ui/react-tooltip'
import { useEffect, useRef, useState } from 'react'
import { api } from './lib/api'
import { PowerCountdown } from './components/PowerCountdown'
import { TopBar } from './components/TopBar'
import { StatusBar } from './components/hardware/StatusBar'
import { PreviewPanel } from './components/preview/PreviewPanel'
import { QueuePanel } from './components/queue/QueuePanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { useQueue } from './store/queueStore'
import { useSystem } from './store/systemStore'

function useBridge(): void {
  useEffect(() => {
    const system = useSystem.getState()
    void api.getHardwareProfile().then(system.setHardware)
    void api.getAppInfo().then(system.setApp)
    const offs = [
      api.onJobUpdate((u) => useQueue.getState().applyUpdate(u)),
      api.onQueueStats((s) => useSystem.getState().setStats(s)),
      api.onSystemLoad((l) => useSystem.getState().setLoad(l)),
      api.onOpenPaths((paths) => void useQueue.getState().addPaths(paths)),
    ]
    // Subscribe first, then collect anything opened before the window was ready.
    void api.takeOpenPaths().then((paths) => useQueue.getState().addPaths(paths))
    return () => offs.forEach((off) => off())
  }, [])
}

/** Whole-window drop target for files and folders. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const overFn = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map((f) => api.getPathForFile(f))
        .filter(Boolean)
      if (paths.length) void useQueue.getState().addPaths(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [role="slider"], [role="combobox"]')) return
      const q = useQueue.getState()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        q.selectNext(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        q.selectNext(-1)
      } else if (e.key === 'Delete' && q.selectedId) {
        q.remove(q.selectedId)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void api.pickFiles().then((p) => q.addPaths(p))
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void q.start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  useBridge()
  useShortcuts()
  const dropping = useFileDrop()

  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1 gap-px bg-ground">
          <QueuePanel />
          <PreviewPanel />
          <SettingsPanel />
        </div>
        <StatusBar />
      </div>
      <PowerCountdown />
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ground/80">
          <div className="rounded-2xl bg-raised px-10 py-8 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
            <p className="font-display text-[17px] font-semibold text-ink">Drop to add to the queue</p>
            <p className="mt-1 text-[12px] text-ink-3">Photos, videos and whole folders</p>
          </div>
        </div>
      )}
    </Tooltip.Provider>
  )
}
