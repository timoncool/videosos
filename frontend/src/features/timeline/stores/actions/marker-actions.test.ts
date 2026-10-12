// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useCompositionsStore } from '../compositions-store'
import { useItemsStore } from '../items-store'
import { useMarkersStore } from '../markers-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  addMarker,
  clearAllMarkers,
  clearInOutPoints,
  removeMarker,
  setInOutPointsWithoutHistory,
  setInPoint,
  setOutPoint,
  updateMarker,
} from './marker-actions'

describe('marker actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    // Timeline content ends at frame 400 — past the 10s minimum floor
    // (getEffectiveTimelineMaxFrame clamps to at least MIN_TIMELINE_SECONDS * fps = 300)
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'a',
        durationInFrames: 400,
        sourceEnd: 400,
        sourceDuration: 600,
      }),
    ])
    useMarkersStore.getState().setMarkers([])
    useMarkersStore.getState().setInOutPoints(null, null)
  })

  describe('markers', () => {
    it('adds, updates, and removes a marker with undo entries', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      addMarker(30, '#ff0000', 'scene start')
      const marker = useMarkersStore.getState().markers[0]
      expect(marker).toMatchObject({ frame: 30, label: 'scene start' })
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      updateMarker(marker!.id, { label: 'renamed' })
      expect(useMarkersStore.getState().markers[0]?.label).toBe('renamed')

      removeMarker(marker!.id)
      expect(useMarkersStore.getState().markers).toHaveLength(0)

      useTimelineCommandStore.getState().undo()
      expect(useMarkersStore.getState().markers).toHaveLength(1)
    })

    it('clearAllMarkers removes every marker', () => {
      addMarker(10)
      addMarker(20)

      clearAllMarkers()

      expect(useMarkersStore.getState().markers).toHaveLength(0)
    })
  })

  describe('in/out points', () => {
    it('setInPoint defaults the out point to the timeline end', () => {
      setInPoint(30)

      expect(useMarkersStore.getState().inPoint).toBe(30)
      expect(useMarkersStore.getState().outPoint).toBe(400)
    })

    it('setInPoint clamps to the valid range', () => {
      setInPoint(-10)
      expect(useMarkersStore.getState().inPoint).toBe(0)

      setInPoint(500)
      expect(useMarkersStore.getState().inPoint).toBe(400)
    })

    it('placing the in point after the out point resets the out point to the end', () => {
      setOutPoint(40)
      setInPoint(60)

      expect(useMarkersStore.getState().inPoint).toBe(60)
      expect(useMarkersStore.getState().outPoint).toBe(400)
    })

    it('setOutPoint defaults the in point to 0', () => {
      setOutPoint(45)

      expect(useMarkersStore.getState().inPoint).toBe(0)
      expect(useMarkersStore.getState().outPoint).toBe(45)
    })

    it('placing the out point before the in point resets the in point to 0', () => {
      setInPoint(50)
      setOutPoint(20)

      expect(useMarkersStore.getState().inPoint).toBe(0)
      expect(useMarkersStore.getState().outPoint).toBe(20)
    })

    it('clearInOutPoints resets both', () => {
      setInPoint(10)
      setOutPoint(50)

      clearInOutPoints()

      expect(useMarkersStore.getState().inPoint).toBeNull()
      expect(useMarkersStore.getState().outPoint).toBeNull()
    })

    describe('inside a composition', () => {
      function openComposition(durationInFrames: number, contentFrames: number) {
        useCompositionsStore.getState().addComposition({
          id: 'comp-range',
          name: 'Motion title',
          editorKind: 'composite-2d',
          items: [
            makeTimelineVideoItem({
              id: 'layer',
              trackId: 'comp-track-v1',
              durationInFrames: contentFrames,
              sourceEnd: contentFrames,
              sourceDuration: 600,
            }),
          ],
          tracks: [makeTimelineTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
          transitions: [],
          keyframes: [],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames,
        })
        useCompositionNavigationStore.getState().enterComposition('comp-range', 'Motion title')
      }

      afterEach(() => {
        useCompositionNavigationStore.getState().resetToRoot()
        useCompositionsStore.getState().setCompositions([])
      })

      it('allows the range to reach the comp canvas end past the last layer', () => {
        openComposition(682, 400)

        setOutPoint(682)

        // Main's rule bounds by content extent, which would have clipped this to 400.
        expect(useMarkersStore.getState().outPoint).toBe(682)
      })

      it('bounds the range by a short comp instead of the 10s Main floor', () => {
        openComposition(120, 120)

        setOutPoint(300)

        expect(useMarkersStore.getState().outPoint).toBe(120)
      })
    })

    it('setInOutPointsWithoutHistory writes without undo entry or dirty flag', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      setInOutPointsWithoutHistory(10, 50)

      expect(useMarkersStore.getState().inPoint).toBe(10)
      expect(useMarkersStore.getState().outPoint).toBe(50)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
    })
  })
})
