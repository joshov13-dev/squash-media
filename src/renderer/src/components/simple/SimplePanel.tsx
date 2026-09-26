import { Check, FolderOpen, Play, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { exampleName } from '@shared/naming'
import { goalDescription, GOALS } from '@shared/presets'
import type { OutputMode } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useQueue, useQueueKinds, useRunState } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { binName } from '../HelpPopover'
import { Button } from '../ui/controls'

const SIMPLE_GOALS = GOALS.filter((g) => g.simple)

/** One choice in a list: a tick, a name and a line saying what it does. */
function Choice({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors', active ? 'bg-hover' : 'hover:bg-raised')}
    >
      <Check size={15} strokeWidth={2.25} className={cn('mt-0.5 shrink-0 text-ember', !active && 'invisible')} />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{children}</span>
      </span>
    </button>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 px-4 py-4">
      <h3 className="font-display text-[14px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

/** Simple view's settings: what the files are for, where they go, and a big Compress button. */
export function SimplePanel() {
  const goalId = useSettings((s) => s.goalId)
  const applyGoal = useSettings((s) => s.applyGoal)
  const output = useSettings((s) => s.output)
  const setOutput = useSettings((s) => s.setOutput)
  const setView = useSettings((s) => s.setView)
  const kinds = useQueueKinds()
  const start = useQueue((s) => s.start)
  const stopAll = useQueue((s) => s.stopAll)
  const { running, runnable } = useRunState()
  const known = SIMPLE_GOALS.some((g) => g.id === goalId)
  const where: OutputMode = output.mode === 'folder' && output.folder ? 'folder' : output.mode === 'overwrite' ? 'overwrite' : 'suffix'
  const noun = kinds.photos && !kinds.videos ? 'photos' : kinds.videos && !kinds.photos ? 'videos' : 'files'

  const chooseFolder = async (): Promise<void> => {
    const folder = await api.chooseOutputFolder()
    if (folder) setOutput({ folder, mode: 'folder' })
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col bg-panel xl:w-[400px]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Step title={`What are the ${noun} for?`}>
          <div role="radiogroup" aria-label="What the files are for" className="-mx-2 space-y-0.5">
            {SIMPLE_GOALS.map((goal) => (
              <Choice key={goal.id} active={goal.id === goalId} onClick={() => applyGoal(goal)} title={goal.name}>
                {goalDescription(goal, kinds)}
              </Choice>
            ))}
          </div>
          {!known && (
            <p className="text-[12px] leading-snug text-ember">
              Using settings you made in Normal view. Pick one of the choices above to use it instead.
            </p>
          )}
        </Step>

        <Step title="Where should the new files go?">
          <div role="radiogroup" aria-label="Where the new files go" className="-mx-2 space-y-0.5">
            <Choice active={where === 'suffix'} onClick={() => setOutput({ mode: 'suffix' })} title="Next to the originals">
              A new copy goes in the same folder, named like {exampleName(output.nameTemplate)}. The originals are not touched.
            </Choice>
            <Choice
              active={where === 'folder'}
              onClick={() => (output.folder ? setOutput({ mode: 'folder' }) : void chooseFolder())}
              title="In a folder I choose"
            >
              All the new copies go into one folder. The originals are not touched.
            </Choice>
            <Choice active={where === 'overwrite'} onClick={() => setOutput({ mode: 'overwrite' })} title="Replace the originals">
              Frees up space straight away. The originals go to the {binName()}, so you can still get them back.
            </Choice>
          </div>
          {where === 'folder' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="min-w-0 flex-1 truncate rounded-md bg-ground px-2.5 py-1.5 text-[12px] text-ink-2" title={output.folder ?? ''}>
                {output.folder}
              </span>
              <Button size="sm" onClick={() => void chooseFolder()}>
                <FolderOpen size={13} /> Change
              </Button>
            </div>
          )}
        </Step>
      </div>

      <div className="shrink-0 space-y-2.5 px-4 pt-3 pb-4">
        {running ? (
          <Button variant="danger" onClick={stopAll} className="h-10 w-full text-[14px]">
            <Square size={12} strokeWidth={2.5} /> Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void start()} disabled={!runnable} className="h-10 w-full text-[14px]">
            <Play size={13} strokeWidth={2.5} className="fill-current" />
            {runnable ? `Compress ${runnable} ${runnable === 1 ? 'file' : 'files'}` : 'Add files to start'}
          </Button>
        )}
        <p className="text-center text-[12px] text-ink-3">
          Need more settings?{' '}
          <button type="button" onClick={() => setView('normal')} className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink">
            Switch to Normal view
          </button>
        </p>
      </div>
    </aside>
  )
}
