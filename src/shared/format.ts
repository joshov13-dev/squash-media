// Small formatting helpers used by both processes.

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

/** "01m 24s", "1h 05m", "12s". Empty when unknown. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

/** "00:02:13" style clock for media durations. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown length'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function savingsPercent(original: number, compressed: number): number {
  if (original <= 0) return 0
  return Math.round((1 - compressed / original) * 100)
}

/** "1:05.5", "1:02:03". Shows tenths only when there are any. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const tenths = Math.round(seconds * 10)
  const whole = Math.floor(tenths / 10)
  const frac = tenths % 10
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, '0') + (frac ? `.${frac}` : '')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Reads "90", "1:30", "1:30.5" or "0:01:30". Returns null when it cannot. */
export function parseTimecode(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':')
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p.trim() === '')) return null
  let total = 0
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isFinite(n) || n < 0) return null
    total = total * 60 + n
  }
  return total
}
