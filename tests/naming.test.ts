import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exampleName, looksLikeOutput, renderName } from '@shared/naming'
import { DEFAULT_OUTPUT } from '@shared/presets'
import { planOutputPath } from '../src/main/services/outputPaths'

const ctx = { name: 'IMG_0042', folder: 'Holiday', modified: new Date(2024, 0, 9), index: 7, format: 'webp', now: new Date(2026, 8, 24) }

describe('name templates', () => {
  it('fills in every token', () => {
    expect(renderName('{name}_compressed', ctx)).toBe('IMG_0042_compressed')
    expect(renderName('{date} {name}', ctx)).toBe('2026-09-24 IMG_0042')
    expect(renderName('{folder}-{n}', ctx)).toBe('Holiday-007')
    expect(renderName('{name} ({modified}).{format}', ctx)).toBe('IMG_0042 (2024-01-09).webp')
    expect(renderName('{NAME}', ctx)).toBe('IMG_0042')
  })

  it('never returns an empty or unsafe name', () => {
    expect(renderName('', ctx)).toBe('IMG_0042_compressed')
    expect(renderName('a:b*c?', ctx)).toBe('abc')
    expect(renderName('  ...  ', ctx)).toBe('IMG_0042')
    expect(renderName('{name}. ', ctx)).toBe('IMG_0042')
  })

  it('recognises names an earlier run made', () => {
    expect(looksLikeOutput('beach_compressed', '{name}_compressed')).toBe(true)
    expect(looksLikeOutput('BEACH_COMPRESSED', '{name}_compressed')).toBe(true)
    expect(looksLikeOutput('beach', '{name}_compressed')).toBe(false)
    expect(looksLikeOutput('2025-01-02 beach', '{date} {name}')).toBe(true)
    expect(looksLikeOutput('beach', '{date} {name}')).toBe(false)
    expect(looksLikeOutput('small-012', '{name}-{n}')).toBe(true)
    // Too broad to be useful.
    expect(looksLikeOutput('anything', '{name}')).toBe(false)
    expect(looksLikeOutput('2025-01-02', '{date}')).toBe(false)
  })

  it('shows an example', () => {
    expect(exampleName('{name}_small')).toBe('holiday_small.jpg')
  })

  it('plans paths with templates and never lands on the original', () => {
    const src = join('/photos', 'cat.jpg')
    const naming = { modified: new Date(2024, 4, 1), index: 3, now: new Date(2026, 0, 2) }
    expect(planOutputPath(src, '.webp', { ...DEFAULT_OUTPUT, nameTemplate: '{date}_{name}' }, undefined, naming).finalPath).toBe(
      join('/photos', '2026-01-02_cat.webp'),
    )
    // "{name}" with the same extension would overwrite the source.
    expect(planOutputPath(src, '.jpg', { ...DEFAULT_OUTPUT, nameTemplate: '{name}' }).finalPath).toBe(join('/photos', 'cat_compressed.jpg'))
    // A different extension is a different file, so it is fine.
    expect(planOutputPath(src, '.webp', { ...DEFAULT_OUTPUT, nameTemplate: '{name}' }).finalPath).toBe(join('/photos', 'cat.webp'))
    // Folder mode keeps names unless asked to rename.
    const folder = { ...DEFAULT_OUTPUT, mode: 'folder' as const, folder: '/out', nameTemplate: '{name}-{n}' }
    expect(planOutputPath(src, '.jpg', folder, undefined, naming).finalPath).toBe(join('/out', 'cat.jpg'))
    expect(planOutputPath(src, '.jpg', { ...folder, renameInFolder: true }, undefined, naming).finalPath).toBe(join('/out', 'cat-003.jpg'))
  })
})
