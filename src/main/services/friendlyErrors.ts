// Turns raw Node, sharp and FFmpeg errors into something a person can act on.

interface Rule {
  test: RegExp
  message: string
}

const RULES: Rule[] = [
  {
    test: /spawn .*(ffmpeg|ffprobe).* ENOENT/i,
    message: 'FFmpeg is missing, so videos cannot be processed. Reinstalling SquashForge puts it back.',
  },
  {
    test: /ENOSPC|No space left on device|There is not enough space/i,
    message: 'The disk is full. Free up some space or save to another drive.',
  },
  {
    test: /EBUSY|resource busy or locked|being used by another process/i,
    message: 'Another program has this file open. Close it (a photo viewer or video player, say) and try again.',
  },
  {
    test: /EACCES|EPERM|permission denied|operation not permitted|Access is denied/i,
    message: 'Windows would not let SquashForge save here. Pick another output folder, or check the file is not read-only.',
  },
  {
    test: /ENOENT|No such file or directory/i,
    message: 'The file could not be found. It may have been moved, renamed or deleted after it was added.',
  },
  {
    test: /OpenEncodeSessionEx|No capable devices found|nvenc|CUDA|libcuda|nvcuda/i,
    message: 'The NVIDIA encoder would not start. Update the graphics driver, or switch the encoder to CPU.',
  },
  {
    test: /\bqsv\b|MFX|Quick ?Sync|libmfx|libvpl/i,
    message: 'The Intel Quick Sync encoder would not start. Update the graphics driver, or switch the encoder to CPU.',
  },
  {
    test: /\bamf\b|AMFContext|amfrt/i,
    message: 'The AMD encoder would not start. Update the graphics driver, or switch the encoder to CPU.',
  },
  {
    test: /Unknown encoder|Encoder not found/i,
    message: 'This encoder is not in the bundled FFmpeg. Choose a different codec or encoder.',
  },
  {
    test: /Invalid data found|moov atom not found|could not find codec parameters|Invalid argument.*Input|End of file/i,
    message: 'This video looks damaged or incomplete, so it cannot be read.',
  },
  {
    test: /Unsupported image format|Input buffer contains unsupported image format|Premature end|corrupt|VipsJpeg|VipsForeignLoad/i,
    message: 'This picture looks damaged or uses a format SquashForge cannot read.',
  },
  {
    test: /Input image exceeds pixel limit/i,
    message: 'This picture is too large to process.',
  },
  {
    test: /No video stream found/i,
    message: 'This file has no video in it.',
  },
]

export interface FriendlyError {
  message: string
  detail: string
}

export function friendlyError(error: unknown): FriendlyError {
  const detail = error instanceof Error ? error.message : String(error)
  const rule = RULES.find((r) => r.test.test(detail))
  return { message: rule?.message ?? `Something went wrong: ${detail}`, detail }
}
