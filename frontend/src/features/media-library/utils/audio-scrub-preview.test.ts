// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { createAudioScrubPreview, getAudioScrubTime } from './audio-scrub-preview'

function makeFakeAudioContext() {
  const stop = vi.fn()
  const start = vi.fn()
  const connect = vi.fn()
  const disconnect = vi.fn()
  const gain = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
  const source = {
    buffer: null as AudioBuffer | null,
    connect,
    start,
    stop,
    disconnect,
    onended: null as (() => void) | null,
  }
  const buffer = { duration: 10 } as AudioBuffer
  return {
    context: {
      currentTime: 5,
      destination: {},
      state: 'running' as AudioContextState,
      resume: vi.fn(async () => undefined),
      decodeAudioData: vi.fn(async () => buffer),
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => ({ gain, connect })),
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext,
    source,
    gain,
    buffer,
  }
}

describe('audio scrub preview', () => {
  it('maps pointer progress to a clamped source time', () => {
    expect(getAudioScrubTime(12, 0.25)).toBe(3)
    expect(getAudioScrubTime(12, -1)).toBe(0)
    expect(getAudioScrubTime(12, 2)).toBe(12)
    expect(getAudioScrubTime(0, 0.5)).toBe(0)
  })

  it('plays a short faded grain at the requested source time', async () => {
    const fake = makeFakeAudioContext()
    const scrub = createAudioScrubPreview({
      createAudioContext: () => fake.context,
      fetchArrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
      grainDurationSeconds: 0.08,
    })

    await scrub.scrub({
      mediaId: 'audio-1',
      mediaUrl: 'blob:audio-1',
      timeSeconds: 9.99,
    })

    expect(fake.context.decodeAudioData).toHaveBeenCalledTimes(1)
    expect(fake.source.buffer).toBe(fake.buffer)
    expect(fake.gain.setValueAtTime).toHaveBeenCalledWith(0, 5)
    expect(fake.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 5.008)
    expect(fake.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.08)
    expect(fake.source.start).toHaveBeenCalledWith(5, 9.92, 0.08)
  })

  it('stops the previous grain before starting the next one', async () => {
    const first = makeFakeAudioContext()
    const scrub = createAudioScrubPreview({
      createAudioContext: () => first.context,
      fetchArrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    })

    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 1 })
    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 2 })

    expect(first.source.stop).toHaveBeenCalledTimes(1)
  })

  it('evicts decoded buffers beyond the byte budget and re-decodes on demand', async () => {
    const fake = makeFakeAudioContext()
    const decodedBuffer = {
      duration: 10,
      length: 100,
      numberOfChannels: 2,
    } as AudioBuffer
    const decodeAudioData = vi.fn(async () => decodedBuffer)
    const context = {
      ...fake.context,
      decodeAudioData,
    } as unknown as AudioContext
    const fetchArrayBuffer = vi.fn(async (url: string) =>
      url === 'blob:audio-1' ? new ArrayBuffer(8) : new ArrayBuffer(16),
    )
    const scrub = createAudioScrubPreview({
      createAudioContext: () => context,
      fetchArrayBuffer,
      // One buffer is 800 bytes (100 frames × 2 channels × 4 bytes).
      maxCachedBufferBytes: 800,
    })

    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 1 })
    await scrub.scrub({ mediaId: 'audio-2', mediaUrl: 'blob:audio-2', timeSeconds: 1 })

    expect(fetchArrayBuffer).toHaveBeenCalledTimes(2)

    // audio-1 was evicted when audio-2 pushed the cache over budget.
    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 2 })

    const audioOneFetches = fetchArrayBuffer.mock.calls.filter(([url]) => url === 'blob:audio-1')
    expect(audioOneFetches).toHaveLength(2)
    expect(decodeAudioData).toHaveBeenCalledTimes(3)
  })

  it('drops failed decodes so a later scrub can retry', async () => {
    const fake = makeFakeAudioContext()
    let remainingFailures = 1
    const decodeAudioData = vi.fn(async () => {
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error('decode failed')
      }
      return fake.buffer
    })
    const context = {
      ...fake.context,
      decodeAudioData,
    } as unknown as AudioContext
    const scrub = createAudioScrubPreview({
      createAudioContext: () => context,
      fetchArrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    })

    await expect(
      scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 1 }),
    ).rejects.toThrow('decode failed')

    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 1 })

    expect(decodeAudioData).toHaveBeenCalledTimes(2)
  })
})
