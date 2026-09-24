import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/codecs'
import type { MediaFile, MediaType, ResolveResult } from '@shared/types'
import { mapLimit } from '../utils/process'
import { readImageInfo } from './imageProcessor'
import { probeVideo } from './videoProcessor'

const MAX_FILES = 5000
const MAX_DEPTH = 8

export function classifyPath(filePath: string): MediaType | null {
  const ext = extname(filePath).toLowerCase()
  if (ext in IMAGE_EXTENSIONS) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return null
}

async function expand(paths: string[], rejected: ResolveResult['rejected']): Promise<string[]> {
  const out: string[] = []
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
        if (name.startsWith('.') || name.startsWith('$')) continue
        await walk(join(p, name), depth + 1)
      }
      return
    }
    if (s.isFile()) {
      if (classifyPath(p)) out.push(p)
      else if (depth === 0) rejected.push({ path: p, reason: 'Unsupported file type' })
    }
  }
  for (const p of paths) await walk(p, 0)
  return out
}

/** Expand dropped files and folders, then read each file's media info. */
export async function resolveMedia(paths: string[]): Promise<ResolveResult> {
  const rejected: ResolveResult['rejected'] = []
  const files = await expand(paths, rejected)
  const resolved = await mapLimit(files, 6, async (filePath): Promise<MediaFile | null> => {
    const type = classifyPath(filePath)!
    try {
      const { size } = await stat(filePath)
      const info = type === 'image' ? await readImageInfo(filePath) : await probeVideo(filePath)
      return { id: randomUUID(), filePath, fileName: basename(filePath), type, sizeBytes: size, info }
    } catch (e) {
      rejected.push({ path: filePath, reason: e instanceof Error ? e.message : String(e) })
      return null
    }
  })
  return { files: resolved.filter((f): f is MediaFile => f !== null), rejected }
}
