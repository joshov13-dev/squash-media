import { basename, dirname, extname, join, resolve } from 'node:path'
import { CONTAINER_EXTENSIONS, IMAGE_FORMAT_EXTENSIONS, type ResolvedImageFormat } from '@shared/codecs'
import type { ImageSourceFormat, OutputSettings, VideoContainer } from '@shared/types'

export interface OutputPlan {
  finalPath: string
  /** The output takes the source's place (overwrite mode). */
  replacesSource: boolean
}

export function samePath(a: string, b: string, platform = process.platform): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return platform === 'win32' || platform === 'darwin' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

/** Keep the source's own extension (".jpeg", ".JPG") when the format does not change. */
export function imageOutputExtension(sourcePath: string, source: ImageSourceFormat, output: ResolvedImageFormat): string {
  if (source === output) return extname(sourcePath) || IMAGE_FORMAT_EXTENSIONS[output]
  return IMAGE_FORMAT_EXTENSIONS[output]
}

export function videoOutputExtension(container: VideoContainer): string {
  return CONTAINER_EXTENSIONS[container]
}

export function planOutputPath(sourcePath: string, outputExt: string, settings: OutputSettings, relativeDir?: string): OutputPlan {
  const dir = dirname(sourcePath)
  const base = basename(sourcePath, extname(sourcePath))
  const suffix = settings.suffix.trim() || '_compressed'

  if (settings.mode === 'overwrite') {
    return { finalPath: join(dir, base + outputExt), replacesSource: true }
  }
  if (settings.mode === 'folder' && settings.folder) {
    // Recreate the dropped folder's layout so same-named files cannot collide.
    const folder = settings.keepFolderStructure && relativeDir ? join(settings.folder, relativeDir) : settings.folder
    let finalPath = join(folder, base + outputExt)
    if (samePath(finalPath, sourcePath)) finalPath = join(folder, base + suffix + outputExt)
    return { finalPath, replacesSource: false }
  }
  return { finalPath: join(dir, base + suffix + outputExt), replacesSource: false }
}

/**
 * "photo.webp" -> "photo (2).webp" until `taken` says the name is free.
 * Stops two files in one run (say photo.png and photo.jpg, both saved as
 * WebP) from writing over each other.
 */
export function uniquePath(path: string, taken: (candidate: string) => boolean): string {
  if (!taken(path)) return path
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!taken(candidate)) return candidate
  }
}

/** Hidden temp file next to the final output so the last step is a same-volume rename. */
export function tempPathFor(finalPath: string, jobId: string): string {
  return join(dirname(finalPath), `.${basename(finalPath)}.sqf-${jobId.slice(0, 8)}.tmp`)
}
