import * as Dialog from '@radix-ui/react-dialog'
import { ChevronRight, FolderOpen, History, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { formatBytes, savingsPercent } from '@shared/format'
import type { HistoryEntry, HistoryRun, RunOrigin } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useSystem } from '@renderer/store/systemStore'
import { binName } from './HelpPopover'
import { Button, IconButton } from './ui/controls'
import { ModalBody, ModalTrigger } from './ui/Modal'

const ORIGIN: Record<RunOrigin, string> = {
  app: 'This window',
  watch: 'Watched folder',
  cli: 'Command line',
  ai: 'AI app',
}

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

function when(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`
}

function Entry({ entry, onUndo, busy }: { entry: HistoryEntry; onUndo: () => void; busy: boolean }) {
  const pct = savingsPercent(entry.originalBytes, entry.outputBytes)
  return (
    <li className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-ink', entry.undone && 'text-ink-3 line-through')} title={entry.source}>
          {fileName(entry.source)}
        </div>
        <div className="num truncate text-[12px] text-ink-3" title={entry.output}>
          {entry.copied
            ? `Copied unchanged to ${fileName(entry.output)}`
            : `${formatBytes(entry.originalBytes)} → ${formatBytes(entry.outputBytes)}${pct > 0 ? ` (−${pct}%)` : ''} · ${entry.replaced ? 'replaced the original' : fileName(entry.output)}`}
        </div>
      </div>
      {entry.undone ? (
        <span className="shrink-0 text-[12px] text-ink-3">Undone</span>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton label="Show in folder" onClick={() => void api.revealInFolder(entry.output)}>
            <FolderOpen size={14} />
          </IconButton>
          <IconButton
            label={entry.replaced ? `Put the original back from the ${binName()}` : `Move this copy to the ${binName()}`}
            disabled={busy}
            onClick={onUndo}
          >
            <Undo2 size={14} />
          </IconButton>
        </div>
      )}
    </li>
  )
}

function Run({ run, onChanged }: { run: HistoryRun; onChanged: (messages: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const live = run.entries.filter((e) => !e.undone)
  const before = live.reduce((n, e) => n + e.originalBytes, 0)
  const after = live.reduce((n, e) => n + e.outputBytes, 0)
  const replaced = live.some((e) => e.replaced)

  const undoAll = async (): Promise<void> => {
    setBusy(true)
    try {
      const results = await api.undoRun(run.id)
      const failed = results.filter((r) => !r.ok)
      onChanged(
        failed.length
          ? failed.map((r) => r.message)
          : [`Undid ${results.length} ${results.length === 1 ? 'file' : 'files'}. ${replaced ? 'The originals are back.' : `The copies are in the ${binName()}.`}`],
      )
    } finally {
      setBusy(false)
    }
  }
  const undoOne = async (entry: HistoryEntry): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.undoEntry(run.id, entry.jobId)
      onChanged([r.message])
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg bg-hover/40">
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-hover"
        >
          <ChevronRight size={14} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {when(run.startedAt)} · {run.entries.length} {run.entries.length === 1 ? 'file' : 'files'}
            </span>
            <span className="num block truncate text-[12px] text-ink-3">
              {ORIGIN[run.origin]}
              {live.length ? ` · saved ${formatBytes(Math.max(0, before - after))}` : ' · all undone'}
              {replaced ? ' · replaced originals' : ''}
            </span>
          </span>
        </button>
        {live.length > 0 && (
          <Button size="sm" variant="raised" disabled={busy} onClick={() => void undoAll()}>
            <Undo2 size={13} /> Undo
          </Button>
        )}
      </div>
      {open && (
        <ul className="space-y-0.5 px-2 pb-2">
          {run.entries.map((e) => (
            <Entry key={e.jobId} entry={e} busy={busy} onUndo={() => void undoOne(e)} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function HistoryDialog() {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<HistoryRun[] | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const active = useSystem((s) => s.stats?.active ?? false)

  const load = useCallback(async () => setRuns(await api.listHistory(100)), [])

  useEffect(() => {
    if (open) void load()
  }, [open, active, load])

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setMessages([])
      }}
    >
      <ModalTrigger icon={<History size={15} strokeWidth={1.75} />} label="History" />
      <ModalBody title="History" description="Files SquashMedia has made, and a way to undo them." width={600}>
        <p className="mb-4 text-[12px] leading-relaxed text-ink-3">
          Every file SquashMedia makes is listed here, including ones made by watched folders, the command line and AI apps. Undo moves the
          compressed copy to the {binName()}. If it replaced an original, the original is put back from the {binName()}.
        </p>
        {messages.length > 0 && (
          <div role="status" className="mb-3 space-y-1 rounded-lg bg-hover px-3 py-2 text-[12px] text-ink-2">
            {messages.slice(0, 6).map((m, i) => (
              <p key={i}>{m}</p>
            ))}
            {messages.length > 6 && <p className="text-ink-3">...and {messages.length - 6} more</p>}
          </div>
        )}
        {runs === null ? (
          <p className="text-ink-3">Loading...</p>
        ) : runs.length === 0 ? (
          <p className="py-8 text-center text-ink-3">Nothing yet. Compressed files will show up here.</p>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((run) => (
              <Run
                key={run.id}
                run={run}
                onChanged={(m) => {
                  setMessages(m)
                  void load()
                }}
              />
            ))}
          </ul>
        )}
      </ModalBody>
    </Dialog.Root>
  )
}
