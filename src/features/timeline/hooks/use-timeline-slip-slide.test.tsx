import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, renderHook } from '@testing-library/react'
import type { CompositionItem, TimelineItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineTrack, makeTimelineVideoItem } from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store'
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineSlipSlide } from './use-timeline-slip-slide'

const TIMELINE_DURATION = 600

// Mouse-move handling is RAF-coalesced, so tests flush pending frame callbacks
// after dispatching a move event.
let rafCallbacks: FrameRequestCallback[] = []

/**
 * Zoom is pinned so 1 px == 1 frame: pixelsPerSecond 30 at 30 fps means
 * deltaFrames === deltaX in every gesture below.
 */
function setupStores(snapEnabled: boolean) {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false, snapEnabled })
  useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'track-v2', name: 'V2', kind: 'video', order: 1 }),
    ])
  useItemsStore.getState().setItems([])
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useEditorStore.setState({ linkedSelectionEnabled: false })
  useSelectionStore.getState().setDragState(null)
  useSelectionStore.getState().setActiveSnapTarget(null)
  useSlipEditPreviewStore.getState().clearPreview()
  useSlideEditPreviewStore.getState().clearPreview()
  useLinkedEditPreviewStore.getState().clear()
  resetPlaybackPreviewState()
}

function makeSlideItems(): {
  left: CompositionItem
  center: CompositionItem
  right: CompositionItem
} {
  const makeCompositionItem = (overrides: Partial<CompositionItem> = {}): CompositionItem => ({
    id: 'composition-item',
    type: 'composition',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 60,
    label: 'Compound Clip',
    compositionId: 'composition-1',
    compositionWidth: 1920,
    compositionHeight: 1080,
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 180,
    sourceFps: 30,
    ...overrides,
  })

  return {
    left: makeCompositionItem({
      id: 'left',
      from: 0,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 180,
    }),
    center: makeCompositionItem({
      id: 'center',
      from: 60,
      sourceStart: 30,
      sourceEnd: 90,
      sourceDuration: 180,
    }),
    right: makeCompositionItem({
      id: 'right',
      from: 120,
      sourceStart: 40,
      sourceEnd: 100,
      sourceDuration: 180,
    }),
  }
}

function getItem(id: string): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  expect(item).toBeDefined()
  return item as TimelineItem
}

function startSlide(result: { current: ReturnType<typeof useTimelineSlipSlide> }) {
  const event = {
    button: 0,
    clientX: 0,
    clientY: 0,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as React.MouseEvent

  act(() => {
    result.current.handleSlipSlideStart(event, 'slide')
  })
}

function moveMouse(clientX: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX }))
    const callbacks = rafCallbacks
    rafCallbacks = []
    for (const callback of callbacks) callback(performance.now())
  })
}

function releaseMouse() {
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

describe('useTimelineSlipSlide', () => {
  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
    setupStores(false)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('preserves slide bounds and enables snapping when snap is toggled on mid-drag', () => {
    const { left, center, right } = makeSlideItems()
    const snapTarget = makeTimelineVideoItem({
      id: 'snap-target',
      trackId: 'track-v2',
      from: 82,
      durationInFrames: 10,
      sourceEnd: 10,
    })
    useItemsStore.getState().setItems([left, center, right, snapTarget])
    const { result } = renderHook(() => useTimelineSlipSlide(center, TIMELINE_DURATION))

    startSlide(result)
    moveMouse(10)

    expect(useSlideEditPreviewStore.getState()).toMatchObject({
      itemId: 'center',
      leftNeighborId: 'left',
      rightNeighborId: 'right',
      slideDelta: 10,
      minDelta: -40,
      maxDelta: 59,
    })

    act(() => {
      useTimelineSettingsStore.getState().toggleSnap()
    })

    expect(result.current.isSlipSlideActive).toBe(true)
    expect(useSelectionStore.getState().dragState).not.toBeNull()
    expect(useSlideEditPreviewStore.getState()).toMatchObject({
      itemId: 'center',
      leftNeighborId: 'left',
      rightNeighborId: 'right',
      slideDelta: 10,
      minDelta: -40,
      maxDelta: 59,
    })

    moveMouse(19)

    expect(useSlideEditPreviewStore.getState()).toMatchObject({
      itemId: 'center',
      slideDelta: 22,
      minDelta: -40,
      maxDelta: 59,
    })

    releaseMouse()

    expect(getItem('center').from).toBe(82)
    expect(useSlideEditPreviewStore.getState().itemId).toBeNull()
    expect(result.current.isSlipSlideActive).toBe(false)
  })

  it('commits the current slide when snap is toggled off before mouseup', () => {
    setupStores(true)
    const { left, center, right } = makeSlideItems()
    useItemsStore.getState().setItems([left, center, right])
    const { result } = renderHook(() => useTimelineSlipSlide(center, TIMELINE_DURATION))

    startSlide(result)
    moveMouse(10)

    act(() => {
      useTimelineSettingsStore.getState().toggleSnap()
    })
    releaseMouse()

    expect(getItem('center').from).toBe(70)
    expect(useSelectionStore.getState().dragState).toBeNull()
    expect(useSlideEditPreviewStore.getState().itemId).toBeNull()
    expect(result.current.isSlipSlideActive).toBe(false)
  })

  it('abandons the active preview when the timeline item unmounts', () => {
    const { left, center, right } = makeSlideItems()
    useItemsStore.getState().setItems([left, center, right])
    const { result, unmount } = renderHook(() => useTimelineSlipSlide(center, TIMELINE_DURATION))

    startSlide(result)
    moveMouse(10)
    expect(useSlideEditPreviewStore.getState().itemId).toBe('center')
    expect(useSelectionStore.getState().dragState).not.toBeNull()

    unmount()

    expect(useSlideEditPreviewStore.getState().itemId).toBeNull()
    expect(useSelectionStore.getState().dragState).toBeNull()
  })
})
