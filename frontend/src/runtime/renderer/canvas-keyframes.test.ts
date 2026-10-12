import { describe, expect, it } from 'vite-plus/test'
import type {
  CompositionItem,
  ControllerItem,
  ShapeItem,
  TextItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { getAnimatedCrop, getAnimatedTransform } from './canvas-keyframes'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'

describe('canvas-keyframes text sizing', () => {
  it('expands text height to fit content during export', () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Text',
      text: 'line one\nline two\nline three\nline four',
      color: '#ffffff',
      fontSize: 48,
      lineHeight: 1.2,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      fontStyle: 'normal',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        rotation: 0,
        opacity: 1,
      },
    }

    const transform = getAnimatedTransform(item, undefined, 0, {
      width: 1920,
      height: 1080,
      fps: 30,
    })

    expect(transform.height).toBeGreaterThan(80)
  })
})

describe('canvas-keyframes logical preview space', () => {
  it('resolves authored transforms before scaling them to preview pixels', () => {
    const item: ShapeItem = {
      id: 'shape-preview-scale',
      type: 'shape',
      shapeType: 'rectangle',
      fillColor: '#fff',
      trackId: 'shape-track',
      from: 0,
      durationInFrames: 60,
      label: 'Shape',
      transform: {
        x: 320,
        y: -180,
        width: 960,
        height: 540,
        anchorX: 240,
        anchorY: 135,
        cornerRadius: 40,
      },
    }

    const resolved = getAnimatedTransform(item, undefined, 0, {
      width: 960,
      height: 540,
      logicalWidth: 3840,
      logicalHeight: 2160,
      fps: 30,
    })

    expect(resolved).toMatchObject({
      x: 80,
      y: -45,
      width: 240,
      height: 135,
      anchorX: 60,
      anchorY: 33.75,
      cornerRadius: 10,
    })
  })
})

describe('canvas-keyframes transform parenting', () => {
  it('matches controller animation during export resolution', () => {
    const parentBase = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      anchorX: 50,
      anchorY: 50,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }
    const childBase = { ...parentBase, x: 10, width: 20, height: 20, anchorX: 10, anchorY: 10 }
    const parent: ControllerItem = {
      id: 'controller-1',
      type: 'controller',
      controllerKind: 'null',
      trackId: 'controller-track',
      from: 0,
      durationInFrames: 60,
      label: 'Controller',
      transform: parentBase,
    }
    const child: ShapeItem = {
      id: 'shape-1',
      type: 'shape',
      shapeType: 'rectangle',
      fillColor: '#fff',
      trackId: 'shape-track',
      from: 0,
      durationInFrames: 60,
      label: 'Shape',
      transform: childBase,
      transformParent: createTransformParentBinding({
        childLocal: childBase,
        childWorld: childBase,
        parentItemId: parent.id,
        parentWorld: parentBase,
      }),
    }
    const parentKeyframes: ItemKeyframes = {
      itemId: parent.id,
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'x-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'x-2', frame: 30, value: 100, easing: 'linear' },
          ],
        },
      ],
    }
    const items = new Map<string, TimelineItem>([
      [parent.id, parent],
      [child.id, child],
    ])

    const resolved = getAnimatedTransform(child, undefined, 15, {
      width: 1920,
      height: 1080,
      fps: 30,
      getExpressionItem: (itemId) => items.get(itemId),
      getExpressionKeyframes: (itemId) => (itemId === parent.id ? parentKeyframes : undefined),
    })
    expect(resolved.x).toBeCloseTo(60)
  })

  it('moves a child through its controller live preview before commit', () => {
    const parentBase = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      anchorX: 50,
      anchorY: 50,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }
    const childBase = { ...parentBase, x: 10, width: 20, height: 20, anchorX: 10, anchorY: 10 }
    const parent: ControllerItem = {
      id: 'controller-live',
      type: 'controller',
      controllerKind: 'null',
      trackId: 'controller-track',
      from: 0,
      durationInFrames: 60,
      label: 'Controller',
      transform: parentBase,
    }
    const child: ShapeItem = {
      id: 'shape-live',
      type: 'shape',
      shapeType: 'rectangle',
      fillColor: '#fff',
      trackId: 'shape-track',
      from: 0,
      durationInFrames: 60,
      label: 'Shape',
      transform: childBase,
      transformParent: createTransformParentBinding({
        childLocal: childBase,
        childWorld: childBase,
        parentItemId: parent.id,
        parentWorld: parentBase,
      }),
    }
    const items = new Map<string, TimelineItem>([
      [parent.id, parent],
      [child.id, child],
    ])

    const resolved = getAnimatedTransform(child, undefined, 15, {
      width: 1920,
      height: 1080,
      fps: 30,
      getExpressionItem: (itemId) => items.get(itemId),
      getPreviewTransform: (itemId) => (itemId === parent.id ? { x: 120 } : undefined),
    })

    expect(resolved.x).toBeCloseTo(130)
  })
})

describe('canvas-keyframes visual fades', () => {
  it('applies video fade in to export opacity', () => {
    const item: VideoItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 90,
      label: 'Video',
      src: 'blob:test',
      fadeIn: 1,
      transform: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 0.8,
      },
    }

    const transform = getAnimatedTransform(item, undefined, 25, {
      width: 1920,
      height: 1080,
      fps: 30,
    })

    expect(transform.opacity).toBeCloseTo(0.4, 5)
  })

  it('applies overlapping compound clip fades to export opacity', () => {
    const item: CompositionItem = {
      id: 'composition-1',
      type: 'composition',
      compositionId: 'sub-comp-1',
      compositionWidth: 1280,
      compositionHeight: 720,
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Compound clip',
      fadeIn: 2,
      fadeOut: 2,
      transform: {
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        rotation: 0,
        opacity: 1,
      },
    }

    const transform = getAnimatedTransform(item, undefined, 45, {
      width: 1920,
      height: 1080,
      fps: 30,
    })

    expect(transform.opacity).toBeCloseTo(0.75, 5)
  })
})

describe('canvas-keyframes crop animation', () => {
  it('resolves crop keyframes in source-pixel space for export', () => {
    const item: VideoItem = {
      id: 'video-crop-1',
      type: 'video',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 90,
      label: 'Video',
      src: 'blob:test',
      sourceWidth: 1920,
      sourceHeight: 1080,
    }
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'cropLeft',
          keyframes: [
            { id: 'k1', frame: 0, value: 0, easing: 'linear' },
            { id: 'k2', frame: 10, value: 192, easing: 'linear' },
          ],
        },
      ],
    }

    const crop = getAnimatedCrop(item, keyframes, 15, {
      width: 1920,
      height: 1080,
    })

    expect(crop?.left).toBeCloseTo(0.05, 5)
  })

  it('uses authored compound dimensions for crop keyframes', () => {
    const item: CompositionItem = {
      id: 'composition-crop-1',
      type: 'composition',
      compositionId: 'sub-comp-1',
      compositionWidth: 1280,
      compositionHeight: 720,
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Compound clip',
    }
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'cropTop',
          keyframes: [
            { id: 'k1', frame: 0, value: 0, easing: 'linear' },
            { id: 'k2', frame: 10, value: 360, easing: 'linear' },
          ],
        },
      ],
    }

    const crop = getAnimatedCrop(item, keyframes, 5, { width: 1920, height: 1080 })

    expect(crop?.top).toBeCloseTo(0.25, 5)
  })
})

describe('canvas-keyframes property links and expressions', () => {
  it('matches a source property at shared composition time during export', () => {
    const source: VideoItem = {
      id: 'source',
      type: 'video',
      trackId: 'track-1',
      from: 20,
      durationInFrames: 90,
      label: 'Source',
      src: 'blob:source',
      transform: { x: 10, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    }
    const target: VideoItem = {
      ...source,
      id: 'target',
      from: 0,
      label: 'Target',
      src: 'blob:target',
      transform: { ...source.transform, x: -50 },
    }
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'source-x-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'source-x-2', frame: 20, value: 100, easing: 'linear' },
          ],
        },
      ],
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'x',
          sourceItemId: source.id,
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const items = new Map([
      [source.id, source],
      [target.id, target],
    ])
    const keyframes = new Map([
      [source.id, sourceKeyframes],
      [target.id, targetKeyframes],
    ])

    const transform = getAnimatedTransform(target, targetKeyframes, 30, {
      width: 1920,
      height: 1080,
      fps: 30,
      getExpressionItem: (itemId) => items.get(itemId),
      getExpressionKeyframes: (itemId) => keyframes.get(itemId),
    })

    expect(transform.x).toBeCloseTo(50, 5)
  })

  it('evaluates sandboxed expressions during export', () => {
    const target: VideoItem = {
      id: 'expression-target',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Expression target',
      src: 'blob:target',
      transform: { x: 20, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    }
    const keyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'value * 2 + frame',
          enabled: true,
        },
      ],
    }

    const transform = getAnimatedTransform(target, keyframes, 10, {
      width: 1920,
      height: 1080,
      fps: 30,
      getExpressionItem: (itemId) => (itemId === target.id ? target : undefined),
      getExpressionKeyframes: (itemId) => (itemId === target.id ? keyframes : undefined),
    })

    expect(transform.x).toBe(50)
  })
})
