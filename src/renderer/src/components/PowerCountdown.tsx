import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/api'
import { useSystem } from '@renderer/store/systemStore'
import { Button } from './ui/controls'

const SECONDS = 60

/** After a run with "When done: sleep / shut down", give the user a minute to change their mind. */
export function PowerCountdown() {
  const finished = useSystem((s) => s.finished)
  const whenDone = useSystem((s) => s.whenDone)
  const setWhenDone = useSystem((s) => s.setWhenDone)
  const [left, setLeft] = useState(SECONDS)
  const armed = finished !== null && whenDone !== 'nothing'

  useEffect(() => {
    if (!armed) return
    setLeft(SECONDS)
    const started = Date.now()
    const timer = setInterval(() => {
      const remaining = SECONDS - Math.floor((Date.now() - started) / 1000)
      setLeft(remaining)
      if (remaining <= 0) {
        clearInterval(timer)
        const action = useSystem.getState().whenDone
        useSystem.getState().setWhenDone('nothing')
        if (action !== 'nothing') void api.powerAction(action)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [armed])

  if (!armed) return null
  const verb = whenDone === 'shutdown' ? 'shut down' : 'go to sleep'
  const now = (): void => {
    const action = whenDone
    setWhenDone('nothing')
    void api.powerAction(action)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ground/80">
      <div role="alertdialog" aria-label={`The PC will ${verb}`} className="w-[360px] rounded-2xl bg-raised p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <p className="font-display text-[16px] font-semibold text-ink">Everything is compressed</p>
        <p className="num mt-2 text-ink-2">
          This PC will {verb} in {left} {left === 1 ? 'second' : 'seconds'}.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="plain" onClick={now}>
            {whenDone === 'shutdown' ? 'Shut down now' : 'Sleep now'}
          </Button>
          <Button variant="primary" onClick={() => setWhenDone('nothing')} autoFocus>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
