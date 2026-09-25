// A Model Context Protocol server over stdio, so AI apps on this computer
// (Claude, Cursor, VS Code, LM Studio and others) can compress files with
// SquashForge. Messages are newline-delimited JSON-RPC 2.0. Everything
// other than protocol messages goes to stderr.
import { createInterface } from 'node:readline'
import { GOALS } from '@shared/presets'
import type { Engine } from '../automation/engine'
import { goalShortName, OptionError } from '../automation/options'
import { flushLogs, logger } from '../logger'
import { TOOLS, type ToolResult } from './tools'

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export const INSTRUCTIONS = `SquashForge compresses photos and videos on this computer. Nothing is uploaded. Use it when the user wants files smaller: to email or share them, to fit a size limit (Discord, WhatsApp, a website), to free up disk space, or to convert formats (HEIC to JPEG, PNG to WebP, MOV to MP4).

How to use it well:
1. Paths must be absolute. Folders are searched for photos and videos (up to 8 levels deep).
2. If you need to know what is there (sizes, resolutions, durations), call inspect_media first. It changes nothing.
3. Pick the goal that matches the request, then only override what the user specifically asked for:
${GOALS.map((g) => `   - ${goalShortName(g)}: ${g.description}`).join('\n')}
   Examples: "make these small enough for Discord" -> goal discord. "Shrink my phone videos to 1080p" -> goal smaller with video.resolution "1080p". "Convert to WebP" -> photo.format "webp". "Under 5 MB" -> photo/video target_size "5MB".
4. By default copies are saved next to the originals as name_compressed.ext and the originals are not touched. Use output.mode "folder" with output.folder to save elsewhere. Only use output.mode "replace" when the user explicitly asks to replace or overwrite the originals; the originals then go to the Recycle Bin/Trash.
5. For many files, or before replacing originals, call compress_media with dry_run first and tell the user what will happen and how long it should take.
6. compress_media waits up to wait_seconds, then returns a batch_id if still running. Videos are slow (roughly real time on a CPU, several times faster with a GPU encoder). Poll get_compression_status with wait_seconds and keep the user informed of progress and time left rather than waiting silently. A batch stops if this server is closed.
7. When it finishes, report the number of files, the space saved, where the copies are, and any failures with the reason given.
8. To check one file will fit a size limit, use estimate_size. To revert, use list_history then undo_compression.`

interface Message {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type Reply = Record<string, unknown>

export class McpServer {
  constructor(
    private readonly engine: Engine,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** Handle one message. Returns the reply, or null for notifications. */
  async handle(msg: Message): Promise<Reply | null> {
    const id = msg.id
    const isRequest = id !== undefined && id !== null
    const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id, result })
    const error = (code: number, message: string): Reply => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? error(-32600, 'Invalid request') : null
    if (!isRequest) {
      // notifications/initialized, notifications/cancelled and the like.
      return null
    }
    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '')
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'squashforge', title: 'SquashForge', version: __APP_VERSION__ },
          instructions: INSTRUCTIONS,
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({
          tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })),
        })
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        const tool = TOOLS.find((t) => t.name === name)
        if (!tool) return error(-32602, `Unknown tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`)
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        return ok(await this.callTool(tool.name, args))
      }
      // Some apps ask even though these are not offered.
      case 'resources/list':
        return ok({ resources: [] })
      case 'resources/templates/list':
        return ok({ resourceTemplates: [] })
      case 'prompts/list':
        return ok({ prompts: [] })
      default:
        return error(-32601, `Method not found: ${msg.method}`)
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = TOOLS.find((t) => t.name === name)!
    const started = Date.now()
    try {
      const result = await tool.run(args, this.engine)
      const ms = Date.now() - started
      this.log(`${name} took ${ms} ms`)
      logger.info('mcp', `${name} (${ms} ms)`, { args, isError: result.isError || undefined })
      return result
    } catch (e) {
      // Problems with the request go back to the model so it can fix them.
      const message = e instanceof OptionError ? e.message : `SquashForge hit a problem: ${e instanceof Error ? e.message : String(e)}`
      this.log(`${name} failed: ${e instanceof OptionError ? e.message : e instanceof Error ? e.stack : String(e)}`)
      logger.error('mcp', `${name} failed`, { args, error: e })
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}

/** Serve on stdin/stdout until the AI app closes the connection. */
export async function serveStdio(engine: Engine): Promise<void> {
  const log = (line: string): void => void process.stderr.write(`[squashforge] ${line}\n`)
  const server = new McpServer(engine, log)
  const write = (reply: Reply): void => void process.stdout.write(`${JSON.stringify(reply)}\n`)
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const inflight = new Set<Promise<unknown>>()
  log(`SquashForge ${__APP_VERSION__} MCP server ready`)
  logger.info('mcp', 'MCP server started')

  for await (const line of rl) {
    if (!line.trim()) continue
    let msg: Message
    try {
      msg = JSON.parse(line) as Message
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      continue
    }
    // Answer requests as they finish, so a long wait never blocks a ping.
    const p = server
      .handle(msg)
      .then((reply) => {
        if (reply) write(reply)
      })
      .catch((e) => write({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String(e) } }))
      .finally(() => inflight.delete(p))
    inflight.add(p)
  }
  // The app closed the connection: stop any batches and save the history.
  log('Connection closed, stopping')
  logger.info('mcp', 'Connection closed, stopping')
  await engine.close()
  await flushLogs()
}
