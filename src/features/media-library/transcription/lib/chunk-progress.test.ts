// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  getChunkCompletionProgress,
  getChunkEndProgress,
  getChunkStartProgress,
  transcribingProgressEvent,
} from './chunk-progress'
import type { PCMChunk } from '../types'

const SAMPLE_RATE = 16_000

function chunk(overrides: Partial<PCMChunk> = {}): PCMChunk {
  return {
    samples: new Float32Array(SAMPLE_RATE * 120),
    timestamp: 0,
    final: false,
    totalDuration: 600,
    ...overrides,
  }
}

describe('chunk-progress', () => {
  it('derives an absolute position from the chunk timestamp', () => {
    expect(getChunkStartProgress(chunk({ timestamp: 118 }))).toBeCloseTo(118 / 600)
    expect(getChunkEndProgress(chunk({ timestamp: 118 }))).toBeCloseTo(238 / 600)
  })

  // The bug this guards: reporting 1 at the end of every chunk drove the monotonic merge to
  // 100% on the first chunk, freezing the bar for the rest of a long file.
  it('advances across successive chunks instead of completing on the first', () => {
    const first = getChunkCompletionProgress(chunk({ timestamp: 0 }))
    const second = getChunkCompletionProgress(chunk({ timestamp: 118 }))
    if (first === null || second === null) throw new Error('a known duration must yield a position')

    expect(first).toBeLessThan(1)
    expect(second).toBeGreaterThan(first)
    expect(second).toBeLessThan(1)
  })

  it('clamps a chunk whose overlap runs past the end of the audio', () => {
    expect(getChunkEndProgress(chunk({ timestamp: 118, totalDuration: 150 }))).toBe(1)
  })

  it('always completes the bar on the final chunk', () => {
    expect(getChunkCompletionProgress(chunk({ timestamp: 0, final: true }))).toBe(1)
    // Even when the duration is unknown, the final chunk must land on 100%.
    expect(getChunkCompletionProgress(chunk({ final: true, totalDuration: 0 }))).toBe(1)
  })

  it('reports no position when the producer could not determine a duration', () => {
    expect(getChunkStartProgress(chunk({ totalDuration: 0 }))).toBeNull()
    expect(getChunkEndProgress(chunk({ totalDuration: 0 }))).toBeNull()
    expect(getChunkCompletionProgress(chunk({ totalDuration: 0 }))).toBeNull()
  })

  it('flags the transcribing event indeterminate when the duration is unknown', () => {
    // Reporting 0 for every chunk pegged the bar at the start of the stage for the whole
    // transcription; an indeterminate event lets the UI run a moving bar instead.
    expect(transcribingProgressEvent(chunk({ totalDuration: 0 }))).toEqual({
      stage: 'transcribing',
      progress: 0,
      indeterminate: true,
    })
    // The final chunk still completes the bar, and is never indeterminate.
    expect(transcribingProgressEvent(chunk({ totalDuration: 0, final: true }))).toEqual({
      stage: 'transcribing',
      progress: 1,
    })
  })

  it('reports a measured fraction when the duration is known', () => {
    expect(transcribingProgressEvent(chunk({ timestamp: 118 }))).toEqual({
      stage: 'transcribing',
      progress: 238 / 600,
    })
  })
})
