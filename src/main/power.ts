import { spawn } from 'node:child_process'
import type { WhenDone } from '@shared/types'

/** Sleep or shut down the PC. Used by "When done" after the queue finishes. */
export function runPowerAction(action: Exclude<WhenDone, 'nothing'>): void {
  const run = (cmd: string, args: string[]): void => {
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
  if (process.platform === 'win32') {
    if (action === 'shutdown') run('shutdown', ['/s', '/t', '0'])
    else
      run('powershell', [
        '-NoProfile',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
      ])
  } else if (process.platform === 'darwin') {
    if (action === 'shutdown') run('osascript', ['-e', 'tell app "System Events" to shut down'])
    else run('pmset', ['sleepnow'])
  } else {
    run('systemctl', [action === 'shutdown' ? 'poweroff' : 'suspend'])
  }
}
