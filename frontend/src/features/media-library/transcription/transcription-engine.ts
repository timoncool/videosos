import type { MediaTranscriptModel } from '@/types/storage'
import type { TranscriptionEngine } from './types'

const PARAKEET_MODEL: MediaTranscriptModel = 'parakeet-tdt-v3'

// When Parakeet can't handle a job we transcribe with Whisper Large v3 Turbo, Dub Studio's Whisper.
const PARAKEET_FALLBACK_WHISPER_MODEL: MediaTranscriptModel = 'whisper-large'

// Parakeet TDT 0.6B v3 and its Ultra fine-tune cover 25 European languages (auto-detected). Anything outside this
// set — notably ja/ko/zh, which FreeCut supports — must fall back to Whisper.
export const PARAKEET_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set([
  'en',
  'es',
  'fr',
  'de',
  'bg',
  'hr',
  'cs',
  'da',
  'nl',
  'et',
  'fi',
  'el',
  'hu',
  'it',
  'lv',
  'lt',
  'mt',
  'pl',
  'pt',
  'ro',
  'sk',
  'sl',
  'sv',
  'ru',
  'uk',
])

export function isParakeetModel(model: MediaTranscriptModel | undefined): boolean {
  return model === PARAKEET_MODEL
}

export interface ResolvedTranscriptionEngine {
  engine: TranscriptionEngine
  /** The model actually used — may differ from the requested one when falling back. */
  model: MediaTranscriptModel
  fallbackReason?: 'language'
}

/**
 * Decide which on-device engine runs a job: Parakeet when selected and the language is one of its
 * own, otherwise Whisper.
 */
export function resolveTranscriptionEngine(
  model: MediaTranscriptModel,
  language: string | undefined,
): ResolvedTranscriptionEngine {
  if (!isParakeetModel(model)) {
    return { engine: 'whisper', model }
  }

  const normalizedLanguage = language?.trim().toLowerCase()
  if (normalizedLanguage && !PARAKEET_SUPPORTED_LANGUAGES.has(normalizedLanguage)) {
    return {
      engine: 'whisper',
      model: PARAKEET_FALLBACK_WHISPER_MODEL,
      fallbackReason: 'language',
    }
  }

  return { engine: 'parakeet', model }
}
