/**
 * Single import seam for media-library -> timeline dependencies.
 */

export type { SubComposition } from '@/features/timeline/contracts/media-library'
export {
  autoMatchOrphanedClips,
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
  importCanvasRenderOrchestrator,
  resolveMediaUrl,
  resolveMediaUrls,
  saveTimeline,
  useCompositionsStore,
} from '@/features/timeline/contracts/media-library'
