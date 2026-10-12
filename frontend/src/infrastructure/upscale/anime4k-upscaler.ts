/**
 * Anime4K CNN 2x (M) super-resolution on onnxruntime-web.
 *
 * The network is 2,584 parameters and 12.7KB per weight set, so all three ship in the bundle rather
 * than being downloaded. See `models/NOTICE.md` for provenance and `models/convert-weights.py` for
 * the conversion from WebSR's JSON weights.
 *
 * What it is: ten 3x3 convolutions over four channels with a CReLU activation, a 1x1 head over
 * seven skip connections, a pixel shuffle, and the result added as a *residual to a bilinear
 * upscale of the input*. It therefore cannot do worse than bilinear, and it cannot invent detail.
 * On live action it is a very good learned sharpener. It is not Real-ESRGAN, which reconstructs
 * texture but costs ~1770x as much per frame and takes minutes per second of footage.
 *
 * As with RIFE, `freeDimensionOverrides` is load-bearing rather than an optimization: pinning the
 * input dims folds the graph to 42 nodes with zero shape-computation ops, all on the WebGPU EP.
 * Sessions are therefore per (variant, resolution) and cached across a whole bake.
 *
 * Worker-safe: no DOM access.
 */

import { createLogger } from '@/shared/logging/logger'
import { getOrt, type OrtModule, type OrtSession } from '@/shared/utils/ort-runtime'
import { planarRgbLength } from '@/shared/utils/planar-rgb'
import animationUrl from './models/anime4k_cnn_2x_m_an.onnx?url'
import threeDUrl from './models/anime4k_cnn_2x_m_3d.onnx?url'
import liveActionUrl from './models/anime4k_cnn_2x_m_rl.onnx?url'
import { upscaledSize } from './upscale-size'
import type { UpscaleVariant } from './upscale-variant'

const logger = createLogger('Anime4kUpscaler')

const MODEL_URLS: Record<UpscaleVariant, string> = {
  liveAction: liveActionUrl,
  animation: animationUrl,
  threeD: threeDUrl,
}

export type UpscaleBackend = 'webgpu' | 'wasm'

/**
 * Holds the model bytes for one variant plus a cache of compiled per-resolution sessions.
 * Construct once per worker and keep it warm across a bake; terminating the worker frees it.
 */
export class Anime4kUpscaler {
  private modelBytes: Uint8Array | null = null
  private ort: OrtModule | null = null
  private backend: UpscaleBackend = 'wasm'
  private readonly sessions = new Map<string, OrtSession>()
  private readyPromise: Promise<void> | null = null

  constructor(private readonly variant: UpscaleVariant) {}

  // The three public members below are reached only from `upscale-worker.ts`, across a
  // `new Worker(new URL(...))` edge that static analysis cannot follow.
  // fallow-ignore-next-line unused-class-member
  get activeBackend(): UpscaleBackend {
    return this.backend
  }

  /** Load the bundled weights and probe for WebGPU. Idempotent and concurrency-safe. */
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
    this.ort = await getOrt()

    const url = MODEL_URLS[this.variant]
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load upscale model ${this.variant}: HTTP ${response.status}`)
    }
    this.modelBytes = new Uint8Array(await response.arrayBuffer())

    const hasWebGpu =
      typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu)
    this.backend = hasWebGpu ? 'webgpu' : 'wasm'
    logger.info('Anime4K model loaded', {
      variant: this.variant,
      bytes: this.modelBytes.byteLength,
      backend: this.backend,
    })
  }

  private async getSession(width: number, height: number): Promise<OrtSession> {
    const key = `${width}x${height}`
    const existing = this.sessions.get(key)
    if (existing) return existing

    const ort = this.ort
    const bytes = this.modelBytes
    if (!ort || !bytes) {
      throw new Error('Anime4kUpscaler.ready() must resolve before upscale()')
    }

    const create = (backend: UpscaleBackend): Promise<OrtSession> =>
      ort.InferenceSession.create(bytes, {
        executionProviders: [backend],
        graphOptimizationLevel: 'all',
        // See file header: without these the meshgrid-free graph still keeps shape ops
        // outside the WebGPU EP.
        freeDimensionOverrides: { batch: 1, height, width },
      })

    let session: OrtSession
    try {
      session = await create(this.backend)
    } catch (error) {
      if (this.backend === 'wasm') throw error
      logger.warn('Anime4K WebGPU session failed, falling back to wasm', { key, error })
      this.backend = 'wasm'
      session = await create('wasm')
    }

    this.sessions.set(key, session)
    return session
  }

  /**
   * Upscale one planar RGB frame `[3, H, W]` in [0,1] to `[3, 2H, 2W]`.
   *
   * The result is freshly allocated and the input is not mutated. Values may overshoot [0,1]
   * slightly — the residual is unbounded — so callers must saturate on the way to 8 bits.
   */
  // fallow-ignore-next-line unused-class-member
  async upscale(planar: Float32Array, width: number, height: number): Promise<Float32Array> {
    const ort = this.ort
    if (!ort) throw new Error('Anime4kUpscaler.ready() must resolve before upscale()')

    const expectedIn = planarRgbLength(width, height)
    if (planar.length < expectedIn) {
      throw new Error(`Anime4kUpscaler: expected ${expectedIn} floats, got ${planar.length}`)
    }

    const session = await this.getSession(width, height)
    const tensor = new ort.Tensor('float32', planar.subarray(0, expectedIn), [1, 3, height, width])
    try {
      const results = await session.run({ input: tensor })
      const output = results.output
      if (!output) throw new Error('Anime4K session returned no `output` tensor')

      const out = upscaledSize(width, height)
      const data = output.data as Float32Array
      const expectedOut = planarRgbLength(out.width, out.height)
      if (data.length !== expectedOut) {
        throw new Error(`Anime4K output length ${data.length}, expected ${expectedOut}`)
      }
      // Copy out: ORT reuses/owns the backing buffer once the tensor is disposed.
      const frame = new Float32Array(data)
      output.dispose?.()
      return frame
    } finally {
      tensor.dispose?.()
    }
  }
}
