// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { duplicateItems, duplicateItemsWithTrackChanges } from './item-actions'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    sourceStart: 10,
    sourceEnd: 40,
    sourceDuration: 120,
    ...overrides,
  }
}

function makeTransition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'wipe-left',
    timing: 'ease-in-out',
    leftClipId: 'left',
    rightClipId: 'right',
    trackId: 'track-1',
    durationInFrames: 12,
    direction: 'from-left',
    alignment: 0.25,
    presetId: 'soft-wipe',
    ...overrides,
  }
}

describe('timeline duplicate item actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  it('copies transitions between clips duplicated together', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'left', from: 0 }),
        makeVideoItem({ id: 'right', from: 30, mediaId: 'media-2' }),
        makeVideoItem({ id: 'outside', from: 60, mediaId: 'media-3' }),
      ])
    useTransitionsStore.getState().setTransitions([
      makeTransition(),
      makeTransition({
        id: 'outside-transition',
        leftClipId: 'right',
        rightClipId: 'outside',
        durationInFrames: 8,
      }),
    ])

    const newItems = duplicateItems(
      ['left', 'right'],
      [
        { from: 100, trackId: 'track-1' },
        { from: 130, trackId: 'track-1' },
      ],
    )

    expect(newItems).toHaveLength(2)
    const transitions = useTransitionsStore.getState().transitions
    expect(transitions).toHaveLength(3)

    const copiedTransition = transitions.find(
      (transition) =>
        transition.leftClipId === newItems[0]?.id && transition.rightClipId === newItems[1]?.id,
    )
    expect(copiedTransition).toMatchObject({
      type: 'crossfade',
      presentation: 'wipe-left',
      timing: 'ease-in-out',
      trackId: 'track-1',
      durationInFrames: 12,
      direction: 'from-left',
      alignment: 0.25,
      presetId: 'soft-wipe',
    })
    expect(copiedTransition?.id).not.toBe('transition-1')
    expect(
      transitions.some(
        (transition) =>
          transition.id !== 'outside-transition' &&
          transition.leftClipId === newItems[1]?.id &&
          transition.rightClipId === 'outside',
      ),
    ).toBe(false)
  })

  it('copies duplicated transitions onto their new track', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'left', from: 0 }),
        makeVideoItem({ id: 'right', from: 30, mediaId: 'media-2' }),
      ])
    useTransitionsStore.getState().setTransitions([makeTransition()])

    const newItems = duplicateItemsWithTrackChanges(
      [
        {
          id: 'track-2',
          name: 'V2',
          order: 0,
          kind: 'video',
          height: 80,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          items: [],
        },
      ],
      ['left', 'right'],
      [
        { from: 100, trackId: 'track-2' },
        { from: 130, trackId: 'track-2' },
      ],
    )

    const copiedTransition = useTransitionsStore
      .getState()
      .transitions.find((transition) => transition.leftClipId === newItems[0]?.id)
    expect(copiedTransition).toMatchObject({
      leftClipId: newItems[0]?.id,
      rightClipId: newItems[1]?.id,
      trackId: 'track-2',
    })
  })

  it('deep-copies keyframes onto an item duplicated to a new track', () => {
    useItemsStore.getState().setItems([makeVideoItem()])
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: 'clip-1',
        separatedVectorProperties: ['position'],
        properties: [
          {
            property: 'x',
            keyframes: [
              {
                id: 'source-keyframe',
                frame: 12,
                value: 240,
                easing: 'cubic-bezier',
                easingConfig: {
                  type: 'cubic-bezier',
                  bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
                },
              },
            ],
          },
        ],
      },
    ])

    const [duplicatedItem] = duplicateItemsWithTrackChanges(
      [
        {
          id: 'track-2',
          name: 'V2',
          order: 0,
          kind: 'video',
          height: 80,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          items: [],
        },
      ],
      ['clip-1'],
      [{ from: 100, trackId: 'track-2' }],
    )

    expect(duplicatedItem).toBeDefined()
    const source = useKeyframesStore.getState().keyframesByItemId['clip-1']!
    const copy = useKeyframesStore.getState().keyframesByItemId[duplicatedItem!.id]!

    expect(copy).toEqual({
      itemId: duplicatedItem!.id,
      separatedVectorProperties: ['position'],
      properties: [
        {
          property: 'x',
          keyframes: [
            {
              id: expect.any(String),
              frame: 12,
              value: 240,
              easing: 'cubic-bezier',
              easingConfig: {
                type: 'cubic-bezier',
                bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
              },
            },
          ],
        },
      ],
    })
    expect(copy.properties[0]!.keyframes[0]!.id).not.toBe('source-keyframe')
    expect(copy.properties[0]!.keyframes[0]).not.toBe(source.properties[0]!.keyframes[0])
    expect(copy.properties[0]!.keyframes[0]!.easingConfig?.bezier).not.toBe(
      source.properties[0]!.keyframes[0]!.easingConfig?.bezier,
    )
  })

  it('copies links and remaps their source when linked items are duplicated together', () => {
    useItemsStore
      .getState()
      .setItems([makeVideoItem({ id: 'source' }), makeVideoItem({ id: 'target', from: 40 })])
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: 'source',
        properties: [{ property: 'x', keyframes: [] }],
      },
      {
        itemId: 'target',
        properties: [],
        expressions: [
          {
            type: 'link',
            targetProperty: 'x',
            sourceItemId: 'source',
            sourceProperty: 'x',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    ])

    const copies = duplicateItems(
      ['source', 'target'],
      [
        { from: 100, trackId: 'track-1' },
        { from: 140, trackId: 'track-1' },
      ],
    )
    const copiedTargetExpression =
      useKeyframesStore.getState().keyframesByItemId[copies[1]!.id]?.expressions?.[0]

    expect(copiedTargetExpression).toMatchObject({
      sourceItemId: copies[0]!.id,
      targetProperty: 'x',
      sourceProperty: 'x',
    })
  })

  it('remaps a duplicated child to its duplicated transform parent', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'parent' }),
      makeVideoItem({
        id: 'child',
        from: 40,
        transformParent: {
          parentItemId: 'parent',
          parentReference: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
          childLocalReference: { x: 20, y: 0, width: 50, height: 50, rotation: 0 },
          childWorldReference: { x: 20, y: 0, width: 50, height: 50, rotation: 0 },
        },
      }),
    ])

    const copies = duplicateItems(
      ['parent', 'child'],
      [
        { from: 100, trackId: 'track-1' },
        { from: 140, trackId: 'track-1' },
      ],
    )

    expect(copies[1]?.transformParent?.parentItemId).toBe(copies[0]?.id)
    expect(useItemsStore.getState().itemById[copies[1]!.id]?.transformParent?.parentItemId).toBe(
      copies[0]?.id,
    )
    expect(useItemsStore.getState().itemById.child?.transformParent?.parentItemId).toBe('parent')
  })
})
