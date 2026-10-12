import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  registerTimelineDensityMarqueeBucket,
  setTimelineDensityMarqueePreview,
} from './timeline-density-marquee-preview'

describe('timeline density marquee preview', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    setTimelineDensityMarqueePreview([])
    cleanups.splice(0).forEach((cleanup) => cleanup())
  })

  it('keeps a grouped bucket highlighted while any contained clip is previewed', () => {
    const bucket = document.createElement('div')
    cleanups.push(registerTimelineDensityMarqueeBucket(bucket, ['a', 'b']))

    setTimelineDensityMarqueePreview(['a', 'b'])
    expect(bucket).toHaveClass('timeline-marquee-preview')

    setTimelineDensityMarqueePreview(['b'])
    expect(bucket).toHaveClass('timeline-marquee-preview')

    setTimelineDensityMarqueePreview([])
    expect(bucket).not.toHaveClass('timeline-marquee-preview')
  })
})
