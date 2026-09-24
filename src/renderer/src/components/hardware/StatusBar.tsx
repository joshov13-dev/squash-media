import { Cpu } from 'lucide-react'
import { formatBytes, formatEta, savingsPercent } from '@shared/format'
import { useQueue } from '@renderer/store/queueStore'
import { useSystem } from '@renderer/store/systemStore'
import { Meter, ProgressBar } from '../ui/controls'
import { HardwarePopover } from './HardwarePopover'

function Reading({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-ink-3">{label}</span>
      <span className="num w-8 text-right text-ink-2">{value === null ? 'n/a' : `${value}%`}</span>
      <Meter value={value} />
    </span>
  )
}

export function StatusBar() {
  const load = useSystem((s) => s.load)
  const hw = useSystem((s) => s.hardware)
  const stats = useSystem((s) => s.stats)
  const jobs = useQueue((s) => s.jobs)

  const done = jobs.filter((j) => (j.status === 'completed' || j.status === 'skipped') && j.compressedSizeBytes !== undefined)
  const before = done.reduce((sum, j) => sum + j.sizeBytes, 0)
  const after = done.reduce((sum, j) => sum + (j.compressedSizeBytes ?? j.sizeBytes), 0)
  const hasGpu = load?.gpuPercent !== null && load?.gpuPercent !== undefined
  const active = stats?.active ?? false

  return (
    <footer className="flex h-8 shrink-0 items-center gap-5 bg-ground px-3 text-[12px]">
      <HardwarePopover>
        <button type="button" className="flex h-6 max-w-[240px] items-center gap-1.5 rounded px-1.5 text-ink-2 hover:bg-raised hover:text-ink">
          <Cpu size={13} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{hw ? hw.cpuModel.replace(/\(R\)|\(TM\)|®|™|CPU|Processor/gi, '').replace(/\s+/g, ' ').trim() : 'Detecting...'}</span>
        </button>
      </HardwarePopover>
      <Reading label="CPU" value={load?.cpuPercent ?? null} />
      {hasGpu && <Reading label="GPU" value={load!.gpuPercent} />}
      {hasGpu && load!.gpuEncoderPercent !== null && <Reading label="Encoder" value={load!.gpuEncoderPercent} />}
      <Reading label="RAM" value={load?.memoryPercent ?? null} />

      <div className="flex-1" />

      {active && stats ? (
        <div className="flex items-center gap-3">
          <span className="num text-ink-2">
            {stats.completed + stats.failed} of {stats.total} done
          </span>
          <ProgressBar value={stats.percent} className="w-40" />
          <span className="num w-10 text-right text-ink">{Math.floor(stats.percent)}%</span>
          <span className="num text-ink-2">
            <span className="text-ink-3">Time left</span> {stats.humanReadableEta || 'estimating'}
          </span>
        </div>
      ) : done.length > 0 ? (
        <span className="num text-ink-2">
          Saved <span className="text-sage">{formatBytes(Math.max(0, before - after))}</span> ({savingsPercent(before, after)}%) across {done.length}{' '}
          {done.length === 1 ? 'file' : 'files'}
          {stats && stats.elapsedSeconds > 0 ? <span className="text-ink-3"> · took {formatEta(stats.elapsedSeconds)}</span> : null}
        </span>
      ) : (
        <span className="text-ink-3">Ready</span>
      )}
    </footer>
  )
}
