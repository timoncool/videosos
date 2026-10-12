import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useColorPlayheadAutoSelect } from './use-color-playhead-auto-select'

function makeTrack(id: string, order: number, extra: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id,
    name: id,
    kind: 'video',
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
    ...extra,
  }
}

function makeClip(id: string, trackId: string, from: number, durationInFrames: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames,
    label: id,
    src: `blob:${id}`,
    mediaId: `media-${id}`,
  }
}

function seed(items: VideoItem[], tracks: TimelineTrack[]) {
  useItemsStore.setState({
    items,
    tracks,
    itemById: Object.fromEntries(items.map((item) => [item.id, item])),
  })
}

describe('useColorPlayheadAutoSelect', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedItemIds: [] })
    usePlaybackStore.setState({ currentFrame: 0, previewFrame: null })
  })

  it('selects the clip under the playhead when nothing is selected', () => {
    seed([makeClip('a', 't1', 0, 90), makeClip('b', 't1', 90, 90)], [makeTrack('t1', 0)])

    renderHook(() => useColorPlayheadAutoSelect())

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['a'])
  })

  it('follows the playhead into the next clip', () => {
    seed([makeClip('a', 't1', 0, 90), makeClip('b', 't1', 90, 90)], [makeTrack('t1', 0)])
    renderHook(() => useColorPlayheadAutoSelect())

    act(() => {
      usePlaybackStore.setState({ currentFrame: 120 })
    })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['b'])
  })

  it('prefers the topmost visible track when clips overlap', () => {
    seed(
      [makeClip('lower', 't2', 0, 90), makeClip('upper', 't1', 0, 90)],
      [makeTrack('t1', 0), makeTrack('t2', 1)],
    )

    renderHook(() => useColorPlayheadAutoSelect())

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['upper'])
  })

  it('skips clips on hidden tracks', () => {
    seed(
      [makeClip('hidden', 't1', 0, 90), makeClip('shown', 't2', 0, 90)],
      [makeTrack('t1', 0, { visible: false }), makeTrack('t2', 1)],
    )

    renderHook(() => useColorPlayheadAutoSelect())

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['shown'])
  })

  it('leaves a manual selection alone while it spans the playhead', () => {
    seed(
      [makeClip('lower', 't2', 0, 90), makeClip('upper', 't1', 0, 90)],
      [makeTrack('t1', 0), makeTrack('t2', 1)],
    )
    renderHook(() => useColorPlayheadAutoSelect())

    act(() => {
      useSelectionStore.getState().selectItems(['lower'])
    })
    act(() => {
      usePlaybackStore.setState({ currentFrame: 30 })
    })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['lower'])
  })

  it('keeps the last selection while the playhead sits in a gap', () => {
    seed([makeClip('a', 't1', 0, 90)], [makeTrack('t1', 0)])
    renderHook(() => useColorPlayheadAutoSelect())

    act(() => {
      usePlaybackStore.setState({ currentFrame: 200 })
    })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['a'])
  })

  it('defers selection while scrubbing and catches up on release', () => {
    seed([makeClip('a', 't1', 0, 90), makeClip('b', 't1', 90, 90)], [makeTrack('t1', 0)])
    renderHook(() => useColorPlayheadAutoSelect())

    act(() => {
      usePlaybackStore.setState({ currentFrame: 120, previewFrame: 120 })
    })
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['a'])

    act(() => {
      usePlaybackStore.setState({ previewFrame: null })
    })
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['b'])
  })

  it('reselects after the selection is cleared', () => {
    seed([makeClip('a', 't1', 0, 90)], [makeTrack('t1', 0)])
    renderHook(() => useColorPlayheadAutoSelect())

    act(() => {
      useSelectionStore.getState().selectItems([])
    })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['a'])
  })
})
