import { FolderPlus, ListChecks, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { formatBytes } from '@shared/format'
import { FFMPEG_MISSING } from '@shared/messages'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { FINISHED, useQueue } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { whereFilesGo } from '../HelpPopover'
import { Button, IconButton } from '../ui/controls'
import { FinishBanner } from './FinishBanner'
import { QueueItem } from './QueueItem'

function EmptyQueue() {
  const addPaths = useQueue((s) => s.addPaths)
  const output = useSettings((s) => s.output)
  const simple = useSettings((s) => s.view === 'simple')
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <svg width="112" height="72" viewBox="0 0 112 72" aria-hidden="true">
        <rect x="6" y="4" width="100" height="10" rx="5" fill="var(--color-press)" />
        <rect x="22" y="26" width="68" height="20" rx="6" fill="var(--color-ember-3)" />
        <rect x="34" y="32" width="44" height="8" rx="4" fill="var(--color-ember-2)" />
        <rect x="6" y="58" width="100" height="10" rx="5" fill="var(--color-press)" />
      </svg>
      <div className="space-y-1.5">
        <p className="font-display text-[15px] font-semibold text-ink">Drop photos and videos here</p>
        <p className="text-[12px] leading-relaxed text-balance text-ink-3">
          JPEG, PNG, WebP, AVIF, HEIC, TIFF and BMP photos.
          <br />
          MP4, MKV, MOV, WebM, AVI and other videos. Folders work too.
        </p>
      </div>
      <ol className="w-full max-w-72 space-y-1.5 text-left text-[12px] text-ink-2">
        <li className="flex gap-2.5">
          <span className="num font-semibold text-ember">1</span>Add your files.
        </li>
        <li className="flex gap-2.5">
          <span className="num font-semibold text-ember">2</span>
          {simple ? 'Choose what they are for, on the right.' : 'Click one to compare before and after.'}
        </li>
        <li className="flex gap-2.5">
          <span className="num font-semibold text-ember">3</span>
          {simple ? 'Press Compress.' : 'Press Compress at the top right.'}
        </li>
      </ol>
      <p className="max-w-72 text-[12px] leading-relaxed text-balance text-ink-3">{whereFilesGo(output)}</p>
      <div className="flex gap-2">
        <Button onClick={async () => void addPaths(await api.pickFiles())}>
          <Plus size={15} /> Add files
        </Button>
        <Button
          variant="plain"
          onClick={async () => {
            const folder = await api.pickFolder()
            if (folder) void addPaths([folder])
          }}
        >
          <FolderPlus size={15} strokeWidth={1.75} /> Add folder
        </Button>
      </div>
    </div>
  )
}

/** The list of files. Wide fills the space the preview would take, for Simple view. */
export function QueuePanel({ wide = false }: { wide?: boolean }) {
  const jobs = useQueue((s) => s.jobs)
  const selectedId = useQueue((s) => s.selectedId)
  const adding = useQueue((s) => s.adding)
  const notice = useQueue((s) => s.notice)
  const dismissNotice = useQueue((s) => s.dismissNotice)
  const clearFinished = useQueue((s) => s.clearFinished)
  const clearAll = useQueue((s) => s.clearAll)
  const requeueFinished = useQueue((s) => s.requeueFinished)
  const ffmpegMissing = useSystem((s) => s.hardware !== null && !s.hardware.ffmpegAvailable)

  const totalBytes = jobs.reduce((sum, j) => sum + j.sizeBytes, 0)
  const images = jobs.filter((j) => j.type === 'image').length
  const videos = jobs.length - images
  const finished = jobs.filter((j) => FINISHED.includes(j.status)).length
  const counts = [images && `${images} ${images === 1 ? 'photo' : 'photos'}`, videos && `${videos} ${videos === 1 ? 'video' : 'videos'}`]
    .filter(Boolean)
    .join(', ')

  return (
    <aside className={cn('flex flex-col bg-panel', wide ? 'min-w-0 flex-1' : 'w-[380px] shrink-0 xl:w-[420px]')}>
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[13px] font-semibold text-ink">Queue</h2>
          <p className="num truncate text-[12px] text-ink-3">
            {jobs.length ? `${counts} · ${formatBytes(totalBytes)}` : adding ? 'Reading files...' : 'Nothing added yet'}
          </p>
        </div>
        <IconButton label="Requeue finished files" onClick={requeueFinished} disabled={!finished}>
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Clear finished" onClick={clearFinished} disabled={!finished}>
          <ListChecks size={15} />
        </IconButton>
        <IconButton label="Clear queue" onClick={clearAll} disabled={!jobs.length}>
          <Trash2 size={15} />
        </IconButton>
      </div>

      {ffmpegMissing && (
        <p role="alert" className="mx-3 mb-2 rounded-lg bg-raised px-3 py-2 text-[12px] leading-relaxed text-brick">
          {FFMPEG_MISSING}
        </p>
      )}

      {jobs.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div role="listbox" aria-label="Queue" className="flex-1 space-y-0.5 overflow-y-auto pb-3">
          {jobs.map((job) => (
            <QueueItem key={job.id} job={job} selected={job.id === selectedId} />
          ))}
          {adding > 0 && <p className="px-5 py-2 text-[12px] text-ink-3">Reading files...</p>}
        </div>
      )}

      <FinishBanner />
      {notice && (
        <button
          type="button"
          onClick={dismissNotice}
          className="mx-3 mb-3 line-clamp-2 rounded-lg bg-raised px-3 py-2 text-left text-[12px] text-ink-2 hover:bg-hover"
          title={notice}
        >
          {notice}
        </button>
      )}
    </aside>
  )
}
