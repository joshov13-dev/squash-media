// Lossless JPEG slimming: drops metadata segments without touching the
// compressed image data, so the pixels are bit-for-bit identical.
//
// Kept:    APP0 (JFIF), APP2 ICC profile, APP14 (Adobe colour transform),
//          all coding segments (DQT, DHT, SOF, SOS, DRI, ...).
// Dropped: EXIF (replaced by a tiny orientation-only EXIF when needed),
//          XMP, IPTC/Photoshop, MPF, comments, other APPn, and trailing data
//          after the end-of-image marker (e.g. embedded preview images).

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const APP0 = 0xe0
const APP1 = 0xe1
const APP2 = 0xe2
const APP14 = 0xee

function startsWith(buf: Buffer, offset: number, text: string): boolean {
  if (offset + text.length > buf.length) return false
  for (let i = 0; i < text.length; i++) if (buf[offset + i] !== text.charCodeAt(i)) return false
  return true
}

/** Read the EXIF orientation (1-8) from an APP1 payload, if present. */
export function readExifOrientation(payload: Buffer): number | null {
  if (!startsWith(payload, 0, 'Exif\0\0')) return null
  const tiff = 6
  if (payload.length < tiff + 8) return null
  const little = payload[tiff] === 0x49
  const u16 = (o: number): number => (little ? payload.readUInt16LE(o) : payload.readUInt16BE(o))
  const u32 = (o: number): number => (little ? payload.readUInt32LE(o) : payload.readUInt32BE(o))
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > payload.length) return null
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > payload.length) break
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/** A minimal little-endian EXIF block holding only the orientation tag. */
export function buildOrientationExif(orientation: number): Buffer {
  const payload = Buffer.alloc(6 + 8 + 2 + 12 + 4)
  payload.write('Exif\0\0', 0, 'latin1')
  const t = 6
  payload.write('II', t, 'latin1')
  payload.writeUInt16LE(42, t + 2)
  payload.writeUInt32LE(8, t + 4)
  payload.writeUInt16LE(1, t + 8)
  payload.writeUInt16LE(0x0112, t + 10)
  payload.writeUInt16LE(3, t + 12) // SHORT
  payload.writeUInt32LE(1, t + 14)
  payload.writeUInt16LE(orientation, t + 18)
  payload.writeUInt32LE(0, t + 22) // no next IFD
  const header = Buffer.from([0xff, APP1, 0, 0])
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

function keepSegment(marker: number, payload: Buffer): boolean {
  if (marker === APP0) return true
  if (marker === APP14) return true
  if (marker === APP2) return startsWith(payload, 0, 'ICC_PROFILE\0')
  if (marker >= 0xe0 && marker <= 0xef) return false
  if (marker === 0xfe) return false // COM
  return true
}

/**
 * Strip metadata from a baseline or progressive JPEG.
 * Returns the input unchanged if it does not look like a well-formed JPEG.
 */
export function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) return input
  const parts: Buffer[] = [input.subarray(0, 2)]
  let orientation: number | null = null
  let pos = 2

  try {
    while (pos < input.length) {
      if (input[pos] !== 0xff) return input
      // Skip fill bytes.
      while (input[pos] === 0xff && input[pos + 1] === 0xff) pos++
      const marker = input[pos + 1]
      if (marker === EOI) {
        parts.push(input.subarray(pos, pos + 2))
        break
      }
      if (marker === SOI || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        parts.push(input.subarray(pos, pos + 2))
        pos += 2
        continue
      }
      const length = input.readUInt16BE(pos + 2)
      const segEnd = pos + 2 + length
      if (segEnd > input.length) return input
      const payload = input.subarray(pos + 4, segEnd)

      if (marker === APP1 && orientation === null) {
        const o = readExifOrientation(payload)
        if (o !== null) orientation = o
      }

      if (marker === SOS) {
        // Copy the scan header and its entropy-coded data up to the next marker.
        let scanEnd = segEnd
        while (scanEnd < input.length - 1) {
          if (input[scanEnd] === 0xff) {
            const next = input[scanEnd + 1]
            if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break
          }
          scanEnd++
        }
        parts.push(input.subarray(pos, scanEnd))
        pos = scanEnd
        continue
      }

      if (keepSegment(marker, payload)) parts.push(input.subarray(pos, segEnd))
      pos = segEnd
    }
  } catch {
    return input
  }

  // Put the orientation back right after SOI (and JFIF, if present) so the
  // photo still displays the right way up.
  if (orientation !== null && orientation !== 1) {
    const exif = buildOrientationExif(orientation)
    const hasJfif = parts.length > 1 && parts[1][1] === APP0
    parts.splice(hasJfif ? 2 : 1, 0, exif)
  }
  return Buffer.concat(parts)
}
