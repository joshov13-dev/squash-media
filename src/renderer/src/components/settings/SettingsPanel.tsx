import { useEffect } from 'react'
import { useQueue, useQueueKinds } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { Segmented } from '../ui/controls'
import { ImageSettings } from './ImageSettings'
import { OutputSettings } from './OutputSettings'
import { QuickSettings } from './QuickSettings'
import { VideoSettings } from './VideoSettings'

export function SettingsPanel() {
  const tab = useSettings((s) => s.tab)
  const setTab = useSettings((s) => s.setTab)
  const selectedType = useQueue((s) => s.jobs.find((j) => j.id === s.selectedId)?.type)
  const kinds = useQueueKinds()
  // With only photos in the queue, video settings are just noise, and the
  // other way round. An empty queue shows both.
  const showPhotos = kinds.photos || !kinds.videos
  const showVideos = kinds.videos || !kinds.photos

  // In the detailed tabs, follow the selection: picking a video shows video
  // settings. The Quick tab stays put so it never jumps away from beginners.
  useEffect(() => {
    if (!selectedType) return
    const current = useSettings.getState().tab
    if (current === 'image' || current === 'video') setTab(selectedType)
  }, [selectedType, setTab])

  // The tab that was open went away with its files.
  useEffect(() => {
    if ((tab === 'image' && !showPhotos) || (tab === 'video' && !showVideos)) setTab('quick')
  }, [tab, showPhotos, showVideos, setTab])

  return (
    <aside className="flex w-[320px] shrink-0 flex-col bg-panel xl:w-[340px]">
      <div className="shrink-0 px-4 pt-3 pb-1">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'quick' as const, label: 'Quick' },
            ...(showPhotos ? [{ value: 'image' as const, label: 'Photos' }] : []),
            ...(showVideos ? [{ value: 'video' as const, label: 'Videos' }] : []),
            { value: 'output' as const, label: 'Output' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === 'quick' && <QuickSettings />}
        {tab === 'image' && <ImageSettings />}
        {tab === 'video' && <VideoSettings />}
        {tab === 'output' && <OutputSettings />}
      </div>
    </aside>
  )
}
