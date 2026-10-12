/**
 * Aggregated composition-runtime utilities used by the renderer.
 *
 * Same-layer (runtime -> runtime) aggregation: it exists so each renderer module
 * has one import site per dependency family, mirroring the feature `deps/*`
 * adapters, not to cross a layer boundary.
 */

export {
  createFrameCompositionSceneCache,
  resolveItemTransformAtFrame,
  resolveActiveShapeMasksAtFrame,
} from '@/runtime/composition-runtime/utils/frame-scene'
export {
  applyPreviewPathVerticesToItem,
  applyPreviewPathVerticesToShape,
  type PreviewPathVerticesOverride,
} from '@/runtime/composition-runtime/utils/preview-path-override'
export { expandTextTransformToFitContent } from '@/runtime/composition-runtime/utils/text-layout'
export {
  resolveCompositionRenderPlan,
  resolveLiveTransitionRenderPlan,
  collectFrameVideoCandidates,
  resolveFrameRenderScene,
  resolveTrackRenderState,
} from '@/runtime/composition-runtime/utils/scene-assembly'
export type { FrameRenderTask } from '@/runtime/composition-runtime/utils/scene-assembly'
export { getShapePath, rotatePath } from '@/runtime/composition-runtime/utils/shape-path'
export {
  hasCornerPin,
  computeCornerPinHomography,
  invertCornerPinHomography,
  drawCornerPinImage,
  computeProjectiveCornerPinWarp,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
} from '@/runtime/composition-runtime/utils/corner-pin'
export { getVideoTargetTimeSeconds } from '@/runtime/composition-runtime/utils/video-timing'
