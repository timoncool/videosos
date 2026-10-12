// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  classifyAdaptiveSceneCuts,
  compareFrameFeatures,
  extractFrameFeatures,
  type AdaptiveFrameScore,
} from './adaptive-scene-detector'

function solidFrame(r: number, g: number, b: number, width = 2, height = 2) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    pixels[index * 4] = r
    pixels[index * 4 + 1] = g
    pixels[index * 4 + 2] = b
    pixels[index * 4 + 3] = 255
  }
  return extractFrameFeatures(pixels, width, height)
}

function score(frameIndex: number, contentScore: number, returnScore?: number): AdaptiveFrameScore {
  return {
    frameIndex,
    time: frameIndex / 30,
    contentScore,
    hueDelta: contentScore,
    saturationDelta: contentScore,
    lumaDelta: contentScore,
    returnScore,
  }
}

describe('adaptive scene frame metrics', () => {
  it('returns zero deltas for identical frames', () => {
    const frame = solidFrame(120, 80, 40)
    expect(compareFrameFeatures(frame, frame)).toEqual({
      contentScore: 0,
      hueDelta: 0,
      saturationDelta: 0,
      lumaDelta: 0,
    })
  })

  it('detects equal-luma hue changes', () => {
    const red = solidFrame(255, 0, 0)
    const blueWithSimilarLuma = solidFrame(0, 0, 255)
    const metrics = compareFrameFeatures(red, blueWithSimilarLuma)

    expect(metrics.hueDelta).toBeGreaterThan(50)
    expect(metrics.contentScore).toBeGreaterThan(15)
  })

  it('rejects mismatched frame dimensions', () => {
    expect(() => compareFrameFeatures(solidFrame(0, 0, 0), solidFrame(0, 0, 0, 3, 2))).toThrow(
      'dimensions must match',
    )
  })
})

describe('adaptive scene classification', () => {
  it('does not classify continuous motion against a raised baseline', () => {
    const cuts = classifyAdaptiveSceneCuts(
      [10, 11, 9, 12, 10, 11].map((value, i) => score(i + 1, value)),
    )
    expect(cuts).toEqual([])
  })

  it('classifies a strong local outlier', () => {
    const cuts = classifyAdaptiveSceneCuts([2, 3, 70, 2, 3].map((value, i) => score(i + 1, value)))
    expect(cuts).toHaveLength(1)
    expect(cuts[0]?.time).toBe(3 / 30)
    expect(cuts[0]?.metrics.kind).toBe('adaptive')
  })

  it('rejects an A-to-flash-to-A pair', () => {
    const cuts = classifyAdaptiveSceneCuts([
      score(1, 2),
      score(2, 80, 1),
      score(3, 78),
      score(4, 2),
      score(5, 2),
    ])
    expect(cuts).toEqual([])
  })

  it('preserves real cuts four frames apart', () => {
    const cuts = classifyAdaptiveSceneCuts(
      [2, 70, 2, 2, 65, 2, 2].map((value, i) => score(i + 1, value)),
      { windowWidth: 1 },
    )
    expect(cuts.map((cut) => cut.time)).toEqual([2 / 30, 5 / 30])
  })

  it('clusters adjacent spikes and keeps the strongest', () => {
    const cuts = classifyAdaptiveSceneCuts(
      [2, 45, 70, 2, 2].map((value, i) => score(i + 1, value)),
      { adaptiveThreshold: 1.5, windowWidth: 2 },
    )
    expect(cuts).toHaveLength(1)
    expect(cuts[0]?.score).toBe(70)
  })

  it('clamps confidence to a finite 0..1 range', () => {
    const cuts = classifyAdaptiveSceneCuts(
      [1, 1, 1_000_000, 1, 1].map((value, i) => score(i, value)),
    )
    expect(cuts).toHaveLength(1)
    expect(Number.isFinite(cuts[0]!.confidence)).toBe(true)
    expect(cuts[0]!.confidence).toBeGreaterThanOrEqual(0)
    expect(cuts[0]!.confidence).toBeLessThanOrEqual(1)
  })

  it('returns no cuts for fewer than three scores', () => {
    expect(classifyAdaptiveSceneCuts([])).toEqual([])
    expect(classifyAdaptiveSceneCuts([score(1, 100)])).toEqual([])
    expect(classifyAdaptiveSceneCuts([score(1, 100), score(2, 1)])).toEqual([])
  })
})
