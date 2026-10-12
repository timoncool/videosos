// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { resolveGeneratedLayerCanvasSize } from './generated-layer-canvas-size'

describe('resolveGeneratedLayerCanvasSize', () => {
  it('uses the active Motion composition instead of the root project canvas', () => {
    expect(
      resolveGeneratedLayerCanvasSize(
        { editorKind: 'composite-2d', width: 1080, height: 1920 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ width: 1080, height: 1920 })
  })

  it('uses project dimensions outside layer composition authoring', () => {
    expect(
      resolveGeneratedLayerCanvasSize(
        { editorKind: 'sequence', width: 720, height: 1280 },
        { width: 3840, height: 2160 },
      ),
    ).toEqual({ width: 3840, height: 2160 })
  })
})
