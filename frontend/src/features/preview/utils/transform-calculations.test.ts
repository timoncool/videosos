import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { Transform } from '../types/gizmo'
import { useGizmoStore } from '../stores/gizmo-store'
import { prepareScaleStartTransform } from './transform-calculations'

const currentTransform: Transform = {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  anchorX: 100,
  anchorY: 50,
  rotation: 0,
  opacity: 1,
}

function createShape(transform: ShapeItem['transform']): ShapeItem {
  return {
    id: 'shape-1',
    type: 'shape',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'Solid',
    shapeType: 'rectangle',
    fillColor: '#ffffff',
    transform,
  }
}

describe('scale preview anchor semantics', () => {
  afterEach(() => {
    useGizmoStore.getState().cancelInteraction()
  })

  it('keeps an implicit anchor centered throughout preview and commit', () => {
    const start = prepareScaleStartTransform(
      currentTransform,
      createShape({ x: 0, y: 0, width: 200, height: 100 }),
      undefined,
      undefined,
    )

    useGizmoStore.getState().setCanvasSize(1920, 1080)
    useGizmoStore.getState().startScale('shape-1', 'se', { x: 1060, y: 590 }, start, 'shape', false)
    useGizmoStore.getState().updateInteraction({ x: 1160, y: 640 }, true)

    const preview = useGizmoStore.getState().previewTransform!
    expect(preview.anchorX).toBeUndefined()
    expect(preview.anchorY).toBeUndefined()
    expect(preview.anchorX ?? preview.width / 2).toBe(preview.width / 2)
    expect(preview.anchorY ?? preview.height / 2).toBe(preview.height / 2)

    const committed = useGizmoStore.getState().endInteraction()
    expect(committed?.anchorX).toBeUndefined()
    expect(committed?.anchorY).toBeUndefined()
  })

  it('preserves explicit and animated anchor axes', () => {
    const item = createShape({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      anchorX: 24,
    })
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'anchorY',
          keyframes: [{ id: 'anchor-y', frame: 0, value: 36, easing: 'linear' }],
        },
      ],
    }

    expect(
      prepareScaleStartTransform(
        { ...currentTransform, anchorX: 24, anchorY: 36 },
        item,
        keyframes,
        undefined,
      ),
    ).toMatchObject({ anchorX: 24, anchorY: 36 })
  })
})
