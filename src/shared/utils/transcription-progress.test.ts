// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  getTranscriptionOverallPercent,
  getTranscriptionProgressDetail,
  getTranscriptionProgressLabel,
  getTranscriptionStageLabel,
  mergeTranscriptionProgress,
} from './transcription-progress'

describe('transcription-progress', () => {
  it('maps stages into a stable overall percentage range', () => {
    expect(getTranscriptionOverallPercent({ stage: 'queued', progress: 1 })).toBe(0)
    expect(getTranscriptionOverallPercent({ stage: 'downloading', progress: 1 })).toBeCloseTo(60)
    expect(getTranscriptionOverallPercent({ stage: 'preparing', progress: 1 })).toBeCloseTo(75)
    expect(getTranscriptionOverallPercent({ stage: 'decoding', progress: 0.5 })).toBeCloseTo(77.5)
    expect(getTranscriptionOverallPercent({ stage: 'transcribing', progress: 0.5 })).toBeCloseTo(90)
  })

  it('orders stages so a cold start never steps backward', () => {
    const percents = (
      [
        { stage: 'queued', progress: 1 },
        { stage: 'downloading', progress: 1 },
        { stage: 'preparing', progress: 1 },
        { stage: 'decoding', progress: 1 },
        { stage: 'transcribing', progress: 1 },
      ] as const
    ).map(getTranscriptionOverallPercent)

    expect(percents).toEqual([...percents].sort((a, b) => a - b))
  })

  it('keeps progress monotonic within the model track', () => {
    const preparing = mergeTranscriptionProgress(undefined, { stage: 'preparing', progress: 0.5 })

    expect(mergeTranscriptionProgress(preparing, { stage: 'downloading', progress: 1 })).toEqual(
      preparing,
    )
  })

  // WebGPU can reject the fp16 encoder only once ORT tries to compile it, by which point the
  // bar is on `preparing`. Fetching the int8 encoder is a real ~749 MB transfer, so it has to
  // rewind the bar rather than hide behind an indeterminate "Preparing model".
  it('lets a restarted download rewind an in-flight prepare', () => {
    const preparing = mergeTranscriptionProgress(undefined, { stage: 'preparing', progress: 0 })
    const fallback = mergeTranscriptionProgress(preparing, {
      stage: 'downloading',
      progress: 0.1,
      restarted: true,
    })

    expect(fallback.stage).toBe('downloading')
    expect(fallback.progress).toBe(0.1)
  })

  it('does not let a restarted download rewind a finished prepare', () => {
    const prepared = mergeTranscriptionProgress(undefined, { stage: 'preparing', progress: 1 })

    expect(
      mergeTranscriptionProgress(prepared, {
        stage: 'downloading',
        progress: 0.1,
        restarted: true,
      }),
    ).toEqual(prepared)
  })

  it('keeps progress monotonic within the audio track', () => {
    const transcribing = mergeTranscriptionProgress(undefined, {
      stage: 'transcribing',
      progress: 0.5,
    })

    expect(mergeTranscriptionProgress(transcribing, { stage: 'decoding', progress: 1 })).toEqual(
      transcribing,
    )
  })

  // The regression: audio decode finishes in ~1 s while the model transfer takes minutes. When
  // both tracks shared one monotonic rule, `decoding` immediately topped out its band and every
  // later `downloading` update was discarded — the bar froze and the download was never shown.
  it('keeps showing the model download when audio decode finishes first', () => {
    const downloading = mergeTranscriptionProgress(undefined, {
      stage: 'downloading',
      progress: 0.02,
    })
    const afterDecode = mergeTranscriptionProgress(downloading, { stage: 'decoding', progress: 1 })
    expect(afterDecode.stage).toBe('downloading')

    const later = mergeTranscriptionProgress(afterDecode, {
      stage: 'downloading',
      progress: 0.4,
      receivedBytes: 500,
      totalBytes: 1_250,
    })
    expect(later).toMatchObject({ stage: 'downloading', progress: 0.4, receivedBytes: 500 })
  })

  it('reclaims the display for a model download that starts after decode has reported', () => {
    const decoding = mergeTranscriptionProgress(undefined, { stage: 'decoding', progress: 0.3 })

    // The model is the long pole, so it takes the display back even though its percent is lower.
    expect(mergeTranscriptionProgress(decoding, { stage: 'downloading', progress: 0 }).stage).toBe(
      'downloading',
    )
  })

  it('hands the display to the audio track once the model is ready', () => {
    const ready = mergeTranscriptionProgress(undefined, { stage: 'preparing', progress: 1 })

    expect(mergeTranscriptionProgress(ready, { stage: 'decoding', progress: 0.5 }).stage).toBe(
      'decoding',
    )
    expect(mergeTranscriptionProgress(ready, { stage: 'transcribing', progress: 0.1 }).stage).toBe(
      'transcribing',
    )
  })

  it('does not let a completed warm model overwrite live audio progress', () => {
    const decoding = mergeTranscriptionProgress(undefined, { stage: 'decoding', progress: 0.4 })

    // A warm worker reports `preparing: 1` instantly; there is nothing to show for it.
    expect(mergeTranscriptionProgress(decoding, { stage: 'preparing', progress: 1 })).toEqual(
      decoding,
    )
  })

  it('refreshes byte counters when a download stalls at the same percentage', () => {
    const first = mergeTranscriptionProgress(undefined, {
      stage: 'downloading',
      progress: 0.5,
      receivedBytes: 500,
      totalBytes: 1_000,
    })

    // Same overall percent, newer byte count — must not be discarded as non-monotonic.
    expect(
      mergeTranscriptionProgress(first, {
        stage: 'downloading',
        progress: 0.5,
        receivedBytes: 501,
        totalBytes: 1_000,
      }).receivedBytes,
    ).toBe(501)
  })

  it('clamps progress values to the supported range', () => {
    expect(getTranscriptionOverallPercent({ stage: 'downloading', progress: 5 })).toBeCloseTo(60)
    expect(
      mergeTranscriptionProgress(undefined, {
        stage: 'transcribing',
        progress: -1,
      }),
    ).toEqual({
      stage: 'transcribing',
      progress: 0,
    })
  })

  it('formats readable stage labels', () => {
    expect(getTranscriptionStageLabel('queued')).toBe('Queued')
    expect(getTranscriptionStageLabel('downloading')).toBe('Downloading model')
    expect(getTranscriptionStageLabel('preparing')).toBe('Preparing model')
    expect(getTranscriptionStageLabel('decoding')).toBe('Preparing audio')
    expect(getTranscriptionStageLabel('transcribing')).toBe('Transcribing')
  })

  it('does not claim to be downloading when every file came from cache', () => {
    expect(
      getTranscriptionProgressLabel({ stage: 'downloading', progress: 0.5, fromCache: true }),
    ).toBe('Loading cached model')
    expect(
      getTranscriptionProgressLabel({ stage: 'downloading', progress: 0.5, fromCache: false }),
    ).toBe('Downloading model')
  })

  it('reports transferred bytes only when both counters are known', () => {
    expect(
      getTranscriptionProgressDetail({
        stage: 'downloading',
        progress: 0.5,
        receivedBytes: 512 * 1024 * 1024,
        totalBytes: 1024 * 1024 * 1024,
      }),
    ).toBe('512.0 MB of 1.00 GB')

    expect(getTranscriptionProgressDetail({ stage: 'downloading', progress: 0.5 })).toBeNull()
    expect(getTranscriptionProgressDetail({ stage: 'transcribing', progress: 0.5 })).toBeNull()
  })
})
