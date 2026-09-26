import os from 'node:os'
import { join } from 'node:path'

/**
 * SquashMedia's settings folder, worked out without Electron so the command
 * line and AI server share it with the app. Matches Electron's userData:
 * %APPDATA%\SquashMedia, ~/Library/Application Support/SquashMedia or
 * ~/.config/SquashMedia.
 */
export function userDataDir(): string {
  if (process.env.SQUASHMEDIA_USER_DATA) return process.env.SQUASHMEDIA_USER_DATA
  const home = os.homedir()
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'SquashMedia')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'SquashMedia')
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'SquashMedia')
}

export const userDataFile = (name: string): string => join(userDataDir(), name)
