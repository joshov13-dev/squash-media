import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { getBinaryPaths } from '../src/main/binaries'
import { runProcess } from '../src/main/utils/process'

export async function tempDir(prefix = 'sqf-test-'): Promise<string> {
  return mkdtemp(join(os.tmpdir(), prefix))
}

let ffmpegOk: boolean | null = null

/** True when an ffmpeg binary is available (bundled or on PATH). */
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk
  const { ffmpeg, bundled } = getBinaryPaths()
  if (bundled && !existsSync(ffmpeg)) return (ffmpegOk = false)
  try {
    const { code } = await runProcess(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 })
    ffmpegOk = code === 0
  } catch {
    ffmpegOk = false
  }
  return ffmpegOk
}

/** Render a short synthetic test clip with ffmpeg's lavfi sources. */
export async function makeTestVideo(
  path: string,
  opts: { seconds?: number; width?: number; height?: number; fps?: number; audio?: boolean; codec?: string } = {},
): Promise<void> {
  const { ffmpeg } = getBinaryPaths()
  const { seconds = 3, width = 640, height = 360, fps = 30, audio = true, codec = 'libx264' } = opts
  const args = ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=${fps}:d=${seconds}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-ac', '2')
  args.push('-c:v', codec, '-pix_fmt', 'yuv420p', '-b:v', '3M')
  if (audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest')
  args.push(path)
  const { code, stderr } = await runProcess(ffmpeg, args, { timeoutMs: 120_000 })
  if (code !== 0) throw new Error(stderr)
}
