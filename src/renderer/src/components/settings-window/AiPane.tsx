import { Check, Copy, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AiAppStatus, IntegrationsInfo } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { Button } from '../ui/controls'
import { Group } from './Group'

const EXAMPLES = [
  'Shrink every video in my Downloads folder to 1080p',
  'Make the photos in Desktop\\Wedding small enough to email',
  'Convert these HEIC photos to JPEG and put them in a new folder',
  'How much space would I save compressing my Videos folder?',
]

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="raised"
      onClick={() => {
        void api.copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : label}
    </Button>
  )
}

function AppRow({ app, disabled, onChange }: { app: AiAppStatus; disabled: boolean; onChange: (connect: boolean) => void }) {
  const state = app.connected ? 'Connected' : app.installed ? 'Found on this computer' : 'Not found'
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover/50">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', app.connected ? 'bg-sage' : app.installed ? 'bg-ink-2' : 'bg-press')} />
      <span className="min-w-0 flex-1">
        <span className={cn('block', app.installed || app.connected ? 'text-ink' : 'text-ink-3')}>{app.name}</span>
        <span className="block truncate text-[12px] text-ink-3" title={app.configPath ?? undefined}>
          {state}
        </span>
      </span>
      {app.connected ? (
        <Button size="sm" variant="raised" disabled={disabled} onClick={() => onChange(false)}>
          Remove
        </Button>
      ) : (
        app.installed && (
          <Button size="sm" variant="primary" disabled={disabled} onClick={() => onChange(true)}>
            Connect
          </Button>
        )
      )}
    </li>
  )
}

export function AiPane() {
  const [info, setInfo] = useState<IntegrationsInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => setInfo(await api.getIntegrations()), [])
  useEffect(() => {
    void load()
  }, [load])

  const change = async (id: string, connect: boolean): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.connectAiApp(id, connect)
      setMessage({ ok: r.ok, text: r.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.installCommand()
      setMessage({ ok: r.ok, text: r.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!info) return <p className="text-ink-3">Looking for AI apps...</p>

  return (
    <div className="space-y-7">
      <Group title="AI apps">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Connect an AI app and you can ask it to compress things for you. It runs SquashMedia on this computer, so your photos and videos are
          never uploaded. The AI only sees file names, sizes and results.
        </p>
        {!info.supported && <p className="rounded-lg bg-hover px-3 py-2.5 text-[12px] leading-relaxed text-ember">{info.problem}</p>}
        {message && (
          <p role="status" className={cn('rounded-lg bg-hover px-3 py-2.5 text-[12px] leading-relaxed', message.ok ? 'text-ink-2' : 'text-brick')}>
            {message.text}
          </p>
        )}
        <ul className="-mx-2 space-y-0.5">
          {info.apps.map((a) => (
            <AppRow key={a.id} app={a} disabled={busy || !info.supported} onChange={(connect) => void change(a.id, connect)} />
          ))}
        </ul>
        <div className="rounded-lg bg-hover/50 px-3 py-2.5">
          <p className="text-[12px] text-ink-2">Then try asking:</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-ink-3">
            {EXAMPLES.map((e) => (
              <li key={e}>“{e}”</li>
            ))}
          </ul>
        </div>
        {info.manualJson && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">Another AI app, or setting it up by hand</summary>
            <div className="mt-2 space-y-3">
              <p className="leading-relaxed text-ink-3">
                Any app that supports MCP servers can use SquashMedia. Add this to its MCP settings (often a file called mcp.json):
              </p>
              <pre className="num max-h-48 overflow-auto rounded-md bg-ground p-2.5 text-[11px] leading-relaxed text-ink-2">{info.manualJson}</pre>
              <CopyButton text={info.manualJson} label="Copy settings" />
              {info.claudeCodeCommand && (
                <>
                  <p className="leading-relaxed text-ink-3">For Claude Code, run this in a terminal:</p>
                  <pre className="num overflow-x-auto rounded-md bg-ground p-2.5 text-[11px] text-ink-2">{info.claudeCodeCommand}</pre>
                  <CopyButton text={info.claudeCodeCommand} label="Copy command" />
                </>
              )}
            </div>
          </details>
        )}
      </Group>

      <Group title="Command line">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Compress from a terminal or a script with the <span className="num text-ink-2">squashmedia</span> command. It uses the same goals and
          settings folder as this window, and its runs show up in History.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={info.command.installed ? 'raised' : 'primary'} disabled={busy || !info.supported} onClick={() => void install()}>
            <Terminal size={13} /> {info.command.installed ? 'Reinstall the command' : 'Install the squashmedia command'}
          </Button>
          {info.command.installed && <span className="text-[12px] text-ink-3">Installed{info.command.onPath ? '' : ', open a new terminal to use it'}</span>}
        </div>
        <pre className="num overflow-x-auto rounded-md bg-ground p-2.5 text-[11px] leading-relaxed text-ink-2">
          {[
            'squashmedia compress "D:\\Phone backup" --goal share',
            'squashmedia compress clip.mov --goal discord',
            'squashmedia compress Videos --resolution 1080p --out Videos\\small',
            'squashmedia help',
          ].join('\n')}
        </pre>
      </Group>
    </div>
  )
}
