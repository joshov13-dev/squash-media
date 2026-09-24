import { useEffect } from 'react'
import { useQueue } from '@renderer/store/queueStore'
import { useSettings } from '@renderer/store/settingsStore'
import { Segmented } from '../ui/controls'
import { ImageSettings } from './ImageSettings'
import { OutputSettings } from './OutputSettings'
import { VideoSettings } from './VideoSettings'

export function SettingsPanel() {
  const tab = useSettings((s) => s.tab)
  const setTab = useSettings((s) => s.setTab)
  const selectedType = useQueue((s) => s.jobs.find((j) => j.id === s.selectedId)?.type)

  // Follow the selection: picking a video shows video settings, and so on.
  useEffect(() => {
    if (selectedType) setTab(selectedType)
  }, [selectedType, setTab])

  return (
    <aside className="flex w-[320px] shrink-0 flex-col bg-panel xl:w-[340px]">
      <div className="shrink-0 px-4 pt-3 pb-1">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'image', label: 'Photos' },
            { value: 'video', label: 'Videos' },
            { value: 'output', label: 'Output' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === 'image' && <ImageSettings />}
        {tab === 'video' && <VideoSettings />}
        {tab === 'output' && <OutputSettings />}
      </div>
    </aside>
  )
}
