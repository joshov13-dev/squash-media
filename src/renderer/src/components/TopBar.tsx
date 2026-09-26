import { FolderPlus, Play, Plus, RotateCw, Square } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useQueue, useRunState } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { HelpPopover } from './HelpPopover'
import { HistoryDialog } from './HistoryDialog'
import { Logo } from './Logo'
import { SettingsDialog } from './settings-window/SettingsDialog'
import { Button, Tip } from './ui/controls'

export function TopBar() {
  const start = useQueue((s) => s.start)
  const stopAll = useQueue((s) => s.stopAll)
  const addPaths = useQueue((s) => s.addPaths)
  const update = useSystem((s) => s.update)
  const { running, runnable } = useRunState()
  const isMac = api.platform === 'darwin'
  // Simple view has its own big Compress button beside the choices.
  const simple = useSettings((s) => s.view === 'simple')

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
        <span className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">SquashMedia</span>
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
      {update?.state === 'ready' && !running && (
        <Tip label={`Version ${update.version} has downloaded. Restart SquashMedia to start using it.`}>
          <span className="no-drag">
            <Button variant="plain" onClick={() => void api.installUpdate()} className="text-ember hover:text-ember">
              <RotateCw size={14} /> Restart to update
            </Button>
          </span>
        </Tip>
      )}
      <HistoryDialog />
      <SettingsDialog />
      <HelpPopover />
      {simple ? null : running ? (
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
