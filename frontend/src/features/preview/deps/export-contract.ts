/**
 * Adapter exports for export dependencies.
 * Preview modules should import export utilities from here.
 */

import type { CompositionRendererInstance } from '@/runtime/renderer/client-render-engine'

export type { CompositionRendererInstance }

export {
  SharedVideoExtractorPool,
  type VideoFrameSource,
} from '@/runtime/renderer/shared-video-extractor'
export {
  isFrameInsideSourceTimeRamp,
  resolveAATransitionRamps,
  resolveTransitionRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@/runtime/renderer/render-span'

// Dynamic on purpose: preview must not pull the canvas engine into its eager
// graph; it loads the renderer only when a composition preview mounts.
export const importCompositionRenderer = () => import('@/runtime/renderer/client-render-engine')
