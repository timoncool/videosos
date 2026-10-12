import type { UpscaleVariant } from '@/infrastructure/upscale'

/**
 * Upscaling renders a new video from an existing one: same duration, same frame rate, twice the
 * width and height, with the extra pixels reconstructed by Anime4K. The result is imported into
 * the media library as an ordinary media item, exactly like frame interpolation's output — it is
 * NOT a proxy, and export uses it as a first-class source.
 *
 * Be honest about what this is: a learned sharpener that adds a residual to a bilinear upscale.
 * It reconstructs edges beautifully and cannot invent texture. It is roughly 1770x cheaper than
 * Real-ESRGAN, which is why the render finishes in seconds rather than hours.
 */

/**
 * Progress phases. Declared here rather than in the worker so app code (the store, the progress
 * hook) can name them without importing a module whose top-level installs an `onmessage` handler.
 * There is no model-download phase — the weights are 12.7KB and ship in the bundle.
 */
export type UpscaleStage = 'preparing' | 'rendering'

/** Scratch space for the render; the file is imported and then deleted. */
export const UPSCALE_TMP_DIR = 'upscale-tmp'

/** Tag applied to generated items so their provenance is visible in the library. */
export const UPSCALED_MEDIA_TAG = 'upscaled'

export function upscaleTmpPath(jobId: string): string {
  return `${UPSCALE_TMP_DIR}/${jobId}.mp4`
}

export interface UpscaleResult {
  variant: UpscaleVariant
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  fps: number
  codec: string
  frameCount: number
}

/**
 * `beach.mp4` at 2x from 1280x720 becomes `beach (2560x1440).mp4`. The output resolution rather
 * than the factor, because that is what the user reasons about once the clip is on the timeline.
 */
export function upscaledFileName(sourceFileName: string, width: number, height: number): string {
  const dot = sourceFileName.lastIndexOf('.')
  const base = dot > 0 ? sourceFileName.slice(0, dot) : sourceFileName
  return `${base} (${width}x${height}).mp4`
}
