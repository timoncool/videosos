// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useMarkersStore } from '../markers-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { clearTimeline, markClean, markDirty, toggleSnap } from './settings-actions'

describe('settings actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false, snapEnabled: true })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([makeTimelineVideoItem({ id: 'a' })])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useMarkersStore.getState().setMarkers([])
    useMarkersStore.getState().setInOutPoints(null, null)
  })

  it('toggleSnap flips the snap setting with an undo entry', () => {
    const undoDepth = useTimelineCommandStore.getState().undoStack.length

    toggleSnap()
    expect(useTimelineSettingsStore.getState().snapEnabled).toBe(false)
    expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

    useTimelineCommandStore.getState().undo()
    expect(useTimelineSettingsStore.getState().snapEnabled).toBe(true)
  })

  it('markDirty / markClean flip the dirty flag without undo entries', () => {
    const undoDepth = useTimelineCommandStore.getState().undoStack.length

    markDirty()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    markClean()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
    expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
  })

  it('clearTimeline empties every domain store and the undo history', () => {
    useKeyframesStore.getState()._addKeyframe('a', 'opacity', 0, 1)
    useMarkersStore.getState().addMarker(10)
    useMarkersStore.getState().setInOutPoints(0, 30)
    // Generate some history first
    toggleSnap()
    expect(useTimelineCommandStore.getState().undoStack.length).toBeGreaterThan(0)

    clearTimeline()

    expect(useItemsStore.getState().items).toHaveLength(0)
    expect(useItemsStore.getState().tracks).toHaveLength(0)
    expect(useTransitionsStore.getState().transitions).toHaveLength(0)
    expect(useKeyframesStore.getState().keyframes).toHaveLength(0)
    expect(useMarkersStore.getState().markers).toHaveLength(0)
    expect(useMarkersStore.getState().inPoint).toBeNull()
    expect(useMarkersStore.getState().outPoint).toBeNull()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})
