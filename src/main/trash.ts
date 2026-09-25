// Moving files to the Recycle Bin / Trash, and finding them there again so
// History can undo a Replace. Works without Electron, for the command line.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'
import { runProcess } from './utils/process'

// ---------------------------------------------------------------------------
// Moving to the bin
// ---------------------------------------------------------------------------

/** Send a file to the bin without Electron's shell module. */
export async function moveToTrash(path: string): Promise<void> {
  if (process.platform === 'win32') {
    // The path goes in through the environment, so no quoting can break it.
    const script =
      "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:SQF_TRASH_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')"
    const { code, stderr } = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, SQF_TRASH_PATH: path },
      timeoutMs: 60_000,
    })
    if (code !== 0 || existsSync(path)) throw new Error(`Could not move ${basename(path)} to the Recycle Bin: ${stderr.trim()}`)
    return
  }
  if (process.platform === 'darwin') {
    try {
      await rename(path, await freeName(join(os.homedir(), '.Trash'), basename(path)))
      return
    } catch {
      // Another disk: ask Finder, which knows that disk's own .Trashes.
      const { code, stderr } = await runProcess('osascript', [
        '-e',
        'on run argv',
        '-e',
        'tell application "Finder" to delete (POSIX file (item 1 of argv))',
        '-e',
        'end run',
        path,
      ])
      if (code !== 0) throw new Error(`Could not move ${basename(path)} to the Trash: ${stderr.trim()}`)
      return
    }
  }
  await freedesktopTrash(path)
}

async function freeName(folder: string, name: string): Promise<string> {
  const { name: stem, ext } = parse(name)
  let candidate = join(folder, name)
  for (let i = 2; existsSync(candidate); i++) candidate = join(folder, `${stem} ${i}${ext}`)
  return candidate
}

function freedesktopHome(): string {
  return join(process.env.XDG_DATA_HOME || join(os.homedir(), '.local', 'share'), 'Trash')
}

async function freedesktopTrash(path: string): Promise<void> {
  const trash = freedesktopHome()
  await mkdir(join(trash, 'files'), { recursive: true })
  await mkdir(join(trash, 'info'), { recursive: true })
  const target = await freeName(join(trash, 'files'), basename(path))
  const name = basename(target)
  const info = `[Trash Info]\nPath=${encodeURI(resolve(path))}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`
  await writeFile(join(trash, 'info', `${name}.trashinfo`), info)
  try {
    await rename(path, target)
  } catch (e) {
    await rm(join(trash, 'info', `${name}.trashinfo`), { force: true })
    // A different disk has its own trash; gio knows where.
    const { code } = await runProcess('gio', ['trash', path]).catch(() => ({ code: 1 }))
    if (code !== 0) throw e
  }
}

// ---------------------------------------------------------------------------
// Finding a file in the bin again
// ---------------------------------------------------------------------------

/** What was known about a file when it was sent to the bin. */
export interface TrashedOriginal {
  /** Where the file used to be. */
  path: string
  size: number
  mtimeMs: number
  /** When it was sent to the bin (ms since 1970). */
  trashedAt: number
}

/** A file found in the bin, and how to put it back. */
export interface TrashHit {
  /** The file's current location inside the bin. */
  location: string
  /** Bookkeeping files to remove once it is back. */
  cleanup: string[]
}

export interface TrashSearchOptions {
  /** Override where to look, for tests. */
  roots?: string[]
  platform?: NodeJS.Platform
}

const sameWinPath = (a: string, b: string): boolean => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

/**
 * Parse a Windows Recycle Bin "$I" file: the original path, size and time.
 * Version 1 (Vista, 7) stores a fixed 260-character path; version 2 (8 and
 * later) stores its length first.
 */
export function parseRecycleInfo(buf: Buffer): { path: string; size: number; deletedAt: number } | null {
  if (buf.length < 24) return null
  const version = Number(buf.readBigUInt64LE(0))
  const size = Number(buf.readBigUInt64LE(8))
  // FILETIME: 100 ns ticks since 1601.
  const deletedAt = Number(buf.readBigUInt64LE(16) / 10000n) - 11644473600000
  let path = ''
  if (version === 2 && buf.length >= 28) {
    const chars = buf.readUInt32LE(24)
    path = buf.toString('utf16le', 28, Math.min(buf.length, 28 + chars * 2))
  } else if (version === 1) {
    path = buf.toString('utf16le', 24, Math.min(buf.length, 24 + 520))
  } else {
    return null
  }
  path = path.replace(/\0.*$/s, '')
  return path ? { path, size, deletedAt } : null
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

async function findWindows(original: TrashedOriginal, roots?: string[]): Promise<TrashHit | null> {
  const drive = parse(resolve(original.path)).root
  // Each user has a folder named after their SID; only our own is readable.
  const bins = roots ?? (await listDirs(join(drive, '$Recycle.Bin')))
  let best: { hit: TrashHit; deletedAt: number } | null = null
  for (const bin of bins) {
    let names: string[] = []
    try {
      names = await readdir(bin)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.startsWith('$I')) continue
      const info = parseRecycleInfo(await readFile(join(bin, name)).catch(() => Buffer.alloc(0)))
      if (!info || !sameWinPath(info.path, original.path)) continue
      const data = join(bin, '$R' + name.slice(2))
      if (!existsSync(data)) continue
      // The newest match is the one this run sent there.
      if (!best || info.deletedAt > best.deletedAt) best = { hit: { location: data, cleanup: [join(bin, name)] }, deletedAt: info.deletedAt }
    }
  }
  return best?.hit ?? null
}

async function findFreedesktop(original: TrashedOriginal, roots?: string[]): Promise<TrashHit | null> {
  const bins = roots ?? [freedesktopHome()]
  const want = resolve(original.path)
  let best: { hit: TrashHit; deletedAt: number } | null = null
  for (const bin of bins) {
    let infos: string[] = []
    try {
      infos = (await readdir(join(bin, 'info'))).filter((n) => n.endsWith('.trashinfo'))
    } catch {
      continue
    }
    for (const name of infos) {
      const text = await readFile(join(bin, 'info', name), 'utf8').catch(() => '')
      const pathLine = /^Path=(.*)$/m.exec(text)?.[1]
      if (!pathLine) continue
      let path = pathLine
      try {
        path = decodeURIComponent(pathLine)
      } catch {
        // Leave it as written.
      }
      if (resolve(path) !== want) continue
      const data = join(bin, 'files', name.slice(0, -'.trashinfo'.length))
      if (!existsSync(data)) continue
      const deletedAt = Date.parse(/^DeletionDate=(.*)$/m.exec(text)?.[1] ?? '') || 0
      if (!best || deletedAt > best.deletedAt) best = { hit: { location: data, cleanup: [join(bin, 'info', name)] }, deletedAt }
    }
  }
  return best?.hit ?? null
}

/**
 * macOS keeps no "put back" record we can read, so match on size and the
 * modified date (which a move to the Trash keeps), preferring the same name.
 */
async function findMac(original: TrashedOriginal, roots?: string[]): Promise<TrashHit | null> {
  const bins = roots ?? [join(os.homedir(), '.Trash')]
  const stem = basename(original.path, extname(original.path)).toLowerCase()
  let best: { hit: TrashHit; score: number } | null = null
  for (const bin of bins) {
    let names: string[] = []
    try {
      names = await readdir(bin)
    } catch {
      continue
    }
    for (const name of names) {
      const s = await stat(join(bin, name)).catch(() => null)
      if (!s?.isFile() || s.size !== original.size || Math.abs(s.mtimeMs - original.mtimeMs) > 2000) continue
      const score = (name.toLowerCase().startsWith(stem) ? 2 : 0) + (extname(name).toLowerCase() === extname(original.path).toLowerCase() ? 1 : 0)
      if (!best || score > best.score) best = { hit: { location: join(bin, name), cleanup: [] }, score }
    }
  }
  return best?.hit ?? null
}

/** Look for a file in the bin. Null when it has been emptied or never went there. */
export async function findInTrash(original: TrashedOriginal, opts: TrashSearchOptions = {}): Promise<TrashHit | null> {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return findWindows(original, opts.roots)
  if (platform === 'darwin') return findMac(original, opts.roots)
  return findFreedesktop(original, opts.roots)
}

/** Move a file found in the bin back to where it was. */
export async function putBack(hit: TrashHit, to: string): Promise<void> {
  if (existsSync(to)) throw new Error(`${basename(to)} already exists`)
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(hit.location, to)
  } catch (e) {
    // The bin can be on another disk from the destination folder (rare).
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    const { copyFile } = await import('node:fs/promises')
    const temp = join(dirname(to), `.${basename(to)}.sqf-${randomUUID().slice(0, 8)}.tmp`)
    await copyFile(hit.location, temp)
    await rename(temp, to)
    await rm(hit.location, { force: true })
  }
  for (const f of hit.cleanup) await rm(f, { force: true }).catch(() => undefined)
}
