import { describe, expect, it } from 'vite-plus/test'
import { getTaperStrokeSegments, getTaperWidthScale, hasActiveTaper } from './taper-path'

describe('taper path', () => {
  it('keeps the default stroke neutral', () => {
    expect(hasActiveTaper({})).toBe(false)
    expect(getTaperStrokeSegments({})).toEqual([])
  })

  it('blends the start and end widths across their configured lengths', () => {
    const taper = {
      taperStartWidth: 0,
      taperStartLength: 50,
      taperEndWidth: 50,
      taperEndLength: 25,
    }

    expect(getTaperWidthScale(0, taper)).toBe(0)
    expect(getTaperWidthScale(0.25, taper)).toBe(0.5)
    expect(getTaperWidthScale(0.5, taper)).toBe(1)
    expect(getTaperWidthScale(1, taper)).toBe(0.5)
  })

  it('builds taper segments over the visible trimmed range', () => {
    const segments = getTaperStrokeSegments({
      taperStartWidth: 0,
      taperStartLength: 50,
      trimPathStart: 25,
      trimPathEnd: 75,
      trimPathOffset: 90,
    })

    expect(segments).toHaveLength(48)
    expect(segments[0]).toMatchObject({ offset: 50, isFirst: true })
    expect(segments.at(-1)?.isLast).toBe(true)
    expect(segments[0]!.widthScale).toBeLessThan(segments[24]!.widthScale)
  })
})
