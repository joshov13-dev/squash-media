import { FolderOpen, X } from 'lucide-react'
import { formatBytes, formatEta, savingsPercent } from '@shared/format'
import { api } from '@renderer/lib/api'
import { useQueue } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Button } from '../ui/controls'

/** Shown under the queue when a run ends: what happened and where the files went. */
export function FinishBanner() {
  const finished = useSystem((s) => s.finished)
  const dismiss = useSystem((s) => s.dismissFinished)
  const output = useSettings((s) => s.output)
  const firstOutput = useQueue((s) => s.jobs.find((j) => j.outputPath)?.outputPath)
  if (!finished) return null

  const saved = Math.max(0, finished.originalBytes - finished.outputBytes)
  const pct = savingsPercent(finished.originalBytes, finished.outputBytes)
  const open = (): void => {
    if (output.mode === 'folder' && output.folder) void api.openPath(output.folder)
    else if (firstOutput) void api.revealInFolder(firstOutput)
  }

  return (
    <div className="mx-3 mb-3 rounded-lg bg-raised p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[13px] font-semibold text-ink">
            {finished.failed ? `Done, but ${finished.failed} ${finished.failed === 1 ? 'file' : 'files'} failed` : 'All done'}
          </p>
          <p className="num mt-0.5 text-[12px] leading-snug text-ink-2">
            {finished.completed} of {finished.total} {finished.total === 1 ? 'file' : 'files'} in {formatEta(finished.elapsedSeconds) || '0s'}.
            {saved > 0 && (
              <>
                {' '}
                Saved <span className="text-sage">{formatBytes(saved)}</span> ({pct}%).
              </>
            )}
          </p>
          {finished.failed > 0 && <p className="mt-1 text-[12px] text-ink-3">Files marked in red say what went wrong.</p>}
        </div>
        <button type="button" aria-label="Close" onClick={dismiss} className="-mt-0.5 -mr-0.5 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
          <X size={14} />
        </button>
      </div>
      {(firstOutput || (output.mode === 'folder' && output.folder)) && (
        <Button size="sm" variant="raised" className="mt-2.5" onClick={open}>
          <FolderOpen size={13} /> Open the folder
        </Button>
      )}
    </div>
  )
}
