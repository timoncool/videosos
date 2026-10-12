/**
 * Canvas Audio Processing System
 *
 * Public entry point for export audio: extraction, planning, decoding, DSP,
 * mixing, and encoding of audio for client-side export. The implementation
 * lives in `./audio/*`; this module only re-exports the API its callers use —
 * `canvas-render-orchestrator` (through the whole namespace, lazily) and
 * `headless/main` (`hasAudioContent`).
 */

export { clearAudioDecodeCache } from './audio/decode'
export { applyDucking, collectDuckingSources, type DuckingSource } from './audio/ducking'
export { downmixToOutputChannels } from './audio/mixdown'
export { hasAudioContent, processAudio } from './audio/pipeline'
export {
  extractAudioSegments,
  getAudioPacketPassthroughPlan,
  supportsWindowedAudioProcessing,
} from './audio/planning'
export { processAudioWindows } from './audio/windowed'
