import type { InterpolationFactor } from '@/infrastructure/interpolation'

/**
 * Frame interpolation renders a new video from an existing one: same duration, `factor`x the
 * frames, the in-between frames invented by RIFE. The result is imported into the media
 * library as an ordinary media item — it is NOT a proxy. A proxy is a lower-fidelity
 * stand-in that export ignores; this is a first-class source you can cut with, slow down for
 * true slow motion, or play at 1x for high-frame-rate motion.
 */

/**
 * Progress phases. Declared here rather than in the worker so app code (the store, the
 * progress hook) can name them without importing a module whose top-level installs an
 * `onmessage` handler.
 */
export type InterpolationStage = 'downloading-model' | 'preparing' | 'rendering'

/** Scratch space for the render; the file is imported and then deleted. */
export const INTERPOLATION_TMP_DIR = 'interpolation-tmp'

/** Tag applied to generated items so their provenance is visible in the library. */
export const INTERPOLATED_MEDIA_TAG = 'interpolated'

export function interpolationTmpPath(jobId: string): string {
  return `${INTERPOLATION_TMP_DIR}/${jobId}.mp4`
}

export interface InterpolationResult {
  factor: InterpolationFactor
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  sourceFps: number
  outputFps: number
  codec: string
  frameCount: number
}

/**
 * `beach.mp4` at 4x from 30fps becomes `beach (120fps).mp4`. The frame rate rather than the
 * factor, because that is what the user reasons about once the clip is on the timeline.
 */
export function interpolatedFileName(sourceFileName: string, outputFps: number): string {
  const dot = sourceFileName.lastIndexOf('.')
  const base = dot > 0 ? sourceFileName.slice(0, dot) : sourceFileName
  const rounded = Math.round(outputFps * 100) / 100
  return `${base} (${rounded}fps).mp4`
}
