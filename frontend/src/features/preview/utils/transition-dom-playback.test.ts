import { describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { ResolvedTransitionWindow } from '@/shared/timeline/transitions/transition-planner'
import {
  resolveTransitionDomPlaybackState,
  synchronizePausedTransitionDomVideo,
} from './transition-dom-playback'

function makeClip(id: string, from: number, sourceStart: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'video-track',
    from,
    durationInFrames: 100,
    label: id,
    mediaId: 'same-media',
    src: 'blob:video',
    sourceStart,
    sourceFps: 30,
    speed: 1,
  }
}

describe('transition DOM playback', () => {
  it('matches the A-A source ramp and playback rate used by the renderer', () => {
    const leftClip = makeClip('left', 0, 0)
    const rightClip = makeClip('right', 100, 100)
    const window = {
      leftClip,
      rightClip,
      startFrame: 80,
      endFrame: 120,
    } as ResolvedTransitionWindow<TimelineItem>

    const left = resolveTransitionDomPlaybackState({
      window,
      clip: leftClip,
      frame: 100,
      timelineFps: 30,
      transportRate: 1,
    })
    const right = resolveTransitionDomPlaybackState({
      window,
      clip: rightClip,
      frame: 100,
      timelineFps: 30,
      transportRate: 1,
    })

    expect(left).toMatchObject({ playbackRate: 1.5, hasActiveSourceRamp: true })
    expect(right).toMatchObject({ playbackRate: 1.5, hasActiveSourceRamp: true })
    expect(left!.sourceTime - right!.sourceTime).toBeCloseTo(2 / 3, 4)
  })

  it('returns null outside the transition window', () => {
    const leftClip = makeClip('left', 0, 0)
    const rightClip = makeClip('right', 100, 100)
    const window = {
      leftClip,
      rightClip,
      startFrame: 80,
      endFrame: 120,
    } as ResolvedTransitionWindow<TimelineItem>

    expect(
      resolveTransitionDomPlaybackState({
        window,
        clip: leftClip,
        frame: 79,
        timelineFps: 30,
        transportRate: 1,
      }),
    ).toBeNull()
  })

  it('marks and seeks a paused A-A lane for zero-copy skim composition', () => {
    const pause = vi.fn()
    const element = {
      currentTime: 2,
      dataset: {
        transitionPrearm: '1',
      },
      pause,
      paused: false,
      playbackRate: 1,
      readyState: 4,
    } as unknown as HTMLVideoElement

    synchronizePausedTransitionDomVideo(element, {
      sourceTime: 4.5,
      playbackRate: 1.5,
      hasActiveSourceRamp: true,
    })

    expect(pause).toHaveBeenCalledTimes(1)
    expect(element.currentTime).toBe(4.5)
    expect(element.playbackRate).toBe(1.5)
    expect(element.dataset.transitionHold).toBe('1')
    expect(element.dataset.transitionSourceRamp).toBe('1')
    expect(element.dataset.transitionPrearm).toBeUndefined()
  })
})
