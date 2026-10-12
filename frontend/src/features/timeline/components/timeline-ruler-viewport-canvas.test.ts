import { describe, expect, it } from 'vite-plus/test'
import { getTimelineRulerInterval } from './timeline-ruler-viewport-canvas'

describe('main timeline ruler viewport canvas', () => {
  it('chooses bounded ruler intervals across the zoom range', () => {
    expect(getTimelineRulerInterval(200)).toEqual({
      intervalInSeconds: 0.5,
      minorTicks: 3,
    })
    expect(getTimelineRulerInterval(80)).toEqual({
      intervalInSeconds: 1,
      minorTicks: 4,
    })
    expect(getTimelineRulerInterval(0.1)).toEqual({
      intervalInSeconds: 1800,
      minorTicks: 2,
    })
  })
})
