import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_CONFIG, DEFAULT_OUTPUT, DEFAULT_PREFERENCES, DEFAULT_VIDEO_CONFIG } from '@shared/presets'
import type { HardwareProfile, JobUpdate } from '@shared/types'
import { tempDir } from './helpers'

// An FFmpeg that is there but broken (a bad download, a missing library).
// Video jobs must fail with a clear message and leave the rest of the queue alone.

const previous = process.env.SQUASHMEDIA_FFMPEG_DIR
afterAll(() => {
  if (previous === undefined) delete process.env.SQUASHMEDIA_FFMPEG_DIR
  else process.env.SQUASHMEDIA_FFMPEG_DIR = previous
})

describe.skipIf(process.platform === 'win32')('a broken FFmpeg', () => {
  it('fails the video job clearly and still finishes the photos', async () => {
    const bin = await tempDir('sqm-badff-')
    await mkdir(bin, { recursive: true })
    for (const name of ['ffmpeg', 'ffprobe']) {
      await writeFile(join(bin, name), '#!/bin/sh\necho "error while loading shared libraries: libfoo.so" >&2\nexit 127\n')
      await chmod(join(bin, name), 0o755)
    }
    process.env.SQUASHMEDIA_FFMPEG_DIR = bin
    const { JobQueue } = await import('../src/main/services/jobQueue')
    const { CalibrationStore } = await import('../src/main/services/etaCalculator')
    const { readImageInfo } = await import('../src/main/services/imageProcessor')

    const dir = await tempDir()
    const video = join(dir, 'clip.mp4')
    await writeFile(video, Buffer.alloc(4096, 1))
    const photo = join(dir, 'photo.png')
    await sharp({ create: { width: 200, height: 150, channels: 3, background: '#446688' } }).png({ compressionLevel: 0 }).toFile(photo)

    const hardware = {
      cpuModel: 'Test', physicalCores: 2, logicalCores: 4, baseClockGHz: 3, boostClockGHz: 3, totalMemoryGB: 8, gpus: [],
      availableGpuEncoders: [], encoderSupport: { h264: ['cpu'], hevc: ['cpu'], av1: ['cpu'], vp9: ['cpu'] },
      performanceScore: 1, imageConcurrency: 2, ffmpegVersion: 'test', ffmpegAvailable: true,
    } as HardwareProfile
    const updates: JobUpdate[] = []
    const queue = new JobQueue({
      getHardware: async () => hardware,
      getPreferences: () => DEFAULT_PREFERENCES,
      calibration: new CalibrationStore(),
      emitUpdate: (u) => updates.push(u),
      emitStats: () => undefined,
      trash: async () => undefined,
    })
    await queue.enqueue([
      {
        id: 'v',
        filePath: video,
        type: 'video',
        sizeBytes: (await stat(video)).size,
        info: { kind: 'video', container: 'mp4', durationSeconds: 5, width: 640, height: 360, fps: 30, totalFrames: 150, videoCodec: 'h264', pixelFormat: 'yuv420p', bitDepth: 8, bitrateKbps: 1000, audioCodec: null, audioChannels: null, audioBitrateKbps: null, audioStreams: 0, subtitleStreams: 0 },
        videoConfig: DEFAULT_VIDEO_CONFIG,
        output: DEFAULT_OUTPUT,
      },
      { id: 'p', filePath: photo, type: 'image', sizeBytes: (await stat(photo)).size, info: await readImageInfo(photo), imageConfig: DEFAULT_IMAGE_CONFIG, output: DEFAULT_OUTPUT },
    ])
    const finished = (id: string): JobUpdate | undefined => updates.find((u) => u.jobId === id && ['completed', 'failed', 'skipped', 'cancelled'].includes(u.status))
    const start = Date.now()
    while ((!finished('v') || !finished('p')) && Date.now() - start < 30_000) await new Promise((r) => setTimeout(r, 50))

    const v = finished('v')!
    expect(v.status).toBe('failed')
    expect(v.error).toBeTruthy()
    expect(v.error).toMatch(/is missing or damaged/)
    expect(finished('p')!.status).toBe('completed')
    // The original video is untouched and nothing half-written is left.
    expect((await stat(video)).size).toBe(4096)
    expect((await readdir(dir)).sort()).toEqual(['clip.mp4', 'photo.png', 'photo_compressed.png'])
    expect(existsSync(join(dir, 'clip_compressed.mp4'))).toBe(false)
  })
})
