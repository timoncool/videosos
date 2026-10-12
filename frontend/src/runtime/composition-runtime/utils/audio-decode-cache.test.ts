// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const decodedPreviewAudioMocks = vi.hoisted(() => ({
  getDecodedPreviewAudio: vi.fn<(_id?: string) => Promise<unknown | null>>(async () => null),
  saveDecodedPreviewAudio: vi.fn(async () => undefined),
  deleteDecodedPreviewAudio: vi.fn(async () => undefined),
}))

const mediaDbMocks = vi.hoisted(() => ({
  getMedia: vi.fn<
    (_id: string) => Promise<{
      mimeType: string
      codec?: string
      audioCodec?: string
    } | null>
  >(async () => null),
}))

const ac3Mocks = vi.hoisted(() => ({
  ensureAc3DecoderRegistered: vi.fn(async () => undefined),
  isAc3AudioCodec: vi.fn(() => false),
}))

const objectUrlRegistryMocks = vi.hoisted(() => ({
  getObjectUrlBlob: vi.fn(() => null),
  getObjectUrlSourceMetadata: vi.fn(() => null),
}))

const previewAudioConformMocks = vi.hoisted(() => ({
  isPreviewAudioConformed: vi.fn(async () => false),
  persistPreviewAudioConform: vi.fn(async () => undefined),
  persistPreviewAudioConformFromInt16: vi.fn(async () => undefined),
}))

const mediabunnyMocks = vi.hoisted(() => {
  type MockAudioSample = {
    numberOfFrames: number
    numberOfChannels: number
    sampleRate: number
    timestamp: number
    duration: number
    copyTo: (
      destination: Float32Array,
      options: { planeIndex: number; format: 'f32-planar' },
    ) => void
    close: () => void
  }

  let pendingSamplePromise: Promise<MockAudioSample | null> | null = null
  let pendingSamples: Array<{
    numberOfFrames: number
    numberOfChannels: number
    sampleRate: number
    timestamp: number
    duration: number
    copyTo: (
      destination: Float32Array,
      options: { planeIndex: number; format: 'f32-planar' },
    ) => void
    close: () => void
  }> = []
  let rejectTargetedWindows = false
  const stats = {
    inputConstructed: 0,
    sinkConstructed: 0,
    sampleSinkConstructed: 0,
    bufferRangeStarts: [] as number[],
    sequentialSamplesCalls: 0,
  }

  class Input {
    constructor(sourceConfig: unknown) {
      void sourceConfig
      stats.inputConstructed += 1
    }
    async getPrimaryAudioTrack() {
      return { id: 'track-1' }
    }
    dispose() {}
  }

  class UrlSource {
    constructor(url: string) {
      void url
    }
  }

  class BlobSource {
    constructor(blob: Blob) {
      void blob
    }
  }

  class AudioSampleSink {
    constructor(track: unknown) {
      void track
      stats.sampleSinkConstructed += 1
    }
    async getSample(startTime: number) {
      if (rejectTargetedWindows) {
        throw new Error('Random-access audio decode is unsupported')
      }
      if (pendingSamplePromise) {
        return pendingSamplePromise
      }
      return (
        pendingSamples.find(
          (sample) =>
            sample.timestamp <= startTime && sample.timestamp + sample.duration > startTime,
        ) ??
        pendingSamples.find((sample) => sample.timestamp >= startTime) ??
        null
      )
    }
    samples(startTime?: number, endTime = Number.POSITIVE_INFINITY) {
      if (startTime === undefined) {
        stats.sequentialSamplesCalls += 1
      } else {
        stats.bufferRangeStarts.push(startTime)
      }
      const effectiveStartTime = startTime ?? 0
      const samples = pendingSamples.filter(
        (sample) => sample.timestamp >= effectiveStartTime && sample.timestamp < endTime,
      )
      return (async function* yieldSamples() {
        for (const sample of samples) {
          yield sample
        }
      })()
    }
  }

  return {
    ALL_FORMATS: [],
    Input,
    UrlSource,
    BlobSource,
    AudioSampleSink,
    __setPendingSamples(
      samples: Array<{
        numberOfFrames: number
        numberOfChannels: number
        sampleRate: number
        timestamp: number
        duration: number
        copyTo: (
          destination: Float32Array,
          options: { planeIndex: number; format: 'f32-planar' },
        ) => void
        close: () => void
      }>,
    ) {
      pendingSamples = samples
    },
    __setPendingSamplePromise(promise: Promise<MockAudioSample | null>) {
      pendingSamplePromise = promise
    },
    __setRejectTargetedWindows(value: boolean) {
      rejectTargetedWindows = value
    },
    __reset() {
      pendingSamplePromise = null
      pendingSamples = []
      rejectTargetedWindows = false
      stats.inputConstructed = 0
      stats.sinkConstructed = 0
      stats.sampleSinkConstructed = 0
      stats.bufferRangeStarts = []
      stats.sequentialSamplesCalls = 0
    },
    __stats: stats,
  }
})

vi.mock('@/infrastructure/storage', () => ({
  ...decodedPreviewAudioMocks,
  ...mediaDbMocks,
}))
vi.mock('@/shared/utils/ac3-decoder', () => ac3Mocks)
vi.mock('@/infrastructure/browser/object-url-registry', () => objectUrlRegistryMocks)
vi.mock('./preview-audio-conform', () => previewAudioConformMocks)
vi.mock('mediabunny', () => mediabunnyMocks)

import {
  clearPreviewAudioCache,
  getOrDecodeAudioSliceForPlayback,
  startPreviewAudioConform,
} from './audio-decode-cache'

function makeInt16Buffer(length: number): ArrayBuffer {
  return new Int16Array(length).buffer
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeSample(frameCount: number, sampleRate = 22050, timestamp = 0) {
  return {
    numberOfFrames: frameCount,
    numberOfChannels: 2,
    sampleRate,
    timestamp,
    duration: frameCount / sampleRate,
    copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) {
      void options
      destination.fill(options.planeIndex === 0 ? 0.25 : -0.25)
    },
    close() {},
  }
}

describe('audio-decode-cache targeted slice reuse', () => {
  beforeAll(() => {
    class OfflineAudioContextMock {
      constructor(channels: number, length: number, sampleRate: number) {
        void channels
        void length
        void sampleRate
      }

      createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
        const data = Array.from({ length: channels }, () => new Float32Array(length))
        return {
          duration: length / sampleRate,
          numberOfChannels: channels,
          length,
          sampleRate,
          getChannelData: (channel: number) => data[channel] ?? data[0]!,
        } as unknown as AudioBuffer
      }
    }

    vi.stubGlobal('OfflineAudioContext', OfflineAudioContextMock)
  })

  beforeEach(() => {
    clearPreviewAudioCache()
    mediabunnyMocks.__reset()
    mediaDbMocks.getMedia.mockReset()
    mediaDbMocks.getMedia.mockResolvedValue(null)
    ac3Mocks.ensureAc3DecoderRegistered.mockClear()
    ac3Mocks.isAc3AudioCodec.mockReset()
    ac3Mocks.isAc3AudioCodec.mockReturnValue(false)
    previewAudioConformMocks.persistPreviewAudioConform.mockClear()
    decodedPreviewAudioMocks.saveDecodedPreviewAudio.mockClear()
    decodedPreviewAudioMocks.getDecodedPreviewAudio.mockReset()
    decodedPreviewAudioMocks.getDecodedPreviewAudio.mockImplementation(async () => null)
  })

  it('reuses a completed targeted slice for the same playback request', async () => {
    mediabunnyMocks.__setPendingSamples([makeSample(2 * 22050)])

    const firstSlice = await getOrDecodeAudioSliceForPlayback('media-1', 'blob://audio', {
      minReadySeconds: 2,
      targetTimeSeconds: 0,
      waitTimeoutMs: 0,
    })

    const secondSlice = await getOrDecodeAudioSliceForPlayback('media-1', 'blob://audio', {
      minReadySeconds: 2,
      targetTimeSeconds: 0,
      waitTimeoutMs: 0,
    })

    expect(firstSlice.buffer).toBe(secondSlice.buffer)
    expect(mediabunnyMocks.__stats.inputConstructed).toBe(1)
    expect(mediabunnyMocks.__stats.sinkConstructed).toBe(0)
    expect(mediabunnyMocks.__stats.sampleSinkConstructed).toBe(1)
    expect(mediabunnyMocks.__stats.bufferRangeStarts).toEqual([2])
  })

  it('continues an incomplete targeted slice after the initial decoded buffer', async () => {
    mediabunnyMocks.__setPendingSamples([makeSample(22050)])

    await getOrDecodeAudioSliceForPlayback('media-range', 'blob://audio', {
      minReadySeconds: 2,
      targetTimeSeconds: 0,
      waitTimeoutMs: 0,
    })

    expect(mediabunnyMocks.__stats.bufferRangeStarts).toEqual([1])
  })

  it('decodes a custom-codec playback window without falling back to a full decode', async () => {
    mediaDbMocks.getMedia.mockResolvedValueOnce({ mimeType: 'audio/ac3', codec: 'ac-3' })
    ac3Mocks.isAc3AudioCodec.mockReturnValue(true)
    mediabunnyMocks.__setPendingSamples([makeSample(22050, 22050, 25)])

    const slice = await getOrDecodeAudioSliceForPlayback('media-ac3', 'blob://audio', {
      minReadySeconds: 1,
      targetTimeSeconds: 25,
      waitTimeoutMs: 0,
    })

    expect(slice.startTime).toBe(25)
    expect(slice.buffer.duration).toBe(1)
    expect(slice.isComplete).toBe(false)
    expect(ac3Mocks.ensureAc3DecoderRegistered).toHaveBeenCalledTimes(1)
    expect(mediabunnyMocks.__stats.sampleSinkConstructed).toBe(1)
    expect(mediabunnyMocks.__stats.bufferRangeStarts).toEqual([])
    expect(mediabunnyMocks.__stats.sequentialSamplesCalls).toBe(0)
  })

  it('falls back to bounded sequential decoding when targeted windows are unsupported', async () => {
    mediaDbMocks.getMedia.mockResolvedValue({ mimeType: 'audio/ac3', codec: 'ac-3' })
    ac3Mocks.isAc3AudioCodec.mockReturnValue(true)
    mediabunnyMocks.__setRejectTargetedWindows(true)
    mediabunnyMocks.__setPendingSamples([
      makeSample(22050, 22050, 0),
      makeSample(22050, 22050, 24),
      makeSample(22050, 22050, 25),
      makeSample(22050, 22050, 26),
    ])

    const slice = await getOrDecodeAudioSliceForPlayback('media-sequential', 'blob://audio', {
      minReadySeconds: 1,
      targetTimeSeconds: 25,
      preRollSeconds: 0,
      waitTimeoutMs: 0,
    })

    expect(slice.startTime).toBe(25)
    expect(slice.buffer.duration).toBe(1)
    expect(slice.isComplete).toBe(false)
    expect(mediabunnyMocks.__stats.sampleSinkConstructed).toBe(2)
    expect(mediabunnyMocks.__stats.sequentialSamplesCalls).toBe(1)
    expect(mediabunnyMocks.__stats.bufferRangeStarts).toEqual([])
  })

  it('shares an in-flight targeted slice decode for duplicate startup requests', async () => {
    const deferred = createDeferred<ReturnType<typeof makeSample>>()
    mediabunnyMocks.__setPendingSamplePromise(deferred.promise)

    const firstPromise = getOrDecodeAudioSliceForPlayback('media-2', 'blob://audio', {
      minReadySeconds: 2,
      targetTimeSeconds: 0,
      waitTimeoutMs: 0,
    })
    const secondPromise = getOrDecodeAudioSliceForPlayback('media-2', 'blob://audio', {
      minReadySeconds: 2,
      targetTimeSeconds: 0,
      waitTimeoutMs: 0,
    })

    deferred.resolve(makeSample(2 * 22050))

    const [firstSlice, secondSlice] = await Promise.all([firstPromise, secondPromise])

    expect(firstSlice.buffer).toBe(secondSlice.buffer)
    expect(mediabunnyMocks.__stats.inputConstructed).toBe(1)
    expect(mediabunnyMocks.__stats.sinkConstructed).toBe(0)
    expect(mediabunnyMocks.__stats.sampleSinkConstructed).toBe(1)
  })

  it('reuses a nearby in-flight targeted slice request while playback advances', async () => {
    mediabunnyMocks.__setPendingSamples([makeSample(3 * 22050)])

    const firstPromise = getOrDecodeAudioSliceForPlayback('media-3', 'blob://audio', {
      minReadySeconds: 3,
      targetTimeSeconds: 0,
      waitTimeoutMs: 0,
    })
    const secondPromise = getOrDecodeAudioSliceForPlayback('media-3', 'blob://audio', {
      minReadySeconds: 3,
      targetTimeSeconds: 1.5,
      waitTimeoutMs: 0,
    })

    const [firstSlice, secondSlice] = await Promise.all([firstPromise, secondPromise])

    expect(firstSlice.buffer).toBe(secondSlice.buffer)
    expect(mediabunnyMocks.__stats.inputConstructed).toBe(1)
    expect(mediabunnyMocks.__stats.sinkConstructed).toBe(0)
    expect(mediabunnyMocks.__stats.sampleSinkConstructed).toBe(1)
  })

  it('rebuilds an immediate partial slice from persisted bins around the target time', async () => {
    const records = new Map<string, unknown>([
      [
        'media-4',
        {
          id: 'media-4',
          mediaId: 'media-4',
          kind: 'meta',
          sampleRate: 10,
          totalFrames: 300,
          binCount: 3,
          binDurationSec: 10,
          createdAt: Date.now(),
        },
      ],
      [
        'media-4:bin:0',
        {
          id: 'media-4:bin:0',
          mediaId: 'media-4',
          kind: 'bin',
          binIndex: 0,
          left: makeInt16Buffer(100),
          right: makeInt16Buffer(100),
          frames: 100,
          sampleRate: 10,
          createdAt: Date.now(),
        },
      ],
      [
        'media-4:bin:1',
        {
          id: 'media-4:bin:1',
          mediaId: 'media-4',
          kind: 'bin',
          binIndex: 1,
          left: makeInt16Buffer(100),
          right: makeInt16Buffer(100),
          frames: 100,
          sampleRate: 10,
          createdAt: Date.now(),
        },
      ],
      [
        'media-4:bin:2',
        {
          id: 'media-4:bin:2',
          mediaId: 'media-4',
          kind: 'bin',
          binIndex: 2,
          left: makeInt16Buffer(100),
          right: makeInt16Buffer(100),
          frames: 100,
          sampleRate: 10,
          createdAt: Date.now(),
        },
      ],
    ])
    decodedPreviewAudioMocks.getDecodedPreviewAudio.mockImplementation(async (id?: string) =>
      id ? (records.get(id) ?? null) : null,
    )

    const slice = await getOrDecodeAudioSliceForPlayback('media-4', 'blob://audio', {
      minReadySeconds: 3,
      targetTimeSeconds: 25,
      preRollSeconds: 1,
      waitTimeoutMs: 0,
    })

    expect(slice.startTime).toBe(20)
    expect(slice.buffer.duration).toBe(10)
    expect(slice.isComplete).toBe(false)
    expect(mediabunnyMocks.__stats.inputConstructed).toBe(0)
    expect(mediabunnyMocks.__stats.sinkConstructed).toBe(0)
  })

  it('accepts Blob sources for background conform', async () => {
    mediabunnyMocks.__setPendingSamples([makeSample(4)])

    await expect(
      startPreviewAudioConform('media-blob', new Blob(['audio-bytes'], { type: 'audio/webm' })),
    ).resolves.toBeUndefined()

    expect(mediabunnyMocks.__stats.inputConstructed).toBe(1)
    expect(mediabunnyMocks.__stats.sampleSinkConstructed).toBe(1)
    expect(decodedPreviewAudioMocks.saveDecodedPreviewAudio).toHaveBeenCalled()
    expect(previewAudioConformMocks.persistPreviewAudioConform).toHaveBeenCalled()
  })

  it('skips decode entirely when the conform asset already exists', async () => {
    previewAudioConformMocks.isPreviewAudioConformed.mockResolvedValueOnce(true)
    mediabunnyMocks.__setPendingSamples([makeSample(4)])

    await expect(startPreviewAudioConform('media-conformed', 'blob:src')).resolves.toBeUndefined()

    expect(mediabunnyMocks.__stats.inputConstructed).toBe(0)
    expect(previewAudioConformMocks.persistPreviewAudioConform).not.toHaveBeenCalled()
  })
})
