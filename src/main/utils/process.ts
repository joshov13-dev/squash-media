import { spawn, type SpawnOptions } from 'node:child_process'

export interface RunResult {
  code: number | null
  stdout: Buffer
  stderr: string
}

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Called for each chunk of stdout. When set, stdout is not buffered. */
  onStdout?: (chunk: Buffer) => void
  /** Keep only the last N characters of stderr. */
  stderrLimit?: number
}

export class AbortError extends Error {
  constructor(message = 'Cancelled') {
    super(message)
    this.name = 'AbortError'
  }
}

/** Spawn a process without a shell and collect its output. */
export function runProcess(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs, signal, cwd, env, onStdout, stderrLimit = 64_000 } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError())
      return
    }
    const spawnOptions: SpawnOptions = { cwd, env: env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    const child = spawn(command, args, spawnOptions)
    const out: Buffer[] = []
    let err = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    let aborted = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    // Wait for the process to exit before rejecting: on Windows the output
    // file stays locked until then, and callers clean it up straight after.
    const onAbort = (): void => {
      aborted = true
      child.kill('SIGKILL')
      setTimeout(() => finish(() => reject(new AbortError())), 5000).unref()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(() => reject(new Error(`${command} timed out after ${timeoutMs} ms`)))
      }, timeoutMs)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (onStdout) onStdout(chunk)
      else out.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
      if (err.length > stderrLimit * 2) err = err.slice(-stderrLimit)
    })
    child.on('error', (e) => finish(() => reject(aborted ? new AbortError() : e)))
    child.on('close', (code) =>
      finish(() => (aborted ? reject(new AbortError()) : resolve({ code, stdout: Buffer.concat(out), stderr: err.slice(-stderrLimit) }))),
    )
  })
}

/** Last meaningful lines of an ffmpeg stderr log, for error messages. */
export function tailError(stderr: string, lines = 4): string {
  const useful = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('frame=') && !l.startsWith('size=') && !/^\s*(Stream|Metadata|Duration|Input|Output|encoder|handler_name|major_brand|minor_version|compatible_brands|creation_time|Side data|Press \[q\])/.test(l))
  return useful.slice(-lines).join(' | ') || 'Unknown error'
}

/** Run async work over items with a fixed concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
