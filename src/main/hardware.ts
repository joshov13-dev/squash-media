import os from 'node:os'
import si from 'systeminformation'
import { ENCODER_NAMES } from '@shared/codecs'
import type {
  EncoderMode,
  GpuInfo,
  GpuVendor,
  HardwareEncoderMode,
  HardwareProfile,
  VideoCodec,
} from '@shared/types'
import { getBinaryPaths } from './binaries'
import { runProcess } from './utils/process'

const CODECS: VideoCodec[] = ['h264', 'hevc', 'av1', 'vp9']
const HW_MODES: HardwareEncoderMode[] = ['nvenc', 'qsv', 'amf', 'videotoolbox']

const VENDOR_FOR_MODE: Record<HardwareEncoderMode, GpuVendor> = {
  nvenc: 'nvidia',
  qsv: 'intel',
  amf: 'amd',
  videotoolbox: 'apple',
}

export function detectVendor(vendor: string, model: string): GpuVendor {
  const text = `${vendor} ${model}`.toLowerCase()
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(text)) return 'nvidia'
  if (/intel|arc|iris|uhd graphics|hd graphics/.test(text)) return 'intel'
  if (/amd|ati|radeon|advanced micro/.test(text)) return 'amd'
  if (/apple/.test(text)) return 'apple'
  return 'other'
}

/**
 * Relative CPU throughput. 1.0 is roughly an 8 thread CPU boosting to 4 GHz.
 * Threads scale sub-linearly because encoders never use every thread fully.
 */
export function computePerformanceScore(logicalCores: number, boostGHz: number): number {
  const threads = Math.max(1, logicalCores)
  const ghz = boostGHz > 0.5 ? boostGHz : 3
  const score = Math.pow(threads / 8, 0.85) * (ghz / 4)
  return Math.round(Math.max(0.1, score) * 100) / 100
}

/** Images compress with libvips threads already, so only a few run side by side. */
export function computeImageConcurrency(logicalCores: number): number {
  return Math.max(1, Math.min(4, Math.floor(logicalCores / 4)))
}

async function readFfmpegVersion(ffmpeg: string): Promise<string | null> {
  try {
    const { stdout } = await runProcess(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 8000 })
    const first = stdout.toString('utf8').split(/\r?\n/)[0] ?? ''
    const match = first.match(/ffmpeg version (\S+)/)
    return match ? match[1] : first || null
  } catch {
    return null
  }
}

async function listEncoders(ffmpeg: string): Promise<Set<string>> {
  try {
    const { stdout } = await runProcess(ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 8000 })
    const names = new Set<string>()
    for (const line of stdout.toString('utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*[VAS][.A-Z]{5}\s+(\S+)/)
      if (m) names.add(m[1])
    }
    return names
  } catch {
    return new Set()
  }
}

/**
 * Being listed by `ffmpeg -encoders` only means the encoder was compiled in.
 * A short real encode proves the GPU and driver can actually run it.
 */
async function testEncoder(ffmpeg: string, encoder: string): Promise<boolean> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:r=30:d=0.2',
    '-frames:v',
    '3',
    '-pix_fmt',
    encoder.endsWith('_qsv') ? 'nv12' : 'yuv420p',
    '-c:v',
    encoder,
    '-f',
    'null',
    '-',
  ]
  try {
    const { code } = await runProcess(ffmpeg, args, { timeoutMs: 12_000 })
    return code === 0
  } catch {
    return false
  }
}

async function readGpus(): Promise<GpuInfo[]> {
  try {
    const graphics = await si.graphics()
    return graphics.controllers
      .filter((c) => c.model || c.vendor)
      .map((c) => ({
        vendor: detectVendor(c.vendor ?? '', c.model ?? ''),
        model: (c.model || c.vendor || 'Unknown GPU').trim(),
        vramMB: typeof c.vram === 'number' && c.vram > 0 ? c.vram : null,
      }))
  } catch {
    return []
  }
}

let profilePromise: Promise<HardwareProfile> | null = null

export function getHardwareProfile(): Promise<HardwareProfile> {
  if (!profilePromise) profilePromise = detectHardware()
  return profilePromise
}

export async function detectHardware(): Promise<HardwareProfile> {
  const { ffmpeg } = getBinaryPaths()
  const cpus = os.cpus()
  const logicalCores = cpus.length || 1

  const [cpu, gpus, ffmpegVersion, encoders] = await Promise.all([
    si.cpu().catch(() => null),
    readGpus(),
    readFfmpegVersion(ffmpeg),
    listEncoders(ffmpeg),
  ])

  const baseClockGHz = cpu?.speed || (cpus[0]?.speed ?? 0) / 1000 || 0
  const boostClockGHz = cpu?.speedMax || baseClockGHz
  const cpuModel =
    [cpu?.manufacturer, cpu?.brand].filter(Boolean).join(' ').trim() || cpus[0]?.model?.trim() || 'Unknown CPU'

  // Only test GPU encoders whose vendor is present. If GPU detection failed
  // entirely, test everything that was compiled in.
  const vendors = new Set(gpus.map((g) => g.vendor))
  // VideoToolbox is part of macOS and works on Intel Macs too.
  const shouldTest = (mode: HardwareEncoderMode): boolean =>
    mode === 'videotoolbox' ? process.platform === 'darwin' : gpus.length === 0 || vendors.has(VENDOR_FOR_MODE[mode])

  const encoderSupport: Record<VideoCodec, EncoderMode[]> = { h264: [], hevc: [], av1: [], vp9: [] }
  const tests: Array<Promise<void>> = []
  for (const codec of CODECS) {
    const cpuName = ENCODER_NAMES[codec].cpu
    if (cpuName && encoders.has(cpuName)) encoderSupport[codec].push('cpu')
    for (const mode of HW_MODES) {
      const name = ENCODER_NAMES[codec][mode]
      if (!name || !encoders.has(name) || !shouldTest(mode)) continue
      tests.push(
        testEncoder(ffmpeg, name).then((ok) => {
          if (ok) encoderSupport[codec].push(mode)
        }),
      )
    }
  }
  await Promise.all(tests)

  const order: EncoderMode[] = ['cpu', 'nvenc', 'qsv', 'amf', 'videotoolbox']
  for (const codec of CODECS) encoderSupport[codec].sort((a, b) => order.indexOf(a) - order.indexOf(b))

  const availableGpuEncoders = HW_MODES.filter((mode) => CODECS.some((c) => encoderSupport[c].includes(mode)))

  return {
    cpuModel,
    physicalCores: cpu?.physicalCores || logicalCores,
    logicalCores,
    baseClockGHz: Math.round(baseClockGHz * 100) / 100,
    boostClockGHz: Math.round(boostClockGHz * 100) / 100,
    totalMemoryGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    gpus,
    availableGpuEncoders,
    encoderSupport,
    performanceScore: computePerformanceScore(logicalCores, boostClockGHz),
    imageConcurrency: computeImageConcurrency(logicalCores),
    ffmpegVersion,
    ffmpegAvailable: ffmpegVersion !== null,
  }
}
