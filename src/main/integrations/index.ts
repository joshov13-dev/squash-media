// Connects SquashForge to AI apps and installs the "squashforge" command.
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { AiAppStatus, IntegrationResult, IntegrationsInfo } from '@shared/types'
import { runProcess } from '../utils/process'
import {
  addServer,
  aiApps,
  claudeCodeCommand,
  ConfigError,
  isConnected,
  launcherScript,
  removeServer,
  serverEntry,
  SERVER_NAME,
  type AiAppDef,
  type Dirs,
  type LaunchSpec,
} from './aiApps'

function dirs(): Dirs {
  return { platform: process.platform, home: os.homedir(), appData: process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming') }
}

/**
 * How another program starts SquashForge without a window: the app's own
 * executable acting as Node, running the bundled command line script.
 * Returns a reason instead when this copy moves around (portable, AppImage).
 */
export function launchSpec(): { spec: LaunchSpec | null; problem?: string } {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return { spec: null, problem: 'The portable version unpacks to a new place each time it runs, so AI apps cannot find it. Install SquashForge with the Setup file to use this.' }
  }
  if (process.env.APPIMAGE) {
    return { spec: null, problem: 'The AppImage moves each time it runs, so AI apps cannot find it. Install the .deb package to use this.' }
  }
  if (process.platform === 'darwin' && process.execPath.startsWith('/Volumes/')) {
    return { spec: null, problem: 'SquashForge is running from the disk image. Drag it into Applications first, then open it from there.' }
  }
  const script = app.isPackaged ? join(process.resourcesPath, 'app.asar', 'out', 'main', 'cli.js') : join(app.getAppPath(), 'out', 'main', 'cli.js')
  return { spec: { command: process.execPath, args: [script, 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } } }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

let claudeCode: { found: boolean; checkedAt: number } | null = null

/** Claude Code is a command, not a folder, so ask it directly. */
async function findClaudeCode(): Promise<boolean> {
  if (claudeCode && Date.now() - claudeCode.checkedAt < 30_000) return claudeCode.found
  const found = await runProcess(process.platform === 'win32' ? 'where' : 'which', ['claude'], { timeoutMs: 5000 })
    .then((r) => r.code === 0)
    .catch(() => false)
  claudeCode = { found, checkedAt: Date.now() }
  return found
}

async function runClaude(args: string[]): Promise<{ code: number | null; out: string }> {
  // claude is a .cmd script on Windows, which only a shell can start.
  const r = await runProcess(process.platform === 'win32' ? 'cmd.exe' : 'claude', process.platform === 'win32' ? ['/d', '/s', '/c', 'claude', ...args] : args, {
    timeoutMs: 30_000,
  })
  return { code: r.code, out: `${r.stdout.toString('utf8')}${r.stderr}`.trim() }
}

async function appStatus(def: AiAppDef): Promise<AiAppStatus> {
  const text = await readText(def.config)
  return {
    id: def.id,
    name: def.name,
    installed: existsSync(def.detect),
    connected: isConnected(text, def.format),
    configPath: def.config,
    after: def.after,
  }
}

export async function integrationsInfo(): Promise<IntegrationsInfo> {
  const { spec, problem } = launchSpec()
  const apps = await Promise.all(aiApps(dirs()).map(appStatus))
  const hasClaudeCode = await findClaudeCode()
  let claudeCodeConnected = false
  if (hasClaudeCode && spec) claudeCodeConnected = (await runClaude(['mcp', 'get', SERVER_NAME]).catch(() => ({ code: 1 }))).code === 0
  apps.splice(1, 0, {
    id: 'claude-code',
    name: 'Claude Code',
    installed: hasClaudeCode,
    connected: claudeCodeConnected,
    configPath: null,
    after: 'Start a new claude session.',
  })
  const command = commandTarget()
  return {
    supported: spec !== null,
    problem,
    apps,
    manualJson: spec ? JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry(spec, 'mcpServers') } }, null, 2) : null,
    claudeCodeCommand: spec ? claudeCodeCommand(spec, process.platform) : null,
    command: { path: command.file, installed: existsSync(command.file), onPath: onPath(command.dir) },
  }
}

export async function connectApp(id: string, connect: boolean): Promise<IntegrationResult> {
  const { spec, problem } = launchSpec()
  if (!spec) return { ok: false, message: problem ?? 'Not available in this copy of SquashForge.' }
  if (id === 'claude-code') {
    claudeCode = null
    // Take out any older entry first, so the paths are always current.
    const removed = await runClaude(['mcp', 'remove', '--scope', 'user', SERVER_NAME]).catch((e: Error) => ({ code: 1, out: e.message }))
    if (!connect) {
      return removed.code === 0 || /not found|no mcp server/i.test(removed.out)
        ? { ok: true, message: 'Removed from Claude Code.' }
        : { ok: false, message: `Claude Code said: ${removed.out.split('\n').slice(-2).join(' ')}` }
    }
    const env = Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
    const r = await runClaude(['mcp', 'add', '--scope', 'user', ...env, SERVER_NAME, '--', spec.command, ...spec.args]).catch((e: Error) => ({
      code: 1,
      out: e.message,
    }))
    return r.code === 0
      ? { ok: true, message: 'Added to Claude Code. Start a new claude session.' }
      : { ok: false, message: `Claude Code said: ${r.out.split('\n').slice(-2).join(' ') || 'it did not work'}` }
  }
  const def = aiApps(dirs()).find((a) => a.id === id)
  if (!def) return { ok: false, message: 'Unknown app' }
  try {
    const text = await readText(def.config)
    if (!connect && !text) return { ok: true, message: `Removed from ${def.name}.` }
    const next = connect ? addServer(text, def.format, spec, def.config) : removeServer(text ?? '', def.format, def.config)
    await mkdir(dirname(def.config), { recursive: true })
    // Keep the user's own copy the first time we touch the file.
    const backup = `${def.config}.before-squashforge`
    if (text !== null && !existsSync(backup)) await copyFile(def.config, backup)
    await writeFile(def.config, next)
    return { ok: true, message: connect ? `Added to ${def.name}. ${def.after}` : `Removed from ${def.name}. ${def.after}` }
  } catch (e) {
    return { ok: false, message: e instanceof ConfigError ? e.message : `Could not update ${def.config}: ${(e as Error).message}` }
  }
}

// ---------------------------------------------------------------------------
// The "squashforge" command
// ---------------------------------------------------------------------------

function commandTarget(): { dir: string; file: string } {
  if (process.platform === 'win32') {
    const dir = join(process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'), 'SquashForge', 'bin')
    return { dir, file: join(dir, 'squashforge.cmd') }
  }
  const dir = join(os.homedir(), '.local', 'bin')
  return { dir, file: join(dir, 'squashforge') }
}

function onPath(dir: string): boolean {
  const want = process.platform === 'win32' ? dir.toLowerCase() : dir
  return (process.env.PATH ?? '').split(delimiter).some((p) => (process.platform === 'win32' ? p.toLowerCase() : p).replace(/[\\/]+$/, '') === want)
}

/** Adds a folder to the user's PATH in the registry, keeping %VARIABLES% as they are. */
async function addToWindowsPath(dir: string): Promise<void> {
  const script = [
    "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "$p = [string]$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')",
    "$parts = @($p -split ';' | Where-Object { $_ -ne '' })",
    'if (-not ($parts | Where-Object { $_.TrimEnd(\'\\\') -ieq $env:SQF_DIR })) {',
    "  $k.SetValue('Path', (($parts + $env:SQF_DIR) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
    // Setting any variable through .NET tells open programs that PATH changed.
    "  [Environment]::SetEnvironmentVariable('SQUASHFORGE_PATH_UPDATED', '1', 'User')",
    "  [Environment]::SetEnvironmentVariable('SQUASHFORGE_PATH_UPDATED', $null, 'User')",
    '}',
  ].join('\n')
  const r = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, SQF_DIR: dir },
    timeoutMs: 30_000,
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'PowerShell could not update PATH')
}

export async function installCommand(): Promise<IntegrationResult> {
  const { spec, problem } = launchSpec()
  if (!spec) return { ok: false, message: problem ?? 'Not available in this copy of SquashForge.' }
  const { dir, file } = commandTarget()
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(file, launcherScript(spec, process.platform))
    if (process.platform !== 'win32') await chmod(file, 0o755)
    if (process.platform === 'win32') {
      await addToWindowsPath(dir)
      return { ok: true, message: 'Installed. Open a new Command Prompt or PowerShell window and type: squashforge help' }
    }
    return onPath(dir)
      ? { ok: true, message: 'Installed. Open a new terminal and type: squashforge help' }
      : {
          ok: true,
          message: `Installed to ${file}. ${dir} is not on your PATH yet: add  export PATH="$HOME/.local/bin:$PATH"  to your shell profile, then open a new terminal.`,
        }
  } catch (e) {
    return { ok: false, message: `Could not install the command: ${(e as Error).message}` }
  }
}
