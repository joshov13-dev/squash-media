import * as Dialog from '@radix-ui/react-dialog'
import { Bot, Eye, Settings, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Button } from '../ui/controls'
import { ModalBody, ModalTrigger } from '../ui/Modal'
import { AiPane } from './AiPane'
import { GeneralPane } from './GeneralPane'
import { UpdatesPane } from './UpdatesPane'
import { WatchPane } from './WatchPane'

export type SettingsSection = 'general' | 'watch' | 'ai' | 'updates'

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: ReactNode }> = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={14} /> },
  { id: 'watch', label: 'Watch folders', icon: <Eye size={14} /> },
  { id: 'ai', label: 'AI and command line', icon: <Bot size={14} /> },
  { id: 'updates', label: 'Updates', icon: <Sparkles size={14} /> },
]

export function SettingsDialog() {
  const resetAll = useSettings((s) => s.resetAll)
  const updateReady = useSystem((s) => s.update?.state === 'ready' || s.update?.state === 'available')
  const [section, setSection] = useState<SettingsSection>('general')
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        setConfirmReset(false)
        if (open && updateReady) setSection('updates')
      }}
    >
      <ModalTrigger icon={<Settings size={15} strokeWidth={1.75} />} label="Settings" badge={updateReady} />
      <ModalBody
        title="Settings"
        description="How SquashMedia runs on this computer."
        width={760}
        className="flex gap-6 pb-0"
        footer={
          <>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true)
                resetAll()
                setConfirmReset(false)
              }}
            >
              {confirmReset ? 'Click again to reset everything' : 'Reset all settings'}
            </Button>
            <Dialog.Close asChild>
              <Button variant="primary">Done</Button>
            </Dialog.Close>
          </>
        }
      >
        <nav aria-label="Settings sections" className="sticky top-0 w-48 shrink-0 space-y-0.5 self-start pb-6">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
                section === s.id ? 'bg-hover text-ink' : 'text-ink-2 hover:bg-hover/60 hover:text-ink',
              )}
            >
              <span className="text-ink-3">{s.icon}</span>
              {s.label}
              {s.id === 'updates' && updateReady && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ember" aria-label="Update available" />}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 pb-6">
          {section === 'general' && <GeneralPane />}
          {section === 'watch' && <WatchPane />}
          {section === 'ai' && <AiPane />}
          {section === 'updates' && <UpdatesPane />}
        </div>
      </ModalBody>
    </Dialog.Root>
  )
}
