import { FolderOpen, RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { cleanTemplate, DEFAULT_NAME_TEMPLATE, exampleName, NAME_TOKENS, templateChangesName } from '@shared/naming'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/store/settingsStore'
import { binName } from '../HelpPopover'
import { Button, Field, IconButton, Section, Segmented, Tip, Toggle } from '../ui/controls'

export function OutputSettings() {
  const output = useSettings((s) => s.output)
  const setOutput = useSettings((s) => s.setOutput)
  const resetOutput = useSettings((s) => s.resetOutput)

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
        {output.mode === 'suffix' && <NameTemplate />}
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
              label="Rename the files too"
              hint="Off keeps the original names. On uses the name pattern below."
              checked={output.renameInFolder}
              onChange={(renameInFolder) => setOutput({ renameInFolder })}
            />
            {output.renameInFolder && <NameTemplate />}
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
            The compressed file takes the original’s place. Originals are moved to the {binName()}, and History can put them back.
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

/** Pattern for the new file names, with buttons that insert each token. */
function NameTemplate() {
  const template = useSettings((s) => s.output.nameTemplate)
  const setOutput = useSettings((s) => s.setOutput)
  const input = useRef<HTMLInputElement>(null)
  const sameAsOriginal = !templateChangesName(template)

  const insert = (token: string): void => {
    const el = input.current
    const start = el?.selectionStart ?? template.length
    const end = el?.selectionEnd ?? template.length
    setOutput({ nameTemplate: template.slice(0, start) + token + template.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <Field
      label="File name"
      hint={
        sameAsOriginal ? (
          <span className="text-ember">Names stay the same, so "_compressed" is added to avoid replacing the original.</span>
        ) : (
          <span className="num">holiday.jpg becomes {exampleName(template)}</span>
        )
      }
    >
      <input
        ref={input}
        value={template}
        onChange={(e) => setOutput({ nameTemplate: cleanTemplate(e.target.value) })}
        onBlur={() => !template.trim() && setOutput({ nameTemplate: DEFAULT_NAME_TEMPLATE })}
        className="num h-8 w-full rounded-md bg-ground px-2.5 outline-none focus:bg-hover"
        spellCheck={false}
        aria-label="File name pattern"
      />
      <div className="flex flex-wrap gap-1">
        {NAME_TOKENS.map((t) => (
          <Tip key={t.token} label={t.label}>
            <button
              type="button"
              onClick={() => insert(t.token)}
              className="num h-6 rounded px-1.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              {t.token}
            </button>
          </Tip>
        ))}
      </div>
    </Field>
  )
}
