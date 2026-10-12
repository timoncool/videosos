import { describe, expect, it } from 'vite-plus/test'
import {
  formatDopesheetRulerCanvasLabel,
  getDopesheetRulerTickLayout,
} from './dopesheet-live-ruler-layout'

describe('dopesheet live ruler canvas', () => {
  it('derives a bounded tick layout from the live zoom and scroll geometry', () => {
    const layout = getDopesheetRulerTickLayout({
      scrollLeft: 900,
      viewportWidth: 1200,
      pixelsPerSecond: 300,
      fps: 30,
    })

    expect(layout).toEqual({
      firstMajorFrame: 80,
      lastMajorFrame: 220,
      majorStepFrames: 20,
      minorStepFrames: 5,
    })
  })

  it('formats global frame and time labels without depending on scaled DOM text', () => {
    expect(formatDopesheetRulerCanvasLabel(900, 30, 'frames')).toBe('900')
    expect(formatDopesheetRulerCanvasLabel(900, 30, 'seconds')).toBe('30.0s')
    expect(formatDopesheetRulerCanvasLabel(2250, 30, 'seconds')).toBe('1:15.0')
  })
})
