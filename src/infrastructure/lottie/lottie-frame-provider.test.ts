// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { mapTimelineFrameToLottieFrame, isRenderableLottieSrc } from './lottie-frame-provider'
import {
  registerObjectUrl,
  unregisterObjectUrl,
} from '@/infrastructure/browser/object-url-registry'

// Base input: project fps === animation fps and totalFrames 100, so 1 project
// frame maps to 1 lottie frame at speed 1 (elapsed === localFrame).
const base = {
  projectFps: 30,
  speed: 1,
  totalFrames: 100,
  frameRate: 30,
  loop: false,
}

describe('mapTimelineFrameToLottieFrame', () => {
  it('maps 1:1 when fps match and speed is 1', () => {
    expect(mapTimelineFrameToLottieFrame({ ...base, localFrame: 0 })).toBe(0)
    expect(mapTimelineFrameToLottieFrame({ ...base, localFrame: 42 })).toBe(42)
  })

  it('holds the final frame past the end when not looping', () => {
    // maxFrame = 99; segLen defaults to 99.
    expect(mapTimelineFrameToLottieFrame({ ...base, localFrame: 250 })).toBe(99)
  })

  it('wraps within the animation when looping', () => {
    // 100 frames (0..99), so the loop period is 100: frame 120 wraps to 120 % 100 = 20.
    expect(mapTimelineFrameToLottieFrame({ ...base, loop: true, localFrame: 120 })).toBe(20)
  })

  it('reaches the final frame before wrapping (no skipped last frame)', () => {
    // 10 frames (0..9): the last frame must render, then wrap back to 0.
    const tiny = { ...base, totalFrames: 10, loop: true }
    expect(mapTimelineFrameToLottieFrame({ ...tiny, localFrame: 9 })).toBe(9)
    expect(mapTimelineFrameToLottieFrame({ ...tiny, localFrame: 10 })).toBe(0)
  })

  it('scales by speed', () => {
    expect(mapTimelineFrameToLottieFrame({ ...base, speed: 2, localFrame: 10 })).toBe(20)
    // speed 0 freezes at the start frame.
    expect(mapTimelineFrameToLottieFrame({ ...base, speed: 0, localFrame: 50 })).toBe(0)
  })

  it('reverses playback from the segment end', () => {
    expect(mapTimelineFrameToLottieFrame({ ...base, reversed: true, localFrame: 0 })).toBe(99)
    expect(mapTimelineFrameToLottieFrame({ ...base, reversed: true, localFrame: 10 })).toBe(89)
  })

  it('confines playback to an in/out segment', () => {
    const seg = { ...base, segmentStart: 20, segmentEnd: 60 }
    expect(mapTimelineFrameToLottieFrame({ ...seg, localFrame: 0 })).toBe(20)
    expect(mapTimelineFrameToLottieFrame({ ...seg, localFrame: 15 })).toBe(35)
    // Past segment end without loop, holds segEnd.
    expect(mapTimelineFrameToLottieFrame({ ...seg, localFrame: 500 })).toBe(60)
    // Loop wraps within [20, 60] (41 frames): elapsed 50 → 20 + (50 % 41) = 29.
    expect(mapTimelineFrameToLottieFrame({ ...seg, loop: true, localFrame: 50 })).toBe(29)
  })

  it('freezes on a zero-length segment (poster frame)', () => {
    expect(
      mapTimelineFrameToLottieFrame({ ...base, segmentStart: 30, segmentEnd: 30, localFrame: 99 }),
    ).toBe(30)
  })

  it('ping-pong bounces at the segment ends', () => {
    const pp = { ...base, loop: true, loopMode: 'pingpong' as const }
    // segLen 99, period 198. At elapsed 99 it hits the far end (99).
    expect(mapTimelineFrameToLottieFrame({ ...pp, localFrame: 99 })).toBe(99)
    // At elapsed 150 it is on the way back: 198 - 150 = 48.
    expect(mapTimelineFrameToLottieFrame({ ...pp, localFrame: 150 })).toBe(48)
  })

  it('returns 0 for degenerate inputs', () => {
    expect(mapTimelineFrameToLottieFrame({ ...base, totalFrames: 0, localFrame: 10 })).toBe(0)
    expect(mapTimelineFrameToLottieFrame({ ...base, frameRate: 0, localFrame: 10 })).toBe(0)
  })
})

describe('isRenderableLottieSrc', () => {
  it('rejects empty/nullish sources', () => {
    expect(isRenderableLottieSrc('')).toBe(false)
    expect(isRenderableLottieSrc(undefined)).toBe(false)
    expect(isRenderableLottieSrc(null)).toBe(false)
  })

  it('accepts non-blob sources (http/data) without a registry check', () => {
    expect(isRenderableLottieSrc('https://cdn.example.com/a.lottie')).toBe(true)
    expect(isRenderableLottieSrc('data:application/json,{}')).toBe(true)
  })

  it('accepts a live blob URL but rejects a stale/unregistered one', () => {
    const liveUrl = 'blob:http://localhost/live-123'
    const staleUrl = 'blob:http://localhost/stale-456'
    registerObjectUrl(liveUrl, new Blob(['{}'], { type: 'application/json' }))

    expect(isRenderableLottieSrc(liveUrl)).toBe(true)
    // Never registered (e.g. persisted into a project or revoked after delete).
    expect(isRenderableLottieSrc(staleUrl)).toBe(false)

    unregisterObjectUrl(liveUrl)
    expect(isRenderableLottieSrc(liveUrl)).toBe(false)
  })
})
