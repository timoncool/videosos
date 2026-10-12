// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { getTextMotionTimelineBands } from './text-motion-timeline'

describe('getTextMotionTimelineBands', () => {
  it('resolves staggered in/out windows and the remaining loop span', () => {
    const item = {
      id: 'text-1',
      type: 'text',
      text: 'One two three',
      from: 100,
      durationInFrames: 120,
      textMotion: {
        in: {
          presetId: 'typewriter',
          durationFrames: 12,
          staggerFrames: 3,
          intensity: 1,
          order: 'forward',
          easing: 'linear',
          seed: 0,
          unit: 'word',
        },
        loop: {
          presetId: 'pulse',
          durationFrames: 20,
          staggerFrames: 0,
          intensity: 1,
          order: 'forward',
          easing: 'ease-in-out',
          seed: 0,
          unit: 'word',
        },
        out: {
          presetId: 'fade-down',
          durationFrames: 10,
          staggerFrames: 2,
          intensity: 1,
          order: 'forward',
          easing: 'linear',
          seed: 0,
          unit: 'word',
        },
      },
    } as TimelineItem

    expect(getTextMotionTimelineBands(item)).toEqual([
      {
        slot: 'in',
        presetId: 'typewriter',
        fromFrame: 100,
        toFrame: 118,
        clipFromFrame: 100,
        clipToFrame: 220,
        unitCount: 3,
        durationFrames: 12,
        offsetFrames: 0,
      },
      {
        slot: 'loop',
        presetId: 'pulse',
        fromFrame: 118,
        toFrame: 206,
        clipFromFrame: 100,
        clipToFrame: 220,
        unitCount: 3,
        durationFrames: 20,
        offsetFrames: 0,
      },
      {
        slot: 'out',
        presetId: 'fade-down',
        fromFrame: 206,
        toFrame: 220,
        clipFromFrame: 100,
        clipToFrame: 220,
        unitCount: 3,
        durationFrames: 10,
        offsetFrames: 0,
      },
    ])
  })

  it('caps in and out windows to half the clip', () => {
    const item = {
      id: 'text-2',
      type: 'text',
      text: 'Long text',
      from: 20,
      durationInFrames: 40,
      textMotion: {
        in: {
          presetId: 'typewriter',
          durationFrames: 80,
          staggerFrames: 10,
          intensity: 1,
          order: 'forward',
          easing: 'linear',
          seed: 0,
          unit: 'character',
        },
      },
    } as TimelineItem

    expect(getTextMotionTimelineBands(item)[0]).toMatchObject({
      fromFrame: 20,
      toFrame: 40,
    })
  })

  it('positions in and out windows using their clip-edge offsets', () => {
    const item = {
      id: 'text-offset',
      type: 'text',
      text: 'Offset',
      from: 100,
      durationInFrames: 100,
      textMotion: {
        in: {
          presetId: 'fade-up',
          durationFrames: 10,
          offsetFrames: 12,
          staggerFrames: 0,
          intensity: 1,
          order: 'forward',
          easing: 'linear',
          seed: 0,
        },
        out: {
          presetId: 'fade-down',
          durationFrames: 10,
          offsetFrames: 18,
          staggerFrames: 0,
          intensity: 1,
          order: 'forward',
          easing: 'linear',
          seed: 0,
        },
      },
    } as TimelineItem

    expect(getTextMotionTimelineBands(item)).toEqual([
      expect.objectContaining({
        slot: 'in',
        fromFrame: 112,
        toFrame: 122,
        offsetFrames: 12,
      }),
      expect.objectContaining({
        slot: 'out',
        fromFrame: 172,
        toFrame: 182,
        offsetFrames: 18,
      }),
    ])
  })
})
