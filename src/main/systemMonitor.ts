import os from 'node:os'
import type { GpuInfo, SystemLoad } from '@shared/types'
import { runProcess } from './utils/process'

interface CpuTimes {
  idle: number
  total: number
}

function sampleCpu(): CpuTimes {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

export function parseNvidiaSmi(output: string): { gpu: number; encoder: number } | null {
  // One line per GPU: "37, 12"
  let gpu = 0
  let encoder = 0
  let seen = false
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(',').map((p) => Number.parseFloat(p.trim()))
    if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
      gpu = Math.max(gpu, parts[0])
      encoder = Math.max(encoder, parts[1])
      seen = true
    }
  }
  return seen ? { gpu, encoder } : null
}

/**
 * Parse `typeperf` CSV for the "GPU Engine" counters. Task Manager reports a
 * GPU engine's load as the sum over every process using it, so we do the same.
 */
export function parseTypeperf(output: string): { gpu: number; encoder: number } | null {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('"'))
  if (lines.length < 2) return null
  const split = (line: string): string[] => line.slice(1, -1).split('","')
  const header = split(lines[0])
  const values = split(lines[lines.length - 1])
  let gpu = 0
  let encoder = 0
  let seen = false
  for (let i = 1; i < header.length; i++) {
    const v = Number.parseFloat(values[i] ?? '')
    if (!Number.isFinite(v)) continue
    const name = header[i].toLowerCase()
    if (name.includes('engtype_3d')) {
      gpu += v
      seen = true
    } else if (name.includes('engtype_videoencode')) {
      encoder += v
      seen = true
    }
  }
  return seen ? { gpu: Math.min(100, gpu), encoder: Math.min(100, encoder) } : null
}

/** Polls CPU, memory and (where possible) GPU utilisation. */
export class SystemMonitor {
  private timer: NodeJS.Timeout | null = null
  private last = sampleCpu()
  private gpu: { gpu: number; encoder: number } | null = null
  private gpuFailures = 0
  private gpuBusy = false
  private tick = 0

  constructor(
    private readonly gpus: GpuInfo[],
    private readonly emit: (load: SystemLoad) => void,
  ) {}

  start(intervalMs = 1500): void {
    if (this.timer) return
    this.last = sampleCpu()
    this.timer = setInterval(() => this.poll(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    const now = sampleCpu()
    const idle = now.idle - this.last.idle
    const total = now.total - this.last.total
    this.last = now
    const cpuPercent = total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0
    const memoryPercent = (1 - os.freemem() / os.totalmem()) * 100

    // GPU queries are slower, so only run every other tick.
    if (this.tick++ % 2 === 0) void this.pollGpu()

    this.emit({
      cpuPercent: Math.round(cpuPercent),
      memoryPercent: Math.round(memoryPercent),
      gpuPercent: this.gpu ? Math.round(this.gpu.gpu) : null,
      gpuEncoderPercent: this.gpu ? Math.round(this.gpu.encoder) : null,
    })
  }

  private async pollGpu(): Promise<void> {
    if (this.gpuBusy || this.gpuFailures >= 3) return
    this.gpuBusy = true
    try {
      let result: { gpu: number; encoder: number } | null = null
      if (process.platform === 'win32') {
        const { stdout } = await runProcess(
          'typeperf',
          [
            '\\GPU Engine(*engtype_3D)\\Utilization Percentage',
            '\\GPU Engine(*engtype_VideoEncode)\\Utilization Percentage',
            '-sc',
            '1',
          ],
          { timeoutMs: 6000 },
        )
        result = parseTypeperf(stdout.toString('utf8'))
      } else if (this.gpus.some((g) => g.vendor === 'nvidia')) {
        const { stdout } = await runProcess(
          'nvidia-smi',
          ['--query-gpu=utilization.gpu,utilization.encoder', '--format=csv,noheader,nounits'],
          { timeoutMs: 4000 },
        )
        result = parseNvidiaSmi(stdout.toString('utf8'))
      }
      if (result) {
        this.gpu = result
        this.gpuFailures = 0
      } else {
        this.gpuFailures++
      }
    } catch {
      this.gpuFailures++
    } finally {
      this.gpuBusy = false
    }
  }
}
