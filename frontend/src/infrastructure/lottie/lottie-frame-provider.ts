/**
 * Lottie frame rendering via @lottiefiles/dotlottie-web.
 *
 * dotlottie-web's WASM core renders a specific frame synchronously with
 * `setFrame()` (verified frame-accurate + deterministic), which is exactly what
 * FreeCut's frame-by-frame compositor needs. Unlike the GIF path we do NOT
 * pre-extract every frame — dotlottie renders on demand into a canvas, so this
 * module just owns:
 *   - one-time WASM URL wiring (bundled asset, works offline / in the export worker)
 *   - timeline-frame -> lottie-frame mapping (shared by preview + export)
 *   - an export-side renderer that draws a requested frame into an OffscreenCanvas
 *
 * Preview uses {@link LottieRenderer} directly against a visible canvas.
 */
import { DotLottie } from '@lottiefiles/dotlottie-web'
import { isLiveObjectUrl } from '@/infrastructure/browser/object-url-registry'
import type { LottieSlotValue } from './lottie-slots'
// Bundle the WASM alongside the app so it resolves without the default CDN.
// Use the package's `exports`-mapped subpath (NOT `/dist/...`) so Node's strict
// exports resolution (Vitest) can resolve it too, not just Vite.
import wasmUrl from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url'
import { createLogger } from '@/shared/logging/logger'

// Metadata parsing is WASM-free; re-exported here for convenience.

const log = createLogger('lottie-provider')

let wasmConfigured = false

/** Point dotlottie at the bundled WASM (idempotent). Call before any DotLottie. */
function ensureLottieWasm(): void {
  if (wasmConfigured) return
  DotLottie.setWasmUrl(wasmUrl)
  wasmConfigured = true
}

/**
 * Whether a Lottie `src` can actually be loaded right now. Guards against a
 * stale `blob:` URL — one persisted into a project or left over after its media
 * was deleted — which dotlottie would `fetch()` and fail with
 * `net::ERR_FILE_NOT_FOUND`, spamming the console every render. A live blob URL
 * (freshly resolved via the blob-url manager) stays registered; a dead one does
 * not. Non-blob sources (http/data) are assumed loadable.
 */
export function isRenderableLottieSrc(src: string | undefined | null): src is string {
  if (!src) return false
  if (src.startsWith('blob:')) return isLiveObjectUrl(src)
  return true
}

export interface LottieFrameMapInput {
  /** Frame within the clip (0-based), in project FPS. */
  localFrame: number
  /** Project frames per second. */
  projectFps: number
  /** Playback speed multiplier (default 1). */
  speed: number
  /** Total frames reported by the Lottie animation. */
  totalFrames: number
  /** Native frame rate of the Lottie animation. */
  frameRate: number
  /** Whether to loop when the clip outlives the animation. */
  loop: boolean
  /** Play the segment backward (default false). */
  reversed?: boolean
  /** Repeat style while looping (default 'loop'). */
  loopMode?: 'loop' | 'pingpong'
  /** First source frame to play (default 0). */
  segmentStart?: number
  /** Last source frame to play (default totalFrames - 1). */
  segmentEnd?: number
}

/**
 * Map a clip-local timeline frame to a Lottie frame index, honoring speed,
 * reverse, an in/out segment, and loop style. The result is always clamped to
 * the active segment and to `[0, totalFrames - 1]` (dotlottie's valid range).
 */
export function mapTimelineFrameToLottieFrame({
  localFrame,
  projectFps,
  speed,
  totalFrames,
  frameRate,
  loop,
  reversed = false,
  loopMode = 'loop',
  segmentStart,
  segmentEnd,
}: LottieFrameMapInput): number {
  if (totalFrames <= 0 || projectFps <= 0 || frameRate <= 0) return 0
  const maxFrame = totalFrames - 1

  // Resolve and sanitize the active segment [segStart, segEnd] within the range.
  const segStart = Math.max(0, Math.min(segmentStart ?? 0, maxFrame))
  const segEnd = Math.max(segStart, Math.min(segmentEnd ?? maxFrame, maxFrame))
  const segSpan = segEnd - segStart
  // A zero-length segment is a frozen poster frame.
  if (segSpan <= 0) return segStart

  // Frames elapsed within the segment at the requested speed.
  const elapsed = (localFrame / projectFps) * (speed ?? 1) * frameRate

  let offset: number
  if (loop) {
    if (loopMode === 'pingpong') {
      // Ping-pong reflects at the endpoints, so segEnd is reached at m === segSpan.
      const period = segSpan * 2
      const m = ((elapsed % period) + period) % period
      offset = m <= segSpan ? m : period - m
    } else {
      // A loop cycles through all frames segStart..segEnd inclusive, then wraps —
      // so the period is the frame *count* (span + 1), not the span, or the final
      // frame is skipped before wrapping.
      const frameCount = segSpan + 1
      offset = ((elapsed % frameCount) + frameCount) % frameCount
    }
  } else {
    // Past the end, hold the final frame (dotlottie clamps anyway).
    offset = Math.max(0, Math.min(elapsed, segSpan))
  }

  const frame = reversed ? segEnd - offset : segStart + offset
  return Math.max(segStart, Math.min(frame, segEnd))
}

/**
 * A single Lottie animation bound to a canvas, seekable frame-by-frame.
 * Rendering is synchronous once {@link ready} resolves.
 */
export class LottieRenderer {
  private readonly dotLottie: DotLottie
  private readonly _canvas: HTMLCanvasElement | OffscreenCanvas
  private _ready: Promise<void>
  private _loaded = false
  private _destroyed = false

  constructor(config: {
    canvas: HTMLCanvasElement | OffscreenCanvas
    /** Blob/URL to the animation file. */
    src?: string
    /** Raw animation JSON string. */
    data?: string
    /**
     * dotLottie theme rule JSON (`{ rules: [...] }`) applied via `setThemeData`
     * once the animation loads — recolors/retexts the animation's slots.
     */
    themeData?: string
    /**
     * Scalar/vector slot overrides applied natively (`setScalarSlot` /
     * `setVectorSlot`) once the animation loads, after the theme so an explicit
     * override wins. Keyed by slot id.
     */
    slots?: Record<string, LottieSlotValue>
    /**
     * Track the canvas's display size and re-render crisply on resize. Enable
     * for a visible preview canvas; leave off (default) for a fixed-size
     * OffscreenCanvas (export), which has no client size to observe.
     */
    autoResize?: boolean
  }) {
    ensureLottieWasm()
    this._canvas = config.canvas
    const autoResize = config.autoResize ?? false
    this.dotLottie = new DotLottie({
      canvas: config.canvas,
      src: config.src,
      data: config.data,
      autoplay: false,
      loop: false,
      backgroundColor: '#00000000',
      renderConfig: {
        // dpr matters only for a display canvas; keep export deterministic at 1.
        devicePixelRatio: autoResize ? undefined : 1,
        autoResize,
        freezeOnOffscreen: false,
      },
    })

    this._ready = new Promise<void>((resolve) => {
      const onLoad = () => {
        this._loaded = true
        // Apply the theme + slot overrides to the loaded animation before the
        // first render; the external setFrame that follows draws them.
        if (config.themeData) {
          try {
            this.dotLottie.setThemeData(config.themeData)
          } catch {
            // ignore a malformed/unsupported theme — render stays as-authored
          }
        }
        this.applySlots(config.slots)
        resolve()
      }
      // Guard against a load that already completed synchronously.
      if (this.dotLottie.isLoaded) {
        onLoad()
        return
      }
      this.dotLottie.addEventListener('load', onLoad)
      this.dotLottie.addEventListener('loadError', () => {
        log.warn('lottie load failed', { src: config.src })
        resolve() // resolve so callers don't hang; renders no-op
      })
    })
  }

  get ready(): Promise<void> {
    return this._ready
  }

  get isLoaded(): boolean {
    return this._loaded
  }

  get canvas(): HTMLCanvasElement | OffscreenCanvas {
    return this._canvas
  }

  get totalFrames(): number {
    return this.dotLottie.totalFrames || 1
  }

  /** Seconds for one full playthrough at native speed. */
  get duration(): number {
    return this.dotLottie.duration || this.totalFrames / 30
  }

  get frameRate(): number {
    const d = this.duration
    return d > 0 ? this.totalFrames / d : 30
  }

  /**
   * Apply scalar/vector slot overrides via dotlottie's native setters, routing
   * each by the slot's declared type. Unknown ids / type mismatches are ignored.
   */
  private applySlots(slots: Record<string, LottieSlotValue> | undefined): void {
    if (!slots) return
    for (const [id, value] of Object.entries(slots)) {
      try {
        // `getSlotType` reports position slots as 'vector'; `setVectorSlot`
        // handles both.
        const type = this.dotLottie.getSlotType(id)
        if (type === 'scalar' && typeof value === 'number') {
          this.dotLottie.setScalarSlot(id, value)
        } else if (type === 'vector' && Array.isArray(value)) {
          this.dotLottie.setVectorSlot(id, value)
        }
      } catch {
        // ignore a single bad slot — the rest still apply
      }
    }
  }

  /** Render a specific Lottie frame synchronously into the bound canvas. */
  renderFrame(lottieFrame: number): void {
    if (this._destroyed || !this._loaded) return
    this.dotLottie.setFrame(lottieFrame)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    try {
      this.dotLottie.destroy()
    } catch {
      // ignore teardown races
    }
  }
}

/**
 * Render a representative frame of a Lottie to a PNG blob for use as a media
 * thumbnail. Returns null if the animation can't load. Main-thread only
 * (uses OffscreenCanvas + the software renderer).
 */
export async function renderLottieThumbnail(
  src: string,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
  const renderer = new LottieRenderer({ canvas, src })
  try {
    await renderer.ready
    if (!renderer.isLoaded) return null
    // A frame ~40% in is usually more representative than the first frame.
    renderer.renderFrame(Math.floor(renderer.totalFrames * 0.4))
    return await canvas.convertToBlob({ type: 'image/png' })
  } catch {
    return null
  } finally {
    renderer.destroy()
  }
}

/**
 * Export-side manager: owns one OffscreenCanvas-backed {@link LottieRenderer}
 * per source, preloaded before the frame loop. Keyed by the item's `src`.
 */
export class LottieExportProvider {
  private readonly renderers = new Map<string, LottieRenderer>()
  /** Override signature the current renderer for a key was built with. */
  private readonly signatures = new Map<string, string>()
  /** In-flight rebuilds, keyed by item key, so concurrent renders dedupe. */
  private readonly rebuilds = new Map<string, { signature: string; promise: Promise<void> }>()

  /**
   * Warm a renderer for a source at a target size. Safe to call repeatedly.
   * Pass `data` (patched JSON string) to render text/color-overridden content
   * instead of loading `src` directly, and `signature` to record which override
   * state that data represents (see {@link getSignature} / {@link rebuild}).
   */
  async preload(
    key: string,
    src: string,
    width: number,
    height: number,
    data?: string,
    signature?: string,
    themeData?: string,
    slots?: Record<string, LottieSlotValue>,
  ): Promise<void> {
    if (this.renderers.has(key)) return
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
    const renderer = new LottieRenderer(
      data ? { canvas, data, themeData, slots } : { canvas, src, themeData, slots },
    )
    this.renderers.set(key, renderer)
    if (signature !== undefined) this.signatures.set(key, signature)
    await renderer.ready
  }

  /** The override signature the key's current renderer was built with. */
  getSignature(key: string): string | undefined {
    return this.signatures.get(key)
  }

  /**
   * Rebuild a key's renderer with fresh override `data` (or the raw `src` when
   * null) after its text/color overrides changed. Concurrent calls for the same
   * signature share one rebuild; the previous renderer is disposed once the new
   * one is ready so a render mid-rebuild still draws the old frame. Used by the
   * live preview — export preloads final overrides once and never rebuilds.
   */
  async rebuild(
    key: string,
    src: string,
    width: number,
    height: number,
    data: string | undefined,
    signature: string,
    themeData?: string,
    slots?: Record<string, LottieSlotValue>,
  ): Promise<void> {
    if (this.signatures.get(key) === signature) return
    const inFlight = this.rebuilds.get(key)
    if (inFlight && inFlight.signature === signature) return inFlight.promise

    const promise = (async () => {
      const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
      const renderer = new LottieRenderer(
        data ? { canvas, data, themeData, slots } : { canvas, src, themeData, slots },
      )
      await renderer.ready
      const previous = this.renderers.get(key)
      this.renderers.set(key, renderer)
      this.signatures.set(key, signature)
      previous?.destroy()
    })()
    this.rebuilds.set(key, { signature, promise })
    try {
      await promise
    } finally {
      if (this.rebuilds.get(key)?.promise === promise) this.rebuilds.delete(key)
    }
  }

  /** Render `lottieFrame` and return the OffscreenCanvas to composite, or null. */
  renderFrame(key: string, lottieFrame: number): OffscreenCanvas | null {
    const renderer = this.renderers.get(key)
    if (!renderer || !renderer.isLoaded) return null
    renderer.renderFrame(lottieFrame)
    return renderer.canvas as OffscreenCanvas
  }

  get(key: string): LottieRenderer | undefined {
    return this.renderers.get(key)
  }

  destroy(): void {
    for (const r of this.renderers.values()) r.destroy()
    this.renderers.clear()
    this.signatures.clear()
    this.rebuilds.clear()
  }
}
