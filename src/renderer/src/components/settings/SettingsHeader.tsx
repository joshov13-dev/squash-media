import * as Popover from '@radix-ui/react-popover'
import { BookmarkPlus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Preset } from '@shared/presets'
import type { MediaJob } from '@shared/types'
import type { SettingsScope } from '@renderer/store/editors'
import { Button, IconButton, Segmented, Select } from '../ui/controls'

function SavePreset({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const save = (): void => {
    const n = name.trim()
    if (!n) return
    onSave(n)
    setName('')
    setOpen(false)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <span>
          <IconButton label="Save these settings as a preset">
            <BookmarkPlus size={15} />
          </IconButton>
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl bg-raised p-3 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <label className="block text-[12px] font-medium text-ink-2" htmlFor="preset-name">
              Name for this preset
            </label>
            <input
              id="preset-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Blog photos"
              className="mt-1.5 h-8 w-full rounded-md bg-ground px-2.5 outline-none placeholder:text-ink-3 focus:bg-hover"
            />
            <div className="mt-2.5 flex justify-end">
              <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
                Save preset
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Top of the Photos and Videos tabs: whether changes apply to every file or
 * only the selected one, the preset picker, and ways to save or reset.
 */
export function SettingsHeader<T>({
  kind,
  job,
  scope,
  onScope,
  presets,
  presetId,
  onPreset,
  onReset,
  onSavePreset,
  onDeletePreset,
}: {
  kind: 'photo' | 'video'
  job?: MediaJob
  scope: SettingsScope
  onScope: (scope: SettingsScope) => void
  presets: Preset<T>[]
  presetId: string | null
  onPreset: (preset: Preset<T>) => void
  onReset: () => void
  onSavePreset: (name: string) => void
  onDeletePreset: (id: string) => void
}) {
  const active = presets.find((p) => p.id === presetId)
  return (
    <div className="space-y-2.5 px-4 pt-3 pb-1">
      {job && (
        <Segmented
          value={scope}
          onChange={onScope}
          options={[
            { value: 'all', label: `All ${kind}s`, hint: `These settings apply to every ${kind} that has no settings of its own` },
            { value: 'file', label: `This ${kind} only`, hint: `Give ${job.fileName} its own settings` },
          ]}
        />
      )}
      <div className="flex items-center gap-0.5">
        <div className="mr-1 min-w-0 flex-1">
          <Select
            ariaLabel="Preset"
            value={presetId ?? ''}
            placeholder="Custom settings"
            onChange={(id) => {
              const preset = presets.find((p) => p.id === id)
              if (preset) onPreset(preset)
            }}
            options={presets.map((p) => ({ value: p.id, label: p.name, detail: p.builtIn ? undefined : 'yours' }))}
          />
        </div>
        {scope === 'all' && <SavePreset onSave={onSavePreset} />}
        {active && !active.builtIn && (
          <IconButton label={`Delete the "${active.name}" preset`} onClick={() => onDeletePreset(active.id)}>
            <Trash2 size={14} />
          </IconButton>
        )}
        <IconButton label="Back to the default settings" onClick={onReset}>
          <RotateCcw size={14} />
        </IconButton>
      </div>
      {active && <p className="text-[12px] leading-snug text-ink-3">{active.description}</p>}
      {scope === 'file' && job && (
        <p className="truncate text-[12px] text-ember" title={job.fileName}>
          Only changes {job.fileName}
        </p>
      )}
    </div>
  )
}
