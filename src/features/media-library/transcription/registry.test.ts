// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  getDefaultMediaTranscriptionAdapter,
  getDefaultMediaTranscriptionModel,
  getMediaTranscriptionModelLabel,
  getMediaTranscriptionModelOptions,
} from './registry'

describe('mediaTranscriptionAdapterRegistry', () => {
  it('resolves the default transcription adapter and model catalog', () => {
    expect(getDefaultMediaTranscriptionAdapter()).toMatchObject({
      id: 'browser-whisper',
      label: 'Browser Whisper',
    })
    expect(getDefaultMediaTranscriptionModel()).toBe('parakeet-tdt-v3')
    expect(getMediaTranscriptionModelOptions()).toContainEqual({
      value: 'whisper-small',
      label: 'Whisper Small',
    })
    expect(getMediaTranscriptionModelOptions()).not.toContainEqual({
      value: 'whisper-tiny',
      label: 'Tiny',
    })
  })

  it('formats model labels through the active adapter', () => {
    expect(getMediaTranscriptionModelLabel('whisper-large')).toBe('Whisper Large v3 Turbo')
  })
})
