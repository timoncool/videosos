import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import { cleanupTrimmedKeyframes, countTrimmedKeyframes } from './trimmed-keyframes'

describe('trimmed keyframes', () => {
  it('counts scalar and vector keyframes outside the visible duration', () => {
    const animation: ItemKeyframes = {
      itemId: 'clip-1',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'a', frame: 0, value: 0, easing: 'linear' },
            { id: 'b', frame: 20, value: 100, easing: 'linear' },
          ],
        },
      ],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'p1', frame: 5, value: { x: 0, y: 0 }, easing: 'linear' },
            { id: 'p2', frame: 25, value: { x: 100, y: 50 }, easing: 'linear' },
          ],
        },
      ],
    }

    expect(countTrimmedKeyframes(animation, 20)).toBe(2)
  })

  it('inserts the evaluated boundary value before removing trimmed scalar keys', () => {
    const animation: ItemKeyframes = {
      itemId: 'clip-1',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'start', frame: 0, value: 0, easing: 'linear' },
            { id: 'trimmed', frame: 20, value: 100, easing: 'linear' },
          ],
        },
      ],
    }

    const result = cleanupTrimmedKeyframes(animation, 11, 30, () => 'boundary')

    expect(result).toMatchObject({ removedCount: 1, insertedBoundaryCount: 1 })
    expect(result.itemKeyframes.properties[0]?.keyframes).toEqual([
      { id: 'start', frame: 0, value: 0, easing: 'linear' },
      {
        id: 'boundary',
        frame: 10,
        value: 50,
        easing: 'linear',
        easingConfig: undefined,
        source: undefined,
      },
    ])
  })

  it('keeps an existing boundary keyframe and removes only later keys', () => {
    const animation: ItemKeyframes = {
      itemId: 'clip-1',
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'start', frame: 0, value: 0, easing: 'linear' },
            { id: 'boundary', frame: 9, value: 25, easing: 'linear' },
            { id: 'trimmed', frame: 20, value: 100, easing: 'linear' },
          ],
        },
      ],
    }

    const result = cleanupTrimmedKeyframes(animation, 10, 30, () => 'unused')

    expect(result).toMatchObject({ removedCount: 1, insertedBoundaryCount: 0 })
    expect(result.itemKeyframes.properties[0]?.keyframes.map((keyframe) => keyframe.id)).toEqual([
      'start',
      'boundary',
    ])
  })

  it('inserts an evaluated vector boundary keyframe', () => {
    const animation: ItemKeyframes = {
      itemId: 'clip-1',
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'start', frame: 0, value: { x: 0, y: 10 }, easing: 'linear' },
            { id: 'trimmed', frame: 20, value: { x: 100, y: 50 }, easing: 'linear' },
          ],
        },
      ],
    }

    const result = cleanupTrimmedKeyframes(animation, 11, 30, () => 'boundary')

    expect(result.itemKeyframes.vectorProperties?.[0]?.keyframes).toEqual([
      { id: 'start', frame: 0, value: { x: 0, y: 10 }, easing: 'linear' },
      {
        id: 'boundary',
        frame: 10,
        value: { x: 50, y: 30 },
        easing: 'linear',
        easingConfig: undefined,
        source: undefined,
      },
    ])
  })
})
