/**
 * Timeline contract consumed by media-library feature adapters.
 */

export { useCompositionsStore, type SubComposition } from '../stores/compositions-store'
export { saveTimeline } from '../stores/timeline-persistence'
export { autoMatchOrphanedClips } from '../utils/media-validation'
export { resolveMediaUrl, resolveMediaUrls } from '../deps/media-library-resolver'
export { importCanvasRenderOrchestrator } from '../deps/export-contract'
export {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
} from '../utils/sub-composition-preview'
