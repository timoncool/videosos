// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ImageItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import {
  clampRippleTrimDeltaToPreserveEditState,
  clampRollingTrimDeltaToPreserveEditState,
} from './trim-edit-constraints'

function clip(id: string, from: number, durationInFrames: number): ImageItem {
  return {
    id,
    type: 'image',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.png`,
  }
}

function transition(
  id: string,
  leftClipId: string,
  rightClipId: string,
  durationInFrames: number,
  alignment: number,
): Transition {
  return {
    id,
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    type: 'crossfade',
    durationInFrames,
    presentation: 'clockWipe',
    timing: 'linear',
    alignment,
  }
}

function keyframes(itemId: string, frame: number): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property: 'opacity',
        keyframes: [{ id: 'kf-1', frame, value: 1, easing: 'linear' }],
      },
    ],
  }
}

describe('trim edit constraints', () => {
  for (const alignment of [0, 0.5, 1]) {
    it(`rolling preserves the transition on the opposite edge at alignment ${alignment}`, () => {
      const a = clip('A', 0, 100)
      const b = clip('B', 100, 40)
      const c = clip('C', 140, 100)
      const transitions = [
        transition('incoming', 'A', 'B', 5, 0.5),
        transition('outgoing', 'B', 'C', 30, alignment),
      ]

      expect(
        clampRollingTrimDeltaToPreserveEditState(b, 'start', 20, a, [a, b, c], transitions, {}, 30),
      ).toBe(9)
    })

    it(`ripple preserves the transition on the opposite edge at alignment ${alignment}`, () => {
      const a = clip('A', 0, 100)
      const b = clip('B', 100, 40)
      const c = clip('C', 140, 100)
      const transitions = [
        transition('incoming', 'A', 'B', 5, 0.5),
        transition('outgoing', 'B', 'C', 30, alignment),
      ]

      expect(
        clampRippleTrimDeltaToPreserveEditState(b, 'start', 20, [a, b, c], transitions, {}, 30),
      ).toBe(9)
    })
  }

  for (const [alignment, frame, expected] of [
    [0, 80, -15],
    [0.5, 80, -9],
    [1, 70, -9],
  ] as const) {
    it(`rolling keeps an existing keyframe out of an alignment ${alignment} transition`, () => {
      const a = clip('A', 0, 100)
      const b = clip('B', 100, 100)
      const transitions = [transition('cut', 'A', 'B', 20, alignment)]

      expect(
        clampRollingTrimDeltaToPreserveEditState(
          a,
          'end',
          -15,
          b,
          [a, b],
          transitions,
          { A: keyframes('A', frame) },
          30,
        ),
      ).toBe(expected)
    })

    it(`ripple keeps an existing keyframe out of an alignment ${alignment} transition`, () => {
      const a = clip('A', 0, 100)
      const b = clip('B', 100, 100)
      const transitions = [transition('cut', 'A', 'B', 20, alignment)]

      expect(
        clampRippleTrimDeltaToPreserveEditState(
          a,
          'end',
          -15,
          [a, b],
          transitions,
          { A: keyframes('A', frame) },
          30,
        ),
      ).toBe(expected)
    })
  }
})
