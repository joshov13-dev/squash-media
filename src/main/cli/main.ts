// The commands behind squashforge compress / inspect / info / history / undo / mcp.
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { formatBytes, formatDuration } from '@shared/format'
import { GOALS } from '@shared/presets'
import type { JobUpdate } from '@shared/types'
import { Engine, type BatchStatus } from '../automation/engine'
import {
  goalShortName,
  OptionError,
  resolveOptions,
  type CompressOptions,
  type OutputOptions,
  type PhotoOptions,
  type VideoOptions,
} from '../automation/options'
import { serveStdio } from '../mcp/server'

const HELP = `SquashForge ${__APP_VERSION__}: compress photos and videos

Usage:
  squashforge compress <files or folders...> [options]
  squashforge inspect <files or folders...>     Show sizes, resolutions and durations
  squashforge info                              This computer's CPU, graphics card and goals
  squashforge history [--limit 10]              Recent runs
  squashforge undo <run id>                     Undo a run (copies to the bin, originals back)
  squashforge mcp                               Run the MCP server for AI apps (stdio)

Compress options:
  -g, --goal <goal>         ${GOALS.map(goalShortName).join(', ')} (default: smaller)
  -o, --out <folder>        Save copies in this folder, keeping subfolders
      --replace             Replace the originals (they go to the Recycle Bin/Trash)
  -n, --name <pattern>      Name pattern, default "{name}_compressed"
                            Tokens: {name} {folder} {date} {modified} {n} {format}
  -t, --target <size>       Largest size for each file, e.g. 500KB or 10MB

  Photos:
      --format <fmt>        original, jpeg, png, webp or avif
  -q, --quality <1-100>     Photo quality
      --max-size <px>       Longest side in pixels
      --lossless            Keep every pixel
      --keep-metadata       Keep EXIF (camera, date, location)

  Videos:
      --codec <codec>       h264, hevc, av1 or vp9
      --crf <n>             Constant quality: lower is better and bigger
      --resolution <res>    2160p, 1440p, 1080p, 720p or 480p
      --fps <n>             Cap the frame rate
      --encoder <enc>       auto (graphics card when possible), cpu, nvenc, qsv or amf
      --no-audio            Drop the sound

  Other:
      --keep-larger         Keep the compressed copy even when it is bigger
      --dry-run             Show what would happen without writing anything
      --json                Print the result as JSON (progress goes to stderr)
      --quiet               No progress output

Examples:
  squashforge compress "C:\\Users\\Sam\\Pictures\\Holiday"
  squashforge compress clip.mov --goal discord
  squashforge compress ~/Videos --resolution 1080p --out ~/Videos/small
  squashforge compress *.png --format webp --quality 80
`

class UsageError extends Error {}

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function err(line = ''): void {
  process.stderr.write(`${line}\n`)
}

function absolute(paths: string[]): string[] {
  return paths.map((p) => (isAbsolute(p) ? p : resolve(process.cwd(), p)))
}

function compressOptions(v: Record<string, string | boolean | undefined>): CompressOptions {
  const num = (key: string): number | undefined => {
    const raw = v[key]
    if (raw === undefined) return undefined
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new UsageError(`--${key} needs a number`)
    return n
  }
  if (v.replace && v.out) throw new UsageError('Use either --out or --replace, not both')
  const output: OutputOptions = {
    mode: v.replace ? 'replace' : v.out ? 'folder' : 'same-folder',
    folder: v.out ? resolve(String(v.out)) : undefined,
    name_pattern: v.name as string | undefined,
    keep_original_if_larger: v['keep-larger'] ? false : undefined,
  }
  return {
    goal: v.goal as string | undefined,
    photo: {
      format: v.format as PhotoOptions['format'],
      quality: num('quality'),
      max_dimension: num('max-size'),
      target_size: v.target as string | undefined,
      lossless: v.lossless ? true : undefined,
      keep_metadata: v['keep-metadata'] ? true : undefined,
    },
    video: {
      codec: v.codec as VideoOptions['codec'],
      quality: num('crf'),
      resolution: v.resolution as VideoOptions['resolution'],
      max_fps: num('fps'),
      audio: v['no-audio'] ? 'none' : undefined,
      encoder: v.encoder as VideoOptions['encoder'],
      target_size: v.target as string | undefined,
    },
    output,
  }
}

/** One line that rewrites itself in a terminal, or a line per file otherwise. */
function progressReporter(engine: Engine, quiet: boolean): () => void {
  if (quiet) return () => undefined
  const tty = process.stderr.isTTY
  let last = ''
  let timer: NodeJS.Timeout | null = null
  const off = engine.onUpdate((u: JobUpdate) => {
    if (tty) return
    const name = engine.jobPath(u.jobId)
    if (!name) return
    if (u.status === 'completed') err(`done    ${name} -> ${formatBytes(u.compressedSizeBytes ?? 0)}`)
    if (u.status === 'skipped') err(`kept    ${name}${u.note ? ` (${u.note})` : ''}`)
    if (u.status === 'failed') err(`failed  ${name}: ${u.error}`)
  })
  if (tty) {
    timer = setInterval(() => {
      const ids = engine.batchIds()
      const s = ids.length ? engine.status(ids[ids.length - 1]) : null
      if (!s) return
      const running = s.files.find((f) => f.status === 'processing')
      const name = running ? running.path.split(/[\\/]/).pop() : ''
      const line = `[${s.completed + s.skipped + s.failed}/${s.total}] ${Math.floor(s.percent)}%${s.eta ? ` · ${s.eta} left` : ''}${name ? ` · ${name}` : ''}`
      const cols = process.stderr.columns || 100
      const shown = line.length > cols - 1 ? `${line.slice(0, cols - 4)}...` : line
      if (shown !== last) process.stderr.write(`\r\x1b[2K${shown}`)
      last = shown
    }, 250)
  }
  return () => {
    off()
    if (timer) clearInterval(timer)
    if (tty && last) process.stderr.write('\r\x1b[2K')
  }
}

function printSummary(s: BatchStatus): void {
  for (const f of s.files) {
    const name = f.path
    if (f.status === 'completed') out(`${name}\n  -> ${f.output} (${formatBytes(f.before_bytes)} -> ${formatBytes(f.after_bytes ?? 0)})`)
    else if (f.status === 'skipped') out(`${name}\n  kept: ${f.note ?? 'nothing to gain'}`)
    else if (f.status === 'failed') out(`${name}\n  FAILED: ${f.error}`)
    else if (f.status === 'cancelled') out(`${name}\n  cancelled`)
  }
  out()
  out(
    `${s.completed + s.skipped} of ${s.total} done${s.failed ? `, ${s.failed} failed` : ''}. Saved ${s.saved} in ${formatDuration(s.elapsed_seconds)}.`,
  )
}

async function compress(paths: string[], values: Record<string, string | boolean | undefined>): Promise<number> {
  if (!paths.length) throw new UsageError('Give at least one file or folder to compress')
  const options = resolveOptions(compressOptions(values))
  const engine = new Engine('cli')
  const json = Boolean(values.json)
  const { files, rejected } = await engine.inspect(absolute(paths))
  for (const r of rejected) err(`skipped ${r.path}: ${r.reason}`)
  if (!files.length) {
    err('No photos or videos found.')
    return 1
  }
  if (values['dry-run']) {
    const plan = await engine.plan(files, options)
    if (json) out(JSON.stringify({ goal: goalShortName(options.goal), ...plan }, null, 2))
    else {
      for (const f of plan.files) out(`${f.path}\n  -> ${f.output}${f.replaces_original ? ' (replaces the original)' : ''}`)
      out(`\n${plan.files.length} files, goal "${options.goal.name}", about ${plan.estimate || 'a moment'}. Nothing was written (dry run).`)
    }
    return 0
  }

  let stopping = false
  const onSignal = (): void => {
    if (stopping) process.exit(130)
    stopping = true
    err('\nStopping... (press Ctrl+C again to quit at once)')
    for (const id of engine.batchIds()) engine.cancel(id)
  }
  process.on('SIGINT', onSignal)

  if (!values.quiet && !json) err(`Compressing ${files.length} ${files.length === 1 ? 'file' : 'files'} with "${options.goal.name}"...`)
  const stop = progressReporter(engine, Boolean(values.quiet))
  const batchId = await engine.start(files, options)
  let status = engine.status(batchId)!
  while (status.state === 'running') status = (await engine.wait(batchId, 60_000))!
  stop()
  await engine.history.flush()
  if (json) out(JSON.stringify(status, null, 2))
  else printSummary(status)
  return status.failed ? 1 : stopping ? 130 : 0
}

async function inspect(paths: string[], json: boolean): Promise<number> {
  if (!paths.length) throw new UsageError('Give at least one file or folder')
  const engine = new Engine('cli')
  const { files, rejected } = await engine.inspect(absolute(paths))
  if (json) {
    out(JSON.stringify({ files, rejected }, null, 2))
    return 0
  }
  for (const f of files) {
    const i = f.info
    const detail =
      i.kind === 'image'
        ? `${i.width}x${i.height} ${i.format}`
        : `${i.width}x${i.height} ${i.videoCodec} ${Math.round(i.fps)}fps ${formatDuration(i.durationSeconds)}${i.audioCodec ? ` ${i.audioCodec}` : ''}`
    out(`${formatBytes(f.sizeBytes).padStart(9)}  ${detail.padEnd(36)} ${f.filePath}`)
  }
  for (const r of rejected) err(`skipped ${r.path}: ${r.reason}`)
  const total = files.reduce((n, f) => n + f.sizeBytes, 0)
  out(`\n${files.length} files, ${formatBytes(total)}`)
  return 0
}

async function info(json: boolean): Promise<number> {
  const engine = new Engine('cli')
  const hw = await engine.hardware()
  if (json) {
    out(JSON.stringify({ version: __APP_VERSION__, hardware: hw, goals: GOALS.map((g) => ({ goal: goalShortName(g), name: g.name, description: g.description })) }, null, 2))
    return 0
  }
  out(`SquashForge ${__APP_VERSION__}`)
  out(`CPU:       ${hw.cpuModel} (${hw.logicalCores} threads)`)
  out(`Graphics:  ${hw.gpus.map((g) => g.model).join(', ') || 'none found'}`)
  out(`GPU video: ${hw.availableGpuEncoders.join(', ') || 'none, videos use the CPU'}`)
  out(`FFmpeg:    ${hw.ffmpegAvailable ? hw.ffmpegVersion : 'missing'}`)
  out('\nGoals (--goal):')
  for (const g of GOALS) out(`  ${goalShortName(g).padEnd(10)} ${g.description}`)
  return 0
}

async function history(limit: number, json: boolean): Promise<number> {
  const engine = new Engine('cli')
  const runs = await engine.history.list(limit)
  if (json) {
    out(JSON.stringify(runs, null, 2))
    return 0
  }
  if (!runs.length) out('No history yet.')
  for (const r of runs) {
    const live = r.entries.filter((e) => !e.undone)
    const saved = live.reduce((n, e) => n + e.originalBytes - e.outputBytes, 0)
    out(`${r.id}  ${new Date(r.startedAt).toLocaleString()}  ${r.origin.padEnd(5)} ${r.entries.length} files, saved ${formatBytes(Math.max(0, saved))}${live.length < r.entries.length ? ' (some undone)' : ''}`)
  }
  return 0
}

async function undo(runId: string | undefined): Promise<number> {
  if (!runId) throw new UsageError('Give the run id from "squashforge history"')
  const engine = new Engine('cli')
  const results = await engine.history.undoRun(runId)
  await engine.history.flush()
  for (const r of results) (r.ok ? out : err)(r.message)
  return results.every((r) => r.ok) ? 0 : 1
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      goal: { type: 'string', short: 'g' },
      out: { type: 'string', short: 'o' },
      replace: { type: 'boolean' },
      name: { type: 'string', short: 'n' },
      target: { type: 'string', short: 't' },
      format: { type: 'string' },
      quality: { type: 'string', short: 'q' },
      'max-size': { type: 'string' },
      lossless: { type: 'boolean' },
      'keep-metadata': { type: 'boolean' },
      codec: { type: 'string' },
      crf: { type: 'string' },
      resolution: { type: 'string' },
      fps: { type: 'string' },
      encoder: { type: 'string' },
      'no-audio': { type: 'boolean' },
      'keep-larger': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      quiet: { type: 'boolean' },
      limit: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  const [command, ...rest] = positionals
  if (values.version) {
    out(__APP_VERSION__)
    return 0
  }
  if (values.help || !command || command === 'help') {
    out(HELP)
    return 0
  }
  const json = Boolean(values.json)
  switch (command) {
    case 'compress':
      return compress(rest, values)
    case 'inspect':
      return inspect(rest, json)
    case 'info':
      return info(json)
    case 'history':
      return history(Number(values.limit ?? 10) || 10, json)
    case 'undo':
      return undo(rest[0])
    case 'mcp':
      await serveStdio(new Engine('ai'))
      return 0
    default:
      throw new UsageError(`Unknown command "${command}". Try "squashforge help".`)
  }
}

export function run(argv: string[]): void {
  main(argv).then(
    (code) => process.exit(code),
    (e) => {
      if (e instanceof UsageError || e instanceof OptionError || (e as NodeJS.ErrnoException).code?.startsWith?.('ERR_PARSE_ARGS')) {
        err(e.message)
        err('Try "squashforge help".')
        process.exit(2)
      }
      err(e instanceof Error ? (e.stack ?? e.message) : String(e))
      process.exit(1)
    },
  )
}
