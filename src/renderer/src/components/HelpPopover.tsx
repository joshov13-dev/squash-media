import * as Popover from '@radix-ui/react-popover'
import { CircleHelp } from 'lucide-react'
import { exampleName } from '@shared/naming'
import type { OutputSettings } from '@shared/types'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'

export function whereFilesGo(output: OutputSettings): string {
  if (output.mode === 'folder' && output.folder) {
    const renamed = output.renameInFolder ? ` holiday.jpg becomes ${exampleName(output.nameTemplate)}.` : ''
    return `New files are saved in ${output.folder}.${renamed}`
  }
  if (output.mode === 'overwrite') return `New files replace the originals. The originals go to the ${binName()}.`
  return `New files are saved next to the originals. holiday.jpg becomes ${exampleName(output.nameTemplate)}.`
}

/** What the recycle bin is called on this system. */
export function binName(): string {
  return window.api.platform === 'win32' ? 'Recycle Bin' : 'Trash'
}

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + O', 'Add files'],
  ['Ctrl + Enter', 'Start compressing'],
  ['Up / Down', 'Move through the queue'],
  ['Delete', 'Remove the selected file'],
  ['Mouse wheel', 'Zoom the comparison'],
  ['Double-click', 'Zoom to 100% and back'],
]

export function HelpPopover() {
  const output = useSettings((s) => s.output)
  const app = useSystem((s) => s.app)
  const ffmpeg = useSystem((s) => s.hardware?.ffmpegVersion)

  const steps = [
    'Drag photos or videos onto this window, or use Add files. Whole folders work too.',
    'Pick what you want in the Quick tab on the right, or leave it on "Smaller, same look". It suits most files.',
    'Click a file to see the original and the compressed version side by side. Drag the line in the middle to compare.',
    'Press Compress. ' + whereFilesGo(output),
  ]

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="no-drag flex h-8 items-center gap-1.5 rounded-md px-2.5 text-ink-2 transition-colors hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink"
        >
          <CircleHelp size={15} strokeWidth={1.75} />
          Help
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[400px] rounded-xl bg-raised p-5 text-[12px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
        >
          <h3 className="font-display text-[14px] font-semibold text-ink">How to use SquashForge</h3>
          <ol className="mt-3 space-y-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3 leading-relaxed text-ink-2">
                <span className="num w-3 shrink-0 font-semibold text-ember">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 leading-relaxed text-ink-3">
            Change where files go in the Output tab. To give one file different settings, select it and choose “This photo only” or “This
            video only” at the top of the settings.
          </p>

          <h4 className="mt-5 font-display text-[13px] font-semibold text-ink">Keyboard</h4>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="contents">
                <dt className="num text-ink">{keys}</dt>
                <dd className="text-ink-2">{what}</dd>
              </div>
            ))}
          </dl>

          <p className="num mt-5 text-ink-3">
            SquashForge {app?.version ?? ''}
            {ffmpeg ? ` · FFmpeg ${ffmpeg}` : ''}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
