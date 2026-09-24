import { Clapperboard, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes, formatDuration, formatEta, savingsPercent } from '@shared/format'
import type { MediaJob, VideoInfo, VideoJobConfig, VideoPreviewResult } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { describeVideoPlan, videoCodecName } from '@renderer/lib/describe'
import { effectiveVideoConfig } from '@renderer/lib/effective'
import { useQueue } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Button } from '../ui/controls'
import { ComparePane } from './ComparePane'

interface CachedPreview {
  configKey: string
  result: VideoPreviewResult
  beforeUrl: string
  afterUrl: string
}

// Survives switching between queue items.
const cache = new Map<string, CachedPreview>()

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cn('num truncate text-[13px] text-ink', className)}>{children}</div>
    </div>
  )
}

export function VideoPreview({ job }: { job: MediaJob & { info: VideoInfo } }) {
  const shared = useSettings((s) => s.video)
  const config = effectiveVideoConfig(job, shared)
  const hardware = useSystem((s) => s.hardware)
  const thumb = useQueue((s) => s.thumbnails[job.id])
  const configKey = JSON.stringify(config)
  const [preview, setPreview] = useState<CachedPreview | undefined>(() => cache.get(job.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setPreview(cache.get(job.id))
    setError(undefined)
    setBusy(false)
  }, [job.id])

  const stale = preview !== undefined && preview.configKey !== configKey
  const info = job.info
  const ffmpegMissing = hardware !== null && !hardware.ffmpegAvailable

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await api.previewVideo({ filePath: job.filePath, info, config: JSON.parse(configKey) as VideoJobConfig })
      if (!result) return
      const old = cache.get(job.id)
      if (old) {
        URL.revokeObjectURL(old.beforeUrl)
        URL.revokeObjectURL(old.afterUrl)
      }
      const entry: CachedPreview = {
        configKey,
        result,
        beforeUrl: URL.createObjectURL(new Blob([result.before as Uint8Array<ArrayBuffer>], { type: result.mime })),
        afterUrl: URL.createObjectURL(new Blob([result.after as Uint8Array<ArrayBuffer>], { type: result.mime })),
      }
      cache.set(job.id, entry)
      setPreview(entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cancel = (): void => {
    void api.cancelVideoPreview()
    setBusy(false)
  }

  const r = preview?.result
  const alreadyUnder = config.rateControl === 'targetSize' && job.sizeBytes <= config.targetMaxSizeBytes && !job.trim
  const pct = r ? savingsPercent(job.sizeBytes, r.estimatedBytes) : 0
  const audio = info.audioCodec ? `${info.audioCodec.toUpperCase()} ${info.audioChannels ?? ''}ch` : 'No audio'

  const callToAction = !preview && (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-ground/90 px-6 py-5 text-center shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
      {busy ? (
        <>
          <LoaderCircle size={22} className="animate-spin text-ember" />
          <p className="text-ink">Encoding a 4 second sample...</p>
          <Button size="sm" variant="plain" onClick={cancel}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <p className="max-w-72 text-[12px] leading-relaxed text-ink-2">
            Encode a short sample with these settings to compare frames and get a real size and speed estimate.
          </p>
          <Button variant="primary" onClick={() => void run()} disabled={ffmpegMissing}>
            <Clapperboard size={14} strokeWidth={2} /> Preview sample
          </Button>
          {ffmpegMissing && <p className="text-[12px] text-brick">FFmpeg was not found.</p>}
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-4 px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[13px] font-semibold text-ink" title={job.filePath}>
            {job.fileName}
          </h2>
          <p className="num truncate text-[12px] text-ink-3">
            {info.width}×{info.height} · {videoCodecName(info.videoCodec)}
            {info.bitDepth > 8 ? ` ${info.bitDepth}-bit` : ''} · {Math.round(info.fps * 100) / 100} fps · {formatDuration(info.durationSeconds)} · {audio}
          </p>
        </div>
        {preview && (
          <div className="flex items-center gap-2">
            {stale && !busy && <span className="text-[12px] text-ember">Settings changed</span>}
            {busy ? (
              <Button size="sm" variant="plain" onClick={cancel}>
                <LoaderCircle size={13} className="animate-spin" /> Cancel
              </Button>
            ) : (
              <Button size="sm" onClick={() => void run()}>
                <Clapperboard size={13} /> {stale ? 'Update sample' : 'Encode again'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-ground">
        {preview ? (
          <ComparePane
            viewKey={job.id}
            beforeUrl={preview.beforeUrl}
            afterUrl={preview.afterUrl}
            contentWidth={info.width}
            contentHeight={info.height}
            loading={busy}
            afterLabel={`Sample · ${r!.encoderUsed}`}
          />
        ) : (
          <ComparePane
            viewKey={job.id}
            beforeUrl={thumb}
            contentWidth={info.width}
            contentHeight={info.height}
            beforeLabel="Source"
            afterLabel=""
            overlay={callToAction}
          />
        )}
        {error && (
          <div className="absolute inset-x-0 bottom-14 mx-auto w-fit max-w-[80%] rounded-lg bg-raised px-3 py-2 text-[12px] text-brick">{error}</div>
        )}
      </div>

      <div className="grid h-16 shrink-0 grid-cols-4 items-center gap-4 px-4">
        <Fact label="Original">
          {formatBytes(job.sizeBytes)}
          {info.bitrateKbps ? <span className="text-ink-3"> · {(info.bitrateKbps / 1000).toFixed(1)} Mbps</span> : null}
        </Fact>
        <Fact label="Estimated size" className={cn(r && pct > 0 && 'text-sage')}>
          {r ? `≈ ${formatBytes(r.estimatedBytes)}${pct > 0 ? ` (−${pct}%)` : ''}` : 'Run a sample'}
        </Fact>
        <Fact label="Encode speed">{r ? `${Math.round(r.encodeFps)} fps · ${(r.encodeFps / info.fps).toFixed(1)}× real time` : '...'}</Fact>
        <Fact label="Estimated time">{r ? formatEta(r.estimatedEncodeSeconds) : '...'}</Fact>
      </div>
      <p className="-mt-2 truncate px-4 pb-2 text-[12px] text-ink-3">
        {describeVideoPlan(info, config, hardware)}
        {alreadyUnder ? ' · Already under the target, the original will be kept' : ''}
        {r?.note ? ` · ${r.note}` : ''}
      </p>
    </div>
  )
}
