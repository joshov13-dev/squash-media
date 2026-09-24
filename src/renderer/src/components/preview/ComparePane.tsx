import { ChevronsLeftRight, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

interface ComparePaneProps {
  beforeUrl?: string
  afterUrl?: string
  beforeLabel?: ReactNode
  afterLabel?: ReactNode
  /** Size of the content at 100% zoom (the source's pixel size). */
  contentWidth: number
  contentHeight: number
  loading?: boolean
  /** Rendered centred over the image, e.g. a call to action. */
  overlay?: ReactNode
  /** Changing this resets zoom and pan (e.g. the file id). */
  viewKey?: string
}

const PADDING = 24
const MAX_ZOOM = 16

/** Caesium-style split view: drag the divider, wheel to zoom, drag to pan. */
export function ComparePane({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Original',
  afterLabel = 'Compressed',
  contentWidth,
  contentHeight,
  loading,
  overlay,
  viewKey,
}: ComparePaneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [split, setSplit] = useState(0.5)
  const [zoom, setZoom] = useState<number | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ mode: 'split' | 'pan'; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<'split' | 'pan' | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset the view for a different file.
  useEffect(() => {
    setZoom(null)
    setOffset({ x: 0, y: 0 })
  }, [contentWidth, contentHeight, viewKey])

  const W = Math.max(1, contentWidth)
  const H = Math.max(1, contentHeight)
  const fit = Math.min((box.w - PADDING * 2) / W, (box.h - PADDING * 2) / H, 1)
  const fitScale = fit > 0 ? fit : 1
  const scale = zoom ?? fitScale
  const stageW = W * scale
  const stageH = H * scale

  const clampOffset = useCallback(
    (o: { x: number; y: number }, s: number) => {
      const sw = W * s
      const sh = H * s
      const maxX = Math.max(0, (sw - box.w) / 2 + PADDING)
      const maxY = Math.max(0, (sh - box.h) / 2 + PADDING)
      return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
    },
    [W, H, box.w, box.h],
  )

  const stageLeft = (box.w - stageW) / 2 + offset.x
  const stageTop = (box.h - stageH) / 2 + offset.y
  const splitX = split * box.w
  const clipLeft = Math.max(0, Math.min(stageW, splitX - stageLeft))

  /** Zoom to `next`, keeping the content point under (mx, my) still. */
  const zoomAt = useCallback(
    (next: number, mx: number, my: number) => {
      const s = Math.max(Math.min(fitScale, 0.05), Math.min(MAX_ZOOM, next))
      if (s <= fitScale + 1e-6) {
        setZoom(null)
        setOffset({ x: 0, y: 0 })
        return
      }
      const px = (mx - stageLeft) / scale
      const py = (my - stageTop) / scale
      const left = mx - px * s
      const top = my - py * s
      setZoom(s)
      setOffset(clampOffset({ x: left - (box.w - W * s) / 2, y: top - (box.h - H * s) / 2 }, s))
    },
    [fitScale, stageLeft, stageTop, scale, box.w, box.h, W, H, clampOffset],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, scale])

  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const zoomed = zoom !== null
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const p = local(e)
    const nearLine = comparing && Math.abs(p.x - splitX) < 14
    const mode = nearLine || (!zoomed && comparing) ? 'split' : 'pan'
    drag.current = { mode, x: e.clientX, y: e.clientY }
    setDragging(mode)
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (mode === 'split') setSplit(Math.max(0, Math.min(1, p.x / box.w)))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'split') {
      setSplit(Math.max(0, Math.min(1, local(e).x / box.w)))
    } else {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, scale))
    }
  }
  const onPointerUp = (): void => {
    drag.current = null
    setDragging(null)
  }
  const onDoubleClick = (e: React.MouseEvent): void => {
    const r = ref.current!.getBoundingClientRect()
    if (zoomed) {
      setZoom(null)
      setOffset({ x: 0, y: 0 })
    } else {
      zoomAt(1 > fitScale ? 1 : fitScale * 2, e.clientX - r.left, e.clientY - r.top)
    }
  }

  const comparing = Boolean(beforeUrl && afterUrl)
  const pixelated = scale >= 2
  const imgClass = cn('absolute inset-0 h-full w-full max-w-none select-none', pixelated && '[image-rendering:pixelated]')
  const cursor = dragging === 'pan' ? 'cursor-grabbing' : zoomed ? 'cursor-grab' : comparing ? 'cursor-col-resize' : 'cursor-default'

  return (
    <div
      ref={ref}
      className={cn('relative h-full w-full touch-none overflow-hidden', cursor)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {box.w > 0 && (beforeUrl || afterUrl) && (
        <div
          className="absolute bg-[conic-gradient(#1d1b19_25%,#23211e_0_50%,#1d1b19_0_75%,#23211e_0)] bg-[length:16px_16px] shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8)]"
          style={{ left: stageLeft, top: stageTop, width: stageW, height: stageH }}
        >
          {beforeUrl && <img src={beforeUrl} alt="Original" className={imgClass} draggable={false} />}
          {afterUrl && (
            <img
              src={afterUrl}
              alt="Compressed"
              className={imgClass}
              draggable={false}
              style={comparing ? { clipPath: `inset(0 0 0 ${clipLeft}px)` } : undefined}
            />
          )}
        </div>
      )}

      {/* Divider */}
      {comparing && (
        <div className="pointer-events-none absolute inset-y-0" style={{ left: splitX }}>
          <div className="absolute inset-y-0 -left-px w-0.5 bg-ink/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
          <div className="absolute top-1/2 -left-4 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-ground shadow-[0_4px_14px_rgba(0,0,0,0.5)]">
            <ChevronsLeftRight size={16} strokeWidth={2.25} />
          </div>
        </div>
      )}

      {beforeUrl && beforeLabel && (
        <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-ground/85 px-2 py-1 text-[12px] text-ink-2">{beforeLabel}</span>
      )}
      {afterUrl && afterLabel && (
        <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-ground/85 px-2 py-1 text-[12px] text-ink-2">{afterLabel}</span>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-ember [animation:sweep_1.1s_ease-in-out_infinite]" />
        </div>
      )}

      {overlay && <div className="absolute inset-0 flex items-center justify-center">{overlay}</div>}

      {/* Zoom controls */}
      {(beforeUrl || afterUrl) && !overlay && (
        <div
          className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg bg-raised p-0.5 text-[12px] text-ink-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)]"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" className={cn('h-7 rounded-md px-2 hover:bg-hover hover:text-ink', !zoomed && 'bg-hover text-ink')} onClick={() => { setZoom(null); setOffset({ x: 0, y: 0 }) }}>
            Fit
          </button>
          <button type="button" className={cn('h-7 rounded-md px-2 hover:bg-hover hover:text-ink', zoom === 1 && 'bg-hover text-ink')} onClick={() => zoomAt(1, box.w / 2, box.h / 2)}>
            100%
          </button>
          <button type="button" aria-label="Zoom out" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-ink" onClick={() => zoomAt(scale / 1.5, box.w / 2, box.h / 2)}>
            <Minus size={14} />
          </button>
          <span className="num w-12 text-center text-ink">{Math.round(scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-ink" onClick={() => zoomAt(scale * 1.5, box.w / 2, box.h / 2)}>
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
