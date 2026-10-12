import type { MediaTranscriptModel } from '@/types/storage'
import type { TranscriptionEngine } from './types'

const PARAKEET_MODEL: MediaTranscriptModel = 'parakeet-tdt-v3'

// When Parakeet can't handle a job we transcribe with Whisper base — the fastest Whisper
// tier with broad language coverage and a small download.
const PARAKEET_FALLBACK_WHISPER_MODEL: MediaTranscriptModel = 'whisper-base'

// Parakeet TDT 0.6B v3 covers 25 European languages (auto-detected). Anything outside this
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

function detectWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null
}

export interface ResolvedTranscriptionEngine {
  engine: TranscriptionEngine
  /** The model actually used — may differ from the requested one when falling back. */
  model: MediaTranscriptModel
  fallbackReason?: 'language' | 'no-webgpu'
}

/**
 * Decide which on-device engine runs a job. Parakeet is used when selected and viable
 * (supported language + WebGPU); otherwise the job transparently falls back to Whisper.
 * `webgpu` can be injected for testing; it defaults to runtime feature detection.
 */
export function resolveTranscriptionEngine(
  model: MediaTranscriptModel,
  language: string | undefined,
  options: { webgpu?: boolean } = {},
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

  const webgpu = options.webgpu ?? detectWebGpu()
  if (!webgpu) {
    return {
      engine: 'whisper',
      model: PARAKEET_FALLBACK_WHISPER_MODEL,
      fallbackReason: 'no-webgpu',
    }
  }

  return { engine: 'parakeet', model }
}
