import { existsSync } from 'node:fs'
import { readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  flushLogs,
  listLogFiles,
  logFilePath,
  logger,
  readRecentLog,
  setVerboseLogging,
  useLogsDir,
} from '../src/main/logger'
import { tempDir } from './helpers'

describe('logger', () => {
  let dir: string

  beforeEach(async () => {
    dir = await tempDir('sqm-logs-')
    useLogsDir(dir)
    setVerboseLogging(false)
  })

  afterEach(() => setVerboseLogging(false))

  it('writes a dated file with level, scope and message', async () => {
    logger.info('queue', 'Job finished', { file: 'a.jpg' })
    await flushLogs()
    const files = await listLogFiles()
    expect(files).toEqual([logFilePath()])
    const text = await readFile(files[0], 'utf8')
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] \[queue\] Job finished \{"file":"a\.jpg"\}\n$/)
  })

  it('drops debug entries unless verbose logging is on', async () => {
    logger.debug('x', 'quiet')
    await flushLogs()
    expect(existsSync(logFilePath())).toBe(false)

    setVerboseLogging(true)
    logger.debug('x', 'loud')
    await flushLogs()
    expect(await readFile(logFilePath(), 'utf8')).toContain('[DEBUG] [x] loud')
  })

  it('always writes warnings and errors, and turns an Error into its message and stack', async () => {
    logger.error('app', 'Crashed', new Error('boom'))
    await flushLogs()
    const text = await readFile(logFilePath(), 'utf8')
    expect(text).toContain('[ERROR] [app] Crashed')
    expect(text).toContain('"message":"boom"')
    expect(text).toContain('"stack":')
  })

  it('appends several entries to the same file in order', async () => {
    logger.info('a', 'one')
    logger.info('a', 'two')
    logger.warn('a', 'three')
    await flushLogs()
    const lines = (await readFile(logFilePath(), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.split(']').pop()?.trim())).toEqual(['one', 'two', 'three'])
  })

  it('deletes files older than the retention window', async () => {
    const old = join(dir, 'squashmedia-2000-01-01.log')
    await writeFile(old, 'ancient\n')
    const oldDate = new Date(2000, 0, 1)
    await utimes(old, oldDate, oldDate)
    const notLogFile = join(dir, 'not-a-log.txt')
    await writeFile(notLogFile, 'unrelated')

    logger.info('a', 'triggers cleanup')
    await flushLogs()

    expect(existsSync(old)).toBe(false)
    expect(existsSync(notLogFile)).toBe(true)
  })

  it('stops writing info/debug once today\'s file is big, but keeps warnings and errors', async () => {
    await writeFile(logFilePath(), 'x'.repeat(11 * 1024 * 1024))
    logger.info('a', 'should be dropped')
    logger.warn('a', 'should still land')
    await flushLogs()
    const text = await readFile(logFilePath(), 'utf8')
    expect(text).not.toContain('should be dropped')
    expect(text).toContain('should still land')
  })

  it('reads the recent tail across files and truncates from the front', async () => {
    logger.info('a', 'first line')
    logger.info('a', 'second line')
    await flushLogs()
    const full = await readRecentLog()
    expect(full).toContain('first line')
    expect(full).toContain('second line')

    const short = await readRecentLog(20)
    expect(short.startsWith('[log truncated]')).toBe(true)
    expect(short).toContain('second line')
    expect(short).not.toContain('first line')
  })

  it('never throws when the log folder cannot be written to', async () => {
    useLogsDir(join(dir, 'nested', 'not', 'writable-as-a-file'))
    await writeFile(join(dir, 'nested'), 'a file, not a directory, so mkdir under it fails')
    expect(() => logger.info('a', 'still called safely')).not.toThrow()
    await expect(flushLogs()).resolves.toBeUndefined()
  })

  it('lists files oldest first and ignores files that are not logs', async () => {
    await writeFile(join(dir, 'squashmedia-2020-05-01.log'), '')
    await writeFile(join(dir, 'squashmedia-2021-05-01.log'), '')
    await writeFile(join(dir, 'readme.txt'), '')
    expect((await listLogFiles()).map((f) => f.split(/[\\/]/).pop())).toEqual([
      'squashmedia-2020-05-01.log',
      'squashmedia-2021-05-01.log',
    ])
    // Confirm nothing outside the dir helper leaked through.
    expect((await readdir(dir)).length).toBeGreaterThanOrEqual(3)
  })
})
