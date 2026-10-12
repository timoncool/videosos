// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ImageItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { getTransitionBlockedRanges } from './transition-region'

describe('transition-region', () => {
  it('distributes chained-transition pressure exactly like the renderer', () => {
    const clip: ImageItem = {
      id: 'middle',
      type: 'image',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 51,
      label: 'middle',
      src: 'middle.png',
    }
    const transitions: Transition[] = [
      {
        id: 'incoming',
        leftClipId: 'left',
        rightClipId: 'middle',
        trackId: 'track-1',
        type: 'crossfade',
        durationInFrames: 20,
        presentation: 'fade',
        timing: 'linear',
        alignment: 0,
      },
      {
        id: 'outgoing',
        leftClipId: 'middle',
        rightClipId: 'right',
        trackId: 'track-1',
        type: 'crossfade',
        durationInFrames: 80,
        presentation: 'clockWipe',
        timing: 'linear',
        alignment: 1,
      },
    ]

    expect(getTransitionBlockedRanges(clip.id, clip, transitions)).toMatchObject([
      { start: 0, end: 10, role: 'incoming' },
      { start: 10, end: 51, role: 'outgoing' },
    ])
  })
})
