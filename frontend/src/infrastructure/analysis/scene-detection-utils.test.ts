// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { SceneCut } from './scene-detection-types'
import { deduplicateCuts, seekVideo } from './scene-detection-utils'

function cut(time: number, score: number): SceneCut {
  return {
    time,
    score,
    confidence: 0.8,
    type: 'cut',
    metrics: { kind: 'histogram', histogramDistance: score },
  }
}

describe('deduplicateCuts', () => {
  it('keeps the strongest candidate in a fixed cluster window', () => {
    expect(deduplicateCuts([cut(1, 2), cut(1.1, 8), cut(1.2, 4)], 0.25)).toEqual([cut(1.1, 8)])
  })

  it('preserves candidates outside the cluster window', () => {
    expect(deduplicateCuts([cut(1, 8), cut(1.3, 7)], 0.25)).toHaveLength(2)
  })

  it('does not extend a cluster from a later strongest candidate', () => {
    expect(deduplicateCuts([cut(1, 2), cut(1.2, 8), cut(1.4, 7)], 0.3)).toEqual([
      cut(1.2, 8),
      cut(1.4, 7),
    ])
  })
})

describe('seekVideo', () => {
  it('resolves after landing on the requested time', async () => {
    const target = new EventTarget() as HTMLVideoElement
    let currentTime = 0
    Object.defineProperty(target, 'currentTime', {
      configurable: true,
      get: vi.fn(() => currentTime),
      set: vi.fn((value: number) => {
        currentTime = value
        queueMicrotask(() => target.dispatchEvent(new Event('seeked')))
      }),
    })

    await expect(seekVideo(target, 2, 50)).resolves.toBeUndefined()
  })

  it('rejects a timed-out seek', async () => {
    const target = new EventTarget() as HTMLVideoElement
    let currentTime = 0
    Object.defineProperty(target, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value - 1
      },
    })

    await expect(seekVideo(target, 2, 5)).rejects.toThrow('timed out')
  })
})
