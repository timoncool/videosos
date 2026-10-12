// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { getAnimatablePropertiesForItem } from './animatable-properties'

function createItem<TType extends TimelineItem['type']>(
  type: TType,
): Extract<TimelineItem, { type: TType }> {
  return {
    id: `${type}-1`,
    type,
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: `${type} item`,
  } as Extract<TimelineItem, { type: TType }>
}

describe('getAnimatablePropertiesForItem', () => {
  it('includes anchor properties for video items', () => {
    expect(getAnimatablePropertiesForItem(createItem('video'))).toEqual([
      'x',
      'y',
      'width',
      'height',
      'anchorX',
      'anchorY',
      'rotation',
      'opacity',
      'cornerRadius',
      'cropLeft',
      'cropRight',
      'cropTop',
      'cropBottom',
      'cropSoftness',
      'volume',
    ])
  })

  it('includes anchor and crop properties for composition items', () => {
    expect(
      getAnimatablePropertiesForItem({
        ...createItem('composition'),
        compositionId: 'comp-1',
        compositionWidth: 1920,
        compositionHeight: 1080,
      }),
    ).toEqual([
      'x',
      'y',
      'width',
      'height',
      'anchorX',
      'anchorY',
      'rotation',
      'opacity',
      'cornerRadius',
      'cropLeft',
      'cropRight',
      'cropTop',
      'cropBottom',
      'cropSoftness',
      'volume',
    ])
  })

  it('exposes anchor properties for every visual item', () => {
    expect(getAnimatablePropertiesForItem(createItem('image'))).toEqual([
      'x',
      'y',
      'width',
      'height',
      'anchorX',
      'anchorY',
      'rotation',
      'opacity',
      'cornerRadius',
    ])
  })

  it('exposes only hierarchy-driving transforms for null controllers', () => {
    expect(
      getAnimatablePropertiesForItem({
        ...createItem('controller'),
        controllerKind: 'null',
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      }),
    ).toEqual(['x', 'y', 'width', 'height', 'rotation'])
  })

  it('includes text-specific properties for text items', () => {
    expect(
      getAnimatablePropertiesForItem({
        ...createItem('text'),
        text: 'Hello world',
        color: '#ffffff',
      }),
    ).toEqual([
      'x',
      'y',
      'width',
      'height',
      'anchorX',
      'anchorY',
      'rotation',
      'opacity',
      'cornerRadius',
      'textStyleScale',
      'fontSize',
      'lineHeight',
      'textPadding',
      'backgroundRadius',
      'textShadowOffsetX',
      'textShadowOffsetY',
      'textShadowBlur',
      'strokeWidth',
    ])
  })

  it('exposes stable path geometry channels for custom path shapes', () => {
    const properties = getAnimatablePropertiesForItem({
      ...createItem('shape'),
      shapeType: 'path',
      pathVertices: [
        {
          position: [0, 0],
          inHandle: [0, 0],
          outHandle: [0.25, 0],
        },
      ],
    })

    expect(properties).toEqual(
      expect.arrayContaining([
        'pathVertex:0:positionX',
        'pathVertex:0:positionY',
        'pathVertex:0:inX',
        'pathVertex:0:inY',
        'pathVertex:0:outX',
        'pathVertex:0:outY',
      ]),
    )
  })
})
