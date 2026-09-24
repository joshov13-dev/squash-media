import { CODECS, ENCODER_LABELS, ENCODER_NAMES } from '@shared/codecs'
import { MB } from '@shared/presets'
import type { EncoderMode, VideoCodec } from '@shared/types'
import { useSettings } from '@renderer/store/settingsStore'
import { useSystem } from '@renderer/store/systemStore'
import { Field, NumberInput, Section, Segmented, Select, Slider, Toggle } from '../ui/controls'

const QUICK_TARGETS: Array<{ label: string; bytes: number }> = [
  { label: 'Discord 10 MB', bytes: 10 * MB },
  { label: 'Email 20 MB', bytes: 20 * MB },
  { label: '50 MB', bytes: 50 * MB },
  { label: '100 MB', bytes: 100 * MB },
]

const ENCODER_SHORT: Record<EncoderMode, string> = { cpu: 'CPU', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF' }

export function VideoSettings() {
  const video = useSettings((s) => s.video)
  const setVideo = useSettings((s) => s.setVideo)
  const hardware = useSystem((s) => s.hardware)
  const spec = CODECS[video.codec]
  const supported = hardware?.encoderSupport[video.codec] ?? ['cpu']
  const hwEncoder = video.encoderMode !== 'cpu' && supported.includes(video.encoderMode)
  const twoPassPossible = !hwEncoder && video.codec !== 'av1'

  const encoderOptions = (['cpu', 'nvenc', 'qsv', 'amf'] as EncoderMode[]).map((mode) => {
    const exists = ENCODER_NAMES[video.codec][mode] !== null
    const works = supported.includes(mode)
    let hint = `${ENCODER_LABELS[mode]}: ${ENCODER_NAMES[video.codec][mode]}`
    if (!exists) hint = `${ENCODER_LABELS[mode]} cannot encode ${spec.label}`
    else if (!works) hint = mode === 'cpu' ? 'This FFmpeg build lacks the encoder' : `${ENCODER_LABELS[mode]} was not detected on this PC`
    return { value: mode, label: ENCODER_SHORT[mode], disabled: !works, hint }
  })

  const codecOptions = (Object.keys(CODECS) as VideoCodec[]).map((codec) => ({
    value: codec,
    label: CODECS[codec].label,
    disabled: hardware ? hardware.encoderSupport[codec].length === 0 : false,
  }))

  return (
    <div className="pt-1">
      <Section title="Format">
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label="Codec">
            <Select ariaLabel="Codec" value={video.codec} onChange={(codec) => setVideo({ codec })} options={codecOptions} />
          </Field>
          <Field label="Container">
            <Select
              ariaLabel="Container"
              value={video.container}
              onChange={(container) => setVideo({ container })}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'mkv', label: 'MKV' },
                { value: 'webm', label: 'WebM' },
              ]}
            />
          </Field>
        </div>
        <Field label="Encoder">
          <Segmented value={supported.includes(video.encoderMode) ? video.encoderMode : 'cpu'} onChange={(encoderMode) => setVideo({ encoderMode })} options={encoderOptions} />
        </Field>
        <Field label="Speed" hint={hwEncoder ? 'GPU encoders are fast at every setting; slower gives slightly better quality.' : 'Slower presets squeeze harder at the same quality.'}>
          <Segmented
            value={video.preset}
            onChange={(preset) => setVideo({ preset })}
            options={[
              { value: 'ultrafast', label: 'Fastest' },
              { value: 'fast', label: 'Fast' },
              { value: 'medium', label: 'Medium' },
              { value: 'slow', label: 'Slow' },
            ]}
          />
        </Field>
      </Section>

      <Section title="Quality">
        <Segmented
          value={video.rateControl}
          onChange={(rateControl) => setVideo({ rateControl })}
          options={[
            { value: 'crf', label: 'Quality' },
            { value: 'targetSize', label: 'Target size' },
            { value: 'bitrate', label: 'Bitrate' },
          ]}
        />
        {video.rateControl === 'crf' && (
          <Field
            label={video.codec === 'h264' || video.codec === 'hevc' ? 'Rate factor (RF)' : 'CRF'}
            value={video.crf}
            hint={`Lower means better quality and bigger files. ${spec.sweetSpot[0]} to ${spec.sweetSpot[1]} is the sweet spot for ${spec.label}.`}
          >
            <Slider ariaLabel="Constant rate factor" value={video.crf} min={spec.crfMin} max={spec.crfMax} band={spec.sweetSpot} onChange={(crf) => setVideo({ crf })} />
          </Field>
        )}
        {video.rateControl === 'targetSize' && (
          <Field label="Target file size" hint="The bitrate is worked out from the duration. If the result overshoots, it is re-encoded to fit.">
            <NumberInput
              ariaLabel="Target size in megabytes"
              value={Math.round((video.targetMaxSizeBytes / MB) * 10) / 10}
              min={1}
              step={1}
              suffix="MB"
              onChange={(mb) => setVideo({ targetMaxSizeBytes: Math.max(1, mb) * MB })}
            />
            <div className="flex flex-wrap gap-1">
              {QUICK_TARGETS.map((t) => (
                <button
                  key={t.bytes}
                  type="button"
                  onClick={() => setVideo({ targetMaxSizeBytes: t.bytes })}
                  className="h-6 rounded px-1.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        {video.rateControl === 'bitrate' && (
          <Field label="Average video bitrate">
            <NumberInput ariaLabel="Bitrate" value={video.targetBitrateKbps} min={100} max={200000} step={100} suffix="kbps" onChange={(v) => setVideo({ targetBitrateKbps: Math.round(v) })} />
          </Field>
        )}
        {video.rateControl !== 'crf' && (
          <Toggle
            label="Two-pass encoding"
            hint={twoPassPossible ? 'Analyses the video first so the bitrate goes where it is needed.' : 'GPU and SVT-AV1 encoders use single-pass VBR here.'}
            checked={video.twoPass && twoPassPossible}
            disabled={!twoPassPossible}
            onChange={(twoPass) => setVideo({ twoPass })}
          />
        )}
      </Section>

      <Section title="Picture">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Resolution">
            <Select
              ariaLabel="Resolution"
              value={video.scale}
              onChange={(scale) => setVideo({ scale })}
              options={[
                { value: 'original', label: 'Original' },
                { value: '2160p', label: '4K (2160p)' },
                { value: '1440p', label: '1440p' },
                { value: '1080p', label: '1080p' },
                { value: '720p', label: '720p' },
                { value: '480p', label: '480p' },
              ]}
            />
          </Field>
          <Field label="Frame rate">
            <Select
              ariaLabel="Frame rate"
              value={String(video.fpsLimit)}
              onChange={(v) => setVideo({ fpsLimit: Number(v) })}
              options={[
                { value: '0', label: 'Original' },
                { value: '60', label: '60 fps max' },
                { value: '30', label: '30 fps max' },
                { value: '24', label: '24 fps max' },
              ]}
            />
          </Field>
        </div>
        <p className="text-[12px] text-ink-3">Never upscales. Portrait videos are capped on their short side.</p>
      </Section>

      <Section title="Audio">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Codec">
            <Select
              ariaLabel="Audio codec"
              value={video.audioCodec}
              onChange={(audioCodec) => setVideo({ audioCodec })}
              options={[
                { value: 'copy', label: 'Passthrough' },
                { value: 'aac', label: 'AAC', disabled: video.container === 'webm' },
                { value: 'opus', label: 'Opus' },
                { value: 'none', label: 'No audio' },
              ]}
            />
          </Field>
          <Field label="Bitrate">
            <Select
              ariaLabel="Audio bitrate"
              value={String(video.audioBitrateKbps)}
              onChange={(v) => setVideo({ audioBitrateKbps: Number(v) })}
              options={[64, 96, 128, 160, 192, 256, 320].map((k) => ({ value: String(k), label: `${k} kbps` }))}
            />
          </Field>
        </div>
        <Toggle
          label="Downmix to stereo"
          hint="Folds surround sound into two channels."
          checked={video.downmixStereo}
          disabled={video.audioCodec === 'copy' || video.audioCodec === 'none'}
          onChange={(downmixStereo) => setVideo({ downmixStereo })}
        />
      </Section>
    </div>
  )
}
