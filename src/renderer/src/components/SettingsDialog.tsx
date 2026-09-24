import * as Dialog from '@radix-ui/react-dialog'
import { Settings, X } from 'lucide-react'
import { useState } from 'react'
import { ENCODER_LABELS } from '@shared/codecs'
import { exampleName } from '@shared/naming'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Button, Field, Segmented, Toggle } from './ui/controls'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsDialog() {
  const prefs = useSettings((s) => s.preferences)
  const set = useSettings((s) => s.setPreferences)
  const resetAll = useSettings((s) => s.resetAll)
  const nameTemplate = useSettings((s) => s.output.nameTemplate)
  const hw = useSystem((s) => s.hardware)
  const [confirmReset, setConfirmReset] = useState(false)

  const gpuEncoders = hw?.availableGpuEncoders ?? []
  const hasGpu = gpuEncoders.length > 0
  const gpuNames = hw?.gpus.map((g) => g.model).join(', ')

  return (
    <Dialog.Root onOpenChange={() => setConfirmReset(false)}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="no-drag flex h-8 items-center gap-1.5 rounded-md px-2.5 text-ink-2 transition-colors hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink"
        >
          <Settings size={15} strokeWidth={1.75} />
          Settings
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/75" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[540px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-raised shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] outline-none">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <Dialog.Title className="font-display text-[16px] font-semibold text-ink">Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">How SquashForge runs on this PC.</Dialog.Description>

          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 pb-6 text-[13px]">
            <Group title="Speed">
              <p className="rounded-lg bg-hover px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
                {hasGpu
                  ? `Graphics card: ${gpuNames}. It can encode video with ${gpuEncoders.map((m) => ENCODER_LABELS[m]).join(' and ')}. Choose Auto as the encoder on the Videos tab (it is the default) to use it.`
                  : hw
                    ? 'No graphics card that can encode video was found, so videos use the processor.'
                    : 'Checking this PC for a graphics card...'}
              </p>
              <Field
                label="Videos at once"
                hint={
                  hasGpu
                    ? 'With the graphics card, 2 or 3 at once gets a big batch done sooner. On the CPU, 1 is fastest.'
                    : 'One video already uses the whole processor, so 1 is fastest on this PC.'
                }
              >
                <Segmented
                  value={String(prefs.videosAtOnce)}
                  onChange={(v) => set({ videosAtOnce: Number(v) })}
                  options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v }))}
                />
              </Field>
              <Field label="Photos at once" hint={`Auto picks ${hw?.imageConcurrency ?? 2} for this PC.`}>
                <Segmented
                  value={String(prefs.photosAtOnce)}
                  onChange={(v) => set({ photosAtOnce: Number(v) })}
                  options={[
                    { value: '0', label: 'Auto' },
                    ...['1', '2', '4', '8'].map((v) => ({ value: v, label: v })),
                  ]}
                />
              </Field>
              <Toggle
                label="Read videos on the graphics card too"
                hint="When the graphics card is encoding, it also decodes the original, taking load off the processor. Turned off automatically for files it cannot read."
                checked={prefs.gpuDecoding}
                disabled={!hasGpu}
                onChange={(gpuDecoding) => set({ gpuDecoding })}
              />
              <Toggle
                label="Keep the PC responsive"
                hint="Compresses at a lower priority so games, calls and other programs stay smooth. Takes a little longer."
                checked={prefs.lowPriority}
                onChange={(lowPriority) => set({ lowPriority })}
              />
            </Group>

            <Group title="Big batches">
              <Toggle
                label="Leave out earlier copies"
                hint={`When you add a folder, files named like ${exampleName(nameTemplate)} are left out, so they are not compressed twice.`}
                checked={prefs.skipCompressedNames}
                onChange={(skipCompressedNames) => set({ skipCompressedNames })}
              />
              <Toggle
                label="Skip files that are already done"
                hint="If a file's compressed copy already exists, leave it alone. Handy for carrying on with a big batch another day."
                checked={prefs.skipExisting}
                onChange={(skipExisting) => set({ skipExisting })}
              />
            </Group>

            <Group title="While it works">
              <Toggle
                label="Stop the PC going to sleep"
                hint="Only while files are being compressed."
                checked={prefs.keepAwake}
                onChange={(keepAwake) => set({ keepAwake })}
              />
              <Toggle
                label="Show a notification when it finishes"
                hint="Only when SquashForge is not the window you are using."
                checked={prefs.notifyWhenDone}
                onChange={(notifyWhenDone) => set({ notifyWhenDone })}
              />
              <Toggle
                label="Ask before quitting mid-way"
                hint="Closing the window stops the files being worked on."
                checked={prefs.confirmQuit}
                onChange={(confirmQuit) => set({ confirmQuit })}
              />
            </Group>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-b-2xl bg-panel px-6 py-3.5">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true)
                resetAll()
                setConfirmReset(false)
              }}
            >
              {confirmReset ? 'Click again to reset everything' : 'Reset all settings'}
            </Button>
            <Dialog.Close asChild>
              <Button variant="primary">Done</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
