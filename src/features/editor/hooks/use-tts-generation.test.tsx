import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TtsGenerateOutput } from '../services/tts-generate-request'
import { useTtsGeneration, type TtsGenerationParams } from './use-tts-generation'

const generateTtsAudioMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../services/tts-generate-request', () => ({
  generateTtsAudio: generateTtsAudioMock,
}))

function output(name: string): TtsGenerateOutput {
  const blob = new Blob([name], { type: 'audio/wav' })
  return {
    blob,
    file: new File([blob], `${name}.wav`, { type: 'audio/wav' }),
    duration: 1,
  }
}

const params: TtsGenerationParams = {
  projectId: 'project-1',
  sourceItemId: null,
  text: 'Hello',
  engine: 'kokoro',
  voice: 'af_heart',
  voiceLabel: 'Heart',
  language: 'auto',
  speed: 1,
  model: 'fp32',
  isSupported: true,
  loadMediaItems: vi.fn(async () => undefined),
  showNotification: vi.fn(),
}

describe('useTtsGeneration', () => {
  beforeEach(() => {
    generateTtsAudioMock.mockReset()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('revokes an uninserted result before replacing it during regeneration', async () => {
    generateTtsAudioMock
      .mockResolvedValueOnce({ ok: true, output: output('first') })
      .mockResolvedValueOnce({ ok: true, output: output('second') })
    const { result } = renderHook(() => useTtsGeneration(params))

    await act(async () => result.current.generate())
    expect(result.current.result?.objectUrl).toBe('blob:first')

    await act(async () => result.current.generate())

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(result.current.result?.objectUrl).toBe('blob:second')
  })
})
