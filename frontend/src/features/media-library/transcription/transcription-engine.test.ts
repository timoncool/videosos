// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { resolveTranscriptionEngine } from './transcription-engine'

describe('resolveTranscriptionEngine', () => {
  it('keeps explicit whisper models on the whisper engine', () => {
    expect(resolveTranscriptionEngine('whisper-small', 'en', { webgpu: true })).toEqual({
      engine: 'whisper',
      model: 'whisper-small',
    })
  })

  it('uses parakeet for supported languages when WebGPU is available', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'fr', { webgpu: true })).toEqual({
      engine: 'parakeet',
      model: 'parakeet-tdt-v3',
    })
  })

  it('uses parakeet for auto-detect (no language) when WebGPU is available', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', '', { webgpu: true })).toEqual({
      engine: 'parakeet',
      model: 'parakeet-tdt-v3',
    })
  })

  it('falls back to whisper base for unsupported languages', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'ja', { webgpu: true })).toEqual({
      engine: 'whisper',
      model: 'whisper-base',
      fallbackReason: 'language',
    })
  })

  it('falls back to whisper base when WebGPU is unavailable', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'en', { webgpu: false })).toEqual({
      engine: 'whisper',
      model: 'whisper-base',
      fallbackReason: 'no-webgpu',
    })
  })

  it('prioritizes the language fallback over the WebGPU fallback', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'zh', { webgpu: false })).toEqual({
      engine: 'whisper',
      model: 'whisper-base',
      fallbackReason: 'language',
    })
  })

  it('normalizes language casing and whitespace', () => {
    expect(resolveTranscriptionEngine('parakeet-tdt-v3', '  EN ', { webgpu: true })).toEqual({
      engine: 'parakeet',
      model: 'parakeet-tdt-v3',
    })
  })
})
