// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '../../test-helpers'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useCompositionsStore } from '../compositions-store'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useMarkersStore } from '../markers-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import {
  setCompositionDuration,
  trimCompositionToActiveRegion,
} from './composition-duration-actions'

const COMP_ID = 'motion-comp'

/** A 600-frame layer comp whose single layer spans the whole canvas. */
function addComposition(durationInFrames = 600) {
  useCompositionsStore.getState().setCompositions([
    {
      id: COMP_ID,
      name: 'Motion title',
      editorKind: 'composite-2d',
      tracks: [makeTimelineTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
      items: [
        makeTimelineVideoItem({
          id: 'layer',
          trackId: 'comp-track-v1',
          durationInFrames: 600,
          sourceEnd: 600,
          sourceDuration: 600,
        }),
      ],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames,
    },
  ])
}

describe('setCompositionDuration', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
  })

  it('shortens a comp past its layers and undoes back', () => {
    addComposition()

    setCompositionDuration(COMP_ID, 240)

    // The layer still runs to 600; the canvas is authored, so 240 stands.
    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(240)

    useTimelineCommandStore.getState().undo()

    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(600)
  })

  it('rounds and floors the requested duration to a real frame count', () => {
    addComposition()

    setCompositionDuration(COMP_ID, 90.4)
    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(90)

    setCompositionDuration(COMP_ID, -12)
    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(1)

    setCompositionDuration(COMP_ID, Number.NaN)
    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(1)
  })

  it('pulls an active region back inside a comp that shrank', () => {
    addComposition()
    useCompositionNavigationStore.getState().enterComposition(COMP_ID, 'Motion title')
    useMarkersStore.getState().setInOutPoints(200, 600)

    setCompositionDuration(COMP_ID, 240)

    // Left where it was, the region would have exported frames past the comp end.
    expect(useMarkersStore.getState().inPoint).toBe(200)
    expect(useMarkersStore.getState().outPoint).toBe(240)
  })

  it('survives entering and leaving the composition', () => {
    addComposition()
    setCompositionDuration(COMP_ID, 240)

    const nav = useCompositionNavigationStore.getState()
    nav.enterComposition(COMP_ID, 'Motion title')
    useCompositionNavigationStore.getState().exitComposition()

    // Saving the comp back on exit used to extend the canvas to fit content,
    // which silently threw away the authored duration.
    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(240)
  })
})

describe('trimCompositionToActiveRegion', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
  })

  /** Enter a 600-frame comp holding three layers around a 200–400 region. */
  function openCompositionWithLayers() {
    useCompositionsStore.getState().setCompositions([
      {
        id: COMP_ID,
        name: 'Motion title',
        editorKind: 'composite-2d',
        tracks: [makeTimelineTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
        items: [
          // Straddles the in point: 100 → 300.
          makeTimelineVideoItem({
            id: 'straddles-in',
            trackId: 'comp-track-v1',
            from: 100,
            durationInFrames: 200,
            sourceStart: 0,
            sourceEnd: 200,
            sourceDuration: 600,
          }),
          // Fully inside: 250 → 350.
          makeTimelineVideoItem({
            id: 'inside',
            trackId: 'comp-track-v1',
            from: 250,
            durationInFrames: 100,
            sourceEnd: 100,
            sourceDuration: 600,
          }),
          // Entirely after the region: 450 → 550.
          makeTimelineVideoItem({
            id: 'after',
            trackId: 'comp-track-v1',
            from: 450,
            durationInFrames: 100,
            sourceEnd: 100,
            sourceDuration: 600,
          }),
        ],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 600,
      },
    ])
    useCompositionNavigationStore.getState().enterComposition(COMP_ID, 'Motion title')
    useMarkersStore.getState().setInOutPoints(200, 400)
  }

  it('rebases layers on the region and drops what falls outside', () => {
    openCompositionWithLayers()

    expect(trimCompositionToActiveRegion()).toBe(true)

    const itemById = useItemsStore.getState().itemById
    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(200)
    expect(itemById.after).toBeUndefined()
    // Fully inside: shifted back by the in point, untouched otherwise.
    expect(itemById.inside).toMatchObject({ from: 50, durationInFrames: 100 })
    // Straddling: head-trimmed to the region start, source window advanced with it.
    expect(itemById['straddles-in']).toMatchObject({
      from: 0,
      durationInFrames: 100,
      sourceStart: 100,
    })
    // The bar remains available, rebased and constrained to the trimmed comp.
    expect(useMarkersStore.getState().inPoint).toBe(0)
    expect(useMarkersStore.getState().outPoint).toBe(200)
  })

  it('rebases separated vector component lanes on a head-trimmed item', () => {
    openCompositionWithLayers()
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: 'straddles-in',
        separatedVectorProperties: ['position'],
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'x-before', frame: 50, value: 10, easing: 'linear' },
              { id: 'x-kept', frame: 125, value: 20, easing: 'linear' },
            ],
          },
          {
            property: 'y',
            keyframes: [
              { id: 'y-at-start', frame: 100, value: 30, easing: 'linear' },
              { id: 'y-kept', frame: 160, value: 40, easing: 'linear' },
            ],
          },
        ],
      },
    ])

    trimCompositionToActiveRegion()

    expect(useKeyframesStore.getState().keyframesByItemId['straddles-in']).toEqual({
      itemId: 'straddles-in',
      separatedVectorProperties: ['position'],
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'x-kept', frame: 25, value: 20, easing: 'linear' }],
        },
        {
          property: 'y',
          keyframes: [
            { id: 'y-at-start', frame: 0, value: 30, easing: 'linear' },
            { id: 'y-kept', frame: 60, value: 40, easing: 'linear' },
          ],
        },
      ],
    })
  })

  it('rebases markers inside the region and drops the rest', () => {
    openCompositionWithLayers()
    useMarkersStore.getState().setMarkers([
      { id: 'before', frame: 100, color: '#ff0000' },
      { id: 'inside', frame: 250, color: '#ff0000' },
      { id: 'after', frame: 500, color: '#ff0000' },
    ])

    trimCompositionToActiveRegion()

    expect(useMarkersStore.getState().markers).toEqual([
      { id: 'inside', frame: 50, color: '#ff0000' },
    ])
  })

  it('undoes as one step', () => {
    openCompositionWithLayers()
    trimCompositionToActiveRegion()

    useTimelineCommandStore.getState().undo()

    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.durationInFrames).toBe(600)
    expect(useItemsStore.getState().items).toHaveLength(3)
    expect(useMarkersStore.getState().outPoint).toBe(400)
  })

  it('declines without a region, and when the region already is the comp', () => {
    openCompositionWithLayers()
    useMarkersStore.getState().setInOutPoints(null, null)
    expect(trimCompositionToActiveRegion()).toBe(false)

    useMarkersStore.getState().setInOutPoints(0, 600)
    expect(trimCompositionToActiveRegion()).toBe(false)

    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})
