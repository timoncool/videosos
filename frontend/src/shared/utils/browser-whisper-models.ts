import type { MediaTranscriptModel } from '@/types/storage'

// Parakeet Ultra 0.6B int8 is the browser ASR engine, as in Dub Studio. It covers 25 European
// languages; for the rest, or without WebGPU, transcription falls back to Whisper Large v3
// Turbo. See `transcription-engine.ts` for the routing.
export const DEFAULT_BROWSER_WHISPER_MODEL: MediaTranscriptModel = 'parakeet-tdt-v3'

export const BROWSER_WHISPER_MODEL_LABELS: Record<MediaTranscriptModel, string> = {
  'parakeet-tdt-v3': 'Parakeet Ultra',
  'whisper-tiny': 'Whisper Tiny',
  'whisper-base': 'Whisper Base',
  'whisper-small': 'Whisper Small',
  'whisper-large': 'Whisper Large v3 Turbo',
}

export const BROWSER_WHISPER_MODEL_OPTIONS = [
  { value: 'parakeet-tdt-v3', label: BROWSER_WHISPER_MODEL_LABELS['parakeet-tdt-v3'] },
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
