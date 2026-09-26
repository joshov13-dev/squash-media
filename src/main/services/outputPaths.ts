import { basename, dirname, extname, join, resolve } from 'node:path'
import { CONTAINER_EXTENSIONS, IMAGE_FORMAT_EXTENSIONS, type ResolvedImageFormat } from '@shared/codecs'
import { DEFAULT_NAME_TEMPLATE, renderName } from '@shared/naming'
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

/** What the name template needs to know about the source. */
export interface NamingInput {
  modified?: Date
  /** 1-based position in the batch, for {n}. */
  index?: number
  now?: Date
}

export function planOutputPath(
  sourcePath: string,
  outputExt: string,
  settings: OutputSettings,
  relativeDir?: string,
  naming: NamingInput = {},
): OutputPlan {
  const dir = dirname(sourcePath)
  const base = basename(sourcePath, extname(sourcePath))
  const named = (template: string): string =>
    renderName(template, {
      name: base,
      folder: basename(dir),
      modified: naming.modified ?? new Date(),
      index: naming.index ?? 1,
      format: outputExt.replace(/^\./, '').toLowerCase(),
      now: naming.now,
    })
  const template = settings.nameTemplate?.trim() || DEFAULT_NAME_TEMPLATE
  // Never let a template land on the original in the same folder: that is
  // what Replace mode is for, and Replace sends the original to the bin first.
  const safe = (folder: string, name: string): string => {
    const candidate = join(folder, name + outputExt)
    if (!samePath(candidate, sourcePath)) return candidate
    const fallback = named(DEFAULT_NAME_TEMPLATE)
    return join(folder, (fallback === name ? name + '_compressed' : fallback) + outputExt)
  }

  if (settings.mode === 'overwrite') {
    return { finalPath: join(dir, base + outputExt), replacesSource: true }
  }
  if (settings.mode === 'folder' && settings.folder) {
    // Recreate the dropped folder's layout so same-named files cannot collide.
    const folder = settings.keepFolderStructure && relativeDir ? join(settings.folder, relativeDir) : settings.folder
    return { finalPath: safe(folder, settings.renameInFolder ? named(template) : base), replacesSource: false }
  }
  return { finalPath: safe(dir, named(template)), replacesSource: false }
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
  return join(dirname(finalPath), `.${basename(finalPath)}.sqm-${jobId.slice(0, 8)}.tmp`)
}
