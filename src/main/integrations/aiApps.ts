// Where AI apps keep their MCP server lists, and how to add SquashMedia to
// them. Pure functions (paths and file contents in, new contents out) so the
// rules can be tested without touching anyone's real settings.
import { join } from 'node:path'

export interface LaunchSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

export type ConfigFormat = 'mcpServers' | 'vscode' | 'codex-toml'

export interface AiAppDef {
  id: string
  name: string
  /** Folder whose presence means the app is installed. */
  detect: string
  /** The file holding its MCP servers. */
  config: string
  format: ConfigFormat
  /** Shown after connecting. */
  after: string
}

export interface Dirs {
  platform: NodeJS.Platform
  home: string
  /** %APPDATA% on Windows. */
  appData: string
}

export const SERVER_NAME = 'squashmedia'

/** Folder where an app built on Electron or VS Code keeps user settings. */
function appSupport(d: Dirs, name: string): string {
  if (d.platform === 'win32') return join(d.appData, name)
  if (d.platform === 'darwin') return join(d.home, 'Library', 'Application Support', name)
  return join(d.home, '.config', name)
}

export function aiApps(d: Dirs): AiAppDef[] {
  const claude = appSupport(d, 'Claude')
  const vscode = join(appSupport(d, 'Code'), 'User')
  return [
    {
      id: 'claude-desktop',
      name: 'Claude',
      detect: claude,
      config: join(claude, 'claude_desktop_config.json'),
      format: 'mcpServers',
      after: 'Quit Claude fully (from the tray or menu bar) and open it again.',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      detect: join(d.home, '.cursor'),
      config: join(d.home, '.cursor', 'mcp.json'),
      format: 'mcpServers',
      after: 'Cursor picks it up straight away. Check Settings > MCP if not.',
    },
    {
      id: 'vscode',
      name: 'VS Code (Copilot)',
      detect: vscode,
      config: join(vscode, 'mcp.json'),
      format: 'vscode',
      after: 'In VS Code, open Copilot Chat in Agent mode and allow the SquashMedia tools.',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      detect: join(d.home, '.codeium', 'windsurf'),
      config: join(d.home, '.codeium', 'windsurf', 'mcp_config.json'),
      format: 'mcpServers',
      after: 'Press Refresh in Windsurf\'s MCP settings.',
    },
    {
      id: 'lmstudio',
      name: 'LM Studio',
      detect: join(d.home, '.lmstudio'),
      config: join(d.home, '.lmstudio', 'mcp.json'),
      format: 'mcpServers',
      after: 'LM Studio loads it on its next chat. Use a model that supports tools.',
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      detect: join(d.home, '.gemini'),
      config: join(d.home, '.gemini', 'settings.json'),
      format: 'mcpServers',
      after: 'Start a new gemini session.',
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      detect: join(d.home, '.codex'),
      config: join(d.home, '.codex', 'config.toml'),
      format: 'codex-toml',
      after: 'Start a new codex session.',
    },
  ]
}

/** The block most apps want, e.g. in claude_desktop_config.json. */
export function serverEntry(spec: LaunchSpec, format: ConfigFormat): Record<string, unknown> {
  const base = { command: spec.command, args: spec.args, env: spec.env }
  return format === 'vscode' ? { type: 'stdio', ...base } : base
}

export class ConfigError extends Error {}

function parseJson(text: string, file: string): Record<string, unknown> {
  const clean = text.replace(/^﻿/, '').trim()
  if (!clean) return {}
  try {
    const parsed = JSON.parse(clean) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Falls through.
  }
  // Comments or trailing commas (allowed by VS Code) would be lost on rewrite.
  throw new ConfigError(`${file} has comments or is not plain JSON, so SquashMedia will not rewrite it. Add the settings by hand instead.`)
}

const listKey = (format: ConfigFormat): string => (format === 'vscode' ? 'servers' : 'mcpServers')

export function isConnected(text: string | null, format: ConfigFormat): boolean {
  if (!text) return false
  if (format === 'codex-toml') return /^\s*\[mcp_servers\.squashmedia\]\s*$/m.test(text)
  try {
    const servers = parseJson(text, '')[listKey(format)] as Record<string, unknown> | undefined
    return Boolean(servers && typeof servers === 'object' && SERVER_NAME in servers)
  } catch {
    return false
  }
}

/** Single-quoted TOML strings need no escaping, which suits Windows paths. */
function tomlString(s: string): string {
  return s.includes("'") ? JSON.stringify(s) : `'${s}'`
}

function removeTomlSection(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    if (/^\s*\[/.test(line)) skipping = /^\s*\[mcp_servers\.squashmedia(\.[^\]]+)?\]\s*$/.test(line)
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** The config file's new contents with SquashMedia added (or updated). */
export function addServer(text: string | null, format: ConfigFormat, spec: LaunchSpec, file = 'The settings file'): string {
  if (format === 'codex-toml') {
    const rest = removeTomlSection(text ?? '').trimEnd()
    const env = Object.entries(spec.env)
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(', ')
    const block = [
      `[mcp_servers.${SERVER_NAME}]`,
      `command = ${tomlString(spec.command)}`,
      `args = [${spec.args.map(tomlString).join(', ')}]`,
      `env = { ${env} }`,
    ].join('\n')
    return `${rest ? `${rest}\n\n` : ''}${block}\n`
  }
  const json = text ? parseJson(text, file) : {}
  const key = listKey(format)
  const servers = (json[key] && typeof json[key] === 'object' ? json[key] : {}) as Record<string, unknown>
  json[key] = { ...servers, [SERVER_NAME]: serverEntry(spec, format) }
  return `${JSON.stringify(json, null, 2)}\n`
}

/** The config file's new contents with SquashMedia taken out. */
export function removeServer(text: string, format: ConfigFormat, file = 'The settings file'): string {
  if (format === 'codex-toml') return `${removeTomlSection(text).trimEnd()}\n`
  const json = parseJson(text, file)
  const key = listKey(format)
  const servers = json[key] as Record<string, unknown> | undefined
  if (servers && typeof servers === 'object') {
    delete servers[SERVER_NAME]
  }
  return `${JSON.stringify(json, null, 2)}\n`
}

/** A shell-safe command line, for Claude Code's "claude mcp add" and for copying. */
export function quoteArg(arg: string, platform: NodeJS.Platform): string {
  if (/^[\w./:=\\-]+$/.test(arg)) return arg
  return platform === 'win32' ? `"${arg}"` : `'${arg.replace(/'/g, `'\\''`)}'`
}

export function claudeCodeCommand(spec: LaunchSpec, platform: NodeJS.Platform): string {
  const env = Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return ['claude', 'mcp', 'add', '--scope', 'user', ...env, SERVER_NAME, '--', spec.command, ...spec.args].map((a) => quoteArg(a, platform)).join(' ')
}

/** The launcher behind the "squashmedia" command. */
export function launcherScript(spec: LaunchSpec, platform: NodeJS.Platform): string {
  const [script, ...rest] = spec.args.filter((a) => a !== 'mcp')
  if (platform === 'win32') {
    return [
      '@echo off',
      'rem Made by SquashMedia. Runs its command line without opening a window.',
      'setlocal',
      ...Object.entries(spec.env).map(([k, v]) => `set ${k}=${v}`),
      `"${spec.command}" "${script}" ${rest.map((a) => `"${a}"`).join(' ')}%*`.replace(/ {2,}/g, ' '),
      '',
    ].join('\r\n')
  }
  const env = Object.entries(spec.env).map(([k, v]) => `export ${k}=${quoteArg(v, platform)}`)
  const lines = ['#!/usr/bin/env bash', '# Made by SquashMedia. Runs its command line without opening a window.', ...env]
  // Electron's own GLib on Linux clashes harmlessly with sharp's and prints
  // warnings; hide them so the output stays readable.
  if (platform === 'linux') lines.push("exec 2> >(grep --line-buffered -v -e 'GLib-GObject-CRITICAL' -e '^$' >&2)")
  lines.push(`exec ${quoteArg(spec.command, platform)} ${quoteArg(script, platform)} "$@"`, '')
  return lines.join('\n')
}
