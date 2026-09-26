import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_CONFIG, DEFAULT_OUTPUT, DEFAULT_PREFERENCES } from '@shared/presets'
import type { HardwareProfile, JobRequest, JobUpdate, OutputSettings } from '@shared/types'
import { CalibrationStore } from '../src/main/services/etaCalculator'
import { readImageInfo } from '../src/main/services/imageProcessor'
import { JobQueue } from '../src/main/services/jobQueue'
import { tempDir } from './helpers'

// Existing files that are not the job's own source must never be written over.

const hardware: HardwareProfile = {
  cpuModel: 'Test CPU',
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
  ffmpegVersion: 'test',
  ffmpegAvailable: true,
}

async function run(jobs: JobRequest[]): Promise<{ done: Map<string, JobUpdate>; trashed: string[] }> {
  const updates: JobUpdate[] = []
  const trashed: string[] = []
  const queue = new JobQueue({
    getHardware: async () => hardware,
    getPreferences: () => DEFAULT_PREFERENCES,
    calibration: new CalibrationStore(),
    emitUpdate: (u) => updates.push(u),
    emitStats: () => undefined,
    trash: async (p) => {
      trashed.push(p)
      const { rm } = await import('node:fs/promises')
      await rm(p)
    },
  })
  await queue.enqueue(jobs)
  const ids = jobs.map((j) => j.id)
  const done = new Map<string, JobUpdate>()
  const start = Date.now()
  while (done.size < ids.length) {
    if (Date.now() - start > 30_000) throw new Error('Timed out')
    for (const u of updates) if (ids.includes(u.jobId) && ['completed', 'skipped', 'failed', 'cancelled'].includes(u.status)) done.set(u.jobId, u)
    await new Promise((r) => setTimeout(r, 30))
  }
  return { done, trashed }
}

async function png(path: string, colour = '#336699'): Promise<void> {
  await sharp({ create: { width: 300, height: 200, channels: 3, background: colour } }).png({ compressionLevel: 0 }).toFile(path)
}

async function job(path: string, id: string, output: OutputSettings, patch = {}): Promise<JobRequest> {
  return {
    id,
    filePath: path,
    type: 'image',
    sizeBytes: (await stat(path)).size,
    info: await readImageInfo(path),
    imageConfig: { ...DEFAULT_IMAGE_CONFIG, ...patch },
    output,
  }
}

const MINE = Buffer.from('a file the user already had')

describe('never writing over files that are already there', () => {
  it('same folder: a name pattern that lands on another file gets a number instead', async () => {
    const dir = await tempDir()
    const src = join(dir, 'photo.png')
    await png(src)
    const theirs = join(dir, 'photo.webp')
    await writeFile(theirs, MINE)
    const { done } = await run([await job(src, 'a', { ...DEFAULT_OUTPUT, nameTemplate: '{name}' }, { format: 'webp' })])
    const u = done.get('a')!
    expect(u.status).toBe('completed')
    expect(u.outputPath).toBe(join(dir, 'photo (2).webp'))
    expect(await readFile(theirs)).toEqual(MINE)
  })

  it('other folder: a file of the same name in the destination is kept', async () => {
    const dir = await tempDir()
    const src = join(dir, 'in.png')
    await png(src)
    const out = join(dir, 'out')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(out)
    await writeFile(join(out, 'in.png'), MINE)
    const { done } = await run([await job(src, 'b', { ...DEFAULT_OUTPUT, mode: 'folder', folder: out })])
    expect(done.get('b')!.outputPath).toBe(join(out, 'in (2).png'))
    expect(await readFile(join(out, 'in.png'))).toEqual(MINE)
  })

  it('other folder: "original kept" copies do not replace a file already there', async () => {
    const dir = await tempDir()
    const src = join(dir, 'tiny.jpg')
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg({ quality: 20 }).toFile(src)
    const out = join(dir, 'out')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(out)
    await writeFile(join(out, 'tiny.jpg'), MINE)
    const { done } = await run([await job(src, 'c', { ...DEFAULT_OUTPUT, mode: 'folder', folder: out }, { quality: 100 })])
    const u = done.get('c')!
    expect(u.status).toBe('skipped')
    expect(await readFile(join(out, 'tiny.jpg'))).toEqual(MINE)
    expect(await readFile(u.outputPath!)).toEqual(await readFile(src))
  })

  it('replace: changing format never writes over a different file with the new name', async () => {
    const dir = await tempDir()
    const src = join(dir, 'pic.png')
    await png(src)
    const other = join(dir, 'pic.webp')
    await writeFile(other, MINE)
    const { done, trashed } = await run([await job(src, 'd', { ...DEFAULT_OUTPUT, mode: 'overwrite' }, { format: 'webp' })])
    const u = done.get('d')!
    expect(u.status).toBe('completed')
    expect(trashed).toEqual([src])
    expect(u.outputPath).toBe(join(dir, 'pic (2).webp'))
    expect(await readFile(other)).toEqual(MINE)
  })

  it('replace: same name and format still takes the original\'s place', async () => {
    const dir = await tempDir()
    const src = join(dir, 'same.png')
    await png(src)
    const { done, trashed } = await run([await job(src, 'e', { ...DEFAULT_OUTPUT, mode: 'overwrite' })])
    expect(done.get('e')!.outputPath).toBe(src)
    expect(trashed).toEqual([src])
  })
})
