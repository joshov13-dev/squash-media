import { useEffect, useRef, useState } from 'react'
import { formatBytes, savingsPercent } from '@shared/format'
import type { ImageInfo, ImageJobConfig, ImagePreviewResult, MediaJob } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { formatName } from '@renderer/lib/describe'
import { useSettings } from '@renderer/store/settingsStore'
import { Segmented } from '../ui/controls'
import { ComparePane } from './ComparePane'

function blobUrl(data: Uint8Array, mime: string): string {
  return URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }))
}

interface PreviewState {
  afterUrl?: string
  /** Latest exact (or tile-estimated) result. */
  result?: ImagePreviewResult
  loading: boolean
  error?: string
}

let requestCounter = 0

/** Above this many pixels a quick low-resolution encode is shown first. */
const QUICK_THRESHOLD = 2_000_000

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The source image, loaded once per file. */
function useOriginal(filePath: string): { url?: string; error?: string } {
  const [state, setState] = useState<{ url?: string; error?: string }>({})
  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    setState({})
    api
      .getImageOriginal(filePath)
      .then((o) => {
        if (cancelled) return
        url = blobUrl(o.data, o.mime)
        setState({ url })
      })
      .catch((e) => !cancelled && setState({ error: message(e) }))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [filePath])
  return state
}

/**
 * Live preview. Each settings change first shows a quick encode of a small
 * copy (instant feedback while dragging), then the exact encode with the
 * real file size replaces it.
 */
function useCompressedPreview(job: MediaJob & { info: ImageInfo }, config: ImageJobConfig, resultPath: string | undefined): PreviewState {
  const [state, setState] = useState<PreviewState>({ loading: true })
  const latest = useRef(0)
  const afterUrl = useRef<string | undefined>(undefined)
  const configKey = JSON.stringify(config)
  const large = job.info.width * job.info.height > QUICK_THRESHOLD

  useEffect(() => {
    const id = ++requestCounter
    latest.current = id
    setState((s) => ({ ...s, loading: true, error: undefined }))
    const show = (r: ImagePreviewResult): string => {
      const url = blobUrl(r.after, r.afterMime)
      if (afterUrl.current) URL.revokeObjectURL(afterUrl.current)
      afterUrl.current = url
      return url
    }
    const request = { requestId: id, filePath: job.filePath, config: JSON.parse(configKey) as ImageJobConfig }
    const timer = setTimeout(async () => {
      try {
        if (large && !resultPath) {
          const quick = await api.previewImage({ ...request, quick: true })
          if (latest.current !== id) return
          if (quick) setState((s) => ({ ...s, afterUrl: show(quick) }))
        }
        const full = await api.previewImage({ ...request, resultPath })
        if (!full || latest.current !== id) return
        setState({ afterUrl: show(full), result: full, loading: false })
      } catch (e) {
        if (latest.current === id) setState((s) => ({ ...s, loading: false, error: message(e) }))
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [job.filePath, configKey, resultPath, large])

  useEffect(
    () => () => {
      if (afterUrl.current) URL.revokeObjectURL(afterUrl.current)
    },
    [],
  )

  return state
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cn('num truncate text-[13px] text-ink', className)}>{children}</div>
    </div>
  )
}

export function ImagePreview({ job }: { job: MediaJob & { info: ImageInfo } }) {
  const config = useSettings((s) => s.image)
  const hasResult = (job.status === 'completed' || job.status === 'skipped') && !!job.outputPath
  const [view, setView] = useState<'live' | 'saved'>(hasResult ? 'saved' : 'live')
  useEffect(() => setView(hasResult ? 'saved' : 'live'), [job.id, hasResult])
  const resultPath = view === 'saved' && hasResult ? job.outputPath : undefined
  const original = useOriginal(job.filePath)
  const { afterUrl, result, loading, error: previewError } = useCompressedPreview(job, config, resultPath)
  const beforeUrl = original.url
  const error = original.error ?? previewError

  const pct = result ? savingsPercent(result.originalBytes, result.estimatedBytes) : 0
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-6 px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[13px] font-semibold text-ink" title={job.filePath}>
            {job.fileName}
          </h2>
          <p className="num truncate text-[12px] text-ink-3">
            {job.info.width}×{job.info.height} · {formatName(job.info.format)}
            {job.info.hasAlpha ? ' · transparency' : ''}
          </p>
        </div>
        {hasResult && (
          <Segmented
            className="w-52"
            value={view}
            onChange={setView}
            options={[
              { value: 'saved', label: 'Saved file' },
              { value: 'live', label: 'Live settings' },
            ]}
          />
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-ground">
        <ComparePane
          viewKey={job.id}
          beforeUrl={beforeUrl}
          afterUrl={afterUrl}
          contentWidth={job.info.width}
          contentHeight={job.info.height}
          loading={loading}
          afterLabel={view === 'saved' && hasResult ? 'Saved' : 'Compressed'}
        />
        {error && (
          <div className="absolute inset-x-0 bottom-14 mx-auto w-fit max-w-[80%] rounded-lg bg-raised px-3 py-2 text-[12px] text-brick">{error}</div>
        )}
      </div>

      <div className={cn('grid h-16 shrink-0 grid-cols-4 items-center gap-4 px-4 transition-opacity', loading && result && 'opacity-50')}>
        <Stat label="Original">{formatBytes(job.sizeBytes)}</Stat>
        <Stat label={result?.exact === false ? 'Estimated' : 'Compressed'}>
          {result ? `${result.exact ? '' : '≈ '}${formatBytes(result.estimatedBytes)}` : loading ? 'Encoding...' : '...'}
        </Stat>
        <Stat label="Saving" className={pct > 0 ? 'text-sage' : pct < 0 ? 'text-brick' : undefined}>
          {result ? (pct >= 0 ? `${pct}%` : `+${-pct}% larger`) : '...'}
        </Stat>
        <Stat label="Output">
          {result
            ? `${formatName(result.outputFormat)} · ${result.outputWidth}×${result.outputHeight}${result.qualityUsed && config.mode === 'targetSize' && view === 'live' ? ` · q${result.qualityUsed}` : ''}`
            : '...'}
        </Stat>
      </div>
      {result?.note && <p className="-mt-2 truncate px-4 pb-2 text-[12px] text-ink-3">{result.note}</p>}
    </div>
  )
}
