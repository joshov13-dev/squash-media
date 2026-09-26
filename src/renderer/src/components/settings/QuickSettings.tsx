import { Check, FolderOpen } from 'lucide-react'
import { ENCODER_LABELS, pickEncoderMode } from '@shared/codecs'
import { goalDescription, GOALS } from '@shared/presets'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useQueueKinds } from '@renderer/store/queueStore'
import { useSettings, type SettingsTab } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { whereFilesGo } from '../HelpPopover'
import { Button, Section, Segmented, Toggle } from '../ui/controls'

/** The simple way in: pick what you want, and whether to use the graphics card. */
export function QuickSettings() {
  const goalId = useSettings((s) => s.goalId)
  const applyGoal = useSettings((s) => s.applyGoal)
  const video = useSettings((s) => s.video)
  const setVideo = useSettings((s) => s.setVideo)
  const output = useSettings((s) => s.output)
  const setOutput = useSettings((s) => s.setOutput)
  const setTab = useSettings((s) => s.setTab)
  const setView = useSettings((s) => s.setView)
  const hw = useSystem((s) => s.hardware)
  const kinds = useQueueKinds()
  const showVideos = kinds.videos || !kinds.photos
  const showPhotos = kinds.photos || !kinds.videos

  const supported = hw?.encoderSupport[video.codec] ?? ['cpu']
  const gpu = pickEncoderMode('auto', video.codec, supported)
  const usingGpu = video.encoderMode === 'auto' && gpu !== 'cpu'

  const chooseFolder = async (): Promise<void> => {
    const folder = await api.chooseOutputFolder()
    if (folder) setOutput({ folder, mode: 'folder' })
  }

  return (
    <div className="pt-1">
      <Section title="What do you want to do?">
        <div role="radiogroup" aria-label="Goal" className="-mx-2 space-y-0.5">
          {GOALS.map((goal) => {
            const active = goal.id === goalId
            return (
              <button
                key={goal.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => applyGoal(goal)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                  active ? 'bg-hover' : 'hover:bg-raised',
                )}
              >
                <Check size={14} strokeWidth={2.25} className={cn('mt-0.5 shrink-0 text-ember', !active && 'invisible')} />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{goal.name}</span>
                  <span className="block text-[12px] leading-snug text-ink-3">{goalDescription(goal, kinds)}</span>
                </span>
              </button>
            )
          })}
        </div>
        {!goalId && (
          <p className="text-[12px] leading-snug text-ember">
            You have changed settings in the other tabs. Pick a goal above to start again from it.
          </p>
        )}
      </Section>

      {showVideos && (
        <Section title="Videos">
          <Toggle
            label="Use my graphics card"
            hint={
              gpu !== 'cpu'
                ? `Found ${ENCODER_LABELS[gpu]}. Videos finish many times faster; files come out a little bigger.`
                : hw
                  ? 'No graphics card that can encode video was found, so videos use the processor.'
                  : 'Checking this PC...'
            }
            checked={usingGpu}
            disabled={gpu === 'cpu'}
            onChange={(on) => setVideo({ encoderMode: on ? 'auto' : 'cpu' })}
          />
        </Section>
      )}

      <Section title="Save to">
        <Segmented
          value={output.mode === 'folder' ? 'folder' : output.mode === 'overwrite' ? 'overwrite' : 'suffix'}
          onChange={(mode) => {
            if (mode === 'folder' && !output.folder) void chooseFolder()
            else setOutput({ mode })
          }}
          options={[
            { value: 'suffix', label: 'Same folder' },
            { value: 'folder', label: 'Other folder' },
            { value: 'overwrite', label: 'Replace' },
          ]}
        />
        {output.mode === 'folder' && output.folder && (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={output.folder}>
              {output.folder}
            </span>
            <Button size="sm" onClick={() => void chooseFolder()}>
              <FolderOpen size={13} /> Change
            </Button>
          </div>
        )}
        <p className="text-[12px] leading-snug text-ink-3">{whereFilesGo(output)}</p>
      </Section>

      <div className="space-y-2 px-4 pt-1 text-[12px] leading-relaxed text-ink-3">
        <p>
          Want more control?{' '}
          <TabLinks tabs={[...(showPhotos ? (['image'] as const) : []), ...(showVideos ? (['video'] as const) : []), 'output']} onPick={setTab} />{' '}
          have every setting.
        </p>
        <p>
          Prefer fewer choices?{' '}
          <button type="button" onClick={() => setView('simple')} className={LINK}>
            Switch to Simple view
          </button>
        </p>
      </div>
    </div>
  )
}

const LINK = 'text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink'
const TAB_NAMES: Record<Exclude<SettingsTab, 'quick'>, string> = {
  image: 'Photos',
  video: 'Videos',
  output: 'Output',
}

/** "The Photos, Videos and Output tabs", each name a link to its tab. */
function TabLinks({ tabs, onPick }: { tabs: ReadonlyArray<Exclude<SettingsTab, 'quick'>>; onPick: (tab: SettingsTab) => void }) {
  return (
    <>
      The{' '}
      {tabs.map((t, i) => (
        <span key={t}>
          {i > 0 && (i === tabs.length - 1 ? ' and ' : ', ')}
          <button type="button" onClick={() => onPick(t)} className={LINK}>
            {TAB_NAMES[t]}
          </button>
        </span>
      ))}{' '}
      tabs
    </>
  )
}
