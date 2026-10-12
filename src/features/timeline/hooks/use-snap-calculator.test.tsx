import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, renderHook } from '@testing-library/react'
import { makeTimelineTrack, makeTimelineVideoItem } from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useZoomStore } from '../stores/zoom-store'
import { useSnapCalculator } from './use-snap-calculator'

const TIMELINE_DURATION = 60

function setupStores() {
  useTimelineSettingsStore.setState({ fps: 30, snapEnabled: true })
  useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: 'dragged', from: 0, durationInFrames: 10 }),
      makeTimelineVideoItem({ id: 'target', from: 20, durationInFrames: 10 }),
    ])
  useTransitionsStore.getState().setTransitions([])
}

describe('useSnapCalculator', () => {
  beforeEach(setupStores)
  afterEach(() => vi.restoreAllMocks())

  it('does not read the timeline or subscribe to stores when mounted', () => {
    const getItemsState = vi.spyOn(useItemsStore, 'getState')
    const getTransitionsState = vi.spyOn(useTransitionsStore, 'getState')
    const getZoomState = vi.spyOn(useZoomStore, 'getState')
    const subscribeToItems = vi.spyOn(useItemsStore, 'subscribe')
    const subscribeToSettings = vi.spyOn(useTimelineSettingsStore, 'subscribe')
    let renderCount = 0

    const { result } = renderHook(() => {
      renderCount += 1
      return useSnapCalculator(TIMELINE_DURATION, 'dragged')
    })

    expect(getItemsState).not.toHaveBeenCalled()
    expect(getTransitionsState).not.toHaveBeenCalled()
    expect(getZoomState).not.toHaveBeenCalled()
    expect(subscribeToItems).not.toHaveBeenCalled()
    expect(subscribeToSettings).not.toHaveBeenCalled()

    act(() => {
      useTimelineSettingsStore.getState().setSnapEnabled(false)
    })

    expect(renderCount).toBe(1)
    expect(result.current.isSnapEnabled()).toBe(false)

    const targets = result.current.getMagneticSnapTargets()
    expect(getItemsState).toHaveBeenCalledTimes(1)
    expect(getTransitionsState).toHaveBeenCalledTimes(1)
    expect(getZoomState).not.toHaveBeenCalled()
    expect(targets).toHaveLength(2)
  })

  it('uses the default exclusion but can include originals for Alt-drag', () => {
    const { result } = renderHook(() => useSnapCalculator(TIMELINE_DURATION, 'dragged'))

    expect(result.current.getMagneticSnapTargets()).toEqual([
      { frame: 20, type: 'item-start', itemId: 'target' },
      { frame: 30, type: 'item-end', itemId: 'target' },
    ])

    expect(result.current.getMagneticSnapTargets(null)).toEqual([
      { frame: 0, type: 'item-start', itemId: 'dragged' },
      { frame: 10, type: 'item-end', itemId: 'dragged' },
      { frame: 20, type: 'item-start', itemId: 'target' },
      { frame: 30, type: 'item-end', itemId: 'target' },
    ])
  })

  it('accepts the active gesture cohort as an exclusion override', () => {
    const { result } = renderHook(() => useSnapCalculator(TIMELINE_DURATION, 'dragged'))

    expect(result.current.getMagneticSnapTargets(['dragged', 'target'])).toEqual([])
  })
})
