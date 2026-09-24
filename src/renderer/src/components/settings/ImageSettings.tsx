import { KB, MB } from '@shared/presets'
import type { ImageJobConfig } from '@shared/types'
import { useImageEditor } from '@renderer/store/editors'
import { allImagePresets, useSettings } from '@renderer/store/settingsStore'
import { Field, NumberInput, Section, Segmented, Select, Slider, Toggle } from '../ui/controls'
import { SettingsHeader } from './SettingsHeader'

const QUALITY_HINTS: Record<ImageJobConfig['format'], string> = {
  original: 'Applies each format’s own quality scale. Around 80 is visually lossless for most photos.',
  jpeg: 'MozJPEG. 75 to 85 is the sweet spot; artefacts creep in below 60.',
  png: 'Reduces the colour palette, like TinyPNG. Great for graphics and screenshots.',
  webp: 'WebP is roughly 30% smaller than JPEG at the same quality.',
  avif: 'AVIF gives the smallest files. 50 to 65 looks like JPEG at 80. Slower to encode.',
}

const LOSSLESS_HINTS: Record<ImageJobConfig['format'], string> = {
  original: 'JPEGs keep their exact pixels and only lose metadata. PNG, WebP, AVIF and TIFF are re-packed losslessly.',
  jpeg: 'Same-format JPEGs only lose metadata, so pixels stay bit-for-bit identical. Converted or resized files are saved at quality 100.',
  png: 'Tries several DEFLATE strategies at maximum effort and keeps the smallest.',
  webp: 'Lossless WebP at maximum effort. Usually much smaller than PNG.',
  avif: 'Lossless AVIF. Best for graphics; photos can end up larger.',
}

const QUICK_TARGETS = [200 * KB, 500 * KB, 1 * MB, 2 * MB]

function TargetSize({ image, setImage }: { image: ImageJobConfig; setImage: (patch: Partial<ImageJobConfig>) => void }) {
  const inMb = image.targetMaxSizeBytes >= MB
  const unit = inMb ? MB : KB
  const value = Math.round((image.targetMaxSizeBytes / unit) * 100) / 100
  return (
    <Field label="Maximum file size" hint="Finds the highest quality that fits, then shrinks the image if it still does not. Metadata is always removed.">
      <div className="flex gap-2">
        <div className="flex-1">
          <NumberInput ariaLabel="Maximum size" value={value} min={1} step={inMb ? 0.5 : 10} onChange={(v) => setImage({ targetMaxSizeBytes: Math.max(1, Math.round(v * unit)) })} />
        </div>
        <Segmented
          className="w-28"
          value={inMb ? 'mb' : 'kb'}
          onChange={(u) => setImage({ targetMaxSizeBytes: Math.round(value * (u === 'mb' ? MB : KB)) })}
          options={[
            { value: 'kb', label: 'KB' },
            { value: 'mb', label: 'MB' },
          ]}
        />
      </div>
      <div className="flex gap-1">
        {QUICK_TARGETS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setImage({ targetMaxSizeBytes: t })}
            className="num h-6 rounded px-1.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t >= MB ? `${t / MB} MB` : `${t / KB} KB`}
          </button>
        ))}
      </div>
    </Field>
  )
}

export function ImageSettings() {
  const editor = useImageEditor()
  const custom = useSettings((s) => s.customImagePresets)
  const savePreset = useSettings((s) => s.saveImagePreset)
  const deletePreset = useSettings((s) => s.deletePreset)
  const { config: image, set: setImage, setResize } = editor
  const showProgressive = image.format === 'jpeg' || image.format === 'original'

  return (
    <div className="pt-1">
      <SettingsHeader
        kind="photo"
        job={editor.job}
        scope={editor.scope}
        onScope={editor.setScope}
        presets={allImagePresets(custom)}
        presetId={editor.presetId}
        onPreset={editor.applyPreset}
        onReset={editor.reset}
        onSavePreset={savePreset}
        onDeletePreset={deletePreset}
      />
      <Section title="Format">
        <Segmented
          value={image.format}
          onChange={(format) => setImage({ format })}
          options={[
            { value: 'original', label: 'Same', hint: 'Keep each file’s format (BMP becomes PNG, HEIC becomes JPEG)' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WebP' },
            { value: 'avif', label: 'AVIF' },
          ]}
        />
      </Section>

      <Section title="Compression">
        <Segmented
          value={image.mode}
          onChange={(mode) => setImage({ mode })}
          options={[
            { value: 'quality', label: 'Quality' },
            { value: 'lossless', label: 'Lossless' },
            { value: 'targetSize', label: 'Max size' },
          ]}
        />
        {image.mode === 'quality' && (
          <Field label="Quality" value={image.quality} hint={QUALITY_HINTS[image.format]}>
            <Slider ariaLabel="Quality" value={image.quality} min={1} max={100} band={[70, 85]} onChange={(quality) => setImage({ quality })} />
          </Field>
        )}
        {image.mode === 'lossless' && <p className="text-[12px] leading-relaxed text-ink-3">{LOSSLESS_HINTS[image.format]}</p>}
        {image.mode === 'targetSize' && <TargetSize image={image} setImage={setImage} />}
        {showProgressive && image.mode !== 'lossless' && (
          <Toggle label="Progressive JPEG" hint="Loads in passes on the web; often slightly smaller." checked={image.progressive} onChange={(progressive) => setImage({ progressive })} />
        )}
      </Section>

      <Section title="Metadata">
        <Toggle
          label="Strip metadata"
          hint="Removes EXIF, GPS location, camera details and XMP. Photos are rotated upright first."
          checked={image.stripMetadata}
          onChange={(stripMetadata) => setImage({ stripMetadata })}
        />
      </Section>

      <Section title="Resize">
        <Segmented
          value={image.resize.mode}
          onChange={(mode) => setResize({ mode })}
          options={[
            { value: 'none', label: 'Off' },
            { value: 'percentage', label: 'Percent' },
            { value: 'fit', label: 'Fit in box' },
          ]}
        />
        {image.resize.mode === 'percentage' && (
          <Field label="Scale" value={`${image.resize.percentage}%`}>
            <Slider ariaLabel="Scale" value={image.resize.percentage} min={5} max={100} onChange={(percentage) => setResize({ percentage })} />
          </Field>
        )}
        {image.resize.mode === 'fit' && (
          <Field label="Longest edges" hint="Keeps the aspect ratio. Smaller images are left alone.">
            <div className="flex items-center gap-2">
              <NumberInput ariaLabel="Maximum width" value={image.resize.maxWidth} min={1} max={65535} suffix="W" onChange={(maxWidth) => setResize({ maxWidth: Math.round(maxWidth) })} />
              <span className="text-ink-3">×</span>
              <NumberInput ariaLabel="Maximum height" value={image.resize.maxHeight} min={1} max={65535} suffix="H" onChange={(maxHeight) => setResize({ maxHeight: Math.round(maxHeight) })} />
            </div>
          </Field>
        )}
        {image.resize.mode !== 'none' && (
          <Field label="Resampling">
            <Select
              ariaLabel="Resampling"
              value={image.resize.kernel}
              onChange={(kernel) => setResize({ kernel })}
              options={[
                { value: 'lanczos3', label: 'Lanczos', detail: 'sharpest' },
                { value: 'mitchell', label: 'Mitchell', detail: 'softer' },
                { value: 'nearest', label: 'Nearest neighbour', detail: 'pixel art' },
              ]}
            />
          </Field>
        )}
      </Section>
    </div>
  )
}
