// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { resolveTranscriptionEngine } from './transcription-engine'

describe('resolveTranscriptionEngine', () => {
  it('keeps an explicit whisper model on the whisper engine', () => {
    expect(resolveTranscriptionEngine('whisper-large', 'en')).toEqual({
      engine: 'whisper',
      model: 'whisper-large',
    })
  })

  it('uses parakeet for its languages', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'fr')).toEqual({
      engine: 'parakeet',
      model: 'parakeet-tdt-v3',
    })
  })

  it('uses parakeet for auto-detect (no language)', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', '')).toEqual({
      engine: 'parakeet',
      model: 'parakeet-tdt-v3',
    })
  })

  it('falls back to Whisper Large Turbo for unsupported languages', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'ja')).toEqual({
      engine: 'whisper',
      model: 'whisper-large',
      fallbackReason: 'language',
    })
  })

  it('normalizes language casing and whitespace', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', '  EN ')).toEqual({
      engine: 'parakeet',
      model: 'parakeet-tdt-v3',
    })
  })
})
