import { describe, expect, it } from 'vite-plus/test'
import {
  applyTransformOverride,
  createFrameCompositionSceneCache,
  resolveActiveShapeMasksAtFrame,
  resolveFrameCompositionScene,
  resolveItemTransformAtFrame,
  selectMaskRenderFrame,
} from './frame-scene'
import { resolveCompositionRenderPlan } from './scene-assembly'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'

describe('frame scene', () => {
  it('keeps inactive mask clock snapshots stable between boundaries', () => {
    const masks = [
      {
        id: 'mask-1',
        type: 'shape' as const,
        trackId: 'track-1',
        from: 10,
        durationInFrames: 10,
        label: 'Mask 1',
        shapeType: 'rectangle' as const,
        fillColor: '#fff',
        isMask: true,
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      },
      {
        id: 'mask-2',
        type: 'shape' as const,
        trackId: 'track-1',
        from: 30,
        durationInFrames: 10,
        label: 'Mask 2',
        shapeType: 'rectangle' as const,
        fillColor: '#fff',
        isMask: true,
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      },
    ]

    expect(selectMaskRenderFrame(masks, 0)).toBe(-1)
    expect(selectMaskRenderFrame(masks, 9)).toBe(-1)
    expect(selectMaskRenderFrame(masks, 10)).toBe(10)
    expect(selectMaskRenderFrame(masks, 19)).toBe(19)
    expect(selectMaskRenderFrame(masks, 20)).toBe(-2)
    expect(selectMaskRenderFrame(masks, 29)).toBe(-2)
    expect(selectMaskRenderFrame(masks, 30)).toBe(30)
    expect(selectMaskRenderFrame(masks, 40)).toBe(-3)
  })

  it('recenters implicit preview anchors while retaining explicit anchors', () => {
    const base = {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      anchorX: 100,
      anchorY: 50,
      rotation: 35,
      opacity: 1,
      cornerRadius: 0,
    }

    expect(
      applyTransformOverride(base, {
        width: 320,
        height: 180,
        anchorX: undefined,
        anchorY: undefined,
      }),
    ).toMatchObject({ width: 320, height: 180, anchorX: 160, anchorY: 90 })

    expect(
      applyTransformOverride(base, {
        width: 320,
        height: 180,
        anchorX: 24,
        anchorY: 36,
      }),
    ).toMatchObject({ width: 320, height: 180, anchorX: 24, anchorY: 36 })
  })

  function createMaskRenderPlan() {
    return resolveCompositionRenderPlan({
      tracks: [
        {
          id: 'track-1',
          name: 'Track 1',
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [
            {
              id: 'mask-1',
              type: 'shape',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              label: 'Mask 1',
              shapeType: 'path',
              fillColor: '#fff',
              isMask: true,
              pathVertices: [
                {
                  position: [0.1, 0.1],
                  inHandle: [0.1, 0.1],
                  outHandle: [0.1, 0.1],
                },
              ],
              transform: {
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                rotation: 0,
                opacity: 1,
              },
            },
          ],
        },
      ],
      transitions: [],
    })
  }

  it('resolves animated parent transforms in the preview runtime', () => {
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
    const parent = {
      id: 'controller-1',
      type: 'controller' as const,
      controllerKind: 'null' as const,
      trackId: 'controller-track',
      from: 0,
      durationInFrames: 60,
      label: 'Controller',
      transform: parentBase,
    }
    const child = {
      id: 'shape-1',
      type: 'shape' as const,
      shapeType: 'rectangle' as const,
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
    const parentKeyframes = {
      itemId: parent.id,
      properties: [
        {
          property: 'x' as const,
          keyframes: [
            { id: 'x-1', frame: 0, value: 0, easing: 'linear' as const },
            { id: 'x-2', frame: 30, value: 100, easing: 'linear' as const },
          ],
        },
      ],
    }
    const items = new Map([parent, child].map((item) => [item.id, item]))
    const resolved = resolveItemTransformAtFrame(child, {
      canvas: { width: 1920, height: 1080, fps: 30 },
      frame: 15,
      getItem: (id) => items.get(id),
      getKeyframes: (id) => (id === parent.id ? parentKeyframes : undefined),
    })
    expect(resolved.x).toBeCloseTo(60)
  })

  it('composes authored transform keyframes with additive animation layers', () => {
    const item = {
      id: 'shape-layered',
      type: 'shape' as const,
      shapeType: 'rectangle' as const,
      fillColor: '#fff',
      trackId: 'shape-track',
      from: 0,
      durationInFrames: 30,
      label: 'Layered shape',
      transform: {
        x: 100,
        y: 50,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
      motionLayers: [
        {
          id: 'layer-1',
          name: 'Offset',
          enabled: true,
          source: 'built-in-preset' as const,
          sourcePresetId: 'offset',
          tracks: [
            {
              property: 'x' as const,
              blend: 'add' as const,
              keyframes: [
                { id: 'l0', frame: 0, value: 0, easing: 'linear' as const },
                { id: 'l1', frame: 10, value: 30, easing: 'linear' as const },
              ],
            },
          ],
        },
      ],
    }
    const resolved = resolveItemTransformAtFrame(item, {
      canvas: { width: 1920, height: 1080, fps: 30 },
      frame: 10,
      keyframes: {
        itemId: item.id,
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'x0', frame: 0, value: 100, easing: 'linear' },
              { id: 'x1', frame: 10, value: 120, easing: 'linear' },
            ],
          },
        ],
      },
    })

    expect(resolved.x).toBe(150)
  })

  it('applies preview path vertices to active path masks', () => {
    const previewVertices = [
      {
        position: [0.9, 0.1] as [number, number],
        inHandle: [0.9, 0.1] as [number, number],
        outHandle: [0.9, 0.1] as [number, number],
      },
    ]
    const activeMasks = resolveActiveShapeMasksAtFrame(
      [
        {
          id: 'mask-path',
          type: 'shape',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 30,
          label: 'Mask path',
          shapeType: 'path',
          fillColor: '#fff',
          isMask: true,
          pathVertices: [
            {
              position: [0.1, 0.1],
              inHandle: [0.1, 0.1],
              outHandle: [0.1, 0.1],
            },
          ],
          transform: {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
        },
      ],
      {
        canvas: { width: 1280, height: 720, fps: 30 },
        frame: 5,
        getPreviewPathVertices: () => previewVertices,
      },
    )

    expect(activeMasks).toHaveLength(1)
    expect(activeMasks[0]?.shape.pathVertices).toBe(previewVertices)
  })

  it('resolves linked mask transforms at shared composition time', () => {
    const source = {
      id: 'source-shape',
      type: 'shape' as const,
      trackId: 'track-1',
      from: 20,
      durationInFrames: 60,
      label: 'Source shape',
      shapeType: 'rectangle' as const,
      fillColor: '#fff',
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    }
    const mask = {
      ...source,
      id: 'linked-mask',
      from: 0,
      label: 'Linked mask',
      isMask: true,
      transform: { ...source.transform, x: -40 },
    }
    const sourceKeyframes = {
      itemId: source.id,
      properties: [
        {
          property: 'x' as const,
          keyframes: [
            { id: 'source-x-1', frame: 0, value: 0, easing: 'linear' as const },
            { id: 'source-x-2', frame: 20, value: 100, easing: 'linear' as const },
          ],
        },
      ],
    }
    const maskKeyframes = {
      itemId: mask.id,
      properties: [],
      expressions: [
        {
          type: 'link' as const,
          targetProperty: 'x' as const,
          sourceItemId: source.id,
          sourceProperty: 'x' as const,
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }

    const activeMasks = resolveActiveShapeMasksAtFrame([mask], {
      canvas: { width: 1280, height: 720, fps: 30 },
      frame: 30,
      getItem: (itemId) => (itemId === source.id ? source : itemId === mask.id ? mask : undefined),
      getKeyframes: (itemId) =>
        itemId === source.id ? sourceKeyframes : itemId === mask.id ? maskKeyframes : undefined,
    })

    expect(activeMasks[0]?.transform.x).toBeCloseTo(50, 5)
  })

  it('combines active masks and transition frame state from the render plan', () => {
    const renderPlan = resolveCompositionRenderPlan({
      tracks: [
        {
          id: 'track-1',
          name: 'Track 1',
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [
            {
              id: 'mask-1',
              type: 'shape',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              label: 'Mask 1',
              shapeType: 'rectangle',
              fillColor: '#fff',
              isMask: true,
              transform: {
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                rotation: 0,
                opacity: 1,
              },
            },
            {
              id: 'left',
              type: 'video',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              src: 'left.mp4',
              label: 'Left',
            },
            {
              id: 'right',
              type: 'video',
              trackId: 'track-1',
              from: 20,
              durationInFrames: 30,
              src: 'right.mp4',
              label: 'Right',
            },
          ],
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'left',
          rightClipId: 'right',
          trackId: 'track-1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
    })

    const frameScene = resolveFrameCompositionScene({
      renderPlan,
      frame: 25,
      canvas: { width: 1280, height: 720, fps: 30 },
    })

    expect(frameScene.activeShapeMasks).toEqual([
      expect.objectContaining({
        shape: expect.objectContaining({ id: 'mask-1' }),
        trackOrder: 1,
        transform: expect.objectContaining({ width: 200, height: 100 }),
      }),
    ])
    expect(frameScene.transitionFrameState.activeTransitions).toEqual([
      expect.objectContaining({
        transition: expect.objectContaining({ id: 'transition-1' }),
      }),
    ])
    expect(frameScene.transitionFrameState.transitionClipIds).toEqual(new Set(['left', 'right']))
  })

  it('keeps frame-scene caches isolated per renderer instance', () => {
    const renderPlan = createMaskRenderPlan()
    const cacheA = createFrameCompositionSceneCache()
    const cacheB = createFrameCompositionSceneCache()
    const previewVerticesA = [
      {
        position: [0.2, 0.2] as [number, number],
        inHandle: [0.2, 0.2] as [number, number],
        outHandle: [0.2, 0.2] as [number, number],
      },
    ]
    const previewVerticesB = [
      {
        position: [0.8, 0.8] as [number, number],
        inHandle: [0.8, 0.8] as [number, number],
        outHandle: [0.8, 0.8] as [number, number],
      },
    ]

    const sceneA = cacheA.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
        getPreviewPathVertices: () => previewVerticesA,
      },
      0,
    )
    const sceneB = cacheB.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
        getPreviewPathVertices: () => previewVerticesB,
      },
      0,
    )

    expect(sceneA).not.toBe(sceneB)
    expect(sceneA.activeShapeMasks[0]?.shape.pathVertices).toBe(previewVerticesA)
    expect(sceneB.activeShapeMasks[0]?.shape.pathVertices).toBe(previewVerticesB)
  })

  it('recomputes the cached frame scene when the revision changes', () => {
    const renderPlan = createMaskRenderPlan()
    const cache = createFrameCompositionSceneCache()
    let previewVertices = [
      {
        position: [0.2, 0.2] as [number, number],
        inHandle: [0.2, 0.2] as [number, number],
        outHandle: [0.2, 0.2] as [number, number],
      },
    ]
    const getPreviewPathVertices = () => previewVertices

    const firstScene = cache.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
        getPreviewPathVertices,
      },
      0,
    )

    previewVertices = [
      {
        position: [0.8, 0.8] as [number, number],
        inHandle: [0.8, 0.8] as [number, number],
        outHandle: [0.8, 0.8] as [number, number],
      },
    ]

    const cachedSameRevision = cache.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
        getPreviewPathVertices,
      },
      0,
    )
    const updatedScene = cache.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
        getPreviewPathVertices,
      },
      1,
    )

    expect(cachedSameRevision).toBe(firstScene)
    expect(cachedSameRevision.activeShapeMasks[0]?.shape.pathVertices).not.toBe(previewVertices)
    expect(updatedScene).not.toBe(firstScene)
    expect(updatedScene.activeShapeMasks[0]?.shape.pathVertices).toBe(previewVertices)
  })

  it('keeps the cached frame scene when an invalidation request misses the cached frame', () => {
    const renderPlan = createMaskRenderPlan()
    const cache = createFrameCompositionSceneCache()

    const firstScene = cache.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
      },
      0,
    )

    cache.invalidate({
      ranges: [{ startFrame: 10, endFrame: 20 }],
    })

    const cachedScene = cache.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
      },
      0,
    )

    expect(cachedScene).toBe(firstScene)

    cache.invalidate({
      ranges: [{ startFrame: 5, endFrame: 6 }],
    })

    const invalidatedScene = cache.resolve(
      {
        renderPlan,
        frame: 5,
        canvas: { width: 1280, height: 720, fps: 30 },
      },
      0,
    )

    expect(invalidatedScene).not.toBe(firstScene)
  })
})
