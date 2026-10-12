import { describe, expect, it } from 'vite-plus/test'
import { shouldUseScrubbingFrameCache } from './render-path-optimizer'

describe('shouldUseScrubbingFrameCache', () => {
  it('keeps the cache enabled for paused preview rendering', () => {
    expect(shouldUseScrubbingFrameCache(true, false)).toBe(true)
  })

  it('bypasses cache reads and writes during live DOM-video playback', () => {
    expect(shouldUseScrubbingFrameCache(true, true)).toBe(false)
  })

  it('stays disabled when the renderer has no scrub cache', () => {
    expect(shouldUseScrubbingFrameCache(false, false)).toBe(false)
    expect(shouldUseScrubbingFrameCache(false, true)).toBe(false)
  })
})
