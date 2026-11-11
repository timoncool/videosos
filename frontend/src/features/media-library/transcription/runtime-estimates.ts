import { BROWSER_WHISPER_MODEL_LABELS } from '@/shared/utils/browser-whisper-models'
import type { MediaTranscriptModel } from '@/types/storage'

const MIB = 1024 * 1024

const WHISPER_MODEL_BASE_ESTIMATES_MIB: Record<MediaTranscriptModel, number> = {
  // Parakeet is sized by estimateParakeetRuntimeBytes(); this entry only satisfies the exhaustive map.
  'parakeet-tdt-v3': 1_270,
  'whisper-tiny': 220,
  'whisper-base': 420,
  'whisper-small': 900,
  'whisper-large': 2_600,
}

// Parakeet ONNX footprint: the int8 encoder (~650 MB) + int8 decoder_joint (~18 MB) + nemo128
// preprocessor.
const PARAKEET_RUNTIME_MIB = 670

// the int8 files take this share of the full-precision footprint the base estimates are given in
const Q8_SHARE = 0.58

export function estimateWhisperRuntimeBytes(model: MediaTranscriptModel): number {
  return Math.round(WHISPER_MODEL_BASE_ESTIMATES_MIB[model] * Q8_SHARE * MIB)
}

export function formatWhisperRuntimeModelLabel(model: MediaTranscriptModel): string {
  return `${BROWSER_WHISPER_MODEL_LABELS[model]} · Q8`
}

export function estimateParakeetRuntimeBytes(): number {
  return Math.round(PARAKEET_RUNTIME_MIB * MIB)
}

export function formatParakeetRuntimeModelLabel(): string {
  return `${BROWSER_WHISPER_MODEL_LABELS['parakeet-tdt-v3']} · WASM`
}
