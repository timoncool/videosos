/**
 * Adapter exports for renderer dependencies.
 *
 * The canvas/WebGPU render engine lives in `src/runtime/renderer/`; the export
 * feature drives it through this contract (job pipeline, codec/settings model,
 * subtitle and output-target helpers). Export modules must not reach into
 * `@/runtime/renderer/**` directly.
 */

export type {
  ClientAudioContainer,
  ClientCodec,
  ClientExportSettings,
  ClientRenderResult,
  ClientVideoContainer,
  RenderProgress,
} from '@/runtime/renderer/client-renderer'
export {
  estimateFileSize,
  formatBytes,
  getAudioBitrateForQuality,
  getCompatibleVideoCodecs,
  getDefaultAudioCodec,
  getDefaultVideoCodec,
  getPreferredContainerForCodec,
  getSupportedCodecs,
  getVideoBitrateForQuality,
  mapExportCodecToClientCodec,
  mapToClientSettings,
  selectFallbackVideoCodec,
  validateSettings,
} from '@/runtime/renderer/client-renderer'
export { normalizeVideoCodec, resolveVideoBitrate } from '@/runtime/renderer/video-bitrate'
export {
  isExtendedSettings,
  mapRequestedClientSettings,
  resolveClientSettings,
  runRender,
} from '@/runtime/renderer/render-pipeline'
export { buildTranscriptSubtitleCues } from '@/runtime/renderer/embedded-subtitle-export'
export { releaseTemporaryExportOutput } from '@/runtime/renderer/export-output-target'
