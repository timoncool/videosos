import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'
import { buildMotionPathPoints, canvasPointToMotionPathScreenPoint } from './motion-path'

const canvas = { width: 1920, height: 1080, fps: 30 }

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 10,
    durationInFrames: 50,
    label: 'Clip',
    src: 'clip.mp4',
    transform: {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
    },
    ...overrides,
  } as TimelineItem
}

describe('motion path utilities', () => {
  it('returns no path without x or y keyframes', () => {
    const points = buildMotionPathPoints({
      item: item(),
      itemKeyframes: {
        itemId: 'clip-1',
        properties: [
          {
            property: 'opacity',
            keyframes: [{ id: 'kf-1', frame: 0, value: 1, easing: 'linear' }],
          },
        ],
      },
      canvas,
    })

    expect(points).toEqual([])
  })

  it('samples the clip span and preserves exact position keyframe frames', () => {
    const keyframes: ItemKeyframes = {
      itemId: 'clip-1',
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 17, value: 120, easing: 'linear' },
            { id: 'kf-3', frame: 49, value: 240, easing: 'linear' },
          ],
        },
      ],
    }

    const points = buildMotionPathPoints({
      item: item(),
      itemKeyframes: keyframes,
      canvas,
      maxSamples: 4,
    })

    expect(points.map((point) => point.frame)).toEqual([10, 26, 27, 43, 59])
    expect(points.filter((point) => point.isKeyframe).map((point) => point.frame)).toEqual([
      10, 27, 59,
    ])
    expect(points[0]).toMatchObject({ x: 960, y: 540 })
    expect(points.at(-1)).toMatchObject({ x: 1200, y: 540 })
  })

  it('draws a path from a position-driving motion modifier without keyframes', () => {
    const points = buildMotionPathPoints({
      item: item({
        motionModifiers: [
          {
            id: 'mod-1',
            type: 'float-drift',
            enabled: true,
            amplitude: 1,
            frequency: 0.625,
            phaseFrames: 0,
            seed: 1,
          },
        ],
      }),
      itemKeyframes: undefined,
      canvas,
    })

    // Drift moves the clip, so the sampled span is a non-empty path with no
    // discrete keyframe markers.
    expect(points.length).toBeGreaterThan(0)
    expect(points.every((point) => point.isKeyframe === false)).toBe(true)
  })

  it('draws the motion inherited from a linked position property', () => {
    const source = item({ id: 'source', from: 20 })
    const target = item({ id: 'target' })
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'source-x-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'source-x-2', frame: 40, value: 100, easing: 'linear' },
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

    const points = buildMotionPathPoints({
      item: target,
      itemKeyframes: targetKeyframes,
      canvas,
      maxSamples: 4,
      getItem: (itemId) => items.get(itemId),
      getKeyframes: (itemId) => keyframes.get(itemId),
    })

    expect(points).toHaveLength(4)
    expect(points[0]?.x).toBe(960)
    expect(points.at(-1)?.x).toBeGreaterThan(1050)
    expect(points.every((point) => point.isKeyframe === false)).toBe(true)
  })

  it('suppresses static position keyframes', () => {
    const points = buildMotionPathPoints({
      item: item(),
      itemKeyframes: {
        itemId: 'clip-1',
        properties: [
          {
            property: 'y',
            keyframes: [
              { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
              { id: 'kf-2', frame: 49, value: 0, easing: 'linear' },
            ],
          },
        ],
      },
      canvas,
    })

    expect(points).toEqual([])
  })

  it('converts canvas points to player-space screen points', () => {
    const screenPoint = canvasPointToMotionPathScreenPoint(
      { frame: 10, x: 960, y: 540, isKeyframe: true },
      {
        containerRect: new DOMRect(0, 0, 960, 540),
        playerSize: { width: 960, height: 540 },
        projectSize: { width: 1920, height: 1080 },
        zoom: -1,
      },
    )

    expect(screenPoint).toMatchObject({ screenX: 480, screenY: 270 })
  })

  it('rotates spatial handles into world space with the parent', () => {
    const parent = item({
      id: 'parent',
      type: 'shape',
      from: 0,
      transform: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 90,
        opacity: 1,
      },
    })
    const child = item({
      id: 'child',
      from: 0,
      transform: {
        x: 10,
        y: 0,
        width: 20,
        height: 20,
        rotation: 0,
        opacity: 1,
      },
      transformParent: createTransformParentBinding({
        parentItemId: parent.id,
        parentWorld: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          anchorX: 50,
          anchorY: 50,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
        childLocal: {
          x: 10,
          y: 0,
          width: 20,
          height: 20,
          anchorX: 10,
          anchorY: 10,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
        childWorld: {
          x: 10,
          y: 0,
          width: 20,
          height: 20,
          anchorX: 10,
          anchorY: 10,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
      }),
    })
    const childKeyframes: ItemKeyframes = {
      itemId: child.id,
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            {
              id: 'position-1',
              frame: 0,
              value: { x: 10, y: 0 },
              easing: 'linear',
              spatial: {
                inTangent: { x: -10, y: 0 },
                outTangent: { x: 10, y: 0 },
                continuous: true,
              },
            },
            { id: 'position-2', frame: 20, value: { x: 30, y: 0 }, easing: 'linear' },
          ],
        },
      ],
    }
    const items = new Map([
      [parent.id, parent],
      [child.id, child],
    ])

    const points = buildMotionPathPoints({
      item: child,
      itemKeyframes: childKeyframes,
      canvas,
      getItem: (itemId) => items.get(itemId),
      getKeyframes: (itemId) => (itemId === child.id ? childKeyframes : undefined),
    })
    const first = points.find((point) => point.keyframeId === 'position-1')

    expect(first?.spatial?.outTangent.x).toBeCloseTo(0)
    expect(first?.spatial?.outTangent.y).toBeCloseTo(10)
  })
})
