import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_CONFIG, DEFAULT_OUTPUT, DEFAULT_PREFERENCES } from '@shared/presets'
import type { HardwareProfile, HistoryEntry, JobUpdate } from '@shared/types'
import { CalibrationStore } from '../src/main/services/etaCalculator'
import { HistoryStore } from '../src/main/services/history'
import { readImageInfo } from '../src/main/services/imageProcessor'
import { JobQueue } from '../src/main/services/jobQueue'
import { findInTrash, moveToTrash, parseRecycleInfo, putBack } from '../src/main/trash'
import { tempDir } from './helpers'

function recycleInfo(path: string, size: number, deletedAt: number, version = 2): Buffer {
  const name = Buffer.from(path + '\0', 'utf16le')
  const head = Buffer.alloc(version === 2 ? 28 : 24)
  head.writeBigUInt64LE(BigInt(version), 0)
  head.writeBigUInt64LE(BigInt(size), 8)
  head.writeBigUInt64LE((BigInt(deletedAt) + 11644473600000n) * 10000n, 16)
  if (version === 2) {
    head.writeUInt32LE(name.length / 2, 24)
    return Buffer.concat([head, name])
  }
  const fixed = Buffer.alloc(520)
  name.copy(fixed)
  return Buffer.concat([head, fixed])
}

describe('Recycle Bin records', () => {
  it('parses Windows 10 and Windows 7 $I files', () => {
    const when = Date.UTC(2026, 8, 24, 12, 0, 0)
    expect(parseRecycleInfo(recycleInfo('C:\\Photos\\cat.jpg', 1234, when))).toEqual({ path: 'C:\\Photos\\cat.jpg', size: 1234, deletedAt: when })
    expect(parseRecycleInfo(recycleInfo('D:\\a b\\ü.png', 9, when, 1))).toEqual({ path: 'D:\\a b\\ü.png', size: 9, deletedAt: when })
    expect(parseRecycleInfo(Buffer.alloc(5))).toBeNull()
  })

  it('finds the newest Windows match and puts it back', async () => {
    const dir = await tempDir()
    const bin = join(dir, 'S-1-5-21-test')
    await mkdir(bin)
    const target = join(dir, 'restored.jpg')
    const original = 'C:\\Photos\\Cat.JPG'
    await writeFile(join(bin, '$IOLD.jpg'), recycleInfo(original, 3, 1000))
    await writeFile(join(bin, '$ROLD.jpg'), 'old')
    await writeFile(join(bin, '$INEW.jpg'), recycleInfo('c:\\photos\\cat.jpg', 3, 2000))
    await writeFile(join(bin, '$RNEW.jpg'), 'new')
    await writeFile(join(bin, '$IOTHER.jpg'), recycleInfo('C:\\Photos\\dog.jpg', 3, 3000))
    await writeFile(join(bin, '$ROTHER.jpg'), 'dog')
    const hit = await findInTrash({ path: original, size: 3, mtimeMs: 0, trashedAt: 0 }, { platform: 'win32', roots: [bin] })
    expect(hit?.location).toBe(join(bin, '$RNEW.jpg'))
    await putBack(hit!, target)
    expect(await readFile(target, 'utf8')).toBe('new')
    expect(existsSync(join(bin, '$INEW.jpg'))).toBe(false)
  })

  it('matches macOS Trash entries on size and date', async () => {
    const dir = await tempDir()
    const mtime = new Date(2025, 1, 2, 3, 4, 5)
    const make = async (name: string, body: string): Promise<void> => {
      await writeFile(join(dir, name), body)
      await utimes(join(dir, name), mtime, mtime)
    }
    await make('holiday 10.22.01.jpg', 'abcd')
    await make('other.jpg', 'abcd')
    await make('holiday.jpg', 'abcdef')
    const hit = await findInTrash({ path: '/Users/me/holiday.jpg', size: 4, mtimeMs: mtime.getTime(), trashedAt: 0 }, { platform: 'darwin', roots: [dir] })
    expect(hit?.location).toBe(join(dir, 'holiday 10.22.01.jpg'))
  })
})

describe.skipIf(process.platform !== 'linux')('Trash on Linux', () => {
  let saved: string | undefined
  beforeAll(async () => {
    saved = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = await tempDir()
  })
  afterAll(() => {
    if (saved === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = saved
  })

  it('moves a file to the trash and back', async () => {
    const dir = await tempDir()
    const file = join(dir, 'odd name #1.txt')
    await writeFile(file, 'hello')
    const s = await stat(file)
    await moveToTrash(file)
    expect(existsSync(file)).toBe(false)
    const hit = await findInTrash({ path: file, size: s.size, mtimeMs: s.mtimeMs, trashedAt: Date.now() })
    expect(hit).not.toBeNull()
    await putBack(hit!, file)
    expect(await readFile(file, 'utf8')).toBe('hello')
  })

  const hardware: HardwareProfile = {
    cpuModel: 'Test',
    physicalCores: 4,
    logicalCores: 8,
    baseClockGHz: 3,
    boostClockGHz: 4,
    totalMemoryGB: 16,
    gpus: [],
    availableGpuEncoders: [],
    encoderSupport: { h264: ['cpu'], hevc: ['cpu'], av1: ['cpu'], vp9: ['cpu'] },
    performanceScore: 1,
    imageConcurrency: 2,
    ffmpegVersion: null,
    ffmpegAvailable: false,
  }

  async function run(output = DEFAULT_OUTPUT, file?: string) {
    const dir = await tempDir()
    const src = file ?? join(dir, 'photo.png')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7' } })
      .composite([{ input: Buffer.from('<svg width="400" height="300"><circle cx="200" cy="150" r="90" fill="#fff"/></svg>') }])
      .png()
      .toFile(src)
    const historyFile = join(dir, 'history.json')
    const history = new HistoryStore(historyFile, { trash: moveToTrash })
    const updates: JobUpdate[] = []
    const queue = new JobQueue({
      getHardware: async () => hardware,
      getPreferences: () => DEFAULT_PREFERENCES,
      calibration: new CalibrationStore(),
      emitUpdate: (u) => updates.push(u),
      emitStats: () => undefined,
      trash: moveToTrash,
      history,
    })
    const originalBytes = (await stat(src)).size
    await queue.enqueue([
      {
        id: 'job-1',
        origin: 'cli',
        filePath: src,
        type: 'image',
        sizeBytes: originalBytes,
        info: await readImageInfo(src),
        imageConfig: { ...DEFAULT_IMAGE_CONFIG, format: 'webp' },
        output,
      },
    ])
    for (let i = 0; i < 400 && !updates.some((u) => u.status === 'completed' || u.status === 'failed'); i++) await new Promise((r) => setTimeout(r, 25))
    await history.flush()
    return { src, dir, history, historyFile, originalBytes, done: updates.find((u) => u.status === 'completed')! }
  }

  it('records a run and undoes a normal copy', async () => {
    const { src, history, historyFile, done } = await run()
    expect(done.outputPath).toMatch(/photo_compressed\.webp$/)
    const runs = await new HistoryStore(historyFile, { trash: moveToTrash }).list()
    expect(runs).toHaveLength(1)
    expect(runs[0].origin).toBe('cli')
    const entry: HistoryEntry = runs[0].entries[0]
    expect(entry).toMatchObject({ source: src, output: done.outputPath, replaced: false })

    const results = await history.undoRun(runs[0].id)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(existsSync(done.outputPath!)).toBe(false)
    expect(existsSync(src)).toBe(true)
    await history.flush()
    const after = await new HistoryStore(historyFile, { trash: moveToTrash }).list()
    expect(after[0].entries[0].undone).toBe(true)
  })

  it('undoes Replace by putting the original back', async () => {
    const { src, history, originalBytes, done } = await run({ ...DEFAULT_OUTPUT, mode: 'overwrite' })
    expect(done.outputPath).toMatch(/photo\.webp$/)
    expect(existsSync(src)).toBe(false)
    const [runInfo] = await history.list()
    expect(runInfo.entries[0].replaced).toBe(true)
    const result = await history.undoEntry(runInfo.id, 'job-1')
    expect(result.ok).toBe(true)
    expect((await stat(src)).size).toBe(originalBytes)
    expect(existsSync(done.outputPath!)).toBe(false)
  })

  it('says so when the original has left the bin, and changes nothing', async () => {
    const { history, done } = await run({ ...DEFAULT_OUTPUT, mode: 'overwrite' })
    const [runInfo] = await history.list()
    const empty = new HistoryStore(null, { trash: moveToTrash, findInTrash: async () => null })
    await empty.record(runInfo.id, runInfo.origin, runInfo.startedAt, runInfo.entries[0])
    const result = await empty.undoEntry(runInfo.id, 'job-1')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no longer in the/)
    expect(existsSync(done.outputPath!)).toBe(true)
    await history.flush()
  })
})
