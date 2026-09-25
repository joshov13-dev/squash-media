import { ClipboardCopy, Film, FolderOpen, Image as ImageIcon, RotateCcw, X } from 'lucide-react'
import { memo } from 'react'
import { formatBytes, savingsPercent } from '@shared/format'
import type { MediaJob } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { describeImagePlan, describeSource, describeVideoPlan } from '@renderer/lib/describe'
import { effectiveImageConfig, effectiveVideoConfig } from '@renderer/lib/effective'
import { ACTIVE, useQueue } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { IconButton, ProgressBar } from '../ui/controls'

function Thumb({ job }: { job: MediaJob }) {
  const thumb = useQueue((s) => s.thumbnails[job.id])
  const Icon = job.type === 'image' ? ImageIcon : Film
  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-press">
      {thumb ? (
        <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <Icon size={18} strokeWidth={1.5} className="absolute inset-0 m-auto text-ink-3" />
      )}
      {job.type === 'video' && thumb && (
        <Film size={11} strokeWidth={2} className="absolute bottom-1 left-1 text-ink drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]" />
      )}
    </div>
  )
}

function PlanLine({ job }: { job: MediaJob }) {
  const image = useSettings((s) => s.image)
  const video = useSettings((s) => s.video)
  const hardware = useSystem((s) => s.hardware)
  const plan =
    job.info.kind === 'image'
      ? describeImagePlan(job.info, effectiveImageConfig(job, image))
      : describeVideoPlan(job.info, effectiveVideoConfig(job, video), hardware)
  const own = job.type === 'image' ? job.imageOverride : job.videoOverride
  return (
    <span className="truncate text-ink-3">
      → {plan}
      {own && <span className="text-ember-2"> · own settings</span>}
    </span>
  )
}

function StatusLine({ job, simple }: { job: MediaJob; simple: boolean }) {
  const p = job.progress
  switch (job.status) {
    case 'pending':
      return simple ? <span className="text-ink-3">Ready</span> : <PlanLine job={job} />
    case 'queued':
      return <span className="text-ink-3">Waiting in line</span>
    case 'analyzing':
    case 'processing': {
      const bits: string[] = [`${Math.floor(p.percent)}%`]
      if (p.phase) bits.push(p.phase)
      // Frame rates and encode speed mean nothing to most people.
      if (p.currentFps && !simple) bits.push(`${Math.round(p.currentFps)} fps`)
      if (p.currentSpeed && !simple) bits.push(`${p.currentSpeed.toFixed(2)}×`)
      return (
        <div className="w-full space-y-1.5 pt-1">
          <ProgressBar value={p.percent} />
          <div className="num flex justify-between gap-2 text-ink-2">
            <span className="truncate">{bits.join(' · ')}</span>
            <span className="shrink-0 text-ink-3">{p.humanReadableEta ? `${p.humanReadableEta} left` : 'estimating'}</span>
          </div>
        </div>
      )
    }
    case 'completed':
      return (
        <span className="num truncate text-ink-2">
          → {formatBytes(job.compressedSizeBytes ?? 0)}
          {job.note && <span className="text-ink-3"> · {job.note}</span>}
        </span>
      )
    case 'skipped':
      return <span className="truncate text-ink-3">{job.note ?? 'Original kept'}</span>
    case 'failed':
      return (
        <span className="line-clamp-3 text-brick" title={job.errorDetail ?? job.error}>
          {job.error ?? 'Failed'}
        </span>
      )
    case 'cancelled':
      return <span className="text-ink-3">Cancelled</span>
  }
}

function Outcome({ job }: { job: MediaJob }) {
  if (job.status === 'completed' && job.compressedSizeBytes !== undefined) {
    const pct = savingsPercent(job.sizeBytes, job.compressedSizeBytes)
    const text = pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : '0%'
    return <span className={cn('num shrink-0 text-[12px] font-semibold', pct > 0 ? 'text-sage' : 'text-ink-2')}>{text}</span>
  }
  if (job.status === 'skipped') return <span className="shrink-0 text-[12px] text-ink-3">Kept</span>
  return null
}

export const QueueItem = memo(function QueueItem({ job, selected }: { job: MediaJob; selected: boolean }) {
  const select = useQueue((s) => s.select)
  const remove = useQueue((s) => s.remove)
  const retry = useQueue((s) => s.retry)
  const cancel = useQueue((s) => s.cancel)
  const copyReport = useQueue((s) => s.copyReport)
  const simple = useSettings((s) => s.view === 'simple')
  const active = ACTIVE.includes(job.status)

  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={() => select(job.id)}
      onDoubleClick={() => job.outputPath && void api.openPath(job.outputPath)}
      title={job.outputPath ? 'Double-click to open the compressed file' : undefined}
      className={cn(
        'group relative mx-2 flex cursor-default gap-3 rounded-lg px-2.5 py-2.5 transition-colors',
        selected ? 'bg-raised' : 'hover:bg-raised/55',
      )}
    >
      <Thumb job={job} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12px]">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-ink" title={job.filePath}>
            {job.fileName}
          </span>
          <span className="ml-auto" />
          <Outcome job={job} />
        </div>
        <span className="num truncate text-ink-3">{describeSource(job)}</span>
        <StatusLine job={job} simple={simple} />
      </div>
      <div
        className={cn(
          'absolute top-2 right-2 hidden items-center gap-0.5 rounded-md bg-raised pl-1 group-hover:flex',
          selected && 'bg-raised',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {job.status === 'failed' && (
          <IconButton label="Copy the details, for a bug report" onClick={() => void copyReport([job.id])}>
            <ClipboardCopy size={14} />
          </IconButton>
        )}
        {job.outputPath && (
          <IconButton label="Show in folder" onClick={() => void api.revealInFolder(job.outputPath!)}>
            <FolderOpen size={14} />
          </IconButton>
        )}
        {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'completed' || job.status === 'skipped') && (
          <IconButton label="Run again" onClick={() => retry(job.id)}>
            <RotateCcw size={14} />
          </IconButton>
        )}
        <IconButton label={active ? 'Cancel' : 'Remove'} onClick={() => (active ? cancel(job.id) : remove(job.id))}>
          <X size={15} />
        </IconButton>
      </div>
    </div>
  )
})
