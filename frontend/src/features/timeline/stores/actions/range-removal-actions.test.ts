// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, VideoItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useKeyframesStore } from '../keyframes-store'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTransitionsStore } from '../transitions-store'
import { removeSilenceFromItems } from './edit/range-removal-actions'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 300,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: 300,
    sourceDuration: 300,
    sourceFps: 30,
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 300,
    label: 'clip.mp4',
    src: 'blob:audio',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: 300,
    sourceDuration: 300,
    sourceFps: 30,
    ...overrides,
  }
}

function sourceSpans(type: 'audio' | 'video') {
  return useItemsStore
    .getState()
    .items.filter((item) => item.type === type)
    .toSorted((left, right) => left.from - right.from)
    .map((item) => ({
      from: item.from,
      durationInFrames: item.durationInFrames,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
    }))
}

describe('removeSilenceFromItems', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useSelectionStore.getState().clearSelection()
  })

  it('splits, removes, ripples, and restores a forward clip as one undo step', () => {
    useItemsStore.getState().setItems([makeVideoItem()])

    const result = removeSilenceFromItems(['video-1'], {
      'media-1': [{ start: 2, end: 4 }],
    })

    expect(result).toEqual({
      analyzedItemCount: 1,
      removedRangeCount: 1,
      removedItemCount: 1,
      splitCount: 2,
    })
    expect(sourceSpans('video')).toEqual([
      { from: 0, durationInFrames: 60, sourceStart: 0, sourceEnd: 60 },
      { from: 60, durationInFrames: 180, sourceStart: 120, sourceEnd: 300 },
    ])
    expect(useTimelineCommandStore.getState().getLastCommandType()).toBe('REMOVE_SILENCE')

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().items).toEqual([makeVideoItem()])
  })

  it('maps source silence from sourceEnd toward sourceStart for reversed clips', () => {
    useItemsStore.getState().setItems([makeVideoItem({ isReversed: true })])

    const result = removeSilenceFromItems(['video-1'], {
      'media-1': [{ start: 2, end: 4 }],
    })

    expect(result.removedRangeCount).toBe(1)
    expect(sourceSpans('video')).toEqual([
      { from: 0, durationInFrames: 180, sourceStart: 120, sourceEnd: 300 },
      { from: 180, durationInFrames: 60, sourceStart: 0, sourceEnd: 60 },
    ])
  })

  it('reports one logical range when linked video and audio items are both removed', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ linkedGroupId: 'group-1' }),
        makeAudioItem({ linkedGroupId: 'group-1' }),
      ])

    const result = removeSilenceFromItems(['video-1', 'audio-1'], {
      'media-1': [{ start: 2, end: 4 }],
    })

    expect(result.removedRangeCount).toBe(1)
    expect(result.removedItemCount).toBe(2)
    expect(sourceSpans('video')).toHaveLength(2)
    expect(sourceSpans('audio')).toHaveLength(2)
  })
})
