import { Check, Copy, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ENCODER_LABELS } from '@shared/codecs'
import { exampleName } from '@shared/naming'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Button, Field, Segmented, Toggle } from '../ui/controls'
import { Group } from './Group'

function CopyLogButton() {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const text = await api.getLogText()
    await api.copyText(text || 'The log is empty so far.')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button size="sm" variant="raised" onClick={() => void copy()}>
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy the log'}
    </Button>
  )
}

export function GeneralPane() {
  const prefs = useSettings((s) => s.preferences)
  const set = useSettings((s) => s.setPreferences)
  const nameTemplate = useSettings((s) => s.output.nameTemplate)
  const view = useSettings((s) => s.view)
  const setView = useSettings((s) => s.setView)
  const hw = useSystem((s) => s.hardware)
  const [logPath, setLogPath] = useState<string | null>(null)

  useEffect(() => {
    void api.getLogPath().then(setLogPath)
  }, [])

  const gpuEncoders = hw?.availableGpuEncoders ?? []
  const hasGpu = gpuEncoders.length > 0
  const gpuNames = hw?.gpus.map((g) => g.model).join(', ')

  return (
    <div className="space-y-7">
      <Group title="Layout">
        <Field
          label="View"
          hint={
            view === 'simple'
              ? 'Simple shows a few plain choices: what the files are for, and where they go.'
              : 'Normal shows the before and after comparison and every photo and video setting.'
          }
        >
          <Segmented
            value={view ?? 'normal'}
            onChange={setView}
            options={[
              { value: 'simple', label: 'Simple' },
              { value: 'normal', label: 'Normal' },
            ]}
          />
        </Field>
      </Group>

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

      <Group title="Diagnostics">
        <p className="text-[12px] leading-relaxed text-ink-3">
          SquashForge keeps a log of what it does: files compressed, problems, and settings changes. Run something, then copy the log here to
          share it. It includes file names and paths, but never the files themselves.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="raised" onClick={() => void api.openLogsFolder()}>
            <FolderOpen size={13} /> Open the log file
          </Button>
          <CopyLogButton />
        </div>
        {logPath && (
          <p className="num truncate text-[12px] text-ink-3" title={logPath}>
            {logPath}
          </p>
        )}
        <Toggle
          label="Detailed logging"
          hint="Adds extra detail, useful when tracking down a specific problem. Makes the log file bigger."
          checked={prefs.verboseLogging}
          onChange={(verboseLogging) => set({ verboseLogging })}
        />
      </Group>
    </div>
  )
}
