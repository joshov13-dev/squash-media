// The tools SquashForge offers AI apps over MCP, with descriptions written
// for the model: what each one does, when to use it, and what comes back.
import { ENCODER_LABELS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/codecs'
import { formatBytes, formatDuration } from '@shared/format'
import { NAME_TOKENS } from '@shared/naming'
import { GOALS } from '@shared/presets'
import type { MediaFile } from '@shared/types'
import type { Engine } from '../automation/engine'
import { goalShortName, OptionError, resolveOptions, type CompressOptions } from '../automation/options'
import { generateImagePreview } from '../services/imageProcessor'
import { generateVideoPreview } from '../services/videoProcessor'
import { isAbsolute } from 'node:path'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean | string>
  run: (args: Record<string, unknown>, engine: Engine) => Promise<ToolResult>
}

const goalIds = GOALS.map(goalShortName)

const pathsSchema = {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  description: 'Absolute paths to photos, videos or folders. Folders are searched up to 8 levels deep.',
}

const optionsSchema = {
  goal: {
    type: 'string',
    enum: goalIds,
    description:
      'Starting point for both photos and videos. smaller: same formats, about half the size, looks the same (default). share: WebP photos up to 2560 px and 1080p30 H.264 videos. smallest: AVIF photos and H.265 1080p video, slowest. discord: everything under 10 MB. email: photos under 2 MB, videos under 20 MB. quality: lossless photos, near-original H.265 video.',
  },
  photo: {
    type: 'object',
    description: 'Only set what the user asked for; the rest comes from the goal.',
    properties: {
      format: { type: 'string', enum: ['original', 'jpeg', 'png', 'webp', 'avif'], description: '"original" keeps each file\'s format (HEIC becomes JPEG).' },
      quality: { type: 'integer', minimum: 1, maximum: 100, description: 'Higher is better quality and bigger. 75-85 looks the same as the original for most photos.' },
      max_dimension: { type: 'integer', minimum: 16, description: 'Shrink so the longest side is at most this many pixels. Never enlarges.' },
      target_size: { type: ['string', 'number'], description: 'Largest file size, e.g. "500KB" or "2MB" (a number means MB). Finds the best quality that fits.' },
      lossless: { type: 'boolean', description: 'Keep every pixel. Saves less space.' },
      keep_metadata: { type: 'boolean', description: 'Keep EXIF such as camera, date taken and GPS location. Default false (stripped for privacy).' },
    },
    additionalProperties: false,
  },
  video: {
    type: 'object',
    description: 'Only set what the user asked for; the rest comes from the goal.',
    properties: {
      codec: { type: 'string', enum: ['h264', 'hevc', 'av1', 'vp9'], description: 'h264 plays everywhere; hevc is about half the size; av1 is smallest but slow on a CPU; vp9 for WebM.' },
      container: { type: 'string', enum: ['mp4', 'mkv', 'webm'] },
      quality: { type: 'integer', description: 'Constant quality (CRF/RF). Lower is better and bigger. h264/hevc 18-28 is typical, av1/vp9 25-40.' },
      target_size: { type: ['string', 'number'], description: 'Largest file size, e.g. "10MB" (a number means MB). Uses a two-pass encode to fit.' },
      resolution: { type: 'string', enum: ['original', '2160p', '1440p', '1080p', '720p', '480p'], description: 'Cap the height (short side for portrait video). Never upscales.' },
      max_fps: { type: 'integer', minimum: 0, description: 'Cap the frame rate, e.g. 30. 0 keeps the original.' },
      audio: { type: 'string', enum: ['keep', 'aac', 'opus', 'none'], description: '"keep" copies the original audio untouched.' },
      audio_kbps: { type: 'integer', minimum: 32, maximum: 512 },
      encoder: {
        type: 'string',
        enum: ['auto', 'cpu', 'nvenc', 'qsv', 'amf', 'videotoolbox'],
        description: 'auto (default) uses the graphics card when it can, which is many times faster; cpu makes slightly smaller files.',
      },
      speed: { type: 'string', enum: ['fastest', 'fast', 'medium', 'slow'], description: 'Slower squeezes a little harder on the CPU.' },
    },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    description: 'Where the compressed copies go. Default: next to each original, named like photo_compressed.jpg.',
    properties: {
      mode: {
        type: 'string',
        enum: ['same-folder', 'folder', 'replace'],
        description:
          'same-folder: next to the originals (default). folder: into output.folder. replace: the copy takes the original\'s place and the original goes to the Recycle Bin/Trash; only when the user clearly asked to replace or overwrite, and set confirm_replace_originals.',
      },
      folder: { type: 'string', description: 'Absolute path of the folder to save into (mode "folder"). Created if missing.' },
      name_pattern: { type: 'string', description: `File name pattern without extension. Tokens: ${NAME_TOKENS.map((t) => t.token).join(' ')}. Default "{name}_compressed".` },
      keep_subfolders: { type: 'boolean', description: 'In folder mode, recreate the subfolders of added folders. Default true.' },
      keep_original_if_larger: { type: 'boolean', description: 'If the copy would be bigger, keep the original instead. Default true.' },
      keep_dates: { type: 'boolean', description: 'Copy the original\'s modified date onto the copy. Default true.' },
    },
    additionalProperties: false,
  },
}

function text(summary: string, data?: unknown): ToolResult {
  const body = data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 1)}`
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined,
  }
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function asPaths(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || !v.every((p) => typeof p === 'string')) throw new OptionError('paths must be a list of absolute paths')
  const relative = v.find((p) => !isAbsolute(p))
  if (relative) throw new OptionError(`"${relative}" is not an absolute path. Give the full path, e.g. C:\\Users\\Name\\Videos or /home/name/Videos.`)
  return v
}

function optionsFrom(args: Record<string, unknown>): CompressOptions {
  return {
    goal: args.goal as string | undefined,
    photo: args.photo as CompressOptions['photo'],
    video: args.video as CompressOptions['video'],
    output: args.output as CompressOptions['output'],
  }
}

function describeFile(f: MediaFile): Record<string, unknown> {
  const base = { path: f.filePath, type: f.type, size_bytes: f.sizeBytes, size: formatBytes(f.sizeBytes) }
  if (f.info.kind === 'image') return { ...base, format: f.info.format, width: f.info.width, height: f.info.height }
  const v = f.info
  return {
    ...base,
    codec: v.videoCodec,
    width: v.width,
    height: v.height,
    fps: Math.round(v.fps * 100) / 100,
    duration_seconds: Math.round(v.durationSeconds * 10) / 10,
    duration: formatDuration(v.durationSeconds),
    bitrate_kbps: v.bitrateKbps,
    audio: v.audioCodec ? `${v.audioCodec}${v.audioChannels ? ` ${v.audioChannels}ch` : ''}` : 'none',
  }
}

const clampWait = (v: unknown, fallback: number): number => Math.max(0, Math.min(55, typeof v === 'number' ? v : fallback)) * 1000

export const TOOLS: Tool[] = [
  {
    name: 'get_capabilities',
    title: 'What SquashForge can do on this computer',
    description:
      'Lists the goals (presets), supported file types, output options, name pattern tokens, and this computer\'s hardware: CPU, graphics card and which GPU video encoders work. Call once before your first compression if you need to choose settings or estimate how long video will take.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (_args, engine) => {
      const hw = await engine.hardware()
      const data = {
        version: __APP_VERSION__,
        platform: process.platform,
        hardware: {
          cpu: hw.cpuModel,
          threads: hw.logicalCores,
          memory_gb: hw.totalMemoryGB,
          graphics: hw.gpus.map((g) => g.model),
          gpu_video_encoders: hw.availableGpuEncoders.map((m) => ENCODER_LABELS[m]),
          ffmpeg: hw.ffmpegAvailable ? hw.ffmpegVersion : 'missing (videos and HEIC photos cannot be processed)',
        },
        goals: GOALS.map((g) => ({ goal: goalShortName(g), name: g.name, description: g.description })),
        photo_inputs: Object.keys(IMAGE_EXTENSIONS).join(' '),
        video_inputs: [...VIDEO_EXTENSIONS].join(' '),
        photo_outputs: 'jpeg png webp avif (or original)',
        video_outputs: 'h264 hevc av1 vp9 in mp4 mkv webm',
        name_pattern_tokens: NAME_TOKENS.map((t) => `${t.token} ${t.label.toLowerCase()}`),
        notes: [
          'Photos take well under a second each. Videos take roughly their own length on a fast CPU (often longer), and several times faster with a GPU encoder.',
          'Originals are never changed unless output.mode is "replace", and even then they go to the Recycle Bin/Trash and undo_compression can put them back.',
        ],
      }
      const gpu = data.hardware.gpu_video_encoders.length ? `GPU encoding: ${data.hardware.gpu_video_encoders.join(', ')}` : 'No GPU encoder, videos use the CPU'
      return text(`SquashForge ${data.version} on ${hw.cpuModel}. ${gpu}.`, data)
    },
  },
  {
    name: 'inspect_media',
    title: 'Look at photos and videos',
    description:
      'Reads the photos and videos at the given paths (folders are searched) and reports each file\'s size, dimensions, format or codec, and for videos the duration, frame rate and audio. Nothing is changed. Use it to answer questions about files or to plan a compression.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: pathsSchema,
        max_files: { type: 'integer', minimum: 1, maximum: 5000, description: 'How many files to list in detail (default 200). Totals always cover everything.' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, engine) => {
      const { files, rejected } = await engine.inspect(asPaths(args.paths))
      const max = typeof args.max_files === 'number' ? args.max_files : 200
      const photos = files.filter((f) => f.type === 'image')
      const videos = files.filter((f) => f.type === 'video')
      const bytes = files.reduce((n, f) => n + f.sizeBytes, 0)
      const seconds = videos.reduce((n, f) => n + (f.info.kind === 'video' ? f.info.durationSeconds : 0), 0)
      const data = {
        totals: {
          files: files.length,
          photos: photos.length,
          videos: videos.length,
          size_bytes: bytes,
          size: formatBytes(bytes),
          video_duration: formatDuration(seconds),
        },
        files: files.slice(0, max).map(describeFile),
        more_files_not_listed: Math.max(0, files.length - max),
        skipped: rejected.slice(0, 50).map((r) => ({ path: r.path, reason: r.reason })),
      }
      return text(
        `${files.length} ${files.length === 1 ? 'file' : 'files'} (${photos.length} photos, ${videos.length} videos), ${formatBytes(bytes)} in total${rejected.length ? `; ${rejected.length} skipped` : ''}.`,
        data,
      )
    },
  },
  {
    name: 'estimate_size',
    title: 'Estimate the result for one file',
    description:
      'Compresses a sample of one photo or video with the given settings and reports the expected output size (and for video, the expected time), without saving anything. Use it to check that a file will fit a size limit or to compare settings before a big batch. Videos take a few seconds.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to one photo or video.' }, ...optionsSchema },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, engine) => {
      const [path] = asPaths([args.path])
      const o = resolveOptions(optionsFrom(args))
      const { files, rejected } = await engine.inspect([path])
      const f = files[0]
      if (!f) return fail(`Could not read ${path}: ${rejected[0]?.reason ?? 'not a photo or video'}`)
      if (f.info.kind === 'image') {
        const r = await generateImagePreview({ requestId: 0, filePath: path, config: o.image })
        const data = {
          path,
          before_bytes: f.sizeBytes,
          estimated_bytes: r.estimatedBytes,
          estimated: formatBytes(r.estimatedBytes),
          exact: r.exact,
          output_format: r.outputFormat,
          output_width: r.outputWidth,
          output_height: r.outputHeight,
          quality_used: r.qualityUsed,
          note: r.note,
        }
        return text(`${formatBytes(f.sizeBytes)} → about ${formatBytes(r.estimatedBytes)} as ${r.outputFormat.toUpperCase()} ${r.outputWidth}×${r.outputHeight}.`, data)
      }
      const r = await generateVideoPreview({ filePath: path, info: f.info, config: o.video }, await engine.hardware(), new AbortController().signal)
      const data = {
        path,
        before_bytes: f.sizeBytes,
        estimated_bytes: r.estimatedBytes,
        estimated: formatBytes(r.estimatedBytes),
        estimated_encode_seconds: Math.round(r.estimatedEncodeSeconds),
        encoder: r.encoderUsed,
        output_width: r.outputWidth,
        output_height: r.outputHeight,
        note: r.note,
      }
      return text(
        `${formatBytes(f.sizeBytes)} → about ${formatBytes(r.estimatedBytes)} at ${r.outputWidth}×${r.outputHeight}, taking about ${formatDuration(r.estimatedEncodeSeconds)} with ${r.encoderUsed}.`,
        data,
      )
    },
  },
  {
    name: 'compress_media',
    title: 'Compress photos and videos',
    description:
      'Compresses the photos and videos at the given paths (folders are searched) and saves compressed copies. Starts a batch and waits up to wait_seconds for it; if it is still running, returns progress and a batch_id to pass to get_compression_status. Set dry_run to see the planned output paths and time without writing anything; do that first for large batches or when replacing originals.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: pathsSchema,
        ...optionsSchema,
        dry_run: { type: 'boolean', description: 'Only report what would happen.' },
        confirm_replace_originals: { type: 'boolean', description: 'Must be true when output.mode is "replace". Only set it when the user asked to replace the originals.' },
        wait_seconds: { type: 'number', minimum: 0, maximum: 55, description: 'How long to wait for the batch before returning (default 25).' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: async (args, engine) => {
      const o = resolveOptions(optionsFrom(args))
      if (o.output.mode === 'overwrite' && !args.dry_run && args.confirm_replace_originals !== true) {
        return fail(
          'output.mode "replace" puts the compressed copies in place of the originals (which go to the Recycle Bin/Trash). Only do this if the user asked for it, then call again with confirm_replace_originals: true. Otherwise use "same-folder" or "folder".',
        )
      }
      const { files, rejected } = await engine.inspect(asPaths(args.paths))
      if (!files.length) {
        return fail(`No photos or videos found.${rejected.length ? ` Skipped: ${rejected.slice(0, 5).map((r) => `${r.path} (${r.reason})`).join('; ')}` : ''}`)
      }
      const hw = await engine.hardware()
      const videos = files.filter((f) => f.type === 'video')
      if (videos.length && !hw.ffmpegAvailable) return fail('FFmpeg is missing, so videos cannot be compressed. Reinstalling SquashForge fixes this.')
      if (args.dry_run) {
        const plan = await engine.plan(files, o)
        return text(
          `Dry run: ${files.length} files with goal "${o.goal.name}" would take about ${plan.estimate || 'a moment'}. Nothing was written.`,
          { goal: goalShortName(o.goal), ...plan, skipped: rejected.slice(0, 50) },
        )
      }
      const batchId = await engine.start(files, o)
      const status = await engine.wait(batchId, clampWait(args.wait_seconds, 25))
      return statusResult(status!, rejected.length)
    },
  },
  {
    name: 'get_compression_status',
    title: 'Check on a compression batch',
    description:
      'Progress and results for a batch started by compress_media: files done, failed and still running, space saved, time left, and each file\'s output path or error. Waits up to wait_seconds for the batch to finish first, so call it in a loop for long batches and tell the user the time left.',
    inputSchema: {
      type: 'object',
      properties: {
        batch_id: { type: 'string' },
        wait_seconds: { type: 'number', minimum: 0, maximum: 55, description: 'Wait this long for the batch to finish before answering (default 30).' },
      },
      required: ['batch_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, engine) => {
      const status = await engine.wait(String(args.batch_id), clampWait(args.wait_seconds, 30))
      if (!status) return fail(`No batch "${String(args.batch_id)}". Batches only last while this SquashForge server runs. Known: ${engine.batchIds().join(', ') || 'none'}.`)
      return statusResult(status, 0)
    },
  },
  {
    name: 'cancel_compression',
    title: 'Stop a compression batch',
    description: 'Stops a running batch. Files that already finished are kept; the file being worked on is discarded.',
    inputSchema: { type: 'object', properties: { batch_id: { type: 'string' } }, required: ['batch_id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args, engine) => {
      if (!engine.cancel(String(args.batch_id))) return fail(`No batch "${String(args.batch_id)}".`)
      const status = await engine.wait(String(args.batch_id), 5000)
      return statusResult(status!, 0)
    },
  },
  {
    name: 'list_history',
    title: 'Recent compressions',
    description:
      'Recent runs from the SquashForge app, its watched folders, the command line and AI apps, newest first, with each file\'s original and output paths and sizes. Use it to find a run_id for undo_compression or to answer "what did I compress".',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Runs to return (default 10).' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, engine) => {
      const runs = await engine.history.list(typeof args.limit === 'number' ? args.limit : 10)
      const data = {
        runs: runs.map((r) => {
          const live = r.entries.filter((e) => !e.undone)
          const before = live.reduce((n, e) => n + e.originalBytes, 0)
          const after = live.reduce((n, e) => n + e.outputBytes, 0)
          return {
            run_id: r.id,
            source: r.origin,
            started: new Date(r.startedAt).toISOString(),
            files: r.entries.length,
            undone: r.entries.length - live.length,
            saved: formatBytes(Math.max(0, before - after)),
            entries: r.entries.slice(0, 100).map((e) => ({
              original: e.source,
              output: e.output,
              before_bytes: e.originalBytes,
              after_bytes: e.outputBytes,
              replaced_original: e.replaced,
              undone: Boolean(e.undone),
            })),
          }
        }),
      }
      return text(runs.length ? `${runs.length} recent ${runs.length === 1 ? 'run' : 'runs'}.` : 'No history yet.', data)
    },
  },
  {
    name: 'undo_compression',
    title: 'Undo a compression',
    description:
      'Undoes a run from list_history: compressed copies go to the Recycle Bin/Trash, and originals that were replaced are put back from it. Pass file_paths (original paths) to undo only some files. Only use when the user asks to undo or revert.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        file_paths: { type: 'array', items: { type: 'string' }, description: 'Original paths of the files to undo. Leave out to undo the whole run.' },
      },
      required: ['run_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (args, engine) => {
      const runId = String(args.run_id)
      const only = Array.isArray(args.file_paths) ? (args.file_paths as string[]).map((p) => p.toLowerCase()) : null
      let results
      if (!only) {
        results = await engine.history.undoRun(runId)
      } else {
        const run = (await engine.history.list(300)).find((r) => r.id === runId)
        if (!run) return fail(`No run "${runId}" in the history.`)
        const entries = run.entries.filter((e) => only.includes(e.source.toLowerCase()))
        if (!entries.length) return fail('None of those paths are in that run. Use the "original" paths from list_history.')
        results = []
        for (const e of entries) results.push(await engine.history.undoEntry(runId, e.jobId))
      }
      await engine.history.flush()
      const failed = results.filter((r) => !r.ok)
      const summary = failed.length ? `${results.length - failed.length} undone, ${failed.length} could not be.` : `${results.length} undone.`
      return { ...text(summary, { results }), isError: failed.length > 0 && failed.length === results.length }
    },
  },
]

function statusResult(s: Awaited<ReturnType<Engine['status']>> & object, skippedPaths: number): ToolResult {
  const parts = [`${s.completed + s.skipped} of ${s.total} done`]
  if (s.failed) parts.push(`${s.failed} failed`)
  if (s.cancelled) parts.push(`${s.cancelled} cancelled`)
  if (s.after_bytes) parts.push(`saved ${s.saved}`)
  const head =
    s.state === 'running'
      ? `Still running (batch ${s.batch_id}, ${Math.floor(s.percent)}%, about ${s.eta || 'a moment'} left): ${parts.join(', ')}. Call get_compression_status with this batch_id to follow it.`
      : `${s.state === 'cancelled' ? 'Cancelled' : 'Finished'}: ${parts.join(', ')}.`
  // Long batches: list the interesting files, not thousands of rows.
  const files = s.files.length > 200 ? s.files.filter((f) => f.status === 'failed' || f.status === 'processing').slice(0, 200) : s.files
  const data = { ...s, files, files_listed: files.length < s.files.length ? 'only failed and running files are listed' : undefined, unreadable_paths_skipped: skippedPaths || undefined }
  return { ...text(head, data), isError: s.state !== 'running' && s.failed > 0 && s.failed === s.total }
}
