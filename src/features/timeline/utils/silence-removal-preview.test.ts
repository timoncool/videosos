// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AudioItem } from '@/types/timeline'
import type { MediaTranscript } from '@/types/storage'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'

const dependencyMocks = vi.hoisted(() => ({
  getOrDecodeAudioSliceForPlayback: vi.fn(),
  getTranscript: vi.fn(),
  resolveMediaUrl: vi.fn(),
  runMediaTranscriptionJob: vi.fn(),
}))

vi.mock('@/features/timeline/deps/composition-runtime', () => ({
  getOrDecodeAudioSliceForPlayback: dependencyMocks.getOrDecodeAudioSliceForPlayback,
}))

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: dependencyMocks.resolveMediaUrl,
}))

vi.mock('@/features/timeline/deps/media-transcription-service', () => ({
  mediaTranscriptionService: { getTranscript: dependencyMocks.getTranscript },
  runMediaTranscriptionJob: dependencyMocks.runMediaTranscriptionJob,
}))

import {
  analyzeSilenceForItems,
  DEFAULT_SILENCE_REMOVAL_SETTINGS,
  detectSpeechSilenceRanges,
} from './silence-removal-preview'

function makeAudioItem(id: string, mediaId: string): AudioItem {
  return {
    id,
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 1000,
    label: id,
    src: `blob:${mediaId}`,
    mediaId,
    sourceStart: 0,
    sourceEnd: 1000,
    sourceDuration: 1000,
    sourceFps: 1000,
  }
}

function makeAudioBuffer(samples: number[]) {
  const data = new Float32Array(samples)
  return {
    duration: samples.length / 1000,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: 1000,
    getChannelData: () => data,
  } as unknown as AudioBuffer
}

describe('silence removal analysis', () => {
  beforeEach(() => {
    dependencyMocks.getOrDecodeAudioSliceForPlayback.mockReset()
    dependencyMocks.getTranscript.mockReset()
    dependencyMocks.resolveMediaUrl.mockReset()
    dependencyMocks.runMediaTranscriptionJob.mockReset()
    useTimelineSettingsStore.setState({ fps: 1000 })
    useItemsStore.getState().setItems([])
  })

  it('returns successful ranges and explicitly reports media that failed analysis', async () => {
    useItemsStore
      .getState()
      .setItems([makeAudioItem('audio-1', 'media-1'), makeAudioItem('audio-2', 'media-2')])
    dependencyMocks.resolveMediaUrl.mockImplementation(async (mediaId: string) => `blob:${mediaId}`)
    dependencyMocks.getOrDecodeAudioSliceForPlayback.mockImplementation(async (mediaId: string) => {
      if (mediaId === 'media-2') throw new Error('decode failed')
      return {
        buffer: makeAudioBuffer([
          ...Array.from({ length: 100 }, () => 0.5),
          ...Array.from({ length: 700 }, () => 0),
          ...Array.from({ length: 200 }, () => 0.5),
        ]),
        startTime: 0,
        isComplete: false,
      }
    })

    const result = await analyzeSilenceForItems(['audio-1', 'audio-2'], {
      ...DEFAULT_SILENCE_REMOVAL_SETTINGS,
      autoThresholds: false,
      minAudioMs: 20,
      paddingStartMs: 0,
      paddingEndMs: 0,
      smoothingMs: 0,
    })

    expect(result.analyzedMediaIds).toEqual(['media-1'])
    expect(result.failedMediaIds).toEqual(['media-2'])
    expect(result.rangesByMediaId['media-1']).toEqual([{ start: 0.1, end: 0.8 }])
  })

  it('derives removable gaps from transcript speech while preserving asymmetric handles', () => {
    const transcript = {
      mediaId: 'media-1',
      segments: [
        { start: 2, end: 4, text: 'one' },
        { start: 6, end: 8, text: 'two' },
      ],
    } as MediaTranscript

    expect(
      detectSpeechSilenceRanges(transcript, [{ start: 0, end: 10 }], {
        minSilenceMs: 500,
        paddingStartMs: 100,
        paddingEndMs: 200,
      }),
    ).toEqual([
      { start: 0.1, end: 1.8 },
      { start: 4.1, end: 5.8 },
      { start: 8.1, end: 9.8 },
    ])
  })

  it('does not classify an entire clip as silence when speech recognition returns no cues', () => {
    const transcript = { mediaId: 'media-1', segments: [] } as unknown as MediaTranscript

    expect(
      detectSpeechSilenceRanges(transcript, [{ start: 0, end: 10 }], {
        minSilenceMs: 500,
        paddingStartMs: 100,
        paddingEndMs: 100,
      }),
    ).toEqual([])
  })

  // Regression: a span that no word overlaps is silent end to end. Bailing out
  // on "no overlapping speech" made these previews claim there was nothing to
  // remove. Distinct from the no-cues case above, which is guarded earlier and
  // must keep returning [] so an untranscribed clip is never wiped.
  it('removes a span that lies entirely outside the transcribed speech', () => {
    const transcript = {
      mediaId: 'media-1',
      segments: [{ start: 20, end: 24, text: 'one' }],
    } as MediaTranscript
    const settings = { minSilenceMs: 500, paddingStartMs: 100, paddingEndMs: 200 }

    // Before the first word, after the last word, and an untranscribed gap
    // between two selected spans — none of these overlap a word.
    expect(
      detectSpeechSilenceRanges(
        transcript,
        [
          { start: 0, end: 10 },
          { start: 30, end: 40 },
        ],
        settings,
      ),
    ).toEqual([
      { start: 0.1, end: 9.8 },
      { start: 30.1, end: 39.8 },
    ])
  })

  it('still reports nothing for a non-overlapping span shorter than minSilence', () => {
    const transcript = {
      mediaId: 'media-1',
      segments: [{ start: 20, end: 24, text: 'one' }],
    } as MediaTranscript

    expect(
      detectSpeechSilenceRanges(transcript, [{ start: 0, end: 0.3 }], {
        minSilenceMs: 500,
        paddingStartMs: 100,
        paddingEndMs: 100,
      }),
    ).toEqual([])
  })

  it('keeps padding from swallowing a non-overlapping span whole', () => {
    const transcript = {
      mediaId: 'media-1',
      segments: [{ start: 20, end: 24, text: 'one' }],
    } as MediaTranscript

    // 0.6s span clears minSilence, but 0.4s + 0.4s of padding leaves nothing.
    expect(
      detectSpeechSilenceRanges(transcript, [{ start: 0, end: 0.6 }], {
        minSilenceMs: 500,
        paddingStartMs: 400,
        paddingEndMs: 400,
      }),
    ).toEqual([])
  })

  it('aborts before starting media work', async () => {
    useItemsStore.getState().setItems([makeAudioItem('audio-1', 'media-1')])
    const controller = new AbortController()
    controller.abort()

    await expect(
      analyzeSilenceForItems(['audio-1'], DEFAULT_SILENCE_REMOVAL_SETTINGS, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(dependencyMocks.resolveMediaUrl).not.toHaveBeenCalled()
  })
})
