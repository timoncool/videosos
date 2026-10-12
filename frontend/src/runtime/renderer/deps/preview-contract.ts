/**
 * Adapter exports for preview dependencies.
 * Renderer modules should import the preview scrubbing cache and decoder-prewarm
 * helpers from here.
 */

export { ScrubbingCache } from '@/features/preview/utils/scrubbing-cache'
export { getCachedPredecodedBitmap } from '@/features/preview/utils/decoder-prewarm'
export { getCachedActivePreviewFallbackBitmap } from '@/features/preview/utils/decoder-prewarm'
export { isActivePreviewTargetSuperseded } from '@/features/preview/utils/decoder-prewarm'
export { isActivePreviewFrameSuperseded } from '@/features/preview/utils/decoder-prewarm'
export { isActivePreviewFrameCurrent } from '@/features/preview/utils/decoder-prewarm'
export { isActivePreviewFrameDecodeReady } from '@/features/preview/utils/decoder-prewarm'
export { isActivePreviewSourceTarget } from '@/features/preview/utils/decoder-prewarm'
export { waitForInflightPredecodedBitmap } from '@/features/preview/utils/decoder-prewarm'
