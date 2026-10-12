import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import {
  createItemRenderContext,
  createItemTransform,
  createMockCanvasContext,
} from './canvas-item-renderer-test-helpers'

const renderShapeMock = vi.hoisted(() => vi.fn())

vi.mock('./canvas-shapes', () => ({
  renderShape: renderShapeMock,
}))

import { renderItem } from './canvas-item-renderer'

const solid: ShapeItem = {
  id: 'solid-1',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 60,
  label: 'Non-square Solid',
  shapeType: 'rectangle',
  fillColor: '#ffffff',
  transform: { x: 0, y: 0, width: 320, height: 140 },
}

describe('canvas item renderer shape rotation', () => {
  beforeEach(() => {
    renderShapeMock.mockReset()
  })

  it.each([30, 90])('applies a %s degree shape rotation exactly once', async (rotation) => {
    const ctx = createMockCanvasContext()

    await renderItem(
      ctx,
      solid,
      createItemTransform({ width: 320, height: 140, rotation }),
      0,
      createItemRenderContext(),
    )

    expect(ctx.rotate).toHaveBeenCalledOnce()
    expect(ctx.rotate).toHaveBeenCalledWith((rotation * Math.PI) / 180)
    expect(renderShapeMock).toHaveBeenCalledOnce()
    expect(renderShapeMock.mock.calls[0]?.[2]).toMatchObject({
      width: 320,
      height: 140,
      rotation: 0,
    })
  })
})
