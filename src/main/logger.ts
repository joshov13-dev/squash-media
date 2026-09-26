// A plain log file, shared by the app, the command line and the AI server,
// so a run can be handed back for debugging. No Electron import, so it works
// the same in all three. Written to <settings folder>/logs/.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { userDataFile } from './appPaths'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Old daily files past this are deleted. */
const RETENTION_DAYS = 14
/** Once today's file passes this, only warnings and errors are still written. */
const SIZE_CAP_BYTES = 10 * 1024 * 1024

let dir = () => userDataFile('logs')
let verbose = false
let writing: Promise<void> = Promise.resolve()
let cleanedDate = ''
let cappedDate = ''

/** Point logging at a different folder. Tests only. */
export function useLogsDir(path: string): void {
  dir = () => path
  cleanedDate = ''
  cappedDate = ''
}

/** Also write "debug" entries. Off by default, since they are usually only useful for a specific problem. */
export function setVerboseLogging(on: boolean): void {
  verbose = on
}

function today(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function logFilePath(date = today()): string {
  return join(dir(), `squashmedia-${date}.log`)
}

async function cleanup(): Promise<void> {
  const date = today()
  if (cleanedDate === date) return
  cleanedDate = date
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    for (const name of await readdir(dir())) {
      if (!/^squashmedia-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue
      const path = join(dir(), name)
      const s = await stat(path).catch(() => null)
      if (s && s.mtimeMs < cutoff) await rm(path, { force: true }).catch(() => undefined)
    }
  } catch {
    // Nothing to clean up yet, or the folder isn't readable; not fatal.
  }
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) return ''
  try {
    // Errors stringify to "{}" by default; pull out what matters.
    const replacer = (_k: string, v: unknown): unknown =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v
    return ` ${JSON.stringify(meta, replacer)}`
  } catch {
    return ` ${String(meta)}`
  }
}

/**
 * Write one line. Never throws: a logging problem should not break the
 * feature that triggered it. Debug entries are dropped unless verbose
 * logging is on; everything else always goes to the file, and warnings and
 * errors also go to the console so they show up when run from a terminal.
 */
export function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (level === 'debug' && !verbose) return
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}${formatMeta(meta)}\n`
  if (level === 'warn') console.warn(line.trimEnd())
  else if (level === 'error') console.error(line.trimEnd())
  writing = writing.then(async () => {
    try {
      await mkdir(dir(), { recursive: true })
      await cleanup()
      const path = logFilePath()
      if (level === 'debug' || level === 'info') {
        const date = today()
        if (cappedDate !== date) {
          const size = await stat(path).then((s) => s.size).catch(() => 0)
          if (size > SIZE_CAP_BYTES) cappedDate = date
        }
        if (cappedDate === date) return
      }
      await appendFile(path, line)
    } catch {
      // The settings folder may be unwritable (read-only install, full disk);
      // logging is a convenience, not something to fail the app over.
    }
  })
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown): void => log('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: unknown): void => log('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown): void => log('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown): void => log('error', scope, message, meta),
}

/** Wait for every write queued so far to land on disk. */
export function flushLogs(): Promise<void> {
  return writing
}

/** Every log file, oldest first. */
export async function listLogFiles(): Promise<string[]> {
  try {
    return (await readdir(dir()))
      .filter((n) => /^squashmedia-\d{4}-\d{2}-\d{2}\.log$/.test(n))
      .sort()
      .map((n) => join(dir(), n))
  } catch {
    return []
  }
}

/**
 * The tail of the log, most recent first file, trimmed to `maxChars`. Used
 * by "Copy the log" and the `logs` command, so a problem report doesn't need
 * someone to go hunting for the right file.
 */
export async function readRecentLog(maxChars = 300_000): Promise<string> {
  await flushLogs()
  const files = await listLogFiles()
  let text = ''
  for (let i = files.length - 1; i >= 0 && text.length < maxChars; i--) {
    if (!existsSync(files[i])) continue
    const chunk = await readFile(files[i], 'utf8').catch(() => '')
    text = text.length ? `${chunk}${text}` : chunk
  }
  return text.length > maxChars ? `[log truncated]\n${text.slice(-maxChars)}` : text
}

/** Something worth putting in every log, so a report says what it's about. */
export function logStartup(scope: string, info: Record<string, unknown>): void {
  logger.info(scope, 'SquashMedia started', info)
}

// Node exits on both of these by default when nothing is listening. Adding a
// listener turns that off, so to leave the crash-on-fatal-error behaviour as
// it was, log first and then exit the same way Node would have. Not under
// the test runner: several test files can share one worker process, and
// exiting it mid-suite over an unrelated test's rejection would take every
// other test down with it.
function fatal(scope: string, message: string, e: unknown): void {
  logger.error(scope, message, e)
  if (process.env.VITEST) return
  const exit = (): void => process.exit(1)
  const timer = setTimeout(exit, 2000)
  timer.unref()
  void flushLogs().then(exit, exit)
}
process.on('uncaughtException', (e) => fatal('process', 'Uncaught exception', e))
process.on('unhandledRejection', (e) => fatal('process', 'Unhandled promise rejection', e))
