import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface BinaryPaths {
  ffmpeg: string
  ffprobe: string
  /** True when the binaries were found on disk rather than assumed to be on PATH. */
  bundled: boolean
}

const exe = process.platform === 'win32' ? '.exe' : ''

function platformDir(): string {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

let cached: BinaryPaths | null = null

/**
 * Find ffmpeg/ffprobe. Order:
 * 1. SQUASHFORGE_FFMPEG_DIR environment variable
 * 2. `resources/bin` inside the packaged app
 * 3. `binaries/<platform>` in the project (development)
 * 4. whatever is on PATH
 */
export function getBinaryPaths(): BinaryPaths {
  if (cached) return cached
  const candidates: string[] = []
  if (process.env.SQUASHFORGE_FFMPEG_DIR) candidates.push(process.env.SQUASHFORGE_FFMPEG_DIR)
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'bin'))
  candidates.push(resolve(__dirname, '../../binaries', platformDir()))
  candidates.push(resolve(process.cwd(), 'binaries', platformDir()))

  for (const dir of candidates) {
    const ffmpeg = join(dir, `ffmpeg${exe}`)
    const ffprobe = join(dir, `ffprobe${exe}`)
    if (existsSync(ffmpeg) && existsSync(ffprobe)) {
      cached = { ffmpeg, ffprobe, bundled: true }
      return cached
    }
  }
  cached = { ffmpeg: `ffmpeg${exe}`, ffprobe: `ffprobe${exe}`, bundled: false }
  return cached
}
