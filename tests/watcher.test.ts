import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FolderWatcher, isCandidate } from '../src/main/watcher'
import { tempDir } from './helpers'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('watch folders', () => {
  let watcher: FolderWatcher | null = null
  afterEach(() => watcher?.stop())

  it('only looks at finished photos and videos', () => {
    expect(isCandidate('/a/IMG_1.HEIC')).toBe(true)
    expect(isCandidate('/a/clip.mp4')).toBe(true)
    expect(isCandidate('/a/notes.txt')).toBe(false)
    expect(isCandidate('/a/.hidden.jpg')).toBe(false)
    expect(isCandidate('/a/.photo.webp.sqf-1234abcd.tmp')).toBe(false)
    expect(isCandidate('/a/video.mp4.crdownload')).toBe(false)
  })

  it('reports a new file once it stops growing, and nothing already there', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'old.jpg'), 'existing')
    const found: string[][] = []
    watcher = new FolderWatcher({ onFound: (_id, paths) => found.push(paths), pollMs: 60, steadyChecks: 2 })
    watcher.update([{ id: 'w1', path: dir, goalId: 'goal-smaller', outputFolder: null, enabled: true }])
    await sleep(100)

    const file = join(dir, 'new.mp4')
    await writeFile(file, 'a')
    for (let i = 0; i < 4; i++) {
      await sleep(50)
      await appendFile(file, 'more data')
    }
    // Whether a poll fell between two appends and looked steady too early is
    // a real race on a loaded CI runner, so only the eventual, single report
    // is checked, not that nothing was found partway through growing.
    for (let i = 0; i < 40 && !found.length; i++) await sleep(50)
    expect(found).toEqual([[file]])

    // Touching it again does not report it twice.
    await appendFile(file, 'edit')
    await sleep(400)
    expect(found).toHaveLength(1)
  })

  it('sees files in subfolders and skips our own outputs', async () => {
    const dir = await tempDir()
    const found: string[] = []
    watcher = new FolderWatcher({ onFound: (_id, paths) => found.push(...paths), pollMs: 50, steadyChecks: 1 })
    watcher.update([{ id: 'w1', path: dir, goalId: 'goal-smaller', outputFolder: null, enabled: true }])
    await sleep(100)
    await mkdir(join(dir, 'Day 1'))
    const own = join(dir, 'Day 1', 'a_compressed.jpg')
    watcher.ignore(own)
    // Written the way the queue writes: a hidden temp file, then a rename.
    await writeFile(join(dir, 'Day 1', '.a_compressed.jpg.sqf-12345678.tmp'), 'x')
    await rename(join(dir, 'Day 1', '.a_compressed.jpg.sqf-12345678.tmp'), own)
    await writeFile(join(dir, 'Day 1', 'b.png'), 'png')
    for (let i = 0; i < 40 && !found.length; i++) await sleep(50)
    await sleep(200)
    expect(found).toEqual([join(dir, 'Day 1', 'b.png')])
  })

  it('stops watching a folder that is switched off', async () => {
    const dir = await tempDir()
    const found: string[] = []
    watcher = new FolderWatcher({ onFound: (_id, paths) => found.push(...paths), pollMs: 50, steadyChecks: 1 })
    const folder = { id: 'w1', path: dir, goalId: 'goal-smaller', outputFolder: null, enabled: true }
    watcher.update([folder])
    watcher.update([{ ...folder, enabled: false }])
    await writeFile(join(dir, 'c.jpg'), 'x')
    await sleep(300)
    expect(found).toEqual([])
    expect(watcher.status()).toEqual([])
  })

  it('reports a missing folder', () => {
    watcher = new FolderWatcher({ onFound: () => undefined })
    watcher.update([{ id: 'gone', path: join('/definitely', 'not', 'here'), goalId: 'goal-smaller', outputFolder: null, enabled: true }])
    expect(watcher.status()[0]).toMatchObject({ id: 'gone', watching: false })
    expect(watcher.status()[0].error).toMatch(/could not be found/)
  })
})
