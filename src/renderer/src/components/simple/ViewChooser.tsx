import * as Dialog from '@radix-ui/react-dialog'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { useSettings, type ViewMode } from '@renderer/store/settingsStore'
import { Button } from '../ui/controls'

const VIEWS: Array<{ id: ViewMode; name: string; summary: string; points: string[] }> = [
  {
    id: 'simple',
    name: 'Simple',
    summary: 'For getting files smaller without thinking about it.',
    points: ['Pick what the files are for, like email or sharing online', 'Pick where the new files go', 'Press Compress'],
  },
  {
    id: 'normal',
    name: 'Normal',
    summary: 'For choosing exactly how each file comes out.',
    points: ['Compare before and after, side by side', 'Every photo and video setting, and presets', 'Trim videos, rename files, per-file settings'],
  },
]

/** Asked once, on first launch: Simple or Normal view. */
export function ViewChooser() {
  const view = useSettings((s) => s.view)
  const setView = useSettings((s) => s.setView)
  const [picked, setPicked] = useState<ViewMode>('simple')

  return (
    <Dialog.Root open={view === null}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/85" />
        <Dialog.Content
          // Needs an answer, so clicking outside or pressing Escape does nothing.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 w-[620px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-raised p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] outline-none"
        >
          <Dialog.Title className="font-display text-[20px] font-semibold text-ink">Welcome to SquashForge</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            It makes photos and videos smaller, right here on your computer. Nothing is uploaded. How much do you want to see?
          </Dialog.Description>

          <div role="radiogroup" aria-label="View" className="mt-6 grid grid-cols-2 gap-3">
            {VIEWS.map((v) => {
              const active = picked === v.id
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPicked(v.id)}
                  onDoubleClick={() => setView(v.id)}
                  className={cn(
                    'flex flex-col rounded-xl p-4 text-left transition-colors',
                    active ? 'bg-press ring-2 ring-ember-2' : 'bg-hover hover:bg-press',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-[16px] font-semibold text-ink">{v.name}</span>
                    <Check size={16} strokeWidth={2.5} className={cn('text-ember', !active && 'invisible')} />
                  </span>
                  <span className="mt-1 text-[12px] leading-snug text-ink-2">{v.summary}</span>
                  <ul className="mt-3 space-y-1.5 text-[12px] leading-snug text-ink-3">
                    {v.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </button>
              )
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <p className="text-[12px] leading-snug text-ink-3">You can switch at any time. The link is under the settings on the right.</p>
            <Button variant="primary" onClick={() => setView(picked)} className="h-9 shrink-0 px-5">
              Use {picked === 'simple' ? 'Simple' : 'Normal'} view
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
