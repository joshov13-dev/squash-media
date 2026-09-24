import { FolderPlus, Play, Plus, Square } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { ACTIVE, useQueue } from '@renderer/store/queueStore'
import { useSystem } from '@renderer/store/systemStore'
import { HelpPopover } from './HelpPopover'
import { Logo } from './Logo'
import { SettingsDialog } from './SettingsDialog'
import { Button, Tip } from './ui/controls'

export function TopBar() {
  const jobs = useQueue((s) => s.jobs)
  const start = useQueue((s) => s.start)
  const stopAll = useQueue((s) => s.stopAll)
  const addPaths = useQueue((s) => s.addPaths)
  const active = useSystem((s) => s.stats?.active ?? false)
  const running = active || jobs.some((j) => ACTIVE.includes(j.status))
  const runnable = jobs.filter((j) => j.status === 'pending' || j.status === 'failed' || j.status === 'cancelled').length
  const isMac = api.platform === 'darwin'

  const addFiles = async (): Promise<void> => {
    const paths = await api.pickFiles()
    await addPaths(paths)
  }
  const addFolder = async (): Promise<void> => {
    const folder = await api.pickFolder()
    if (folder) await addPaths([folder])
  }

  return (
    <header className={cn('drag flex h-11 shrink-0 items-center gap-2 bg-ground', isMac ? 'pr-3 pl-20' : 'pr-[148px] pl-3')}>
      <div className="flex items-center gap-2 pr-3">
        <Logo />
        <span className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">SquashForge</span>
      </div>
      <Button onClick={addFiles}>
        <Plus size={15} strokeWidth={2} />
        Add files
      </Button>
      <Button variant="plain" onClick={addFolder}>
        <FolderPlus size={15} strokeWidth={1.75} />
        Add folder
      </Button>
      <div className="flex-1" />
      <SettingsDialog />
      <HelpPopover />
      {running ? (
        <Button variant="danger" onClick={stopAll}>
          <Square size={12} strokeWidth={2.5} />
          Stop all
        </Button>
      ) : (
        <Tip label={runnable ? undefined : 'Add files, or requeue finished ones, to start'}>
          <span className="no-drag">
            <Button variant="primary" onClick={() => void start()} disabled={!runnable} className="px-4">
              <Play size={13} strokeWidth={2.5} className="fill-current" />
              {runnable ? `Compress ${runnable} ${runnable === 1 ? 'file' : 'files'}` : 'Compress'}
            </Button>
          </span>
        </Tip>
      )}
    </header>
  )
}
