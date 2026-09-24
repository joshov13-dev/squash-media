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

export function planOutputPath(sourcePath: string, outputExt: string, settings: OutputSettings): OutputPlan {
  const dir = dirname(sourcePath)
  const base = basename(sourcePath, extname(sourcePath))
  const suffix = settings.suffix.trim() || '_compressed'

  if (settings.mode === 'overwrite') {
    return { finalPath: join(dir, base + outputExt), replacesSource: true }
  }
  if (settings.mode === 'folder' && settings.folder) {
    let finalPath = join(settings.folder, base + outputExt)
    if (samePath(finalPath, sourcePath)) finalPath = join(settings.folder, base + suffix + outputExt)
    return { finalPath, replacesSource: false }
  }
  return { finalPath: join(dir, base + suffix + outputExt), replacesSource: false }
}

/** Hidden temp file next to the final output so the last step is a same-volume rename. */
export function tempPathFor(finalPath: string, jobId: string): string {
  return join(dirname(finalPath), `.${basename(finalPath)}.sqf-${jobId.slice(0, 8)}.tmp`)
}
