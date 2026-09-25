// A record of every file SquashForge has written, shared by the app, the
// command line and the AI server, so any run can be undone later.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { HistoryEntry, HistoryRun, RunOrigin, UndoResult } from '@shared/types'
import { findInTrash, putBack, type TrashHit, type TrashedOriginal } from '../trash'

/** Oldest runs are dropped past this. */
const MAX_RUNS = 300

export interface HistoryDeps {
  /** Send a file to the bin. */
  trash: (path: string) => Promise<void>
  findInTrash?: (original: TrashedOriginal) => Promise<TrashHit | null>
  /** What the bin is called here, for messages. */
  binName?: string
}

export class HistoryStore {
  private runs: HistoryRun[] | null = null
  /** Runs this process changed and has not saved yet. */
  private dirty = new Set<string>()
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string | null,
    private readonly deps: HistoryDeps,
  ) {}

  private get bin(): string {
    return this.deps.binName ?? (process.platform === 'win32' ? 'Recycle Bin' : 'Trash')
  }

  private async readDisk(): Promise<HistoryRun[]> {
    if (!this.file) return []
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { runs?: HistoryRun[] }
      return Array.isArray(parsed.runs) ? parsed.runs : []
    } catch {
      return []
    }
  }

  private async load(): Promise<HistoryRun[]> {
    if (!this.runs) this.runs = await this.readDisk()
    return this.runs
  }

  /** Newest first. Re-reads the file so runs from the command line show up. */
  async list(limit = 50): Promise<HistoryRun[]> {
    await this.saving
    const disk = await this.readDisk()
    const mine = this.runs ?? []
    const merged = new Map(disk.map((r) => [r.id, r]))
    for (const r of mine) if (this.dirty.has(r.id) || !merged.has(r.id)) merged.set(r.id, r)
    this.runs = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt)
    return this.runs.slice(0, limit)
  }

  async record(runId: string, origin: RunOrigin, startedAt: number, entry: HistoryEntry): Promise<void> {
    const runs = await this.load()
    let run = runs.find((r) => r.id === runId)
    if (!run) {
      run = { id: runId, origin, startedAt, finishedAt: entry.finishedAt, entries: [] }
      runs.unshift(run)
    }
    run.entries.push(entry)
    run.finishedAt = Math.max(run.finishedAt, entry.finishedAt)
    this.touch(run.id)
  }

  async undoRun(runId: string): Promise<UndoResult[]> {
    const run = (await this.list(MAX_RUNS)).find((r) => r.id === runId)
    if (!run) return [{ ok: false, message: 'That run is no longer in the history' }]
    const results: UndoResult[] = []
    for (const entry of run.entries) if (!entry.undone) results.push(await this.undoOne(run, entry))
    return results
  }

  async undoEntry(runId: string, jobId: string): Promise<UndoResult> {
    const run = (await this.list(MAX_RUNS)).find((r) => r.id === runId)
    const entry = run?.entries.find((e) => e.jobId === jobId)
    if (!run || !entry) return { ok: false, message: 'That file is no longer in the history' }
    if (entry.undone) return { ok: true, jobId, message: 'Already undone' }
    return this.undoOne(run, entry)
  }

  private async undoOne(run: HistoryRun, entry: HistoryEntry): Promise<UndoResult> {
    const name = basename(entry.source)
    const done = (message: string): UndoResult => {
      entry.undone = true
      this.touch(run.id)
      return { ok: true, jobId: entry.jobId, message }
    }
    try {
      if (!entry.replaced) {
        if (existsSync(entry.output)) await this.deps.trash(entry.output)
        return done(`Moved ${basename(entry.output)} to the ${this.bin}`)
      }
      // Find the original before touching anything, so a miss changes nothing.
      const find = this.deps.findInTrash ?? findInTrash
      const original = await find({ path: entry.source, size: entry.originalBytes, mtimeMs: entry.sourceMtimeMs, trashedAt: entry.finishedAt })
      if (!original) {
        return { ok: false, jobId: entry.jobId, message: `${name} is no longer in the ${this.bin}, so it cannot be put back` }
      }
      if (existsSync(entry.output)) await this.deps.trash(entry.output)
      try {
        await putBack(original, entry.source)
      } catch (e) {
        // Put the compressed copy back rather than leave neither in place.
        const output = await find({ path: entry.output, size: entry.outputBytes, mtimeMs: Date.now(), trashedAt: Date.now() }).catch(() => null)
        if (output) await putBack(output, entry.output).catch(() => undefined)
        throw e
      }
      return done(`Put ${name} back`)
    } catch (e) {
      return { ok: false, jobId: entry.jobId, message: `Could not undo ${name}: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  private touch(runId: string): void {
    this.dirty.add(runId)
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, 300)
  }

  /** Write now. Merges with the file so other processes' runs are kept. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.file || !this.dirty.size) return
    const file = this.file
    const write = async (): Promise<void> => {
      const mine = new Map((this.runs ?? []).filter((r) => this.dirty.has(r.id)).map((r) => [r.id, r]))
      this.dirty.clear()
      const disk = await this.readDisk()
      const merged = [...disk.filter((r) => !mine.has(r.id)), ...mine.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_RUNS)
      await mkdir(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify({ version: 1, runs: merged }))
      await rename(temp, file)
    }
    this.saving = this.saving.then(write, write)
    await this.saving
  }
}
