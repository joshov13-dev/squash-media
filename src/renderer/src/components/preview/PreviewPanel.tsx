import type { ImageInfo, MediaJob, VideoInfo } from '@shared/types'
import { useQueue } from '@renderer/store/queueStore'
import { ImagePreview } from './ImagePreview'
import { VideoPreview } from './VideoPreview'

export function PreviewPanel() {
  const job = useQueue((s) => s.jobs.find((j) => j.id === s.selectedId))
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-panel">
      {job ? (
        job.type === 'image' ? (
          <ImagePreview key={job.id} job={job as MediaJob & { info: ImageInfo }} />
        ) : (
          <VideoPreview key={job.id} job={job as MediaJob & { info: VideoInfo }} />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center bg-ground">
          <p className="max-w-72 text-center text-[12px] leading-relaxed text-ink-3">
            Pick a file in the queue to compare the original with the compressed result before you commit.
          </p>
        </div>
      )}
    </main>
  )
}
