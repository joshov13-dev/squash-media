import { useEffect, useState } from 'react'
import { formatTimecode, parseTimecode } from '@shared/format'
import type { MediaJob, VideoInfo } from '@shared/types'
import { useQueue } from '@renderer/store/queueStore'
import { Field, RangeSlider, Section } from '../ui/controls'

function TimeInput({ value, onCommit, ariaLabel }: { value: number; onCommit: (v: number) => void; ariaLabel: string }) {
  const [text, setText] = useState(formatTimecode(value))
  useEffect(() => setText(formatTimecode(value)), [value])
  const commit = (): void => {
    const parsed = parseTimecode(text)
    if (parsed === null) setText(formatTimecode(value))
    else onCommit(parsed)
  }
  return (
    <input
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      spellCheck={false}
      className="num h-8 w-full rounded-md bg-ground px-2.5 outline-none focus:bg-hover"
    />
  )
}

/** Keep only part of a video. Always per file. */
export function TrimControl({ job }: { job: MediaJob & { info: VideoInfo } }) {
  const setTrim = useQueue((s) => s.setTrim)
  const duration = job.info.durationSeconds
  if (!(duration > 0)) return null

  const start = job.trim?.start ?? 0
  const end = job.trim?.end ?? duration

  const update = (a: number, b: number): void => {
    const s = Math.max(0, Math.min(a, duration))
    const e = Math.max(0, Math.min(b, duration))
    if (e - s < 0.2) return
    setTrim(job.id, s <= 0.05 && e >= duration - 0.05 ? undefined : { start: s, end: e })
  }

  return (
    <Section
      title="Trim"
      aside={
        job.trim && (
          <button type="button" onClick={() => setTrim(job.id, undefined)} className="text-[12px] text-ink-3 hover:text-ink">
            Keep whole video
          </button>
        )
      }
    >
      <RangeSlider ariaLabel="Part to keep" value={[start, end]} min={0} max={duration} step={0.1} onChange={([a, b]) => update(a, b)} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start">
          <TimeInput ariaLabel="Start time" value={start} onCommit={(v) => update(v, end)} />
        </Field>
        <Field label="End">
          <TimeInput ariaLabel="End time" value={end} onCommit={(v) => update(start, v)} />
        </Field>
      </div>
      <p className="num text-[12px] text-ink-3">
        {job.trim ? `Keeps ${formatTimecode(end - start)} of ${formatTimecode(duration)}.` : 'Drag the ends to cut the start or end off.'} Only
        affects this video.
      </p>
    </Section>
  )
}
