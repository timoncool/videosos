// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  DEFAULT_WHISPER_LANGUAGE,
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  normalizeWhisperLanguage,
  WHISPER_AUTO_LANGUAGE_VALUE,
} from './whisper-settings'

describe('whisper-settings', () => {
  it('uses auto-detect for blank language settings', () => {
    expect(getWhisperLanguageSelectValue(DEFAULT_WHISPER_LANGUAGE)).toBe(
      WHISPER_AUTO_LANGUAGE_VALUE,
    )
    expect(getWhisperLanguageSettingValue(WHISPER_AUTO_LANGUAGE_VALUE)).toBe(
      DEFAULT_WHISPER_LANGUAGE,
    )
  })

  it('keeps supported language codes stable in the select', () => {
    expect(getWhisperLanguageSelectValue('en')).toBe('en')
    expect(getWhisperLanguageSettingValue('es')).toBe('es')
  })

  it('normalizes language codes to lowercase', () => {
    expect(normalizeWhisperLanguage(' EN ')).toBe('en')
  })

  it('falls back to auto-detect when a stored language is unsupported', () => {
    expect(getWhisperLanguageSelectValue('english')).toBe(WHISPER_AUTO_LANGUAGE_VALUE)
    expect(getWhisperLanguageSelectValue('yue')).toBe(WHISPER_AUTO_LANGUAGE_VALUE)
  })
})
