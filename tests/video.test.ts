import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveAudioMode } from '@shared/codecs'
import { DEFAULT_VIDEO_CONFIG, MB } from '@shared/presets'
import type { HardwareProfile, VideoInfo, VideoJobConfig } from '@shared/types'
import {
  buildVideoArgs,
  computeTargetBitrate,
  computeVideoOutputSize,
  encodeVideo,
  generateVideoPreview,
  parseProbe,
  planAttempts,
  probeVideo,
  ProgressParser,
  resolveEncoder,
  trimWindow,
  type BuildArgsInput,
  type FfmpegProgress,
} from '../src/main/services/videoProcessor'
import { hasFfmpeg, makeTestVideo, tempDir } from './helpers'

const info: VideoInfo = {
  kind: 'video',
  container: 'mov',
  durationSeconds: 120,
  width: 3840,
  height: 2160,
  fps: 59.94,
  totalFrames: 7193,
  videoCodec: 'hevc',
  pixelFormat: 'yuv420p10le',
  bitDepth: 10,
  bitrateKbps: 60000,
  audioCodec: 'aac',
  audioChannels: 6,
  audioBitrateKbps: 384,
  audioStreams: 1,
  subtitleStreams: 0,
}

const cfg = (patch: Partial<VideoJobConfig> = {}): VideoJobConfig => ({ ...DEFAULT_VIDEO_CONFIG, ...patch })

function args(patch: Partial<BuildArgsInput> & { config?: VideoJobConfig } = {}): string[] {
  const config = patch.config ?? cfg()
  const encoder = patch.encoder ?? resolveEncoder(config, null)
  return buildVideoArgs({
    input: '/in.mov',
    output: '/out.mp4',
    info,
    audio: resolveAudioMode(config.container, config.audioCodec, info.audioCodec),
    ...patch,
    config,
    encoder,
  })
}

const after = (list: string[], flag: string): string | undefined => {
  const i = list.indexOf(flag)
  return i >= 0 ? list[i + 1] : undefined
}

const allGpus: Pick<HardwareProfile, 'encoderSupport'> = {
  encoderSupport: {
    h264: ['cpu', 'nvenc', 'qsv', 'amf'],
    hevc: ['cpu', 'nvenc', 'qsv', 'amf'],
    av1: ['cpu', 'nvenc', 'qsv', 'amf'],
    vp9: ['cpu', 'qsv'],
  },
}

describe('ffprobe parsing', () => {
  it('reads streams, rotation and bit depth', () => {
    const parsed = parseProbe({
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 300, height: 300, disposition: { attached_pic: 1 } },
        {
          codec_type: 'video',
          codec_name: 'hevc',
          width: 1920,
          height: 1080,
          pix_fmt: 'yuv420p10le',
          avg_frame_rate: '30000/1001',
          nb_frames: '1798',
          side_data_list: [{ rotation: -90 }],
        },
        { codec_type: 'audio', codec_name: 'aac', channels: 2, bit_rate: '128000' },
        { codec_type: 'subtitle', codec_name: 'mov_text' },
      ],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '60.0', bit_rate: '8000000' },
    })
    expect(parsed).toMatchObject({
      container: 'mov',
      width: 1080,
      height: 1920,
      videoCodec: 'hevc',
      bitDepth: 10,
      totalFrames: 1798,
      audioCodec: 'aac',
      audioBitrateKbps: 128,
      subtitleStreams: 1,
      bitrateKbps: 8000,
    })
    expect(parsed.fps).toBeCloseTo(29.97, 2)
  })
})

describe('planning', () => {
  it('caps the short side and keeps dimensions even', () => {
    expect(computeVideoOutputSize(info, '1080p')).toEqual({ width: 1920, height: 1080 })
    expect(computeVideoOutputSize({ ...info, width: 1080, height: 1920 }, '720p')).toEqual({ width: 720, height: 1280 })
    expect(computeVideoOutputSize({ ...info, width: 1279, height: 719 }, '1080p')).toEqual({ width: 1280, height: 720 })
  })

  it('computes a bitrate that leaves room for audio and overhead', () => {
    const kbps = computeTargetBitrate(60, 10 * MB, 128, 1)
    const totalBytes = ((kbps + 128) * 1000 * 60) / 8
    expect(totalBytes).toBeLessThan(10 * MB)
    expect(totalBytes).toBeGreaterThan(9 * MB)
  })

  it('falls back to the CPU when a GPU encoder is missing', () => {
    expect(resolveEncoder(cfg({ encoderMode: 'nvenc' }), { encoderSupport: { ...allGpus.encoderSupport, h264: ['cpu'] } })).toMatchObject({ mode: 'cpu', name: 'libx264' })
    expect(resolveEncoder(cfg({ codec: 'vp9', encoderMode: 'nvenc' }), allGpus).name).toBe('libvpx-vp9')
    expect(resolveEncoder(cfg({ codec: 'av1', encoderMode: 'amf' }), allGpus).name).toBe('av1_amf')
  })

  it('picks the best graphics card encoder in auto mode', () => {
    expect(resolveEncoder(cfg({ encoderMode: 'auto' }), allGpus)).toEqual({ mode: 'nvenc', name: 'h264_nvenc' })
    const intelOnly = { encoderSupport: { ...allGpus.encoderSupport, hevc: ['cpu', 'qsv'] as const } } as unknown as typeof allGpus
    expect(resolveEncoder(cfg({ codec: 'hevc', encoderMode: 'auto' }), intelOnly)).toEqual({ mode: 'qsv', name: 'hevc_qsv' })
    expect(resolveEncoder(cfg({ codec: 'vp9', encoderMode: 'auto' }), allGpus)).toEqual({ mode: 'qsv', name: 'vp9_qsv' })
    // No graphics card: quietly use the CPU, with no warning note.
    expect(resolveEncoder(cfg({ encoderMode: 'auto' }), null)).toEqual({ mode: 'cpu', name: 'libx264' })
  })

  it('retries graphics card jobs without GPU decoding, then on the CPU', () => {
    const gpu = { mode: 'nvenc' as const, name: 'h264_nvenc' }
    expect(planAttempts(gpu, cfg(), true).map((a) => `${a.encoder.name}${a.hwDecode ? '+hw' : ''}`)).toEqual([
      'h264_nvenc+hw',
      'h264_nvenc',
      'libx264',
    ])
    expect(planAttempts(gpu, cfg(), false)).toHaveLength(2)
    expect(planAttempts({ mode: 'cpu', name: 'libx264' }, cfg(), true)).toEqual([{ encoder: { mode: 'cpu', name: 'libx264' }, hwDecode: false }])
  })

  it('picks audio codecs each container accepts', () => {
    expect(resolveAudioMode('webm', 'copy', 'aac')).toBe('opus')
    expect(resolveAudioMode('webm', 'aac', 'aac')).toBe('opus')
    expect(resolveAudioMode('mp4', 'copy', 'pcm_s16le')).toBe('aac')
    expect(resolveAudioMode('mkv', 'copy', 'pcm_s16le')).toBe('copy')
    expect(resolveAudioMode('mp4', 'aac', null)).toBe('none')
  })
})

describe('buildVideoArgs', () => {
  it('builds a CRF x264 encode with scaling and a frame rate cap', () => {
    const a = args({ config: cfg({ scale: '1080p', fpsLimit: 30, crf: 20 }) })
    expect(after(a, '-c:v')).toBe('libx264')
    expect(after(a, '-crf')).toBe('20')
    expect(after(a, '-vf')).toBe('fps=30,scale=1920:1080:flags=lanczos')
    expect(after(a, '-pix_fmt')).toBe('yuv420p')
    expect(after(a, '-movflags')).toBe('+faststart+use_metadata_tags')
    expect(a.at(-1)).toBe('/out.mp4')
    expect(after(a, '-progress')).toBe('pipe:1')
  })

  it('keeps 10-bit for HEVC and tags it for Apple players', () => {
    const a = args({ config: cfg({ codec: 'hevc' }) })
    expect(after(a, '-pix_fmt')).toBe('yuv420p10le')
    expect(after(a, '-tag:v')).toBe('hvc1')
    expect(after(a, '-x265-params')).toBe('log-level=error')
  })

  it('writes relative two-pass stats for x265', () => {
    const config = cfg({ codec: 'hevc', rateControl: 'targetSize' })
    const pass1 = args({ config, pass: 1, output: null, videoBitrateKbps: 2500, passLogFile: 'ffpass' })
    expect(after(pass1, '-x265-params')).toBe('log-level=error:pass=1:stats=ffpass.log')
    expect(pass1).toContain('-an')
    expect(pass1.slice(-3)).toEqual(['-f', 'null', '-'])
    expect(pass1).not.toContain('-map_metadata')
    const pass2 = args({ config, pass: 2, videoBitrateKbps: 2500, passLogFile: 'ffpass' })
    expect(after(pass2, '-b:v')).toBe('2500k')
    expect(after(pass2, '-c:a')).toBe('aac')
  })

  it('uses -pass for x264 and VP9', () => {
    const x264 = args({ config: cfg({ rateControl: 'bitrate' }), pass: 1, output: null, videoBitrateKbps: 3000 })
    expect(after(x264, '-pass')).toBe('1')
    expect(after(x264, '-passlogfile')).toBe('ffpass')
    const vp9 = args({ config: cfg({ container: 'webm', codec: 'vp9', audioCodec: 'opus' }) })
    expect(after(vp9, '-b:v')).toBe('0')
    expect(after(vp9, '-row-mt')).toBe('1')
    expect(after(vp9, '-f')).toBe('webm')
  })

  it('maps NVENC, QSV and AMF quality controls', () => {
    const nv = args({ config: cfg({ codec: 'hevc', encoderMode: 'nvenc', preset: 'slow', crf: 28 }), encoder: { mode: 'nvenc', name: 'hevc_nvenc' } })
    expect(after(nv, '-preset')).toBe('p7')
    expect(after(nv, '-cq')).toBe('28')
    expect(after(nv, '-pix_fmt')).toBe('p010le')

    const nvTarget = args({ config: cfg({ encoderMode: 'nvenc' }), encoder: { mode: 'nvenc', name: 'h264_nvenc' }, videoBitrateKbps: 4000 })
    expect(after(nvTarget, '-multipass')).toBe('fullres')
    expect(after(nvTarget, '-maxrate')).toBe('5200k')
    expect(after(nvTarget, '-pix_fmt')).toBe('nv12')

    const qsv = args({ config: cfg({ codec: 'av1', encoderMode: 'qsv', crf: 63 }), encoder: { mode: 'qsv', name: 'av1_qsv' } })
    expect(after(qsv, '-global_quality')).toBe('51')

    const amf = args({ config: cfg({ codec: 'av1', encoderMode: 'amf', crf: 30 }), encoder: { mode: 'amf', name: 'av1_amf' } })
    expect(after(amf, '-rc')).toBe('cqp')
    expect(after(amf, '-qp_i')).toBe('120')
  })

  it('handles surround audio for Opus and downmixing', () => {
    const opus = args({ config: cfg({ container: 'mkv', codec: 'av1', audioCodec: 'opus' }) })
    expect(after(opus, '-mapping_family')).toBe('1')
    const stereo = args({ config: cfg({ downmixStereo: true }) })
    expect(after(stereo, '-ac')).toBe('2')
    const none = args({ config: cfg({ audioCodec: 'none' }) })
    expect(none).toContain('-an')
  })

  it('clamps trims to the real duration', () => {
    expect(trimWindow(info, {})).toEqual({ start: 0, duration: 120, trimmed: false })
    expect(trimWindow(info, { trimStart: 10, trimEnd: 40 })).toEqual({ start: 10, duration: 30, trimmed: true })
    expect(trimWindow(info, { trimStart: 100, trimEnd: 500 })).toEqual({ start: 100, duration: 20, trimmed: true })
    expect(trimWindow(info, { trimStart: 50, trimEnd: 20 }).trimmed).toBe(false)
  })

  it('trims jobs and sizes the bitrate for the trimmed length', () => {
    const a = args({ config: cfg({ trimStart: 30, trimEnd: 45 }) })
    expect(after(a, '-ss')).toBe('30.000')
    expect(after(a, '-t')).toBe('15.000')
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))
    const full = computeTargetBitrate(120, 10 * MB, 128, 1)
    const clip = computeTargetBitrate(trimWindow(info, { trimStart: 30, trimEnd: 45 }).duration, 10 * MB, 128, 1)
    expect(clip).toBeGreaterThan(full * 7)
  })

  it('asks FFmpeg to decode on the graphics card when told to', () => {
    const a = args({ hwDecode: true, config: cfg({ trimStart: 5 }) })
    expect(after(a, '-hwaccel')).toBe('auto')
    expect(a.indexOf('-hwaccel')).toBeLessThan(a.indexOf('-i'))
    expect(args()).not.toContain('-hwaccel')
  })

  it('adds seek and duration for preview clips', () => {
    const a = args({ seekSeconds: 48, durationSeconds: 4 })
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))
    expect(after(a, '-ss')).toBe('48.000')
    expect(after(a, '-t')).toBe('4.000')
  })
})

describe('ProgressParser', () => {
  it('emits one snapshot per progress block across chunk boundaries', () => {
    const seen: FfmpegProgress[] = []
    const p = new ProgressParser((x) => seen.push(x))
    p.push('frame=120\nfps=59.8\nout_time_us=2002000\nspe')
    p.push('ed=1.99x\nprogress=continue\nframe=240\nout_time_us=N/A\nprogress=end\n')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ frame: 120, fps: 59.8, speed: 1.99, done: false })
    expect(seen[0].outTimeSeconds).toBeCloseTo(2.002, 3)
    expect(seen[1]).toMatchObject({ frame: 240, outTimeSeconds: null, done: true })
  })
})

describe('real encodes', async () => {
  const ok = await hasFfmpeg()
  let dir: string
  let source: string
  let sourceInfo: VideoInfo

  beforeAll(async () => {
    if (!ok) return
    dir = await tempDir()
    source = join(dir, 'clip.mp4')
    await makeTestVideo(source, { seconds: 4, width: 1280, height: 720 })
    sourceInfo = await probeVideo(source)
  }, 120_000)

  it.skipIf(!ok)('probes the clip', () => {
    expect(sourceInfo).toMatchObject({ width: 1280, height: 720, videoCodec: 'h264', audioCodec: 'aac', audioStreams: 1 })
    expect(sourceInfo.durationSeconds).toBeGreaterThan(3.9)
  })

  it.skipIf(!ok)('encodes with CRF and reports progress', async () => {
    const out = join(dir, 'crf.mkv')
    const events: number[] = []
    const r = await encodeVideo({
      input: source,
      output: out,
      info: sourceInfo,
      config: cfg({ container: 'mkv', crf: 30, preset: 'ultrafast', scale: '480p' }),
      hardware: null,
      onProgress: (p) => events.push(p.percent),
    })
    expect(r.bytes).toBeGreaterThan(1000)
    expect(events.length).toBeGreaterThan(0)
    const outInfo = await probeVideo(out)
    expect(outInfo).toMatchObject({ width: 854, height: 480, container: 'matroska' })
  })

  it.skipIf(!ok)('removes the GPS location from phone videos unless asked to keep it', async () => {
    const { getBinaryPaths } = await import('../src/main/binaries')
    const { runProcess } = await import('../src/main/utils/process')
    const { ffmpeg, ffprobe } = getBinaryPaths()
    const phone = join(dir, 'phone.mov')
    const tags = ['location=+51.5074-000.1278/', 'com.apple.quicktime.location.ISO6709=+51.5074-000.1278+010.000/', 'creation_time=2024-05-01T10:00:00Z']
    const made = await runProcess(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:d=1', '-c:v', 'libx264', '-movflags', 'use_metadata_tags', ...tags.flatMap((t) => ['-metadata', t]), phone])
    expect(made.code).toBe(0)
    const phoneInfo = await probeVideo(phone)
    const tagsOf = async (p: string): Promise<string> =>
      String((await runProcess(ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'compact', p])).stdout).toLowerCase()
    expect(await tagsOf(phone)).toContain('51.5074')
    for (const container of ['mp4', 'mkv'] as const) {
      const out = join(dir, `private.${container}`)
      await encodeVideo({ input: phone, output: out, info: phoneInfo, config: cfg({ container, preset: 'ultrafast' }), hardware: null })
      const t = await tagsOf(out)
      expect(t).not.toContain('51.5074')
      // The date it was filmed stays, so photo libraries keep their order.
      expect(t).toContain('creation_time=2024-05-01')
    }
    const kept = join(dir, 'kept.mp4')
    await encodeVideo({ input: phone, output: kept, info: phoneInfo, config: cfg({ preset: 'ultrafast', keepLocation: true }), hardware: null })
    expect(await tagsOf(kept)).toContain('51.5074')
  })

  it.skipIf(!ok)('fits a two-pass target size', async () => {
    const out = join(dir, 'target.mp4')
    const target = 300 * 1024
    const phases = new Set<string>()
    const r = await encodeVideo({
      input: source,
      output: out,
      info: sourceInfo,
      config: cfg({ rateControl: 'targetSize', targetMaxSizeBytes: target, audioBitrateKbps: 64, preset: 'fast' }),
      hardware: null,
      onProgress: (p) => p.phase && phases.add(p.phase),
    })
    expect(r.bytes).toBeLessThanOrEqual(target)
    expect((await stat(out)).size).toBe(r.bytes)
    expect([...phases].some((p) => p.startsWith('Pass 2'))).toBe(true)
  })

  it.skipIf(!ok)('encodes HEVC two-pass, AV1 and VP9', async () => {
    const hevc = await encodeVideo({
      input: source,
      output: join(dir, 'hevc.mp4'),
      info: sourceInfo,
      config: cfg({ codec: 'hevc', rateControl: 'bitrate', targetBitrateKbps: 500, preset: 'ultrafast', scale: '480p' }),
      hardware: null,
    })
    expect(hevc.encoder.name).toBe('libx265')
    const av1 = await encodeVideo({
      input: source,
      output: join(dir, 'av1.mkv'),
      info: sourceInfo,
      config: cfg({ container: 'mkv', codec: 'av1', crf: 40, preset: 'ultrafast', audioCodec: 'opus', scale: '480p' }),
      hardware: null,
    })
    expect(av1.bytes).toBeGreaterThan(1000)
    const vp9 = await encodeVideo({
      input: source,
      output: join(dir, 'vp9.webm'),
      info: sourceInfo,
      config: cfg({ container: 'webm', codec: 'vp9', crf: 40, preset: 'ultrafast', audioCodec: 'copy', scale: '480p' }),
      hardware: null,
    })
    expect(vp9.notes.join(' ')).toMatch(/OPUS/)
    const vp9Info = await probeVideo(join(dir, 'vp9.webm'))
    expect(vp9Info.audioCodec).toBe('opus')
  })

  it.skipIf(!ok)('falls back to the CPU when the graphics card encoder fails', async () => {
    // This machine has no NVIDIA card, so NVENC fails for real.
    const out = join(dir, 'fallback.mp4')
    const phases = new Set<string>()
    const r = await encodeVideo({
      input: source,
      output: out,
      info: sourceInfo,
      config: cfg({ encoderMode: 'nvenc', preset: 'ultrafast', scale: '480p' }),
      hardware: { ...({} as HardwareProfile), ...allGpus, performanceScore: 1 } as HardwareProfile,
      hwDecode: true,
      onProgress: (p) => p.phase && phases.add(p.phase),
    })
    expect(r.encoder.mode).toBe('cpu')
    expect(r.notes[0]).toMatch(/NVENC encoder failed/)
    expect([...phases]).toContain('Retrying on the CPU')
    expect((await probeVideo(out)).width).toBe(854)
  })

  it.skipIf(!ok)('encodes only the trimmed part', async () => {
    const out = join(dir, 'trim.mp4')
    await encodeVideo({
      input: source,
      output: out,
      info: sourceInfo,
      config: cfg({ preset: 'ultrafast', scale: '480p', trimStart: 1, trimEnd: 2.5 }),
      hardware: null,
    })
    const outInfo = await probeVideo(out)
    expect(outInfo.durationSeconds).toBeGreaterThan(1.3)
    expect(outInfo.durationSeconds).toBeLessThan(1.8)
  })

  it.skipIf(!ok)('cancels a running encode', async () => {
    const controller = new AbortController()
    const run = encodeVideo({
      input: source,
      output: join(dir, 'cancel.mp4'),
      info: sourceInfo,
      config: cfg({ codec: 'hevc', preset: 'slow' }),
      hardware: null,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 300)
    await expect(run).rejects.toThrow(/Cancelled/)
  })

  it.skipIf(!ok)('builds a preview clip with before/after frames', async () => {
    const r = await generateVideoPreview(
      { filePath: source, info: sourceInfo, config: cfg({ crf: 28, preset: 'ultrafast' }) },
      null,
    )
    expect(r.before.byteLength).toBeGreaterThan(1000)
    expect(r.after.byteLength).toBeGreaterThan(1000)
    expect(r.encodeFps).toBeGreaterThan(0)
    expect(r.estimatedBytes).toBeGreaterThanOrEqual(r.sampleBytes)
  })
})

describe('Apple VideoToolbox', () => {
  const mac = { encoderSupport: { h264: ['cpu', 'videotoolbox'], hevc: ['cpu', 'videotoolbox'], av1: ['cpu'], vp9: ['cpu'] } } as Pick<
    HardwareProfile,
    'encoderSupport'
  >

  it('is picked by auto on a Mac and maps quality to its 1-100 scale', () => {
    const config = cfg({ codec: 'hevc', crf: 24 })
    const encoder = resolveEncoder(config, mac)
    expect(encoder).toMatchObject({ mode: 'videotoolbox', name: 'hevc_videotoolbox' })
    const list = args({ config, encoder })
    expect(after(list, '-c:v')).toBe('hevc_videotoolbox')
    const q = Number(after(list, '-q:v'))
    expect(q).toBeGreaterThan(40)
    expect(q).toBeLessThan(70)
    expect(list).toContain('-allow_sw')
    // Better quality asks for a higher number.
    expect(Number(after(args({ config: cfg({ codec: 'hevc', crf: 18 }), encoder }), '-q:v'))).toBeGreaterThan(q)
  })

  it('uses a bitrate for target sizes and never handles AV1', () => {
    const config = cfg({ rateControl: 'bitrate', targetBitrateKbps: 3000 })
    const list = args({ config, encoder: resolveEncoder(config, mac), videoBitrateKbps: 3000 })
    expect(after(list, '-b:v')).toBe('3000k')
    expect(resolveEncoder(cfg({ codec: 'av1' }), mac).mode).toBe('cpu')
  })
})
