import type { MediaTranscriptModel } from '@/types/storage'

// Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) is the default browser ASR engine: measured
// ~30-37x realtime via a hybrid WebGPU-encoder + WASM-decode pipeline (~10x faster than
// Whisper base) with native punctuation. It covers 25 European languages; for ja/ko/zh
// or when WebGPU is unavailable, transcription auto-falls back to Whisper base. See
// `transcription-engine.ts` for the routing.
export const DEFAULT_BROWSER_WHISPER_MODEL: MediaTranscriptModel = 'parakeet-tdt-v3'

export const BROWSER_WHISPER_MODEL_LABELS: Record<MediaTranscriptModel, string> = {
  'parakeet-tdt-v3': 'Parakeet (fast)',
  'whisper-tiny': 'Whisper Tiny',
  'whisper-base': 'Whisper Base',
  'whisper-small': 'Whisper Small',
  'whisper-large': 'Whisper Large v3 Turbo',
}

export const BROWSER_WHISPER_MODEL_OPTIONS = [
  { value: 'parakeet-tdt-v3', label: BROWSER_WHISPER_MODEL_LABELS['parakeet-tdt-v3'] },
  { value: 'whisper-base', label: BROWSER_WHISPER_MODEL_LABELS['whisper-base'] },
  { value: 'whisper-small', label: BROWSER_WHISPER_MODEL_LABELS['whisper-small'] },
  { value: 'whisper-large', label: BROWSER_WHISPER_MODEL_LABELS['whisper-large'] },
] as const satisfies ReadonlyArray<{
  value: MediaTranscriptModel
  label: string
}>

const SELECTABLE_BROWSER_WHISPER_MODELS = new Set<MediaTranscriptModel>(
  BROWSER_WHISPER_MODEL_OPTIONS.map((option) => option.value),
)

export function normalizeSelectableBrowserWhisperModel(
  model: MediaTranscriptModel | undefined,
): MediaTranscriptModel {
  if (!model) {
    return DEFAULT_BROWSER_WHISPER_MODEL
  }

  return SELECTABLE_BROWSER_WHISPER_MODELS.has(model) ? model : DEFAULT_BROWSER_WHISPER_MODEL
}
