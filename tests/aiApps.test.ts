import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addServer, aiApps, claudeCodeCommand, isConnected, launcherScript, removeServer, type LaunchSpec } from '../src/main/integrations/aiApps'

const win: LaunchSpec = {
  command: 'C:\\Users\\Sam Smith\\AppData\\Local\\Programs\\SquashMedia\\SquashMedia.exe',
  args: ['C:\\Users\\Sam Smith\\AppData\\Local\\Programs\\SquashMedia\\resources\\app.asar\\out\\main\\cli.js', 'mcp'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}
const mac: LaunchSpec = {
  command: '/Applications/SquashMedia.app/Contents/MacOS/SquashMedia',
  args: ["/Applications/SquashMedia.app/Contents/Resources/app.asar/out/main/cli.js", 'mcp'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

describe('AI app settings', () => {
  it('knows where each app keeps its MCP servers', () => {
    const w = aiApps({ platform: 'win32', home: 'C:\\Users\\Sam', appData: 'C:\\Users\\Sam\\AppData\\Roaming' })
    expect(w.find((a) => a.id === 'claude-desktop')?.config).toBe(join('C:\\Users\\Sam\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'))
    const m = aiApps({ platform: 'darwin', home: '/Users/sam', appData: '' })
    expect(m.find((a) => a.id === 'vscode')?.config).toBe(join('/Users/sam', 'Library', 'Application Support', 'Code', 'User', 'mcp.json'))
    expect(m.find((a) => a.id === 'cursor')?.config).toBe(join('/Users/sam', '.cursor', 'mcp.json'))
  })

  it('adds SquashMedia without touching other servers or settings', () => {
    const existing = JSON.stringify({ globalShortcut: 'Ctrl+Space', mcpServers: { files: { command: 'npx', args: ['files'] } } })
    const next = JSON.parse(addServer(existing, 'mcpServers', win))
    expect(next.globalShortcut).toBe('Ctrl+Space')
    expect(next.mcpServers.files).toEqual({ command: 'npx', args: ['files'] })
    expect(next.mcpServers.squashmedia).toEqual({ command: win.command, args: win.args, env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(isConnected(JSON.stringify(next), 'mcpServers')).toBe(true)

    const removed = JSON.parse(removeServer(JSON.stringify(next), 'mcpServers'))
    expect(removed.mcpServers).toEqual({ files: { command: 'npx', args: ['files'] } })
    expect(isConnected(JSON.stringify(removed), 'mcpServers')).toBe(false)
  })

  it('creates a new file and handles VS Code\'s own format', () => {
    expect(JSON.parse(addServer(null, 'mcpServers', mac)).mcpServers.squashmedia.command).toBe(mac.command)
    const vs = JSON.parse(addServer('\uFEFF{}', 'vscode', mac))
    expect(vs.servers.squashmedia).toMatchObject({ type: 'stdio', command: mac.command })
    expect(isConnected(JSON.stringify(vs), 'vscode')).toBe(true)
  })

  it('refuses to rewrite files with comments', () => {
    expect(() => addServer('{ // my settings\n "servers": {} }', 'vscode', mac)).toThrow(/comments/)
    expect(isConnected('{ // x\n}', 'vscode')).toBe(false)
  })

  it('edits Codex TOML in place', () => {
    const toml = 'model = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n'
    const added = addServer(toml, 'codex-toml', win)
    expect(added).toContain('model = "o4"')
    expect(added).toContain('[mcp_servers.other]')
    expect(added).toContain(`command = '${win.command}'`)
    expect(added).toContain("env = { ELECTRON_RUN_AS_NODE = '1' }")
    expect(isConnected(added, 'codex-toml')).toBe(true)
    // Adding again replaces rather than duplicates.
    expect(addServer(added, 'codex-toml', win).match(/\[mcp_servers\.squashmedia\]/g)).toHaveLength(1)
    const removed = removeServer(added, 'codex-toml')
    expect(isConnected(removed, 'codex-toml')).toBe(false)
    expect(removed).toContain('[mcp_servers.other]')
  })

  it('builds commands and launchers that survive spaces in paths', () => {
    expect(claudeCodeCommand(win, 'win32')).toBe(
      `claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 squashmedia -- "${win.command}" "${win.args[0]}" mcp`,
    )
    const cmd = launcherScript(win, 'win32')
    expect(cmd).toContain('set ELECTRON_RUN_AS_NODE=1')
    expect(cmd).toContain(`"${win.command}" "${win.args[0]}" %*`)
    const sh = launcherScript(mac, 'darwin')
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
    expect(sh).toContain(`exec ${mac.command} ${mac.args[0]} "$@"`)
    expect(launcherScript(mac, 'linux')).toContain('GLib-GObject-CRITICAL')
  })
})
