// File name templates for compressed copies, e.g. "{name}_compressed" or
// "{date} {name}". Shared so the UI can preview exactly what main will write.

export const DEFAULT_NAME_TEMPLATE = '{name}_compressed'

export interface NameToken {
  token: string
  label: string
}

export const NAME_TOKENS: NameToken[] = [
  { token: '{name}', label: 'Original name' },
  { token: '{folder}', label: 'Folder name' },
  { token: '{date}', label: "Today's date" },
  { token: '{modified}', label: 'Date the file was last changed' },
  { token: '{n}', label: 'Number: 001, 002...' },
  { token: '{format}', label: 'New format, e.g. webp' },
]

export interface NameContext {
  /** The source file name without its extension. */
  name: string
  /** Name of the folder the source is in. */
  folder: string
  /** When the source was last modified. */
  modified: Date
  /** 1-based position in the batch. */
  index: number
  /** Output extension without the dot, e.g. "jpg". */
  format: string
  now?: Date
}

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g

function isoDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Characters Windows refuses in file names are dropped as the user types. */
export function cleanTemplate(template: string): string {
  return template.replace(/[\\/:*?"<>|]/g, '')
}

/** The file name (without extension) a template produces. Never empty. */
export function renderName(template: string, ctx: NameContext): string {
  const t = template.trim() || DEFAULT_NAME_TEMPLATE
  const out = t
    .replace(/\{name\}/gi, ctx.name)
    .replace(/\{folder\}/gi, ctx.folder)
    .replace(/\{date\}/gi, isoDate(ctx.now ?? new Date()))
    .replace(/\{modified\}/gi, isoDate(ctx.modified))
    .replace(/\{n\}/gi, String(ctx.index).padStart(3, '0'))
    .replace(/\{format\}/gi, ctx.format)
    .replace(ILLEGAL, '')
    // Windows drops trailing dots and spaces, which would change the name.
    .replace(/[. ]+$/, '')
    .trim()
  return out || ctx.name
}

/** True when the template makes a name different from the original. */
export function templateChangesName(template: string): boolean {
  const t = template.trim() || DEFAULT_NAME_TEMPLATE
  return t.toLowerCase() !== '{name}'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Does a file name (without extension) look like one this template made?
 * Used to leave out earlier compressed copies when a folder is added again.
 * A template of just "{name}" matches nothing, since every file would match.
 */
export function looksLikeOutput(stem: string, template: string): boolean {
  const t = template.trim() || DEFAULT_NAME_TEMPLATE
  if (!templateChangesName(t)) return false
  let pattern = ''
  let rest = t
  const token = /\{(name|folder|date|modified|n|format)\}/i
  while (rest) {
    const m = token.exec(rest)
    if (!m) {
      pattern += escapeRegExp(rest.replace(ILLEGAL, ''))
      break
    }
    pattern += escapeRegExp(rest.slice(0, m.index).replace(ILLEGAL, ''))
    const kind = m[1].toLowerCase()
    if (kind === 'date' || kind === 'modified') pattern += '\\d{4}-\\d{2}-\\d{2}'
    else if (kind === 'n') pattern += '\\d+'
    else if (kind === 'format') pattern += '[a-z0-9]+'
    else pattern += '.+'
    rest = rest.slice(m.index + m[0].length)
  }
  // A template made only of tokens (say "{date}") would match too much.
  if (!/[^\\]/.test(pattern.replace(/\\d\{4\}-\\d\{2\}-\\d\{2\}|\\d\+|\[a-z0-9\]\+|\.\+/g, ''))) return false
  return new RegExp(`^${pattern.replace(/\s+$/, '')}$`, 'i').test(stem)
}

/** "holiday.jpg becomes ..." preview for the settings. */
export function exampleName(template: string, ext = 'jpg'): string {
  return `${renderName(template, {
    name: 'holiday',
    folder: 'Photos',
    modified: new Date(2025, 6, 14),
    index: 1,
    format: ext,
  })}.${ext}`
}
