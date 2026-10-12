/**
 * RIFE v4.x frame interpolation on onnxruntime-web.
 *
 * Model: https://huggingface.co/walterlow/RIFE_fp32_timestep (MIT). This is `FuryTMP/RIFE_fp32`
 * with one change: that export was traced with `timestep = 0.5`, folding the value into a
 * `Constant` and leaving a graph that could only ever emit the midpoint of its two inputs. The
 * constant is promoted to a scalar `timestep` input, which restores arbitrary-phase
 * interpolation. Output at `t = 0.5` is bit-identical to the original, and the folded graph has
 * the same node count, so the extra input costs nothing. The repo carries the patch script.
 *
 * Two non-obvious things, both measured against this exact file (see
 * `docs/plans/2026-07-09-001-feat-rife-frame-interpolation-plan.md`):
 *
 * 1. `freeDimensionOverrides` is load-bearing, not an optimization. Left dynamic, the graph's
 *    per-warp meshgrid construction leaves 18 `ConstantOfShape` nodes on the CPU EP, and each
 *    of the 14 `GridSample` warps then round-trips a full-resolution grid across the
 *    GPU/CPU boundary. Pinning the input dims lets ORT constant-fold the graph from 1362 to
 *    301 nodes with *zero* ops outside the WebGPU EP.
 *
 * 2. Sessions are per-resolution, because of (1). Creating one costs ~500ms, so they are
 *    cached and reused across a whole bake.
 *
 * The endpoints are not exact: `t = 0` does not reproduce `left`, nor `t = 1` `right`. That is a
 * property of the upstream weights and is harmless here, because the source frames are passed
 * through verbatim and never synthesized. Only `0 < t < 1` is meaningful.
 *
 * Worker-safe: no DOM access.
 */

import { createLogger } from '@/shared/logging/logger'
import { fetchOnnxModelBytes } from '@/shared/utils/onnx-model-cache'
import { getOrt, type OrtModule, type OrtSession } from '@/shared/utils/ort-runtime'
import { planarRgbLength } from '@/shared/utils/planar-rgb'
import { concatPlanarPair } from './frame-tensor'

const logger = createLogger('RifeInterpolator')

/**
 * Settings' model-cache inspector matches this by the `/RIFE_fp32_timestep/` path fragment; keep
 * the two in sync (`shared/utils/local-model-cache.ts`).
 */
const RIFE_MODEL_URL =
  'https://huggingface.co/walterlow/RIFE_fp32_timestep/resolve/main/RIFE_fp32_timestep.onnx'

/**
 * Ceiling on the resolution an interpolated video is rendered at, and therefore on the
 * resolution RIFE runs at. 1080p is the practical limit: the folded meshgrid constants (one
 * full-resolution grid per warp, 14 of them) put the WebGPU backend under memory pressure,
 * and 1080p measures 5.6x the time of 720p for only 2.4x the pixels.
 *
 * Sources at or below this render natively. Larger sources render downscaled — every frame of
 * the output. It is tempting to keep real frames at native resolution and upscale only the
 * synthesized ones, but at 4x that alternates one sharp frame with three soft ones, which reads
 * as sharpness pumping. One resolution for all frames is the lesser evil.
 */
export const RIFE_MAX_RENDER_PIXELS = 1920 * 1088

export type RifeBackend = 'webgpu' | 'wasm'

export interface RifeLoadProgress {
  receivedBytes: number
  totalBytes: number
  fromCache: boolean
}

export interface RifeInterpolatorOptions {
  onDownloadProgress?: (progress: RifeLoadProgress) => void
}

interface SessionEntry {
  session: OrtSession
  width: number
  height: number
}

/**
 * Holds the model bytes plus a cache of compiled per-resolution sessions.
 * Construct once per worker and keep it warm across jobs; terminating the worker frees it.
 */
export class RifeInterpolator {
  private modelBytes: Uint8Array | null = null
  private ort: OrtModule | null = null
  private backend: RifeBackend = 'wasm'
  private readonly sessions = new Map<string, SessionEntry>()
  private readyPromise: Promise<void> | null = null

  constructor(private readonly options: RifeInterpolatorOptions = {}) {}

  // The three public members below are reached only from `frame-interpolation-worker.ts`,
  // across a `new Worker(new URL(...))` edge that static analysis cannot follow.
  // fallow-ignore-next-line unused-class-member
  get activeBackend(): RifeBackend {
    return this.backend
  }

  /** Download weights and probe for WebGPU. Idempotent and concurrency-safe. */
  // fallow-ignore-next-line unused-class-member
  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.load().catch((error) => {
        // Let a later call retry rather than caching a rejected promise forever.
        this.readyPromise = null
        throw error
      })
    }
    return this.readyPromise
  }

  private async load(): Promise<void> {
    const ort = await getOrt()
    this.ort = ort

    const bytes = await fetchOnnxModelBytes(
      RIFE_MODEL_URL,
      (receivedBytes, totalBytes, fromCache) =>
        this.options.onDownloadProgress?.({ receivedBytes, totalBytes, fromCache }),
    )
    this.modelBytes = new Uint8Array(bytes)

    const hasWebGpu =
      typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu)
    this.backend = hasWebGpu ? 'webgpu' : 'wasm'
    logger.info('RIFE model loaded', {
      bytes: this.modelBytes.byteLength,
      backend: this.backend,
    })
  }

  private sessionKey(width: number, height: number): string {
    return `${width}x${height}`
  }

  private async getSession(width: number, height: number): Promise<OrtSession> {
    const key = this.sessionKey(width, height)
    const existing = this.sessions.get(key)
    if (existing) return existing.session

    const ort = this.ort
    const bytes = this.modelBytes
    if (!ort || !bytes) {
      throw new Error('RifeInterpolator.ready() must resolve before interpolate()')
    }

    const create = (backend: RifeBackend): Promise<OrtSession> =>
      ort.InferenceSession.create(bytes, {
        executionProviders: [backend],
        graphOptimizationLevel: 'all',
        // Without these the graph keeps 18 CPU-EP nodes and every GridSample warp
        // round-trips a full-resolution grid across the GPU boundary. See file header.
        freeDimensionOverrides: {
          dynamic_dim_0: 1,
          dynamic_dim_1: 6,
          dynamic_dim_2: height,
          dynamic_dim_3: width,
        },
      })

    let session: OrtSession
    try {
      session = await create(this.backend)
    } catch (error) {
      if (this.backend === 'wasm') throw error
      logger.warn('RIFE WebGPU session failed, falling back to wasm', { key, error })
      this.backend = 'wasm'
      session = await create('wasm')
    }

    this.sessions.set(key, { session, width, height })
    return session
  }

  /**
   * Synthesize the frame at `timestep` of the way from `left` to `right`.
   *
   * Both operands are planar RGB float `[3, H, W]` in [0,1]; the result is a freshly
   * allocated planar RGB frame of the same shape. Inputs are not mutated. `timestep` must lie
   * strictly between 0 and 1 — see the note on endpoints in the file header.
   */
  // fallow-ignore-next-line unused-class-member
  async interpolate(
    left: Float32Array,
    right: Float32Array,
    width: number,
    height: number,
    timestep: number,
  ): Promise<Float32Array> {
    const ort = this.ort
    if (!ort) throw new Error('RifeInterpolator.ready() must resolve before interpolate()')
    if (!(timestep > 0 && timestep < 1)) {
      throw new Error(`RIFE timestep must be in (0, 1), got ${timestep}`)
    }

    const session = await this.getSession(width, height)
    const input = concatPlanarPair(left, right, width, height)

    const tensor = new ort.Tensor('float32', input, [1, 6, height, width])
    // Rank-0: the graph broadcasts this scalar into the timestep plane every IFBlock reads.
    const phase = new ort.Tensor('float32', new Float32Array([timestep]), [])
    try {
      const results = await session.run({ input: tensor, timestep: phase })
      const output = results.output
      if (!output) throw new Error('RIFE session returned no `output` tensor')

      const data = output.data as Float32Array
      const expected = planarRgbLength(width, height)
      if (data.length !== expected) {
        throw new Error(`RIFE output length ${data.length}, expected ${expected}`)
      }
      // Copy out: ORT reuses/owns the backing buffer once the tensor is disposed.
      const frame = new Float32Array(data)
      output.dispose?.()
      return frame
    } finally {
      tensor.dispose?.()
      phase.dispose?.()
    }
  }
}

const evenFloor = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)

/**
 * Resolution to render an interpolated video at: the source size, capped to `maxPixels` with the
 * aspect ratio preserved. Dimensions are forced even because H.264/HEVC encoders reject odd
 * ones, so a source with an odd dimension loses its last row or column.
 */
export function clampRenderSize(
  width: number,
  height: number,
  maxPixels: number = RIFE_MAX_RENDER_PIXELS,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`clampRenderSize: invalid source size ${width}x${height}`)
  }
  const pixels = width * height
  if (pixels <= maxPixels) {
    return { width: evenFloor(width), height: evenFloor(height) }
  }
  const scale = Math.sqrt(maxPixels / pixels)
  return { width: evenFloor(width * scale), height: evenFloor(height * scale) }
}
