import { Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Button, ProgressBar, Toggle } from '../ui/controls'
import { Group } from './Group'

const REPO = 'https://github.com/joshov13-dev/squash-media'

function Status() {
  const u = useSystem((s) => s.update)
  if (!u) return null
  switch (u.state) {
    case 'checking':
      return <p className="text-ink-2">Checking for a new version...</p>
    case 'none':
      return <p className="text-ink-2">You have the latest version.</p>
    case 'available':
      return (
        <p className="text-ink">
          Version {u.version} is out.{' '}
          <span className="text-ink-2">
            {u.selfUpdate ? 'Downloading it now.' : 'This copy cannot update itself, so download the new one from the release page.'}
          </span>
        </p>
      )
    case 'downloading':
      return (
        <div className="space-y-2">
          <p className="text-ink">Downloading version {u.version}...</p>
          <ProgressBar value={u.percent ?? 0} />
        </div>
      )
    case 'ready':
      return <p className="text-ink">Version {u.version} is ready. It installs when SquashMedia restarts.</p>
    case 'error':
      return <p className="text-brick">Could not check: {u.error}</p>
    default:
      return <p className="text-ink-3">Not checked yet.</p>
  }
}

export function UpdatesPane() {
  const prefs = useSettings((s) => s.preferences)
  const setPrefs = useSettings((s) => s.setPreferences)
  const u = useSystem((s) => s.update)
  const app = useSystem((s) => s.app)
  const ffmpeg = useSystem((s) => s.hardware?.ffmpegVersion)
  const busy = useSystem((s) => s.stats?.active ?? false)
  const [checking, setChecking] = useState(false)

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await api.checkForUpdate()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-7">
      <Group title="Updates">
        <div className="space-y-3 rounded-lg bg-hover/50 p-3">
          <p className="num text-[12px] text-ink-3">
            You have SquashMedia {u?.current ?? app?.version}
            {u?.lastChecked ? ` · checked ${new Date(u.lastChecked).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
          <Status />
          <div className="flex flex-wrap gap-2">
            {u?.state === 'ready' && (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void api.installUpdate()}>
                <RotateCw size={13} /> {busy ? 'Finish compressing first' : 'Restart and update'}
              </Button>
            )}
            {u?.state === 'available' && !u.selfUpdate && (
              <Button variant="primary" size="sm" onClick={() => void api.installUpdate()}>
                <Download size={13} /> Download {u.version}
              </Button>
            )}
            <Button size="sm" variant="raised" disabled={checking || u?.state === 'checking' || u?.state === 'downloading'} onClick={() => void check()}>
              <RefreshCw size={13} className={checking ? 'animate-spin' : undefined} /> Check now
            </Button>
          </div>
          {u?.notes && (u.state === 'available' || u.state === 'ready' || u.state === 'downloading') && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-ink-2 hover:text-ink">What's new</summary>
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-ink-3">{u.notes.replace(/<[^>]+>/g, '')}</p>
            </details>
          )}
        </div>
        <Toggle
          label="Check for updates automatically"
          hint={
            u?.selfUpdate
              ? 'New versions download in the background and install the next time SquashMedia starts.'
              : 'You get a note here when there is a new version to download.'
          }
          checked={prefs.checkForUpdates}
          onChange={(checkForUpdates) => setPrefs({ checkForUpdates })}
        />
      </Group>

      <Group title="About">
        <p className="num text-[12px] text-ink-3">
          SquashMedia {app?.version} · {app?.platform}
          {ffmpeg ? ` · FFmpeg ${ffmpeg}` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="raised" onClick={() => window.open(REPO)}>
            <ExternalLink size={13} /> Website and source
          </Button>
          <Button size="sm" variant="raised" onClick={() => window.open(`${REPO}/issues/new`)}>
            <ExternalLink size={13} /> Report a problem
          </Button>
        </div>
      </Group>
    </div>
  )
}
