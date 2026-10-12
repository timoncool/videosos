import { describe, expect, it } from 'vite-plus/test'
import { buildTaperedOutline, getTaperedOutlineFillPath } from './taper-outline'

describe('buildTaperedOutline', () => {
  it('builds one continuous pointed outline without a start cap blob', () => {
    const outline = buildTaperedOutline(
      {
        points: [
          { x: 0, y: 0, progress: 0 },
          { x: 100, y: 0, progress: 1 },
        ],
        totalLength: 100,
        closed: false,
      },
      {
        strokeWidth: 20,
        lineCap: 'round',
        taperStartWidth: 0,
        taperStartLength: 100,
      },
    )

    expect(outline?.path).toMatch(/^M 0 0 /)
    expect(outline?.caps).toEqual([{ x: 100, y: 0, radius: 10 }])
    expect(getTaperedOutlineFillPath(outline!)).toContain('A 10 10 0 1 0 90 0')
  })

  it('honors a trimmed visible range when building the outline', () => {
    const outline = buildTaperedOutline(
      {
        points: [
          { x: 0, y: 0, progress: 0 },
          { x: 100, y: 0, progress: 1 },
        ],
        totalLength: 100,
        closed: false,
      },
      {
        strokeWidth: 10,
        taperStartWidth: 0,
        taperStartLength: 50,
        trimPathStart: 25,
        trimPathEnd: 75,
      },
    )

    expect(outline?.path).toContain('M 25 0')
    expect(outline?.path).toContain('75')
  })

  it('wraps an offset trim on an open path without connecting its endpoints', () => {
    const outline = buildTaperedOutline(
      {
        points: [
          { x: 0, y: 0, progress: 0 },
          { x: 100, y: 0, progress: 1 },
        ],
        totalLength: 100,
        closed: false,
      },
      {
        strokeWidth: 10,
        lineCap: 'round',
        taperStartWidth: 50,
        taperStartLength: 100,
        trimPathStart: 25,
        trimPathEnd: 75,
        trimPathOffset: 180,
      },
    )

    expect(outline?.path.match(/\bM\b/g)).toHaveLength(2)
    expect(outline?.caps.map((cap) => cap.x)).toEqual([75, 100, 0, 25])
  })
})
