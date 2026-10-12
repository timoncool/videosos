/**
 * Progress and time-remaining estimation for a frame-interpolation render.
 *
 * Two things make this less trivial than `seen / total`:
 *
 * 1. The caller's nominal source frame rate is a timestamp-derived best guess. It can still
 *    differ from the de facto cadence of a VFR or dropped-frame source, so the total frame count
 *    is re-derived from the median decoded timestamp gap as soon as enough frames have arrived.
 * 2. The first frames are not representative. The ONNX session compiles on the first inference
 *    (~500ms) and the JIT warms over the next few, so seeding the rate estimate with them
 *    would badly overstate the time remaining.
 *
 * The per-frame cost estimate is an EMA rather than a mean: a render can slow down (thermal
 * throttling, a background tab stealing the GPU) and the estimate should follow.
 */

/** Frames whose timings are discarded: session compile plus JIT warm-up. */
const WARMUP_FRAMES = 2

/** Gaps needed before the measured frame rate beats the caller's hint. */
const MIN_GAPS_FOR_RATE = 4

const EMA_ALPHA = 0.2

export class RenderProgress {
  private frames = 0
  private readonly gaps: number[] = []
  private emaFrameMs: number | null = null
  private lastTickMs: number | null = null

  /**
   * @param totalSeconds duration of the source, in seconds
   * @param fallbackFps the caller's (possibly wrong) source frame rate hint
   */
  constructor(
    private readonly totalSeconds: number,
    private readonly fallbackFps: number,
  ) {}

  /**
   * Record one fully-processed source frame.
   *
   * @param nowMs monotonic clock reading, e.g. `performance.now()`
   * @param gapSeconds seconds since the previous source frame's timestamp, or null for the first
   */
  tick(nowMs: number, gapSeconds: number | null): void {
    this.frames++
    if (gapSeconds !== null && gapSeconds > 0) {
      this.gaps.push(gapSeconds)
    }

    const previous = this.lastTickMs
    this.lastTickMs = nowMs
    if (previous === null || this.frames <= WARMUP_FRAMES) {
      return
    }

    const elapsed = nowMs - previous
    this.emaFrameMs =
      this.emaFrameMs === null ? elapsed : EMA_ALPHA * elapsed + (1 - EMA_ALPHA) * this.emaFrameMs
  }

  /** Best estimate of the source's total frame count. Never below what we have already seen. */
  get estimatedTotalFrames(): number {
    const fps = this.gaps.length >= MIN_GAPS_FOR_RATE ? 1 / medianOf(this.gaps) : this.fallbackFps
    const estimate = Number.isFinite(fps) && fps > 0 ? Math.round(this.totalSeconds * fps) : 0
    return Math.max(this.frames, estimate, 1)
  }

  /** 0..1. Monotonic, because `estimatedTotalFrames` can never drop below `frames`. */
  get fraction(): number {
    return Math.min(1, this.frames / this.estimatedTotalFrames)
  }

  /** Seconds remaining, or null while the rate estimate is still warming up. */
  get etaSeconds(): number | null {
    if (this.emaFrameMs === null) return null
    const remaining = this.estimatedTotalFrames - this.frames
    if (remaining <= 0) return 0
    return (this.emaFrameMs * remaining) / 1000
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}
