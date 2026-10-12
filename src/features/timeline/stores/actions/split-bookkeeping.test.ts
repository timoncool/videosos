// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Transition } from '@/types/transition'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { applySplitBookkeeping, type SplitResultEntry } from './split-bookkeeping'

function makeFade(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'left',
    rightClipId: 'right',
    trackId: 'track-v1',
    durationInFrames: 12,
    ...overrides,
  }
}

describe('applySplitBookkeeping', () => {
  beforeEach(() => {
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
  })

  it('remaps a transition left edge to the right split segment', () => {
    // Splitting clip 'a' (which leads into a transition) must hand the
    // transition to the segment that still touches the cut: the right one.
    useTransitionsStore.getState().setTransitions([makeFade({ leftClipId: 'a', rightClipId: 'b' })])

    const entry: SplitResultEntry = {
      originalId: 'a',
      originalLinkedGroupId: undefined,
      result: {
        leftItem: makeTimelineVideoItem({ id: 'a-left' }),
        rightItem: makeTimelineVideoItem({ id: 'a-right', from: 30 }),
      },
    }
    applySplitBookkeeping([entry])

    const transition = useTransitionsStore.getState().transitions[0]
    expect(transition?.leftClipId).toBe('a-right')
    expect(transition?.rightClipId).toBe('b')
  })

  it('leaves transitions into the split clip pointing at the original (left keeps the id)', () => {
    useTransitionsStore.getState().setTransitions([makeFade({ leftClipId: 'x', rightClipId: 'a' })])

    applySplitBookkeeping([
      {
        originalId: 'a',
        originalLinkedGroupId: undefined,
        result: {
          leftItem: makeTimelineVideoItem({ id: 'a-left' }),
          rightItem: makeTimelineVideoItem({ id: 'a-right', from: 30 }),
        },
      },
    ])

    const transition = useTransitionsStore.getState().transitions[0]
    expect(transition?.rightClipId).toBe('a')
  })

  it('gives split halves of a linked pair fresh shared group ids per side', () => {
    const videoLeft = makeTimelineVideoItem({ id: 'video-left' })
    const videoRight = makeTimelineVideoItem({ id: 'video-right', from: 30 })
    const audioLeft = makeTimelineAudioItem({ id: 'audio-left' })
    const audioRight = makeTimelineAudioItem({ id: 'audio-right', from: 30 })
    useItemsStore.getState().setItems([videoLeft, videoRight, audioLeft, audioRight])

    applySplitBookkeeping([
      {
        originalId: 'video-orig',
        originalLinkedGroupId: 'lg-old',
        result: { leftItem: videoLeft, rightItem: videoRight },
      },
      {
        originalId: 'audio-orig',
        originalLinkedGroupId: 'lg-old',
        result: { leftItem: audioLeft, rightItem: audioRight },
      },
    ])

    const byId = useItemsStore.getState().itemById
    const leftGroup = byId['video-left']?.linkedGroupId
    const rightGroup = byId['video-right']?.linkedGroupId
    expect(leftGroup).toBeTruthy()
    expect(rightGroup).toBeTruthy()
    expect(leftGroup).not.toBe(rightGroup)
    expect(leftGroup).not.toBe('lg-old')
    expect(byId['audio-left']?.linkedGroupId).toBe(leftGroup)
    expect(byId['audio-right']?.linkedGroupId).toBe(rightGroup)
  })

  it('clears the link when only one clip of a linked group was split', () => {
    const left = makeTimelineVideoItem({ id: 'solo-left', linkedGroupId: 'lg-old' })
    const right = makeTimelineVideoItem({ id: 'solo-right', from: 30, linkedGroupId: 'lg-old' })
    useItemsStore.getState().setItems([left, right])

    applySplitBookkeeping([
      {
        originalId: 'solo-orig',
        originalLinkedGroupId: 'lg-old',
        result: { leftItem: left, rightItem: right },
      },
    ])

    const byId = useItemsStore.getState().itemById
    expect(byId['solo-left']?.linkedGroupId).toBeUndefined()
    expect(byId['solo-right']?.linkedGroupId).toBeUndefined()
  })

  it('is a no-op for empty input', () => {
    useTransitionsStore.getState().setTransitions([makeFade()])
    applySplitBookkeeping([])
    expect(useTransitionsStore.getState().transitions).toHaveLength(1)
  })
})
