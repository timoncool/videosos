// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { renderShape } from './canvas-shapes'

const shape: ShapeItem = {
  id: 'gradient-shape',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Gradient',
  shapeType: 'rectangle',
  fillColor: '#112233',
  fillType: 'linear',
  gradientEndColor: '#aabbcc',
  gradientAngle: 0,
  transform: { x: 0, y: 0, width: 200, height: 100 },
}

const transform: ResolvedTransform = {
  x: 0,
  y: 0,
  anchorX: 0,
  anchorY: 0,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

describe('renderShape Canvas gradients', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', class {})
  })

  it('creates the same edge-to-edge two-stop gradient used by live and GPU rendering', () => {
    const addColorStop = vi.fn()
    const gradient = { addColorStop }
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 4,
      lineWidth: 0,
      lineDashOffset: 0,
    } as unknown as OffscreenCanvasRenderingContext2D

    renderShape(context, shape, { ...transform, rotation: 90 }, { width: 1920, height: 1080 })

    expect(context.createLinearGradient).toHaveBeenCalledWith(960, 440, 960, 640)
    expect(addColorStop).toHaveBeenNthCalledWith(1, 0, '#112233')
    expect(addColorStop).toHaveBeenNthCalledWith(2, 1, '#aabbcc')
    expect(context.fill).toHaveBeenCalledTimes(1)
  })
})
