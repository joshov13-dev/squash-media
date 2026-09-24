import { existsSync } from 'node:fs'
import { readdir, readFile, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_CONFIG, DEFAULT_OUTPUT, DEFAULT_VIDEO_CONFIG } from '@shared/presets'
import type { HardwareProfile, JobRequest, JobUpdate, OutputSettings, QueueStats } from '@shared/types'
import { CalibrationStore } from '../src/main/services/etaCalculator'
import { readImageInfo } from '../src/main/services/imageProcessor'
import { JobQueue } from '../src/main/services/jobQueue'
import { imageOutputExtension, planOutputPath, tempPathFor } from '../src/main/services/outputPaths'
import { probeVideo } from '../src/main/services/videoProcessor'
import { hasFfmpeg, makeTestVideo, tempDir } from './helpers'

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

function harness() {
  const updates: JobUpdate[] = []
  const stats: QueueStats[] = []
  const trashed: string[] = []
  const queue = new JobQueue({
    getHardware: async () => hardware,
    calibration: new CalibrationStore(),
    emitUpdate: (u) => updates.push(u),
    emitStats: (s) => stats.push(s),
    trash: async (p) => {
      trashed.push(p)
    },
  })
  const waitFor = async (ids: string[], timeoutMs = 60_000): Promise<Map<string, JobUpdate>> => {
    const done = new Map<string, JobUpdate>()
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      for (const u of updates) {
        if (ids.includes(u.jobId) && ['completed', 'skipped', 'failed', 'cancelled'].includes(u.status)) done.set(u.jobId, u)
      }
      if (done.size === ids.length) return done
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Timed out waiting for jobs')
  }
  return { queue, updates, stats, trashed, waitFor }
}

async function imageJob(path: string, id: string, output: OutputSettings, patch = {}): Promise<JobRequest> {
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

describe('output paths', () => {
  it('plans suffix, folder and overwrite outputs', () => {
    const src = join('/photos', 'cat.JPG')
    expect(planOutputPath(src, '.JPG', DEFAULT_OUTPUT).finalPath).toBe(join('/photos', 'cat_compressed.JPG'))
    expect(planOutputPath(src, '.webp', { ...DEFAULT_OUTPUT, mode: 'folder', folder: '/out' }).finalPath).toBe(join('/out', 'cat.webp'))
    expect(planOutputPath(src, '.JPG', { ...DEFAULT_OUTPUT, mode: 'folder', folder: '/photos' }).finalPath).toBe(join('/photos', 'cat_compressed.JPG'))
    expect(planOutputPath(src, '.webp', { ...DEFAULT_OUTPUT, mode: 'overwrite' })).toEqual({ finalPath: join('/photos', 'cat.webp'), replacesSource: true })
    expect(planOutputPath(src, '.JPG', { ...DEFAULT_OUTPUT, suffix: '  ' }).finalPath).toBe(join('/photos', 'cat_compressed.JPG'))
  })

  it('keeps the original extension spelling when the format is unchanged', () => {
    expect(imageOutputExtension('/a/b.jpeg', 'jpeg', 'jpeg')).toBe('.jpeg')
    expect(imageOutputExtension('/a/b.jpeg', 'jpeg', 'webp')).toBe('.webp')
    expect(imageOutputExtension('/a/b.bmp', 'bmp', 'png')).toBe('.png')
  })

  it('puts temp files next to the output', () => {
    expect(tempPathFor(join('/x', 'y.mp4'), 'abcdef123456')).toBe(join('/x', '.y.mp4.sqf-abcdef12.tmp'))
  })
})

const ffmpegAvailable = await hasFfmpeg()

describe('JobQueue', () => {
  it('compresses images, keeps timestamps and reports stats', async () => {
    const dir = await tempDir()
    const a = join(dir, 'a.jpg')
    const b = join(dir, 'b.png')
    await sharp({ create: { width: 900, height: 600, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 120, sigma: 50 } } })
      .jpeg({ quality: 98 })
      .toFile(a)
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } }).png({ compressionLevel: 0 }).toFile(b)
    const old = new Date('2020-01-02T03:04:05Z')
    await utimes(a, old, old)

    const { queue, stats, waitFor } = harness()
    await queue.enqueue([await imageJob(a, 'job-a', DEFAULT_OUTPUT), await imageJob(b, 'job-b', DEFAULT_OUTPUT, { format: 'webp' })])
    const done = await waitFor(['job-a', 'job-b'])

    const ua = done.get('job-a')!
    expect(ua.status).toBe('completed')
    expect(ua.outputPath).toBe(join(dir, 'a_compressed.jpg'))
    expect(ua.compressedSizeBytes).toBeLessThan((await stat(a)).size)
    expect((await stat(ua.outputPath!)).mtime.getTime()).toBe(old.getTime())
    expect(done.get('job-b')!.outputPath).toBe(join(dir, 'b_compressed.webp'))

    // No temp files left behind.
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    const last = stats.at(-1)!
    expect(last.active).toBe(false)
    expect(last.completed).toBe(2)
    expect(last.percent).toBe(100)
  })

  it('keeps the original when the result would be larger', async () => {
    const dir = await tempDir()
    const src = join(dir, 'tiny.jpg')
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg({ quality: 20 }).toFile(src)
    const outDir = join(dir, 'out')
    const { queue, waitFor } = harness()
    await queue.enqueue([await imageJob(src, 'j', { ...DEFAULT_OUTPUT, mode: 'folder', folder: outDir }, { quality: 100 })])
    const u = (await waitFor(['j'])).get('j')!
    expect(u.status).toBe('skipped')
    expect(u.note).toMatch(/Original kept/)
    // Folder mode still gets a copy so the destination is complete.
    expect(await readFile(join(outDir, 'tiny.jpg'))).toEqual(await readFile(src))
  })

  it('replaces the source in overwrite mode, recycling the original', async () => {
    const dir = await tempDir()
    const src = join(dir, 'photo.png')
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#123456' } }).png({ compressionLevel: 0 }).toFile(src)
    const { queue, trashed, waitFor } = harness()
    await queue.enqueue([await imageJob(src, 'o', { ...DEFAULT_OUTPUT, mode: 'overwrite' }, { format: 'webp' })])
    const u = (await waitFor(['o'])).get('o')!
    expect(u.status).toBe('completed')
    expect(trashed).toEqual([src])
    expect(u.outputPath).toBe(join(dir, 'photo.webp'))
    expect(existsSync(u.outputPath!)).toBe(true)
  })

  it('reports failures without stopping the queue', async () => {
    const dir = await tempDir()
    const good = join(dir, 'good.png')
    await sharp({ create: { width: 50, height: 50, channels: 3, background: '#ff0000' } }).png({ compressionLevel: 0 }).toFile(good)
    const bad = await imageJob(good, 'bad', DEFAULT_OUTPUT)
    bad.filePath = join(dir, 'missing.png')
    const { queue, waitFor } = harness()
    await queue.enqueue([bad, await imageJob(good, 'good', DEFAULT_OUTPUT)])
    const done = await waitFor(['bad', 'good'])
    expect(done.get('bad')!.status).toBe('failed')
    expect(done.get('bad')!.error).toBeTruthy()
    expect(done.get('good')!.status).toBe('completed')
  })

  it('keeps videos that are already under the target size', async () => {
    const dir = await tempDir()
    const src = join(dir, 'small.mp4')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toFile(src)
    const { queue, waitFor } = harness()
    await queue.enqueue([
      {
        id: 'small',
        filePath: src,
        type: 'video',
        sizeBytes: (await stat(src)).size,
        info: { kind: 'video', container: 'mov', durationSeconds: 5, width: 640, height: 360, fps: 30, totalFrames: 150, videoCodec: 'h264', pixelFormat: 'yuv420p', bitDepth: 8, bitrateKbps: 1, audioCodec: null, audioChannels: null, audioBitrateKbps: null, audioStreams: 0, subtitleStreams: 0 },
        videoConfig: { ...DEFAULT_VIDEO_CONFIG, rateControl: 'targetSize', targetMaxSizeBytes: 10 * 1024 * 1024 },
        output: DEFAULT_OUTPUT,
      },
    ])
    const u = (await waitFor(['small'])).get('small')!
    expect(u.status).toBe('skipped')
    expect(u.note).toBe('Already under the target size')
  })

  it.skipIf(!ffmpegAvailable)('runs video jobs with live progress and ETA', async () => {
    const dir = await tempDir()
    const src = join(dir, 'clip.mp4')
    await makeTestVideo(src, { seconds: 3 })
    const info = await probeVideo(src)
    const { queue, updates, waitFor } = harness()
    await queue.enqueue([
      {
        id: 'v',
        filePath: src,
        type: 'video',
        sizeBytes: (await stat(src)).size,
        info,
        videoConfig: { ...DEFAULT_VIDEO_CONFIG, container: 'mkv', crf: 30, preset: 'fast' },
        output: DEFAULT_OUTPUT,
      },
    ])
    const u = (await waitFor(['v'])).get('v')!
    expect(u.status).toBe('completed')
    expect(u.outputPath).toBe(join(dir, 'clip_compressed.mkv'))
    const progress = updates.filter((x) => x.jobId === 'v' && x.status === 'processing')
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.some((x) => x.progress.humanReadableEta !== '')).toBe(true)
  })
})

describe('output naming in a run', () => {
  it('numbers clashing names and keeps subfolders', async () => {
    const { uniquePath } = await import('../src/main/services/outputPaths')
    const taken = new Set([join('/o', 'a.webp'), join('/o', 'a (2).webp')])
    expect(uniquePath(join('/o', 'a.webp'), (p) => taken.has(p))).toBe(join('/o', 'a (3).webp'))
    expect(uniquePath(join('/o', 'b.webp'), (p) => taken.has(p))).toBe(join('/o', 'b.webp'))
    const plan = planOutputPath(join('/in', 'Trip', 'Day1', 'x.jpg'), '.jpg', { ...DEFAULT_OUTPUT, mode: 'folder', folder: '/out' }, join('Trip', 'Day1'))
    expect(plan.finalPath).toBe(join('/out', 'Trip', 'Day1', 'x.jpg'))
    const flat = planOutputPath(join('/in', 'Trip', 'Day1', 'x.jpg'), '.jpg', { ...DEFAULT_OUTPUT, mode: 'folder', folder: '/out', keepFolderStructure: false }, join('Trip', 'Day1'))
    expect(flat.finalPath).toBe(join('/out', 'x.jpg'))
  })

  it('never lets two files in one run overwrite each other', async () => {
    const dir = await tempDir()
    const png = join(dir, 'pic.png')
    const jpg = join(dir, 'pic.jpg')
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#335577' } }).png({ compressionLevel: 0 }).toFile(png)
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#775533' } }).jpeg({ quality: 100 }).toFile(jpg)
    const { queue, waitFor } = harness()
    await queue.enqueue([
      await imageJob(png, 'p', DEFAULT_OUTPUT, { format: 'webp' }),
      await imageJob(jpg, 'j', DEFAULT_OUTPUT, { format: 'webp' }),
    ])
    const done = await waitFor(['p', 'j'])
    const outputs = [done.get('p')!.outputPath, done.get('j')!.outputPath].sort()
    expect(outputs).toEqual([join(dir, 'pic_compressed (2).webp'), join(dir, 'pic_compressed.webp')])
  })

  it('explains failures in plain words', async () => {
    const { friendlyError } = await import('../src/main/services/friendlyErrors')
    expect(friendlyError(new Error("EBUSY: resource busy or locked, rename 'x'")).message).toMatch(/Another program/)
    expect(friendlyError(new Error('ENOSPC: no space left on device')).message).toMatch(/disk is full/)
    expect(friendlyError(new Error('OpenEncodeSessionEx failed: unsupported device (2)')).message).toMatch(/NVIDIA/)
    const odd = friendlyError(new Error('weird thing'))
    expect(odd.message).toContain('weird thing')
    expect(odd.detail).toBe('weird thing')
  })
})

describe('adding folders', () => {
  it('remembers where each file sat inside a dropped folder', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { resolveMedia } = await import('../src/main/services/mediaResolver')
    const dir = await tempDir()
    const trip = join(dir, 'Trip')
    await mkdir(join(trip, 'Day1'), { recursive: true })
    await mkdir(join(trip, 'node_modules'), { recursive: true })
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toFile(join(trip, 'top.jpg'))
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toFile(join(trip, 'Day1', 'a.jpg'))
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toFile(join(trip, 'node_modules', 'skip.jpg'))
    await writeFile(join(trip, 'code.ts'), 'export const x = 1\n')
    await writeFile(join(trip, 'notes.txt'), 'hello')

    const loose = join(dir, 'loose.jpg')
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toFile(loose)

    const { files, rejected } = await resolveMedia([trip, loose])
    const byName = Object.fromEntries(files.map((f) => [f.fileName, f.relativeDir]))
    expect(byName).toEqual({ 'a.jpg': join('Trip', 'Day1'), 'top.jpg': 'Trip', 'loose.jpg': undefined })
    expect(rejected).toEqual([])
  })
})
