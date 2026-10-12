import { describe, expect, it } from 'vite-plus/test'
import type { ControllerItem, ShapeItem, TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'
import { resolveItemTransformAtFrame } from '@/features/preview/deps/composition-runtime'
import { resolveGizmoWorldPreviewAsLocal } from './gizmo-world-preview'

const canvas = { width: 1920, height: 1080, fps: 30 }

function transform(overrides: Partial<ResolvedTransform> = {}): ResolvedTransform {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    anchorX: 50,
    anchorY: 50,
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    ...overrides,
  }
}

describe('resolveGizmoWorldPreviewAsLocal', () => {
  it('keeps a parented preview in the same world position before and after commit', () => {
    const parentReference = transform()
    const parent: ControllerItem = {
      id: 'parent',
      type: 'controller',
      controllerKind: 'null',
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 100,
      label: 'Parent',
      transform: transform({ x: 100 }),
    }
    const childReference = transform({ x: 10, width: 20, height: 20 })
    const child: ShapeItem = {
      id: 'child',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'child-track',
      from: 0,
      durationInFrames: 100,
      label: 'Child',
      fillColor: '#3b82f6',
      strokeWidth: 0,
      transform: childReference,
      transformParent: createTransformParentBinding({
        childLocal: childReference,
        childWorld: childReference,
        parentItemId: parent.id,
        parentWorld: parentReference,
      }),
    }
    const items = new Map<string, TimelineItem>([
      [parent.id, parent],
      [child.id, child],
    ])

    const localPreview = resolveGizmoWorldPreviewAsLocal({
      itemId: child.id,
      worldPreviewTransform: transform({ x: 130, width: 20, height: 20 }),
      canvas,
      frame: 0,
      getItem: (itemId) => items.get(itemId),
      getKeyframes: () => undefined,
    })

    expect(localPreview.x).toBeCloseTo(30)
    const renderedWorld = resolveItemTransformAtFrame(child, {
      canvas,
      frame: 0,
      previewTransform: localPreview,
      getItem: (itemId) => items.get(itemId),
      getKeyframes: () => undefined,
    })
    expect(renderedWorld.x).toBeCloseTo(130)
  })
})
