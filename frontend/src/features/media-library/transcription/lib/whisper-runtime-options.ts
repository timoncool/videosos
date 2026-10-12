const LARGE_TURBO_MODEL_FRAGMENT = 'whisper-large-v3-turbo'
const SMALL_MODEL_FRAGMENT = 'whisper-small'

/**
 * Transformers.js batches the 30 s windows inside each decoded audio span.
 * Large Turbo's activations are much heavier than Base's, so sharing Base's
 * batch of eight can exhaust WebGPU memory before the first segment is emitted.
 */
export function getWhisperWebGpuBatchSize(modelId: string): number {
  if (modelId.includes(LARGE_TURBO_MODEL_FRAGMENT)) return 1
  if (modelId.includes(SMALL_MODEL_FRAGMENT)) return 4
  return 8
}
