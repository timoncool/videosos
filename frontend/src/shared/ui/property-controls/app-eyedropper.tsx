/**
 * In-app eyedropper (promptless, whole-app) with a magnifier loupe.
 *
 * Replaces the native `EyeDropper` API, which on Chrome/Windows leaves the tab
 * unfocused and unclickable after a pick (an OS window-occlusion bug no page
 * code can fix). Browsers won't let a page read arbitrary rendered pixels
 * without a share prompt — but a page CAN read its own content, so we sample
 * per element under the cursor:
 *   - the WebGPU preview → the composited frame from the capture bridge,
 *   - any same-origin <img>/<video>/<canvas> → the pixel under the cursor,
 *   - anything else → its computed background colour.
 * No OS overlay, no permission prompt, works anywhere in the app.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { usePlaybackStore } from '@/shared/state/playback'
import { clamp } from '@/shared/utils/math'

const CURSOR_OFFSET = 20
// Loupe geometry: an odd window keeps the sampled pixel centred under the reticle.
const LOUPE_N = 11
const LOUPE_HALF = Math.floor(LOUPE_N / 2)
const LOUPE_ZOOM = 14
const LOUPE_PX = LOUPE_N * LOUPE_ZOOM

function toHexByte(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

/** An `LOUPE_N`×`LOUPE_N` crop around the sample, with the reticle cell. */
interface Loupe {
  data: ImageData
  rx: number
  ry: number
}

interface Picked {
  hex: string
  loupe: Loupe | null
}

// A reused 1×1 probe canvas: the 2D context converts ANY CSS colour string
// (oklch, oklab, hsl, named, rgb…) to concrete RGBA. Regex parsing can't — this
// app themes entirely in oklch, so `getComputedStyle().backgroundColor` returns
// e.g. `oklch(0.15 0 0)`.
let colorProbeCtx: CanvasRenderingContext2D | null = null

/** Resolve a CSS colour to `#rrggbb`; null if unset or mostly transparent. */
function cssColorToHex(css: string): string | null {
  if (!css || css === 'transparent') return null
  if (!colorProbeCtx) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    colorProbeCtx = canvas.getContext('2d', { willReadFrequently: true })
  }
  const ctx = colorProbeCtx
  if (!ctx) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  // Skip mostly-transparent layers so the fallback keeps walking to the solid
  // background beneath (e.g. a 30%-opacity input over a panel).
  if ((d[3] ?? 0) < 128) return null
  return `#${toHexByte(d[0] ?? 0)}${toHexByte(d[1] ?? 0)}${toHexByte(d[2] ?? 0)}`
}

function hexFromLoupe(loupe: Loupe): string {
  const i = (loupe.ry * loupe.data.width + loupe.rx) * 4
  const d = loupe.data.data
  return `#${toHexByte(d[i] ?? 0)}${toHexByte(d[i + 1] ?? 0)}${toHexByte(d[i + 2] ?? 0)}`
}

/** Crop an `LOUPE_N`² region from an ImageData, clamped at edges. */
function loupeFromImageData(src: ImageData, cx: number, cy: number): Loupe {
  const x0 = clamp(cx - LOUPE_HALF, 0, Math.max(0, src.width - LOUPE_N))
  const y0 = clamp(cy - LOUPE_HALF, 0, Math.max(0, src.height - LOUPE_N))
  const data = new ImageData(LOUPE_N, LOUPE_N)
  for (let dy = 0; dy < LOUPE_N; dy++) {
    for (let dx = 0; dx < LOUPE_N; dx++) {
      const sx = clamp(x0 + dx, 0, src.width - 1)
      const sy = clamp(y0 + dy, 0, src.height - 1)
      const si = (sy * src.width + sx) * 4
      const di = (dy * LOUPE_N + dx) * 4
      data.data[di] = src.data[si] ?? 0
      data.data[di + 1] = src.data[si + 1] ?? 0
      data.data[di + 2] = src.data[si + 2] ?? 0
      data.data[di + 3] = 255
    }
  }
  return { data, rx: clamp(cx - x0, 0, LOUPE_N - 1), ry: clamp(cy - y0, 0, LOUPE_N - 1) }
}

/** Crop an `LOUPE_N`² region from a drawable element around (sx, sy). */
function loupeFromElement(
  el: CanvasImageSource,
  sx: number,
  sy: number,
  natW: number,
  natH: number,
): Loupe | null {
  const x0 = clamp(sx - LOUPE_HALF, 0, Math.max(0, natW - LOUPE_N))
  const y0 = clamp(sy - LOUPE_HALF, 0, Math.max(0, natH - LOUPE_N))
  const canvas = document.createElement('canvas')
  canvas.width = LOUPE_N
  canvas.height = LOUPE_N
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(el, x0, y0, LOUPE_N, LOUPE_N, 0, 0, LOUPE_N, LOUPE_N)
    return {
      data: ctx.getImageData(0, 0, LOUPE_N, LOUPE_N),
      rx: clamp(sx - x0, 0, LOUPE_N - 1),
      ry: clamp(sy - y0, 0, LOUPE_N - 1),
    }
  } catch {
    return null // cross-origin taint
  }
}

/** Sample an <img>/<video>/<canvas> pixel, honouring object-fit. */
function samplePixelElement(
  el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Picked | null {
  const natW =
    el instanceof HTMLImageElement
      ? el.naturalWidth
      : el instanceof HTMLVideoElement
        ? el.videoWidth
        : el.width
  const natH =
    el instanceof HTMLImageElement
      ? el.naturalHeight
      : el instanceof HTMLVideoElement
        ? el.videoHeight
        : el.height
  if (!natW || !natH) return null

  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const fit = el instanceof HTMLCanvasElement ? 'fill' : getComputedStyle(el).objectFit || 'fill'

  let dw = rect.width
  let dh = rect.height
  const boxAR = rect.width / rect.height
  const natAR = natW / natH
  if (fit === 'contain' || fit === 'scale-down') {
    if (natAR > boxAR) dh = rect.width / natAR
    else dw = rect.height * natAR
  } else if (fit === 'cover') {
    if (natAR > boxAR) dw = rect.height * natAR
    else dh = rect.width / natAR
  } else if (fit === 'none') {
    dw = natW
    dh = natH
  }
  const ox = (rect.width - dw) / 2
  const oy = (rect.height - dh) / 2

  const u = (clientX - rect.left - ox) / dw
  const v = (clientY - rect.top - oy) / dh
  if (u < 0 || u > 1 || v < 0 || v > 1) return null // in the letterboxed margin

  const sx = clamp(Math.round(u * (natW - 1)), 0, natW - 1)
  const sy = clamp(Math.round(v * (natH - 1)), 0, natH - 1)
  const loupe = loupeFromElement(el, sx, sy, natW, natH)
  if (!loupe) return null
  return { hex: hexFromLoupe(loupe), loupe }
}

interface Preview {
  frame: ImageData
  rect: DOMRect
}

function samplePreview(preview: Preview, clientX: number, clientY: number): Picked | null {
  const { frame, rect } = preview
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null
  }
  const nx = clamp((clientX - rect.left) / rect.width, 0, 1)
  const ny = clamp((clientY - rect.top) / rect.height, 0, 1)
  const px = clamp(Math.round(nx * (frame.width - 1)), 0, frame.width - 1)
  const py = clamp(Math.round(ny * (frame.height - 1)), 0, frame.height - 1)
  const loupe = loupeFromImageData(frame, px, py)
  return { hex: hexFromLoupe(loupe), loupe }
}

interface AppEyedropperOverlayProps {
  /** Called with the picked `#rrggbb`, or `null` when cancelled. */
  onResolve: (hex: string | null) => void
  /**
   * Restrict sampling to the video preview only (ignore UI/other elements).
   * Use for image-only pickers like the color-wheel white-balance/black/white
   * point, where sampling a panel or a CSS-gradient wheel is meaningless.
   */
  previewOnly?: boolean
}

interface Hover extends Picked {
  x: number
  y: number
}

export const AppEyedropperOverlay = memo(function AppEyedropperOverlay({
  onResolve,
  previewOnly = false,
}: AppEyedropperOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<Preview | null>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  // Freeze playback and cache the composited preview frame once, so hovering the
  // preview reads a stable, effect-accurate pixel without re-capturing per move.
  useEffect(() => {
    let cancelled = false
    // Remember whether playback was running so we can resume it on close — the
    // picker only pauses to freeze a stable frame to sample, not to stop the user.
    const wasPlaying = usePlaybackStore.getState().isPlaying
    usePlaybackStore.getState().pause()
    const capture = usePreviewBridgeStore.getState().captureFrameImageData
    const container = document.querySelector('[data-player-container]')
    if (capture && container) {
      // NB: no `fresh` — sample the already-displayed frame. Forcing a fresh
      // render stalls ~2s behind the Color workspace's continuous scope
      // captures; the displayed frame is instant and matches what the user sees.
      capture()
        .then((frame) => {
          if (!cancelled && frame) {
            previewRef.current = { frame, rect: container.getBoundingClientRect() }
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
      if (wasPlaying) usePlaybackStore.getState().play()
    }
  }, [])

  const pickAt = useCallback(
    (clientX: number, clientY: number): Picked | null => {
      const preview = previewRef.current
      if (preview) {
        const fromPreview = samplePreview(preview, clientX, clientY)
        if (fromPreview) return fromPreview
      }
      // Image-only pickers stop here: no sampling of UI / gradient wheels.
      if (previewOnly) return null
      const stack = document
        .elementsFromPoint(clientX, clientY)
        .filter((el) => el !== overlayRef.current) as HTMLElement[]

      for (const el of stack) {
        if (
          el instanceof HTMLImageElement ||
          el instanceof HTMLVideoElement ||
          el instanceof HTMLCanvasElement
        ) {
          const px = samplePixelElement(el, clientX, clientY)
          if (px) return px
        }
      }
      // Fall back to the first opaque background colour up the stack (no loupe).
      for (const el of stack) {
        let node: HTMLElement | null = el
        while (node) {
          const hex = cssColorToHex(getComputedStyle(node).backgroundColor)
          if (hex) return { hex, loupe: null }
          node = node.parentElement
        }
      }
      return null
    },
    [previewOnly],
  )

  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null)
  const moveRafRef = useRef<number | null>(null)

  const handleMove = useCallback(
    (event: React.MouseEvent) => {
      // Coalesce rapid mousemoves to at most one sample per animation frame.
      // pickAt() runs elementsFromPoint + canvas readback, too costly to fire on
      // every pointer event; the loupe only needs the latest position per frame.
      pendingMoveRef.current = { x: event.clientX, y: event.clientY }
      if (moveRafRef.current !== null) return
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null
        const pos = pendingMoveRef.current
        if (!pos) return
        const picked = pickAt(pos.x, pos.y)
        setHover(picked ? { ...picked, x: pos.x, y: pos.y } : null)
      })
    },
    [pickAt],
  )

  // Drop any queued sample if the overlay unmounts mid-frame.
  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current)
    }
  }, [])

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const picked = pickAt(event.clientX, event.clientY)
      if (picked) {
        onResolve(picked.hex)
        return
      }
      // No sample here. In previewOnly mode a click that just misses the preview
      // bounds shouldn't dismiss — the user can aim again. But if the frame never
      // captured (`previewRef` still null: no bridge, still loading, capture
      // failed) nothing is pickable anywhere, so dismiss instead of silently
      // swallowing every click and freezing the picker open.
      if (previewOnly && previewRef.current) return
      onResolve(null)
    },
    [pickAt, onResolve, previewOnly],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onResolve(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [onResolve])

  // Paint the magnifier: the cropped region scaled up (pixelated) + a reticle
  // on the exact sampled cell.
  useEffect(() => {
    const canvas = loupeCanvasRef.current
    const loupe = hover?.loupe
    if (!canvas || !loupe) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const tmp = document.createElement('canvas')
    tmp.width = LOUPE_N
    tmp.height = LOUPE_N
    tmp.getContext('2d')?.putImageData(loupe.data, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX)
    ctx.drawImage(tmp, 0, 0, LOUPE_N, LOUPE_N, 0, 0, LOUPE_PX, LOUPE_PX)
    const cx = loupe.rx * LOUPE_ZOOM
    const cy = loupe.ry * LOUPE_ZOOM
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(cx - 1, cy - 1, LOUPE_ZOOM + 2, LOUPE_ZOOM + 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 1
    ctx.strokeRect(cx, cy, LOUPE_ZOOM, LOUPE_ZOOM)
  }, [hover])

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[99999]"
      // Image-only pickers show "not-allowed" off the video so it's obvious
      // where a sample can be taken.
      style={{ cursor: previewOnly && !hover ? 'not-allowed' : 'crosshair' }}
      onMouseMove={handleMove}
      onClick={handleClick}
      onContextMenu={(event) => {
        event.preventDefault()
        onResolve(null)
      }}
    >
      {hover && (
        <div
          className="pointer-events-none fixed z-[100000] flex flex-col items-center gap-1"
          style={{ left: hover.x + CURSOR_OFFSET, top: hover.y + CURSOR_OFFSET }}
        >
          {hover.loupe ? (
            <canvas
              ref={loupeCanvasRef}
              width={LOUPE_PX}
              height={LOUPE_PX}
              className="rounded-full border-2 border-white"
              style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.5)' }}
            />
          ) : (
            <span
              className="h-6 w-6 rounded border-2 border-white shadow"
              style={{ backgroundColor: hover.hex }}
            />
          )}
          <span className="rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] uppercase text-white">
            {hover.hex}
          </span>
        </div>
      )}
    </div>,
    document.body,
  )
})
