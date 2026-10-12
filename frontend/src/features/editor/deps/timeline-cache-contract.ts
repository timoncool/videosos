/**
 * Adapter exports for timeline cache-service dependencies.
 * Editor modules should import lazy cache helpers from here.
 */

export const importGifFrameCache = () => import('@/features/timeline/services/gif-frame-cache')
export const importFilmstripCache = () => import('@/features/timeline/services/filmstrip-cache')
export const importWaveformCache = () => import('@/features/timeline/services/waveform-cache')
