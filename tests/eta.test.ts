import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatEta } from '@shared/format'
import type { VideoInfo } from '@shared/types'
import {
  CalibrationStore,
  imageLaneSpeedup,
  predictImageSeconds,
  predictVideoFps,
  predictVideoSeconds,
  VideoEtaTracker,
  type VideoWorkload,
} from '../src/main/services/etaCalculator'
import { computeImageConcurrency, computePerformanceScore, detectVendor } from '../src/main/hardware'

const info1080: VideoInfo = {
  kind: 'video',
  container: 'mov',
  durationSeconds: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  totalFrames: 1800,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  bitrateKbps: 20000,
  audioCodec: 'aac',
  audioChannels: 2,
  audioBitrateKbps: 192,
  audioStreams: 1,
  subtitleStreams: 0,
}

const workload = (patch: Partial<VideoWorkload> = {}): VideoWorkload => ({
  info: info1080,
  codec: 'h264',
  mode: 'cpu',
  preset: 'medium',
  outputWidth: 1920,
  outputHeight: 1080,
  outputFps: 30,
  durationSeconds: 60,
  passes: 1,
  ...patch,
})

describe('formatting', () => {
  it('formats ETAs like the spec', () => {
    expect(formatEta(84)).toBe('01m 24s')
    expect(formatEta(12)).toBe('12s')
    expect(formatEta(3900)).toBe('1h 05m')
    expect(formatEta(Number.NaN)).toBe('')
  })
  it('formats bytes and durations', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
    expect(formatDuration(133)).toBe('02:13')
    expect(formatDuration(3723)).toBe('1:02:03')
  })
})

describe('hardware scoring', () => {
  it('scores an 8 thread 4 GHz CPU at 1.0', () => {
    expect(computePerformanceScore(8, 4)).toBe(1)
    expect(computePerformanceScore(16, 5)).toBeGreaterThan(computePerformanceScore(8, 4))
    expect(computePerformanceScore(4, 2.5)).toBeLessThan(1)
  })
  it('picks a sensible number of parallel image jobs', () => {
    expect(computeImageConcurrency(2)).toBe(1)
    expect(computeImageConcurrency(8)).toBe(2)
    expect(computeImageConcurrency(32)).toBe(4)
  })
  it('recognises GPU vendors', () => {
    expect(detectVendor('NVIDIA', 'GeForce RTX 4070')).toBe('nvidia')
    expect(detectVendor('Intel Corporation', 'Intel(R) UHD Graphics 770')).toBe('intel')
    expect(detectVendor('Advanced Micro Devices, Inc.', 'AMD Radeon RX 7800 XT')).toBe('amd')
  })
})

describe('video throughput model', () => {
  it('predicts faster encodes for faster presets, GPUs and lower resolutions', () => {
    const medium = predictVideoFps(workload(), 1)
    expect(predictVideoFps(workload({ preset: 'ultrafast' }), 1)).toBeGreaterThan(medium)
    expect(predictVideoFps(workload({ preset: 'slow' }), 1)).toBeLessThan(medium)
    expect(predictVideoFps(workload({ codec: 'hevc' }), 1)).toBeLessThan(medium)
    expect(predictVideoFps(workload({ outputWidth: 1280, outputHeight: 720 }), 1)).toBeGreaterThan(medium)
    expect(predictVideoFps(workload({ mode: 'nvenc' }), 0.5)).toBeGreaterThan(predictVideoFps(workload(), 0.5))
    expect(predictVideoFps(workload(), 2)).toBeGreaterThan(medium)
  })

  it('adds the analysis pass for two-pass encodes', () => {
    const one = predictVideoSeconds(workload(), 1)
    const two = predictVideoSeconds(workload({ passes: 2 }), 1)
    expect(two).toBeCloseTo(one * 1.5, 5)
  })

  it('applies calibration factors', () => {
    const store = new CalibrationStore()
    const before = predictVideoFps(workload(), 1, store)
    store.record('video:h264:cpu:medium', 2)
    expect(predictVideoFps(workload(), 1, store)).toBeCloseTo(before / 2, 5)
    store.record('video:h264:cpu:medium', 1)
    expect(store.get('video:h264:cpu:medium')).toBeGreaterThan(1)
    expect(store.get('video:h264:cpu:medium')).toBeLessThan(2)
  })
})

describe('VideoEtaTracker', () => {
  it('converges on remaining frames / fps', () => {
    const t = new VideoEtaTracker(3000, 50)
    const start = 1_000_000
    t.startPass(1, start)
    let snap = t.update(0, start)
    for (let s = 1; s <= 20; s++) snap = t.update(s * 100, start + s * 1000)
    // 100 fps steady, 1000 frames left
    expect(snap.fps).toBeCloseTo(100, 0)
    expect(snap.etaSeconds).toBeCloseTo(10, 0)
    expect(snap.percent).toBeCloseTo(66.7, 0)
  })

  it('reacts to a slowdown within the recent window', () => {
    const t = new VideoEtaTracker(10_000, 100)
    const start = 1_000_000
    t.startPass(1, start)
    let frame = 0
    for (let s = 1; s <= 30; s++) t.update((frame += 100), start + s * 1000)
    // Thermal throttle: speed halves for 5 seconds.
    let snap = t.update(frame, start + 30_000)
    for (let s = 31; s <= 36; s++) snap = t.update((frame += 50), start + s * 1000)
    // Overall average is still ~91 fps, but the estimate should lean towards 50.
    expect(snap.fps).toBeLessThan(75)
    expect(snap.fps).toBeGreaterThan(50)
  })

  it('trusts the hardware prior during warm-up', () => {
    const t = new VideoEtaTracker(1000, 40)
    t.startPass(1, 0)
    const snap = t.update(1, 100)
    expect(snap.fps).toBeGreaterThan(30)
    expect(snap.fps).toBeLessThan(50)
  })

  it('weights two-pass progress and adds the second pass to the ETA', () => {
    const t = new VideoEtaTracker(1000, 50, 2, 2)
    t.startPass(1, 0)
    let snap = t.update(0, 0)
    for (let s = 1; s <= 5; s++) snap = t.update(s * 100, s * 1000)
    // Pass 1 at 100 fps: 500 frames left (5 s), then pass 2 at ~50 fps (20 s).
    expect(snap.percent).toBeCloseTo((500 / 1000) * (100 / 3), 0)
    expect(snap.etaSeconds).toBeGreaterThan(20)
    t.startPass(2, 10_000)
    snap = t.update(0, 10_000)
    for (let s = 1; s <= 10; s++) snap = t.update(s * 50, 10_000 + s * 1000)
    expect(snap.percent).toBeCloseTo((1 / 3 + 0.5 * (2 / 3)) * 100, 0)
    expect(snap.etaSeconds).toBeCloseTo(10, 0)
  })
})

describe('image throughput model', () => {
  it('scales with megapixels, format and hardware', () => {
    const jpeg12 = predictImageSeconds(12, 'jpeg', 'quality', 1)
    expect(predictImageSeconds(24, 'jpeg', 'quality', 1)).toBeGreaterThan(jpeg12)
    expect(predictImageSeconds(12, 'avif', 'quality', 1)).toBeGreaterThan(jpeg12)
    expect(predictImageSeconds(12, 'jpeg', 'quality', 2)).toBeLessThan(jpeg12)
    expect(imageLaneSpeedup(1)).toBe(1)
    expect(imageLaneSpeedup(4)).toBe(2.5)
  })
})

describe('time codes', () => {
  it('formats and parses trim times', async () => {
    const { formatTimecode, parseTimecode } = await import('@shared/format')
    expect(formatTimecode(65.5)).toBe('1:05.5')
    expect(formatTimecode(3723)).toBe('1:02:03')
    expect(formatTimecode(0)).toBe('0:00')
    expect(parseTimecode('90')).toBe(90)
    expect(parseTimecode('1:30.5')).toBe(90.5)
    expect(parseTimecode('0:01:30')).toBe(90)
    expect(parseTimecode('1,5')).toBe(1.5)
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('1::2')).toBeNull()
  })
})
