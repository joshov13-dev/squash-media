import { FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GOALS } from '@shared/presets'
import type { WatchFolder, WatchStatus } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useSettings } from '@renderer/store/settingsStore'
import { Button, IconButton, Segmented, Select, Toggle } from '../ui/controls'
import { Group } from './Group'

const shortName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

function WatchCard({ folder, status }: { folder: WatchFolder; status?: WatchStatus }) {
  const prefs = useSettings((s) => s.preferences)
  const setPrefs = useSettings((s) => s.setPreferences)
  const update = (patch: Partial<WatchFolder>): void =>
    setPrefs({ watchFolders: prefs.watchFolders.map((w) => (w.id === folder.id ? { ...w, ...patch } : w)) })
  const remove = (): void => setPrefs({ watchFolders: prefs.watchFolders.filter((w) => w.id !== folder.id) })

  const chooseOutput = async (): Promise<void> => {
    const chosen = await api.chooseOutputFolder()
    if (chosen) update({ outputFolder: chosen })
  }

  const state = !folder.enabled ? 'Paused' : status?.error ? status.error : status?.watching ? 'Watching' : 'Starting...'
  const ok = folder.enabled && status?.watching

  return (
    <li className="space-y-3 rounded-lg bg-hover/50 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink" title={folder.path}>
            {shortName(folder.path)}
          </div>
          <div className="truncate text-[12px] text-ink-3" title={folder.path}>
            {folder.path}
          </div>
          <div className={cn('mt-1 flex items-center gap-1.5 text-[12px]', status?.error && folder.enabled ? 'text-brick' : 'text-ink-2')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-sage' : status?.error && folder.enabled ? 'bg-brick' : 'bg-ink-3')} />
            {state}
          </div>
        </div>
        <IconButton label="Open the folder" onClick={() => void api.openPath(folder.path)}>
          <FolderOpen size={14} />
        </IconButton>
        <IconButton label="Stop watching this folder" onClick={remove}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      <div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2 text-[12px]">
        <span className="text-ink-3">Compress as</span>
        <Select
          ariaLabel="Goal for new files"
          value={folder.goalId}
          onChange={(goalId) => update({ goalId })}
          options={GOALS.map((g) => ({ value: g.id, label: g.name }))}
        />
        <span className="text-ink-3">Save copies</span>
        <Segmented
          value={folder.outputFolder ? 'folder' : 'next'}
          onChange={(v) => (v === 'folder' ? void chooseOutput() : update({ outputFolder: null }))}
          options={[
            { value: 'next', label: 'Next to the originals' },
            { value: 'folder', label: 'In another folder' },
          ]}
        />
        {folder.outputFolder && (
          <>
            <span />
            <button type="button" onClick={() => void chooseOutput()} className="truncate text-left text-ink-2 hover:text-ink" title={folder.outputFolder}>
              {folder.outputFolder}
            </button>
          </>
        )}
      </div>
      <Toggle label="On" checked={folder.enabled} onChange={(enabled) => update({ enabled })} />
    </li>
  )
}

export function WatchPane() {
  const prefs = useSettings((s) => s.preferences)
  const setPrefs = useSettings((s) => s.setPreferences)
  const goalId = useSettings((s) => s.goalId)
  const [status, setStatus] = useState<WatchStatus[]>([])
  const [login, setLogin] = useState<boolean | null>(null)

  useEffect(() => {
    void api.getWatchStatus().then(setStatus)
    void api.getLoginItem().then(setLogin)
    return api.onWatchStatus(setStatus)
  }, [])

  const add = async (): Promise<void> => {
    const path = await api.pickFolder()
    if (!path || prefs.watchFolders.some((w) => w.path.toLowerCase() === path.toLowerCase())) return
    const folder: WatchFolder = {
      id: `watch-${Date.now().toString(36)}`,
      path,
      goalId: goalId ?? GOALS[0].id,
      outputFolder: null,
      enabled: true,
    }
    setPrefs({ watchFolders: [...prefs.watchFolders, folder] })
  }

  return (
    <div className="space-y-7">
      <Group
        title="Watch folders"
        aside={
          <Button size="sm" variant="raised" onClick={() => void add()}>
            <FolderPlus size={13} /> Add a folder
          </Button>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-3">
          New photos and videos saved into these folders (or folders inside them) are compressed on their own, as soon as they have finished
          copying. Files already there are left alone. Point it at a phone backup, screenshots or screen recordings folder.
        </p>
        {prefs.watchFolders.length === 0 ? (
          <p className="rounded-lg bg-hover/50 px-3 py-6 text-center text-ink-3">No folders yet.</p>
        ) : (
          <ul className="space-y-2">
            {prefs.watchFolders.map((f) => (
              <WatchCard key={f.id} folder={f} status={status.find((s) => s.id === f.id)} />
            ))}
          </ul>
        )}
      </Group>

      <Group title="Keep it running">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Watching only happens while SquashMedia is open. Minimised is fine.
        </p>
        {login !== null && (
          <Toggle
            label="Open SquashMedia when I sign in"
            hint="It starts minimised, so watched folders keep working after a restart."
            checked={login}
            onChange={(open) => {
              setLogin(open)
              void api.setLoginItem(open)
            }}
          />
        )}
      </Group>
    </div>
  )
}
