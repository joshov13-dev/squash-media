import * as Popover from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { CODECS, ENCODER_NAMES } from '@shared/codecs'
import type { EncoderMode, VideoCodec } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { useSystem } from '@renderer/store/systemStore'
import { FFMPEG_MISSING } from '@shared/messages'

const MODES: EncoderMode[] = window.api.platform === 'darwin' ? ['cpu', 'videotoolbox'] : ['cpu', 'nvenc', 'qsv', 'amf']
const MODE_NAMES: Record<EncoderMode, string> = { cpu: 'CPU', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF', videotoolbox: 'VideoToolbox' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-ink-3">{label}</span>
      <span className="num min-w-0 truncate text-right text-ink">{children}</span>
    </div>
  )
}

export function HardwarePopover({ children }: { children: ReactNode }) {
  const hw = useSystem((s) => s.hardware)
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-[360px] rounded-xl bg-raised p-4 text-[12px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
        >
          {!hw ? (
            <p className="text-ink-3">Detecting hardware...</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="mb-1.5 font-display text-[13px] font-semibold text-ink">This PC</h4>
                <Row label="Processor">{hw.cpuModel}</Row>
                <Row label="Cores">
                  {hw.physicalCores} cores, {hw.logicalCores} threads
                </Row>
                <Row label="Clock">
                  {hw.baseClockGHz ? `${hw.baseClockGHz} GHz` : 'unknown'}
                  {hw.boostClockGHz > hw.baseClockGHz ? ` (boost ${hw.boostClockGHz} GHz)` : ''}
                </Row>
                <Row label="Memory">{hw.totalMemoryGB} GB</Row>
                {hw.gpus.map((g, i) => (
                  <Row key={i} label={i === 0 ? 'Graphics' : ''}>
                    {g.model}
                    {g.vramMB ? ` · ${Math.round(g.vramMB / 1024)} GB` : ''}
                  </Row>
                ))}
                <Row label="Speed score">
                  {hw.performanceScore.toFixed(2)} · {hw.imageConcurrency} photo{hw.imageConcurrency > 1 ? 's' : ''} at once
                </Row>
              </div>

              <div>
                <h4 className="mb-1.5 font-display text-[13px] font-semibold text-ink">Video encoders</h4>
                {!hw.ffmpegAvailable ? (
                  <p className="leading-relaxed text-brick">
                    {FFMPEG_MISSING}
                  </p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="text-ink-3">
                        <th className="py-1 text-left font-normal" />
                        {MODES.map((m) => (
                          <th key={m} className="py-1 text-center font-normal">
                            {MODE_NAMES[m]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(CODECS) as VideoCodec[]).map((codec) => (
                        <tr key={codec}>
                          <td className="py-1 text-ink-2">{CODECS[codec].label}</td>
                          {MODES.map((m) => {
                            const offered = ENCODER_NAMES[codec][m] !== null
                            const works = hw.encoderSupport[codec].includes(m)
                            return (
                              <td key={m} className={cn('num py-1 text-center', works ? 'text-sage' : 'text-ink-3')}>
                                {!offered ? '' : works ? 'yes' : 'no'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {hw.ffmpegVersion && <p className="mt-2 text-ink-3">FFmpeg {hw.ffmpegVersion}</p>}
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
