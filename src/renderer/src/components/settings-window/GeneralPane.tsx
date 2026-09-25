import { ENCODER_LABELS } from '@shared/codecs'
import { exampleName } from '@shared/naming'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Field, Segmented, Toggle } from '../ui/controls'
import { Group } from './Group'

export function GeneralPane() {
  const prefs = useSettings((s) => s.preferences)
  const set = useSettings((s) => s.setPreferences)
  const nameTemplate = useSettings((s) => s.output.nameTemplate)
  const hw = useSystem((s) => s.hardware)

  const gpuEncoders = hw?.availableGpuEncoders ?? []
  const hasGpu = gpuEncoders.length > 0
  const gpuNames = hw?.gpus.map((g) => g.model).join(', ')

  return (
    <div className="space-y-7">
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
  )
}
