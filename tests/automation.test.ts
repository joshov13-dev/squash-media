import { existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { MB } from '@shared/presets'
import { Engine } from '../src/main/automation/engine'
import { OptionError, parseSize, resolveOptions } from '../src/main/automation/options'
import { INSTRUCTIONS, McpServer } from '../src/main/mcp/server'
import { TOOLS } from '../src/main/mcp/tools'
import { tempDir } from './helpers'

describe('automation options', () => {
  it('starts from a goal and applies only what was asked', () => {
    const o = resolveOptions({ goal: 'discord', video: { resolution: '480p' } })
    expect(o.goal.id).toBe('goal-discord')
    expect(o.video).toMatchObject({ rateControl: 'targetSize', targetMaxSizeBytes: 10 * MB, scale: '480p' })
    expect(o.output).toMatchObject({ mode: 'suffix', nameTemplate: '{name}_compressed' })

    const p = resolveOptions({ photo: { format: 'webp', quality: 70, max_dimension: 1600 }, output: { folder: '/out', name_pattern: '{n}' } })
    expect(p.image).toMatchObject({ format: 'webp', quality: 70, mode: 'quality', resize: { mode: 'fit', maxWidth: 1600, maxHeight: 1600 } })
    expect(p.output).toMatchObject({ mode: 'folder', folder: '/out', renameInFolder: true, nameTemplate: '{n}' })

    expect(resolveOptions({ video: { codec: 'vp9', container: 'webm' } }).video).toMatchObject({ codec: 'vp9', container: 'webm', audioCodec: 'opus' })
    expect(resolveOptions({ video: { container: 'webm' } }).video).toMatchObject({ codec: 'vp9', container: 'webm' })
    expect(resolveOptions({ output: { mode: 'replace' } }).output.mode).toBe('overwrite')
    expect(resolveOptions({ goal: 'Best quality' }).goal.id).toBe('goal-quality')
  })

  it('explains bad options', () => {
    expect(() => resolveOptions({ goal: 'tiny' })).toThrow(/Use one of: smaller, share/)
    expect(() => resolveOptions({ photo: { quality: 0 } })).toThrow(OptionError)
    expect(() => resolveOptions({ video: { codec: 'hevc', container: 'webm' } })).toThrow(/cannot go in WEBM/)
    expect(() => resolveOptions({ output: { mode: 'folder' } })).toThrow(/output.folder is needed/)
    expect(() => resolveOptions({ video: { resolution: '999p' as never } })).toThrow(/Unknown resolution/)
  })

  it('reads sizes', () => {
    expect(parseSize('500KB')).toBe(500 * 1024)
    expect(parseSize('10 MB')).toBe(10 * MB)
    expect(parseSize('1.5gb')).toBe(Math.round(1.5 * 1024 * MB))
    expect(parseSize(8)).toBe(8 * MB)
    expect(() => parseSize('big')).toThrow(/not a size/)
  })
})

describe('MCP server', () => {
  let server: McpServer
  let dir: string

  beforeAll(async () => {
    process.env.SQUASHMEDIA_USER_DATA = await tempDir('sqm-mcp-home-')
    dir = await tempDir('sqm-mcp-')
    for (const [name, colour] of [['one.png', '#2a6'], ['two.png', '#a26']]) {
      await sharp({ create: { width: 800, height: 600, channels: 3, background: colour } })
        .composite([{ input: Buffer.from('<svg width="800" height="600"><rect x="100" y="100" width="300" height="200" fill="#fff"/></svg>') }])
        .png()
        .toFile(join(dir, name))
    }
    server = new McpServer(new Engine('ai'))
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    return (reply as { result: { content: Array<{ text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> } }).result
  }

  it('introduces itself and lists well-formed tools', async () => {
    const init = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })) as { result: Record<string, unknown> }
    expect(init.result.protocolVersion).toBe('2024-11-05')
    expect(init.result.instructions).toBe(INSTRUCTIONS)
    expect(INSTRUCTIONS).toMatch(/discord/)
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    const list = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } }
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object')
    const unknown = (await server.handle({ jsonrpc: '2.0', id: 3, method: 'nope' })) as { error: { code: number } }
    expect(unknown.error.code).toBe(-32601)
  })

  it('inspects, dry-runs and compresses', async () => {
    const inspected = await call('inspect_media', { paths: [dir] })
    expect(inspected.content[0].text).toMatch(/^2 files \(2 photos, 0 videos\)/)

    const dry = await call('compress_media', { paths: [dir], goal: 'share', dry_run: true })
    expect(dry.content[0].text).toMatch(/Dry run/)
    expect((dry.structuredContent as { files: Array<{ output: string }> }).files[0].output).toMatch(/one_compressed\.webp$/)
    expect(existsSync(join(dir, 'one_compressed.webp'))).toBe(false)

    const done = await call('compress_media', { paths: [dir], goal: 'share', wait_seconds: 30 })
    expect(done.isError).toBeFalsy()
    expect(done.content[0].text).toMatch(/^Finished: 2 of 2 done/)
    expect((await readdir(dir)).sort()).toEqual(['one.png', 'one_compressed.webp', 'two.png', 'two_compressed.webp'])

    // Running again never writes over the first copies: the new ones are numbered.
    const firstCopy = await readFile(join(dir, 'one_compressed.webp'))
    const again = await call('compress_media', { paths: [join(dir, 'one.png')], goal: 'share', photo: { quality: 40 }, wait_seconds: 30 })
    expect(again.content[0].text).toMatch(/^Finished: 1 of 1 done/)
    expect(await readFile(join(dir, 'one_compressed.webp'))).toEqual(firstCopy)
    expect(existsSync(join(dir, 'one_compressed (2).webp'))).toBe(true)
    await rm(join(dir, 'one_compressed (2).webp'))

    const history = await call('list_history', {})
    const runs = (history.structuredContent as { runs: Array<{ run_id: string; source: string; files: number }> }).runs
    expect(runs.find((r) => r.files === 2)).toMatchObject({ source: 'ai', files: 2 })
  })

  it('refuses to replace originals unless confirmed, and reports mistakes to the model', async () => {
    const before = (await readdir(dir)).sort()
    const originals = await Promise.all(before.map((f) => readFile(join(dir, f))))
    const replace = await call('compress_media', { paths: [dir], output: { mode: 'replace' } })
    expect(replace.isError).toBe(true)
    expect(replace.content[0].text).toMatch(/confirm_replace_originals/)
    // Anything but a real true is refused.
    const sloppy = await call('compress_media', { paths: [dir], output: { mode: 'replace' }, confirm_replace_originals: 'true' })
    expect(sloppy.isError).toBe(true)
    // A dry run may describe a replace, but writes and recycles nothing.
    const dry = await call('compress_media', { paths: [join(dir, 'one.png')], output: { mode: 'replace' }, dry_run: true })
    expect(dry.isError).toBeFalsy()
    expect((dry.structuredContent as { files: Array<{ replaces_original: boolean }> }).files[0].replaces_original).toBe(true)
    expect((await readdir(dir)).sort()).toEqual(before)
    expect(await Promise.all(before.map((f) => readFile(join(dir, f))))).toEqual(originals)
    const relative = await call('inspect_media', { paths: ['photos/one.png'] })
    expect(relative.isError).toBe(true)
    expect(relative.content[0].text).toMatch(/not an absolute path/)
    const status = await call('get_compression_status', { batch_id: 'missing', wait_seconds: 0 })
    expect(status.isError).toBe(true)
  })

  it('estimates one photo without writing', async () => {
    const r = await call('estimate_size', { path: join(dir, 'two.png'), photo: { format: 'avif' } })
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toMatch(/→ about .* as AVIF 800×600/)
  })
})
