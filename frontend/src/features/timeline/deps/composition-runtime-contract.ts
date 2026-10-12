/**
 * Adapter exports for composition-runtime dependencies.
 * Timeline modules should import composition-runtime utilities from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/runtime/composition-runtime/utils/transform-resolver'
export {
  resolveItemTransformAtFrame,
  resolveItemTransformAtRelativeFrame,
} from '@/runtime/composition-runtime/utils/frame-scene'
export { resolveCornerPinTargetRect } from '@/runtime/composition-runtime/utils/corner-pin'
export { needsCustomAudioDecoder } from '@/runtime/composition-runtime/utils/audio-codec-detection'
export {
  getOrDecodeAudio,
  getOrDecodeAudioSliceForPlayback,
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
} from '@/runtime/composition-runtime/utils/audio-decode-cache'
export { resolvePreviewAudioConformUrl } from '@/runtime/composition-runtime/utils/preview-audio-conform'
export { prewarmPreviewAudioElement } from '@/runtime/composition-runtime/utils/preview-audio-element-pool'
