import { FolderOpen } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/store/settingsStore'
import { Button, Field, IconButton, Section, Segmented, Toggle } from '../ui/controls'
import { RotateCcw } from 'lucide-react'

export function OutputSettings() {
  const output = useSettings((s) => s.output)
  const setOutput = useSettings((s) => s.setOutput)
  const resetOutput = useSettings((s) => s.resetOutput)
  const suffix = output.suffix.trim() || '_compressed'

  const chooseFolder = async (): Promise<void> => {
    const folder = await api.chooseOutputFolder()
    if (folder) setOutput({ folder, mode: 'folder' })
  }

  return (
    <div className="pt-1">
      <Section
        title="Save to"
        aside={
          <IconButton label="Back to the default settings" onClick={resetOutput}>
            <RotateCcw size={14} />
          </IconButton>
        }
      >
        <Segmented
          value={output.mode}
          onChange={(mode) => {
            setOutput({ mode })
            if (mode === 'folder' && !output.folder) void chooseFolder()
          }}
          options={[
            { value: 'suffix', label: 'Same folder' },
            { value: 'folder', label: 'Other folder' },
            { value: 'overwrite', label: 'Replace' },
          ]}
        />
        {output.mode === 'suffix' && (
          <Field label="Name ending" hint={<span className="num">holiday.jpg becomes holiday{suffix}.jpg</span>}>
            <input
              value={output.suffix}
              onChange={(e) => setOutput({ suffix: e.target.value.replace(/[\\/:*?"<>|]/g, '') })}
              className="h-8 w-full rounded-md bg-ground px-2.5 outline-none focus:bg-hover"
              spellCheck={false}
              aria-label="File name suffix"
            />
          </Field>
        )}
        {output.mode === 'folder' && (
          <>
            <Field label="Destination" hint="Files keep their names. If two files would end up with the same name, the second gets (2) added.">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md bg-ground px-2.5 py-1.5 text-ink-2" title={output.folder ?? ''}>
                  {output.folder ?? 'No folder chosen'}
                </span>
                <Button size="sm" onClick={() => void chooseFolder()}>
                  <FolderOpen size={13} /> Choose
                </Button>
              </div>
            </Field>
            <Toggle
              label="Keep subfolders"
              hint="When you add a whole folder, its subfolders are recreated inside the destination."
              checked={output.keepFolderStructure}
              onChange={(keepFolderStructure) => setOutput({ keepFolderStructure })}
            />
          </>
        )}
        {output.mode === 'overwrite' && (
          <p className="text-[12px] leading-relaxed text-ink-3">
            The compressed file takes the original’s place. Originals are moved to the Recycle Bin, so you can still get them back.
          </p>
        )}
      </Section>

      <Section title="Rules">
        <Toggle
          label="Keep the original if the result is bigger"
          hint="Already well-compressed files are left as they are."
          checked={output.keepOriginalIfLarger}
          onChange={(keepOriginalIfLarger) => setOutput({ keepOriginalIfLarger })}
        />
        <Toggle
          label="Keep the modified date"
          hint="Copies the original’s date so photo libraries stay in order."
          checked={output.preserveTimestamps}
          onChange={(preserveTimestamps) => setOutput({ preserveTimestamps })}
        />
      </Section>
    </div>
  )
}
