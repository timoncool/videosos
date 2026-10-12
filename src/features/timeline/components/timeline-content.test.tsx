import { createRef, type ReactNode } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineTrack, VideoItem } from '@/types/timeline'

import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { setTimelineState } from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'
import { TIMELINE_RULER_HEIGHT, ZOOM_MAX, ZOOM_MIN } from '../constants'
import { TimelineContent } from './timeline-content'
import { getTimelineZoomInteractionShieldBounds } from '../utils/timeline-zoom-interaction-shield'
import { TIMELINE_LIVE_SCROLL_EVENT } from '@/shared/timeline/live-scroll-sync'

const perfMarkMocks = vi.hoisted(() => ({
  mark: vi.fn(),
}))
const marqueeMocks = vi.hoisted(() => ({
  onGestureEnd: undefined as ((event: MouseEvent, wasActualDrag: boolean) => void) | undefined,
}))

vi.mock('@/shared/logging/perf-marks', () => ({
  perfMarkRender: perfMarkMocks.mark,
  withPerfMeasure: (_name: string, callback: () => unknown) => callback(),
}))

vi.mock('@/shared/marquee/use-marquee-selection', () => {
  const INACTIVE = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }
  return {
    useMarqueeSelection: (options: {
      onGestureEnd?: (event: MouseEvent, wasActualDrag: boolean) => void
    }) => {
      marqueeMocks.onGestureEnd = options.onGestureEnd
      return {
        isActive: false,
        marquee: {
          subscribe: () => () => {},
          getSnapshot: () => INACTIVE,
        },
        selectedIds: [],
      }
    },
  }
})

vi.mock('../hooks/use-waveform-prefetch', () => ({
  useWaveformPrefetch: () => {},
}))

vi.mock('./timeline-markers', () => ({
  TimelineMarkers: () => null,
  IO_LANE_HEIGHT: 12,
}))

vi.mock('./timeline-playhead', () => ({
  TimelinePlayhead: () => <div data-testid="unified-timeline-playhead" />,
}))

vi.mock('./timeline-preview-scrubber', () => ({
  TimelinePreviewScrubber: () => <div data-testid="unified-timeline-preview-scrubber" />,
}))

vi.mock('./timeline-track', async () => {
  const { useState } = await import('react')
  const { createTimelineTrackContentLayerRef } = await import('../utils/timeline-live-geometry')

  return {
    TimelineTrack: ({ track }: { track: { id: string; height: number } }) => {
      const [contentLayerRef] = useState(createTimelineTrackContentLayerRef)

      return (
        <div data-track-id={track.id} style={{ height: `${track.height}px` }}>
          <div ref={contentLayerRef} data-timeline-track-content-layer />
        </div>
      )
    },
  }
})

vi.mock('./timeline-guidelines', () => ({
  TimelineGuidelines: () => null,
}))

vi.mock('./timeline-media-drop-zone', () => ({
  TimelineMediaDropZone: () => null,
}))

vi.mock('./track-row-frame', () => ({
  FirstTrackRowFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TrackRowFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TrackSectionDivider: () => null,
}))

vi.mock('@/shared/marquee/marquee-overlay', () => ({
  MarqueeOverlay: () => null,
}))

const VIDEO_TRACK: TimelineTrack = {
  id: 'track-video-1',
  name: 'V1',
  kind: 'video',
  height: 72,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
}

const VIDEO_ITEM: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: VIDEO_TRACK.id,
  from: 0,
  durationInFrames: 90,
  label: 'clip.mp4',
  src: 'blob:clip-video-1',
  mediaId: 'media-video-1',
}

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
  }

  if (!globalThis.requestIdleCallback) {
    globalThis.requestIdleCallback = ((callback: IdleRequestCallback) => {
      return window.setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => 0,
        })
      }, 0)
    }) as typeof requestIdleCallback
  }

  if (!globalThis.cancelIdleCallback) {
    globalThis.cancelIdleCallback = ((id: number) => {
      window.clearTimeout(id)
    }) as typeof cancelIdleCallback
  }
})

function resetStores() {
  _resetZoomStoreForTest()
  useEditorStore.setState({
    linkedSelectionEnabled: true,
    transcriptionDialogDepth: 0,
  })

  useSelectionStore.setState({
    selectedItemIds: [],
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: null,
    activeTool: 'select',
    dragState: null,
    expandedKeyframeLanes: new Set<string>(),
    editKeyframePanelOpen: false,
  })

  resetPlaybackPreviewState()

  setTimelineState({
    fps: 30,
    items: [VIDEO_ITEM],
    tracks: [VIDEO_TRACK],
    transitions: [],
    keyframes: [],
    markers: [],
    inPoint: null,
    outPoint: null,
    scrollPosition: 0,
    snapEnabled: true,
    isDirty: false,
  })

  _resetViewportThrottle()
  useTimelineViewportStore.setState({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  })
}

describe('TimelineContent playback selection behavior', () => {
  beforeEach(() => {
    resetStores()
    marqueeMocks.onGestureEnd = undefined
  })

  it('renders one full-height playhead and one tool-only preview overlay', () => {
    const { container, getAllByTestId, getByTestId } = render(
      <TimelineContent duration={10} tracks={[VIDEO_TRACK]} />,
    )

    expect(getAllByTestId('unified-timeline-playhead')).toHaveLength(1)
    expect(getAllByTestId('unified-timeline-preview-scrubber')).toHaveLength(1)
    expect(getByTestId('unified-timeline-preview-scrubber')).toBeInTheDocument()
    expect(container.querySelector('.timeline-container')).toHaveClass('isolate')
  })

  it('keeps the selected clip selected after the playhead moves past it', async () => {
    render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)

    act(() => {
      useSelectionStore.getState().selectItems([VIDEO_ITEM.id])
      usePlaybackStore.getState().setCurrentFrame(30)
    })

    expect(useSelectionStore.getState().selectedItemIds).toEqual([VIDEO_ITEM.id])

    act(() => {
      usePlaybackStore
        .getState()
        .setCurrentFrame(VIDEO_ITEM.from + VIDEO_ITEM.durationInFrames + 15)
    })

    await waitFor(() => {
      expect(useSelectionStore.getState().selectedItemIds).toEqual([VIDEO_ITEM.id])
    })
  })

  it('does not re-render the full timeline tree for live or settled gesture zoom', () => {
    render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)
    perfMarkMocks.mark.mockClear()

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(1.5)
    })

    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('TimelineContent')

    act(() => {
      useZoomStore.setState({
        contentLevel: 1.5,
        contentPixelsPerSecond: 150,
        isZoomInteracting: false,
      })
    })

    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('TimelineContent')
  })

  it('steps zoom buttons multiplicatively while preserving the playhead anchor', () => {
    let zoomHandlers:
      | {
          handleZoomIn: () => void
          handleZoomOut: () => void
        }
      | undefined

    useZoomStore.getState().setZoomLevelSynchronized(ZOOM_MIN)
    usePlaybackStore.getState().setCurrentFrame(150)

    const { container } = render(
      <TimelineContent
        duration={10}
        tracks={[VIDEO_TRACK]}
        onZoomHandlersReady={(handlers) => {
          zoomHandlers = handlers
        }}
      />,
    )
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')
    if (!(scrollContainer instanceof HTMLDivElement) || !zoomHandlers) {
      throw new Error('Expected timeline scroll container and zoom handlers')
    }
    scrollContainer.scrollLeft = 2

    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    act(() => zoomHandlers?.handleZoomIn())
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))

    expect(useZoomStore.getState().level).toBeCloseTo(0.011)
    expect(useZoomStore.getState().level).not.toBeCloseTo(0.11)
    expect(scrollContainer.scrollLeft).toBeCloseTo(2.5)

    act(() => zoomHandlers?.handleZoomOut())
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))

    expect(useZoomStore.getState().level).toBeCloseTo(ZOOM_MIN)
    expect(scrollContainer.scrollLeft).toBeCloseTo(2)

    animationFrameSpy.mockRestore()
  })

  it('keeps zoom buttons within the production zoom limits', () => {
    let zoomHandlers:
      | {
          handleZoomIn: () => void
          handleZoomOut: () => void
        }
      | undefined

    render(
      <TimelineContent
        duration={10}
        tracks={[VIDEO_TRACK]}
        onZoomHandlersReady={(handlers) => {
          zoomHandlers = handlers
        }}
      />,
    )
    if (!zoomHandlers) {
      throw new Error('Expected zoom handlers')
    }

    const animationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')

    act(() => useZoomStore.getState().setZoomLevelSynchronized(ZOOM_MIN))
    act(() => zoomHandlers?.handleZoomOut())
    expect(useZoomStore.getState().level).toBe(ZOOM_MIN)
    expect(animationFrameSpy).not.toHaveBeenCalled()

    act(() => useZoomStore.getState().setZoomLevelSynchronized(ZOOM_MAX))
    act(() => zoomHandlers?.handleZoomIn())
    expect(useZoomStore.getState().level).toBe(ZOOM_MAX)
    expect(animationFrameSpy).not.toHaveBeenCalled()

    animationFrameSpy.mockRestore()
  })

  it('applies live zoom and its cursor-anchor scroll in the same animation frame', () => {
    const { container, unmount } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')

    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll container')
    }
    const committedSurface = container.querySelector(
      '[data-timeline-committed-surface="tracks"]',
    ) as HTMLDivElement
    const contentLayer = committedSurface.querySelector(
      '[data-timeline-track-content-layer]',
    ) as HTMLDivElement
    const trackNode = container.querySelector(`[data-track-id="${VIDEO_TRACK.id}"]`)
    const liveScroll = vi.fn()
    scrollContainer.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, liveScroll)

    const liveRectRead = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: liveRectRead,
    })

    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    fireEvent.wheel(scrollContainer, {
      clientX: 200,
      clientY: 100,
      ctrlKey: true,
      deltaY: -120,
    })

    expect(frameCallbacks).toHaveLength(1)
    expect(useZoomStore.getState().level).toBe(1)
    expect(scrollContainer.scrollLeft).toBe(0)
    expect(liveRectRead).not.toHaveBeenCalled()

    act(() => {
      frameCallbacks.shift()?.(performance.now())
    })

    expect(useZoomStore.getState().level).toBeCloseTo(1.15)
    expect(scrollContainer.scrollLeft).toBeCloseTo(30)
    expect(useTimelineViewportStore.getState().scrollLeft).toBeCloseTo(30)
    expect(liveScroll).toHaveBeenCalledOnce()
    expect(frameCallbacks).toHaveLength(0)
    expect(container.querySelector('[data-timeline-committed-surface="tracks"]')).toBe(
      committedSurface,
    )
    expect(container.querySelector(`[data-track-id="${VIDEO_TRACK.id}"]`)).toBe(trackNode)
    expect(committedSurface.style.transform).toBe('none')
    expect(contentLayer.style.width).toBe('1150px')
    expect(
      Number.parseFloat(committedSurface.style.getPropertyValue('--timeline-percent-per-frame')),
    ).toBeCloseTo(100 / (10 * 30))
    expect(committedSurface.style.getPropertyValue('--timeline-px-per-frame')).toBe('')

    unmount()
    animationFrameSpy.mockRestore()
  })

  it('notifies linked panels inside each horizontal momentum frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const { container, unmount } = render(<TimelineContent duration={100} tracks={[VIDEO_TRACK]} />)
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')
    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll container')
    }
    const liveScroll = vi.fn()
    scrollContainer.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, liveScroll)

    fireEvent.wheel(scrollContainer, { deltaY: 120 })
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))

    expect(scrollContainer.scrollLeft).toBeGreaterThan(0)
    expect(liveScroll).toHaveBeenCalledOnce()

    unmount()
    animationFrameSpy.mockRestore()
  })

  it('preserves the mouse pivot when wheel-zooming immediately after zoom to fit', () => {
    let zoomToFit: (() => void) | undefined
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const { container, unmount } = render(
      <TimelineContent
        duration={100}
        tracks={[VIDEO_TRACK]}
        onZoomHandlersReady={(handlers) => {
          zoomToFit = handlers.handleZoomToFit
        }}
      />,
    )
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')
    if (!(scrollContainer instanceof HTMLDivElement) || !zoomToFit) {
      throw new Error('Expected timeline scroll container and zoom handlers')
    }
    Object.defineProperty(scrollContainer, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    act(() => window.dispatchEvent(new Event('resize')))
    act(() => zoomToFit?.())
    expect(useZoomStore.getState().level).toBeCloseTo(0.35)
    expect(scrollContainer.scrollLeft).toBe(0)

    fireEvent.wheel(scrollContainer, {
      clientX: 300,
      clientY: 100,
      ctrlKey: true,
      deltaY: -120,
    })
    act(() => {
      frameCallbacks.shift()?.(performance.now())
    })

    expect(useZoomStore.getState().level).toBeCloseTo(0.4025)
    expect(scrollContainer.scrollLeft).toBeCloseTo(45)

    fireEvent.wheel(scrollContainer, {
      clientX: 300,
      clientY: 100,
      ctrlKey: true,
      deltaY: -120,
    })
    act(() => {
      frameCallbacks.shift()?.(performance.now())
      frameCallbacks.shift()?.(performance.now())
    })

    expect(useZoomStore.getState().level).toBeCloseTo(0.463)
    expect(scrollContainer.scrollLeft).toBeCloseTo(96.75)

    unmount()
    animationFrameSpy.mockRestore()
  })

  it('does not update the hover scrub preview while the transcription dialog is open', async () => {
    const { container } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')

    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll container')
    }

    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    act(() => {
      useEditorStore.setState({ transcriptionDialogDepth: 1 })
      usePlaybackStore.getState().setPreviewFrame(12)
    })

    fireEvent.mouseMove(scrollContainer, { clientX: 180, clientY: 48 })

    expect(usePlaybackStore.getState().previewFrame).toBeNull()
  })

  it('cancels a queued hover preview when cursor-anchored zoom starts', () => {
    let nextFrameId = 1
    const scheduledFrames = new Map<number, FrameRequestCallback>()
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const id = nextFrameId++
        scheduledFrames.set(id, callback)
        return id
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id) => {
        scheduledFrames.delete(id)
      })

    const { container, unmount } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')
    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll container')
    }

    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    scheduledFrames.clear()

    fireEvent.mouseMove(scrollContainer, { clientX: 180, clientY: 48 })
    const previewFrameId = [...scheduledFrames.keys()].at(-1)
    expect(previewFrameId).toBeDefined()

    fireEvent.wheel(scrollContainer, {
      clientX: 180,
      clientY: 48,
      ctrlKey: true,
      deltaY: -120,
    })

    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(previewFrameId)
    act(() => {
      for (const [id, callback] of [...scheduledFrames]) {
        scheduledFrames.delete(id)
        callback(performance.now())
      }
    })
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(useZoomStore.getState().level).toBeGreaterThan(1)

    unmount()
    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('gives dense timelines a short window to cancel hover preview before zoom', () => {
    vi.useFakeTimers()
    const denseItems = Array.from({ length: 80 }, (_, index) => ({
      ...VIDEO_ITEM,
      id: `clip-video-${index}`,
      from: index * VIDEO_ITEM.durationInFrames,
    }))
    act(() => {
      useItemsStore.getState().setItems(denseItems)
    })

    let nextFrameId = 1
    const scheduledFrames = new Map<number, FrameRequestCallback>()
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const id = nextFrameId++
        scheduledFrames.set(id, callback)
        return id
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id) => {
        scheduledFrames.delete(id)
      })

    const { container, unmount } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')
    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll container')
    }
    const zoomInteractionShield = container.querySelector<HTMLElement>(
      '[data-timeline-zoom-interaction-shield]',
    )
    expect(zoomInteractionShield).not.toBeNull()
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    scheduledFrames.clear()

    fireEvent.mouseMove(scrollContainer, { clientX: 180, clientY: 48 })
    expect(scheduledFrames.size).toBe(0)

    fireEvent.wheel(scrollContainer, {
      clientX: 180,
      clientY: 48,
      ctrlKey: true,
      deltaY: -120,
    })
    expect(zoomInteractionShield!.style.display).toBe('block')
    expect(zoomInteractionShield).toHaveAttribute('data-marquee-ignore')
    expect(
      getTimelineZoomInteractionShieldBounds({ left: 0, top: 0, width: 400, height: 200 }),
    ).toEqual({
      left: 0,
      top: TIMELINE_RULER_HEIGHT,
      width: 400,
      height: 200 - TIMELINE_RULER_HEIGHT,
    })
    const zoomFrameCount = scheduledFrames.size
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(scheduledFrames.size).toBe(zoomFrameCount)

    act(() => {
      for (const [id, callback] of [...scheduledFrames]) {
        scheduledFrames.delete(id)
        callback(performance.now())
      }
    })
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(useZoomStore.getState().level).toBeGreaterThan(1)
    expect(zoomInteractionShield!.style.display).toBe('block')

    act(() => {
      useZoomStore.setState({ isZoomInteracting: false })
    })
    expect(zoomInteractionShield!.style.display).toBe('none')

    unmount()
    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
    vi.useRealTimers()
  })

  it('reveals the active track when selection moves to an offscreen lane', async () => {
    const videoTracks: TimelineTrack[] = [
      { ...VIDEO_TRACK, id: 'track-video-1', name: 'V1', order: 0 },
      { ...VIDEO_TRACK, id: 'track-video-2', name: 'V2', order: 1 },
      { ...VIDEO_TRACK, id: 'track-video-3', name: 'V3', order: 2 },
    ]

    setTimelineState({
      tracks: videoTracks,
      items: [],
    })

    const allTracksScrollRef = createRef<HTMLDivElement>()
    const { container } = render(
      <TimelineContent
        duration={10}
        tracks={videoTracks}
        allTracksScrollRef={allTracksScrollRef}
      />,
    )
    const scrollContainer =
      allTracksScrollRef.current ??
      (container.querySelector('[data-track-section-scroll="video"]') as HTMLDivElement | null)
    expect(scrollContainer).toBeTruthy()

    const trackElements = Array.from(container.querySelectorAll<HTMLElement>('[data-track-id]'))
    expect(trackElements).toHaveLength(3)

    Object.defineProperty(scrollContainer!, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    scrollContainer!.scrollTop = 120
    vi.spyOn(scrollContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect)

    const trackRects = new Map<string, DOMRect>([
      [
        'track-video-1',
        {
          x: 0,
          y: -120,
          left: 0,
          top: -120,
          right: 200,
          bottom: -48,
          width: 200,
          height: 72,
          toJSON: () => ({}),
        } as DOMRect,
      ],
      [
        'track-video-2',
        {
          x: 0,
          y: -48,
          left: 0,
          top: -48,
          right: 200,
          bottom: 24,
          width: 200,
          height: 72,
          toJSON: () => ({}),
        } as DOMRect,
      ],
      [
        'track-video-3',
        {
          x: 0,
          y: 24,
          left: 0,
          top: 24,
          right: 200,
          bottom: 96,
          width: 200,
          height: 72,
          toJSON: () => ({}),
        } as DOMRect,
      ],
    ])

    for (const element of trackElements) {
      const trackId = element.getAttribute('data-track-id')
      const rect = trackId ? trackRects.get(trackId) : null
      expect(rect).toBeTruthy()
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect!)
    }

    act(() => {
      useSelectionStore.getState().setActiveTrack('track-video-1')
    })

    await waitFor(() => {
      expect(scrollContainer!.scrollTop).toBe(0)
    })
  })

  it('reveals the active track through the split-pane video scroll ref', async () => {
    const tracks: TimelineTrack[] = [
      { ...VIDEO_TRACK, id: 'track-video-1', name: 'V1', order: 0 },
      { ...VIDEO_TRACK, id: 'track-video-2', name: 'V2', order: 1 },
      { ...VIDEO_TRACK, id: 'track-video-3', name: 'V3', order: 2 },
      {
        ...VIDEO_TRACK,
        id: 'track-audio-1',
        name: 'A1',
        kind: 'audio',
        order: 3,
      },
    ]

    setTimelineState({
      tracks,
      items: [],
    })

    const videoTracksScrollRef = createRef<HTMLDivElement>()
    const audioTracksScrollRef = createRef<HTMLDivElement>()
    const { container } = render(
      <TimelineContent
        duration={10}
        tracks={tracks}
        videoTracksScrollRef={videoTracksScrollRef}
        audioTracksScrollRef={audioTracksScrollRef}
      />,
    )
    const videoScrollContainer =
      videoTracksScrollRef.current ??
      (container.querySelector('[data-track-section-scroll="video"]') as HTMLDivElement | null)
    const audioScrollContainer =
      audioTracksScrollRef.current ??
      (container.querySelector('[data-track-section-scroll="audio"]') as HTMLDivElement | null)
    expect(videoScrollContainer).toBeTruthy()
    expect(audioScrollContainer).toBeTruthy()

    const videoTrackElements = Array.from(
      videoScrollContainer!.querySelectorAll<HTMLElement>('[data-track-id]'),
    )
    expect(videoTrackElements).toHaveLength(3)

    Object.defineProperty(videoScrollContainer!, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    videoScrollContainer!.scrollTop = 120
    audioScrollContainer!.scrollTop = 55
    vi.spyOn(videoScrollContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect)

    const trackRects = new Map<string, DOMRect>([
      [
        'track-video-1',
        {
          x: 0,
          y: -120,
          left: 0,
          top: -120,
          right: 200,
          bottom: -48,
          width: 200,
          height: 72,
          toJSON: () => ({}),
        } as DOMRect,
      ],
      [
        'track-video-2',
        {
          x: 0,
          y: -48,
          left: 0,
          top: -48,
          right: 200,
          bottom: 24,
          width: 200,
          height: 72,
          toJSON: () => ({}),
        } as DOMRect,
      ],
      [
        'track-video-3',
        {
          x: 0,
          y: 24,
          left: 0,
          top: 24,
          right: 200,
          bottom: 96,
          width: 200,
          height: 72,
          toJSON: () => ({}),
        } as DOMRect,
      ],
    ])

    for (const element of videoTrackElements) {
      const trackId = element.getAttribute('data-track-id')
      const rect = trackId ? trackRects.get(trackId) : null
      expect(rect).toBeTruthy()
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect!)
    }

    act(() => {
      useSelectionStore.getState().setActiveTrack('track-video-1')
    })

    await waitFor(() => {
      expect(videoScrollContainer!.scrollTop).toBe(0)
    })
    expect(audioScrollContainer!.scrollTop).toBe(55)
  })

  it('does not clear previewFrame on ruler mousedown before the ruler handler runs', () => {
    const { container } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(24)
    })

    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement | null
    expect(ruler).toBeTruthy()

    fireEvent.mouseDown(ruler!, { button: 0 })

    expect(usePlaybackStore.getState().previewFrame).toBe(24)
  })

  it('locks the skim preview from track mousedown until the marquee gesture ends', () => {
    const { container } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />)

    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(90)
      usePlaybackStore.getState().setPreviewFrame(24)
    })

    const track = container.querySelector(`[data-track-id="${VIDEO_TRACK.id}"]`)
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]')
    expect(track).toBeTruthy()
    expect(scrollContainer).toBeTruthy()

    vi.spyOn(scrollContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.mouseDown(track!, { button: 0, clientX: 80, clientY: 100 })
    document.body.style.userSelect = 'none'
    fireEvent.mouseMove(track!, { clientX: 180, clientY: 100 })
    fireEvent.mouseLeave(scrollContainer!)

    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(performance.now()))
    })

    expect(usePlaybackStore.getState().currentFrame).toBe(90)
    expect(usePlaybackStore.getState().previewFrame).toBe(24)

    document.body.style.userSelect = ''
    act(() => {
      marqueeMocks.onGestureEnd?.(
        new MouseEvent('mouseup', { button: 0, clientX: 180, clientY: 100 }),
        true,
      )
    })
    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(performance.now()))
    })
    expect(usePlaybackStore.getState().previewFrame).not.toBe(24)

    const releaseFrame = usePlaybackStore.getState().previewFrame
    frameCallbacks.length = 0
    fireEvent.mouseMove(track!, { clientX: 220, clientY: 100 })
    expect(frameCallbacks.length).toBeGreaterThan(0)

    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(performance.now()))
    })

    expect(usePlaybackStore.getState().previewFrame).not.toBe(releaseFrame)
    animationFrameSpy.mockRestore()
  })
})
