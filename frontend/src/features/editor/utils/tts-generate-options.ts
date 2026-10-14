import type { TFunction } from 'i18next'
import {
  getMossTtsVoiceOption,
  MOSS_TTS_VOICE_OPTIONS,
  type MossTtsVoice,
} from '@/features/editor/services/moss-tts-service'
import {
  SUPERTONIC_TTS_VOICE_OPTIONS,
  type SupertonicTtsVoice,
} from '@/features/editor/services/supertonic-tts-service'
import type { StoredTtsEngine } from '@/shared/utils/tts-settings'

export interface TtsVoiceOption {
  value: string
  label: string
}

/** The voice each engine currently has selected in the dialog. */
export interface TtsVoiceSelection {
  moss: MossTtsVoice
  supertonic: SupertonicTtsVoice
}

export interface TtsVoiceSetters {
  moss: (voice: MossTtsVoice) => void
  supertonic: (voice: SupertonicTtsVoice) => void
}

export type TtsTranslate = TFunction

/**
 * Engine-keyed presentation data. Callers index these records instead of
 * branching on the engine, so a new engine is one entry here and nothing else.
 */
export const TTS_VOICE_OPTIONS_BY_ENGINE: Record<StoredTtsEngine, readonly TtsVoiceOption[]> = {
  moss: MOSS_TTS_VOICE_OPTIONS,
  supertonic: SUPERTONIC_TTS_VOICE_OPTIONS,
}

export const TTS_VOICE_KEY_BY_ENGINE: Record<StoredTtsEngine, keyof TtsVoiceSelection> = {
  moss: 'moss',
  supertonic: 'supertonic',
}

/** Resolves the selected value to its option, falling back to the raw value as its label. */
export const TTS_VOICE_OPTION_RESOLVERS: Record<
  StoredTtsEngine,
  (voice: string) => TtsVoiceOption
> = {
  moss: (voice) => getMossTtsVoiceOption(voice as MossTtsVoice),
  supertonic: (voice) =>
    SUPERTONIC_TTS_VOICE_OPTIONS.find((option) => option.value === voice) ?? {
      value: voice,
      label: voice,
    },
}

export const TTS_VOICE_CHANGE_HANDLERS: Record<
  StoredTtsEngine,
  (voice: string, setters: TtsVoiceSetters) => void
> = {
  moss: (voice, setters) => setters.moss(voice as MossTtsVoice),
  supertonic: (voice, setters) => setters.supertonic(voice as SupertonicTtsVoice),
}

export const TTS_SPEED_RANGE_BY_ENGINE: Record<StoredTtsEngine, { min: number; max: number }> = {
  moss: { min: 0.5, max: 2 },
  supertonic: { min: 0.8, max: 1.3 },
}

// Engines whose runtime applies the slider speed itself; the others synthesize at 1x.
export const NATIVE_SPEED_ENGINES: readonly StoredTtsEngine[] = ['supertonic']

export interface TtsGenerateGuards {
  hasProject: boolean
  trimmedText: string
  engine: StoredTtsEngine
  isSupported: boolean
}

export const TTS_MODEL_LABEL_BY_ENGINE: Record<StoredTtsEngine, string> = {
  moss: 'Multilingual Nano',
  supertonic: 'Supertonic 3',
}

export const TTS_RESULT_TAGS_BY_ENGINE: Record<
  StoredTtsEngine,
  (voice: string) => string[]
> = {
  moss: (voice) => ['ai-generated', 'moss-tts', 'tts-engine:moss', `moss-voice:${voice}`],
  supertonic: (voice) => [
    'ai-generated',
    'supertonic-tts',
    'tts-engine:supertonic',
    `supertonic-voice:${voice}`,
  ],
}

const SUPERTONIC_UNSUPPORTED_FALLBACK =
  'This browser cannot run the local Supertonic TTS runtime. Try a recent Chrome or Edge browser.'

const TTS_UNSUPPORTED_MESSAGE_BY_ENGINE: Record<
  StoredTtsEngine,
  { key: string; fallback: string | null }
> = {
  moss: { key: 'editor.tts.mossUnsupported', fallback: null },
  supertonic: {
    key: 'editor.tts.supertonicUnsupported',
    fallback: SUPERTONIC_UNSUPPORTED_FALLBACK,
  },
}

export function resolveTtsUnsupportedMessage(engine: StoredTtsEngine, t: TtsTranslate): string {
  const { key, fallback } = TTS_UNSUPPORTED_MESSAGE_BY_ENGINE[engine]
  return fallback === null ? t(key) : t(key, { defaultValue: fallback })
}

/** First reason the dialog cannot start a generation, or null when it can. */
export function resolveTtsGenerateError(guards: TtsGenerateGuards, t: TtsTranslate): string | null {
  if (!guards.hasProject) return t('editor.tts.errors.openProject')
  if (guards.trimmedText.length === 0) return t('editor.tts.errors.enterText')
  if (!guards.isSupported) return resolveTtsUnsupportedMessage(guards.engine, t)
  return null
}
