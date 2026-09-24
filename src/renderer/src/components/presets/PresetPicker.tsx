import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, X } from 'lucide-react'
import { useState } from 'react'
import type { Preset } from '@shared/presets'
import { cn } from '@renderer/lib/cn'
import { allImagePresets, allVideoPresets, useSettings } from '@renderer/store/settingsStore'

function PresetList<T>({
  title,
  presets,
  activeId,
  onPick,
  onSave,
  onDelete,
}: {
  title: string
  presets: Preset<T>[]
  activeId: string | null
  onPick: (p: Preset<T>) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState('')
  const save = (): void => {
    const n = name.trim()
    if (!n) return
    onSave(n)
    setName('')
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <h4 className="px-2 pb-1.5 font-display text-[12px] font-semibold text-ink-2">{title}</h4>
      <ul className="space-y-px">
        {presets.map((p) => {
          const active = p.id === activeId
          return (
            <li key={p.id} className="group relative">
              <button
                type="button"
                onClick={() => onPick(p)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-hover' : 'hover:bg-hover/70',
                )}
              >
                <Check size={13} className={cn('mt-0.5 shrink-0 text-ember', !active && 'invisible')} />
                <span className="min-w-0">
                  <span className="block text-ink">{p.name}</span>
                  <span className="block text-[12px] leading-snug text-ink-3">{p.description}</span>
                </span>
              </button>
              {!p.builtIn && (
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => onDelete(p.id)}
                  className="absolute top-1.5 right-1.5 hidden h-6 w-6 items-center justify-center rounded text-ink-3 group-hover:flex hover:bg-press hover:text-ink"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <form
        className="mt-2 flex gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Save current as..."
          className="h-7 min-w-0 flex-1 rounded-md bg-ground px-2 text-[12px] outline-none placeholder:text-ink-3 focus:bg-hover"
        />
        <button type="submit" disabled={!name.trim()} className="h-7 rounded-md px-2 text-[12px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30">
          Save
        </button>
      </form>
    </div>
  )
}

export function PresetPicker() {
  const s = useSettings()
  const images = allImagePresets(s.customImagePresets)
  const videos = allVideoPresets(s.customVideoPresets)
  const imageName = images.find((p) => p.id === s.imagePresetId)?.name ?? 'Custom'
  const videoName = videos.find((p) => p.id === s.videoPresetId)?.name ?? 'Custom'

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="no-drag ml-1 flex h-8 max-w-[380px] items-center gap-2 rounded-md px-2.5 text-ink-2 transition-colors hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink"
        >
          <span className="text-ink-3">Presets</span>
          <span className="truncate">
            {imageName} <span className="text-ink-3">/</span> {videoName}
          </span>
          <ChevronDown size={14} className="shrink-0 text-ink-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className="z-50 flex w-[560px] gap-3 rounded-xl bg-raised p-3 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
        >
          <PresetList
            title="Photos"
            presets={images}
            activeId={s.imagePresetId}
            onPick={s.applyImagePreset}
            onSave={s.saveImagePreset}
            onDelete={s.deletePreset}
          />
          <PresetList
            title="Videos"
            presets={videos}
            activeId={s.videoPresetId}
            onPick={s.applyVideoPreset}
            onSave={s.saveVideoPreset}
            onDelete={s.deletePreset}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
