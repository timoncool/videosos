// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import { getPathClosureUpdates, getShapeSectionControlVisibility } from './shape-section-visibility'

function path(overrides: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id: 'path',
    type: 'shape',
    trackId: 'track',
    from: 0,
    durationInFrames: 30,
    label: 'Path',
    shapeType: 'path',
    fillColor: '#fff',
    strokeColor: '#000',
    strokeWidth: 4,
    strokeEnabled: true,
    pathVertices: [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ],
    ...overrides,
  }
}

describe('getShapeSectionControlVisibility', () => {
  it('shows endpoint caps but hides fill and joins for a two-point open path', () => {
    expect(getShapeSectionControlVisibility([path({ pathClosed: false })])).toMatchObject({
      isSingleOpenPath: true,
      showPathClosure: true,
      showFill: false,
      showStroke: true,
      showLineCap: true,
      showLineJoin: false,
      showTrimPaths: true,
    })
  })

  it('shows joins but not caps for an untrimmed closed path', () => {
    expect(getShapeSectionControlVisibility([path({ pathClosed: true })])).toMatchObject({
      isSingleOpenPath: false,
      showFill: true,
      showLineCap: false,
      showLineJoin: true,
    })
  })

  it('shows caps on a closed path once trim creates visible endpoints', () => {
    expect(
      getShapeSectionControlVisibility([path({ pathClosed: true, trimPathEnd: 50 })]).showLineCap,
    ).toBe(true)
  })

  it('hides appearance, trim, and closure controls for masks', () => {
    expect(
      getShapeSectionControlVisibility([path({ pathClosed: true, isMask: true })]),
    ).toMatchObject({
      isMaskOnly: true,
      showPathClosure: false,
      showFill: false,
      showStroke: false,
      showTrimPaths: false,
    })
  })

  it('hides stroke-dependent controls when the stroke is off', () => {
    expect(
      getShapeSectionControlVisibility([path({ strokeEnabled: false, trimPathEnd: 50 })]),
    ).toMatchObject({
      showStroke: true,
      showLineCap: false,
      showLineJoin: false,
      showTrimPaths: false,
      showNoAppearanceNotice: false,
    })
  })

  it('reports when neither fill nor stroke can render', () => {
    expect(
      getShapeSectionControlVisibility([
        path({ pathClosed: false, fillEnabled: false, strokeEnabled: false }),
      ]).showNoAppearanceNotice,
    ).toBe(true)
  })
})

describe('getPathClosureUpdates', () => {
  it('enables a sensible stroke when opening a visible fill-only path', () => {
    expect(
      getPathClosureUpdates(
        path({ pathClosed: true, fillEnabled: true, strokeEnabled: false, strokeWidth: 0 }),
        false,
      ),
    ).toMatchObject({
      pathClosed: false,
      fillEnabled: false,
      strokeEnabled: true,
      strokeColor: '#000',
      strokeWidth: 4,
      strokeLineCap: 'round',
    })
  })

  it('respects an intentionally invisible path when opening it', () => {
    expect(
      getPathClosureUpdates(
        path({ pathClosed: true, fillEnabled: false, strokeEnabled: false }),
        false,
      ),
    ).toEqual({ pathClosed: false, fillEnabled: false })
  })

  it('does not re-enable a stroke when Open is selected again', () => {
    expect(
      getPathClosureUpdates(
        path({ pathClosed: false, fillEnabled: false, strokeEnabled: false }),
        false,
      ),
    ).toEqual({ pathClosed: false, fillEnabled: false })
  })
})
