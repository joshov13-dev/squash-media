import os from 'node:os'
import { join } from 'node:path'

/**
 * SquashForge's settings folder, worked out without Electron so the command
 * line and AI server share it with the app. Matches Electron's userData:
 * %APPDATA%\SquashForge, ~/Library/Application Support/SquashForge or
 * ~/.config/SquashForge.
 */
export function userDataDir(): string {
  if (process.env.SQUASHFORGE_USER_DATA) return process.env.SQUASHFORGE_USER_DATA
  const home = os.homedir()
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'SquashForge')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'SquashForge')
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'SquashForge')
}

export const userDataFile = (name: string): string => join(userDataDir(), name)
