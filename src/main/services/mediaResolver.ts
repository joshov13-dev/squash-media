import { randomUUID } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/codecs'
import type { MediaFile, MediaType, ResolveResult } from '@shared/types'
import { mapLimit } from '../utils/process'
import { readImageInfo } from './imageProcessor'
import { probeVideo } from './videoProcessor'
import { FFMPEG_MISSING } from '@shared/messages'
import { getHardwareProfile } from '../hardware'
import { friendlyError } from './friendlyErrors'

const MAX_FILES = 5000
const MAX_DEPTH = 8
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'System Volume Information'])

/** ".ts" is also TypeScript. Real MPEG transport streams start with a 0x47 sync byte. */
async function looksLikeTransportStream(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(1)
    await handle.read(buf, 0, 1, 0)
    return buf[0] === 0x47
  } finally {
    await handle.close()
  }
}

export function classifyPath(filePath: string): MediaType | null {
  const ext = extname(filePath).toLowerCase()
  if (ext in IMAGE_EXTENSIONS) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return null
}

interface Found {
  path: string
  /** Folder below the dropped folder's parent, e.g. "Holiday/Day 1". */
  relativeDir?: string
}

async function expand(paths: string[], rejected: ResolveResult['rejected']): Promise<Found[]> {
  const out: Found[] = []
  let root = ''
  const walk = async (p: string, depth: number): Promise<void> => {
    if (out.length >= MAX_FILES) return
    let s
    try {
      s = await stat(p)
    } catch {
      rejected.push({ path: p, reason: 'Not found' })
      return
    }
    if (s.isDirectory()) {
      if (depth > MAX_DEPTH) return
      let entries: string[] = []
      try {
        entries = await readdir(p)
      } catch {
        rejected.push({ path: p, reason: 'Folder could not be read' })
        return
      }
      entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      for (const name of entries) {
        if (name.startsWith('.') || name.startsWith('$') || SKIP_DIRS.has(name)) continue
        await walk(join(p, name), depth + 1)
      }
      return
    }
    if (s.isFile()) {
      const ts = extname(p).toLowerCase() === '.ts'
      if (classifyPath(p) && (!ts || (await looksLikeTransportStream(p).catch(() => false)))) {
        out.push({ path: p, relativeDir: depth > 0 ? relative(dirname(root), dirname(p)) : undefined })
      }
      else if (depth === 0) rejected.push({ path: p, reason: 'Unsupported file type' })
    }
  }
  for (const p of paths) {
    root = p
    await walk(p, 0)
  }
  return out
}

/** Expand dropped files and folders, then read each file's media info. */
export async function resolveMedia(paths: string[]): Promise<ResolveResult> {
  const rejected: ResolveResult['rejected'] = []
  const files = await expand(paths, rejected)
  const resolved = await mapLimit(files, 6, async ({ path: filePath, relativeDir }): Promise<MediaFile | null> => {
    const type = classifyPath(filePath)!
    try {
      const { size } = await stat(filePath)
      const info = type === 'image' ? await readImageInfo(filePath) : await probeVideo(filePath)
      return { id: randomUUID(), filePath, fileName: basename(filePath), relativeDir, type, sizeBytes: size, info }
    } catch (e) {
      // FFmpeg reads videos and HEIC photos. When it is missing or broken, say
      // that once in plain words rather than FFmpeg's own error.
      const needsFfmpeg = type === 'video' || /\.(heic|heif)$/i.test(filePath)
      const reason = needsFfmpeg && !(await getHardwareProfile()).ffmpegAvailable ? FFMPEG_MISSING : friendlyError(e).message
      rejected.push({ path: filePath, reason })
      return null
    }
  })
  return { files: resolved.filter((f): f is MediaFile => f !== null), rejected }
}
