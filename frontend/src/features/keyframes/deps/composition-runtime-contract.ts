/**
 * Adapter exports for composition-runtime dependencies.
 * Keyframes modules should import transform helpers from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/runtime/composition-runtime/utils/transform-resolver'
export { expandTextTransformToFitContent } from '@/runtime/composition-runtime/utils/text-layout'
export { hasCornerPin } from '@/runtime/composition-runtime/utils/corner-pin'
