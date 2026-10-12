import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { TimelinePreviewScrubberVisual } from '@/shared/ui/timeline-preview-scrubber-visual'
import { DopesheetEditor } from './index'
import { DopesheetPlayheadLine } from './dopesheet-playhead-line'
import { PROPERTY_COLUMN_WIDTH } from './dopesheet-constants'
import {
  mainTimelineScrubActiveRef,
  mainTimelineScrubHandoffFrameRef,
  resetTimelineSkimmerScrubForTest,
  timelineSkimmerScrubSignal,
} from '@/shared/timeline/main-timeline-scrub'
import {
  TIMELINE_LIVE_SCROLL_EVENT,
  TIMELINE_SCRUB_VISUAL_FRAME_EVENT,
  notifyTimelineScrubVisualFrame,
} from '@/shared/timeline/live-scroll-sync'

describe('DopesheetEditor playhead overlay', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      isPlaying: false,
    })
    mainTimelineScrubActiveRef.current = false
    mainTimelineScrubHandoffFrameRef.current = null
    resetTimelineSkimmerScrubForTest()
  })

  it('skips playhead transform assignments until playback reaches the next pixel', () => {
    usePlaybackStore.setState({ isPlaying: true })
    render(
      <DopesheetPlayheadLine
        relativeFrame={0}
        itemFrom={0}
        totalFrames={100}
        frameToX={(frame) => Math.floor(frame / 2)}
        maxLeft={100}
      />,
    )
    const playhead = screen.getByTestId('dopesheet-playhead-line')
    expect(playhead).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' })

    let transform = playhead.style.transform
    const transformAssignments: string[] = []
    Object.defineProperty(playhead.style, 'transform', {
      configurable: true,
      get: () => transform,
      set: (value: string) => {
        transform = value
        transformAssignments.push(value)
      },
    })

    act(() => usePlaybackStore.setState({ currentFrame: 1 }))
    expect(transformAssignments).toEqual([])

    act(() => usePlaybackStore.setState({ currentFrame: 2 }))
    expect(transformAssignments).toEqual(['translate3d(1px, 0, 0)'])
  })

  it('clamps the playhead to the left edge when the current frame is before the viewport', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
      />,
    )

    const clip = screen.getByTestId('dopesheet-playhead-clip')
    const line = screen.getByTestId('dopesheet-playhead-line')

    // columnWidth (248) + 1px for the timeline cells' border-l.
    expect(clip).toHaveStyle({ left: '249px' })
    expect(clip).toHaveClass('overflow-hidden')
    // Playhead should be clamped to 0 (left edge), not negative
    expect(line).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' })
    expect(screen.getAllByTestId('dopesheet-playhead-line')).toHaveLength(1)
    expect(line.querySelectorAll('span')).toHaveLength(2)
  })

  it('removes the keyframe edge inset from the classic shared timeline axis', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('dopesheet-playhead-line')).toHaveStyle({
      transform: 'translate3d(0px, 0, 0)',
    })
  })

  it('uses the main viewport right edge for the classic shared playhead clamp', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={100}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    // 640px editor - 248px property column - 1px cell border leaves a 391px
    // viewport whose final visible pixel is x=390, matching the main ruler.
    expect(screen.getByTestId('dopesheet-playhead-line')).toHaveStyle({
      transform: 'translate3d(390px, 0, 0)',
    })
  })

  it('reserves the sheet scrollbar gutter across the ruler and playhead axis', () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'dopesheet-scroll-area' ? 628 : 0
      })

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={100}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('dopesheet-scroll-area')).toHaveStyle({
      right: '12px',
    })
    expect(screen.getByTestId('dopesheet-scrollbar')).toHaveClass(
      'right-0',
      'w-3',
      'bg-background/80',
    )
    expect(screen.getByTestId('dopesheet-ruler-scrollbar-gutter')).toHaveStyle({
      width: '12px',
    })
    expect(screen.getByTestId('dopesheet-playhead-line')).toHaveStyle({
      transform: 'translate3d(378px, 0, 0)',
    })

    clientWidthSpy.mockRestore()
  })

  it('shows the shared ruler in graph mode and defers the playhead to the graph', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
        visualizationMode="graph"
      />,
    )

    expect(screen.getByTestId('dopesheet-ruler')).toHaveClass('cursor-ew-resize')
    // In graph mode the dopesheet overlay playhead is not rendered — the graph
    // draws its own playhead (GraphPlayhead) in the graph's coordinate space.
    expect(screen.queryByTestId('dopesheet-playhead-line')).not.toBeInTheDocument()
  })

  it('lets the shared Edit ruler drag beyond the selected item bounds', () => {
    const onScrub = vi.fn()
    const onScrubStart = vi.fn()
    const onScrubEnd = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={50}
        frameViewport={{ startFrame: -100, endFrame: 100 }}
        clampViewportToContent={false}
        scrubClampToItemBounds={false}
        width={640}
        height={240}
        onScrub={onScrub}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 7, clientX: 294 })
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 350 })
    fireEvent.pointerUp(ruler, { pointerId: 7, clientX: 350 })

    expect(onScrubStart).toHaveBeenCalledOnce()
    expect(onScrub).toHaveBeenNthCalledWith(1, 52)
    expect(onScrub).toHaveBeenLastCalledWith(82)
    expect(onScrubEnd).toHaveBeenCalledOnce()
  })

  it('clamps shared Edit ruler scrubbing to the composition bounds', () => {
    const onScrub = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={50}
        frameViewport={{ startFrame: -100, endFrame: 200 }}
        clampViewportToContent={false}
        scrubClampToItemBounds={false}
        scrubFrameBounds={{ minFrame: -20, maxFrame: 80 }}
        width={640}
        height={240}
        onScrub={onScrub}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 17, clientX: 640 })
    fireEvent.pointerUp(ruler, { pointerId: 17, clientX: 640 })

    expect(onScrub).toHaveBeenCalledWith(80)
  })

  it('snaps the committed playhead to a primary ruler press before pointer movement', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onScrub={(frame) => usePlaybackStore.getState().setScrubFrame(frame, 'item-1')}
        onScrubEnd={() => usePlaybackStore.getState().setPreviewFrame(null)}
        onSkim={() => {}}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    const playhead = screen.getByTestId('dopesheet-playhead-line')
    const initialTransform = playhead.style.transform

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 8, clientX: 196 })

    expect(usePlaybackStore.getState().currentFrame).toBe(50)
    expect(playhead.style.transform).not.toBe(initialTransform)
    expect(playhead).toHaveStyle({ transform: 'translate3d(196px, 0, 0)' })

    fireEvent.pointerUp(ruler, { pointerId: 8, clientX: 196 })
    expect(playhead).toHaveStyle({ transform: 'translate3d(196px, 0, 0)' })
  })

  it('aligns the classic ruler pointer with the playhead after the cell border', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        presentation="classic"
        width={640}
        height={240}
        onScrub={(frame) => usePlaybackStore.getState().setScrubFrame(frame, 'item-1')}
        onSkim={() => {}}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 81, clientX: 196.5 })

    expect(usePlaybackStore.getState().currentFrame).toBe(50)
    expect(screen.getByTestId('dopesheet-playhead-line')).toHaveStyle({
      transform: 'translate3d(195.5px, 0, 0)',
    })

    fireEvent.pointerUp(ruler, { pointerId: 81, clientX: 196.5 })
  })

  it('auto-scrolls a linked timeline while the ruler pointer stays at the edge', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const onScrub = vi.fn()
    const onRulerEdgeScroll = vi.fn((deltaPixels: number) => deltaPixels)
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        scrubClampToItemBounds={false}
        presentation="classic"
        width={640}
        height={240}
        onScrub={onScrub}
        onRulerEdgeScroll={onRulerEdgeScroll}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 249,
      y: 0,
      left: 249,
      top: 0,
      right: 640,
      bottom: 22,
      width: 391,
      height: 22,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 9, clientX: 640 })
    expect(frameCallbacks).toHaveLength(1)

    act(() => frameCallbacks.shift()?.(16))
    expect(onRulerEdgeScroll).toHaveBeenCalledOnce()
    expect(onRulerEdgeScroll.mock.calls[0]?.[0]).toBeGreaterThan(0)

    // Flush the coalesced scrub produced by edge scrolling. The pointer has not
    // moved, but its frame advances as the linked viewport pans underneath it.
    act(() => frameCallbacks.shift()?.(32))
    expect(onScrub.mock.calls.length).toBeGreaterThan(1)
    expect(onScrub.mock.lastCall?.[0]).toBeGreaterThan(onScrub.mock.calls[0]?.[0])

    fireEvent.pointerUp(ruler, { pointerId: 9, clientX: 640 })
    animationFrameSpy.mockRestore()
  })

  it('keeps the playhead cursor-locked between an edge scroll and its queued scrub frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const scrollContainer = document.createElement('div')
    const timelineScrollContainerRef = { current: scrollContainer }
    const pixelsPerFrame = 391 / 100
    const onRulerEdgeScroll = vi.fn((deltaPixels: number) => {
      const appliedPixels = Math.min(deltaPixels, 12)
      scrollContainer.scrollLeft += appliedPixels
      scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))
      return appliedPixels
    })

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        scrubClampToItemBounds={false}
        presentation="classic"
        width={640}
        height={240}
        onScrub={(frame) => usePlaybackStore.getState().setScrubFrame(frame)}
        onRulerEdgeScroll={onRulerEdgeScroll}
        globalFrameToPixels={(frame) => frame * pixelsPerFrame - scrollContainer.scrollLeft}
        timelineScrollContainerRef={timelineScrollContainerRef}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 249,
      y: 0,
      left: 249,
      top: 0,
      right: 640,
      bottom: 22,
      width: 391,
      height: 22,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 91, clientX: 640 })
    const playhead = screen.getByTestId('dopesheet-playhead-line')
    const cursorLockedTransform = playhead.style.transform

    act(() => frameCallbacks.shift()?.(16))

    expect(onRulerEdgeScroll).toHaveBeenCalledOnce()
    expect(playhead.style.transform).toBe(cursorLockedTransform)

    fireEvent.pointerUp(ruler, { pointerId: 91, clientX: 640 })
    animationFrameSpy.mockRestore()
  })

  it('uses main-timeline wheel semantics in a standalone keyframe editor', () => {
    const onFrameViewportChange = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onFrameViewportChange={onFrameViewportChange}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.wheel(ruler, { deltaY: 120 })
    expect(onFrameViewportChange).toHaveBeenLastCalledWith({
      startFrame: 31,
      endFrame: 131,
    })

    onFrameViewportChange.mockClear()
    fireEvent.wheel(ruler, { deltaY: 120, shiftKey: true })
    expect(onFrameViewportChange).not.toHaveBeenCalled()

    fireEvent.wheel(ruler, { clientX: 196, deltaY: -120, ctrlKey: true })
    const zoomedViewport = onFrameViewportChange.mock.lastCall?.[0]
    expect(zoomedViewport.endFrame - zoomedViewport.startFrame).toBeLessThan(100)
  })

  it('routes linked keyframe wheel navigation through the main timeline handler', () => {
    const timeline = document.createElement('div')
    const forwardedEvents: WheelEvent[] = []
    timeline.addEventListener(
      'wheel',
      (event) => {
        forwardedEvents.push(event)
        event.preventDefault()
      },
      { passive: false },
    )
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        viewportInteractionEnabled={false}
        timelineScrollContainerRef={{ current: timeline }}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    const panEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 320,
      deltaY: 120,
    })
    act(() => ruler.dispatchEvent(panEvent))
    expect(panEvent.defaultPrevented).toBe(true)
    expect(forwardedEvents).toHaveLength(1)
    expect(forwardedEvents[0]).toMatchObject({
      clientX: 320,
      deltaY: 120,
      ctrlKey: false,
    })

    const zoomEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      deltaY: -120,
      ctrlKey: true,
    })
    act(() => ruler.dispatchEvent(zoomEvent))
    expect(forwardedEvents).toHaveLength(2)
    expect(forwardedEvents[1]).toMatchObject({
      clientX: 400,
      deltaY: -120,
      ctrlKey: true,
    })

    fireEvent.wheel(ruler, { deltaY: 120, shiftKey: true })
    expect(forwardedEvents).toHaveLength(2)
  })

  it('shows a separate skim playhead while keeping the committed playhead in place', () => {
    const onSkim = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={onSkim}
        globalFrameToPixels={() => 123.25}
      />,
    )

    const committed = screen.getByTestId('dopesheet-playhead-line')
    const committedTransform = committed.style.transform
    const skim = screen.getByTestId('timeline-preview-scrubber')

    act(() => usePlaybackStore.getState().setPreviewFrame(80, 'item-1'))

    expect(skim.style.display).toBe('')
    expect(skim.style.transform).toBe('translate3d(123.25px, 0, 0)')
    expect(committed.style.transform).toBe(committedTransform)

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 196 })
    expect(onSkim).toHaveBeenCalledWith(50)
    fireEvent.pointerLeave(ruler, { pointerId: 1, clientX: 196 })
    expect(onSkim).toHaveBeenLastCalledWith(null)
  })

  it('follows an active main timeline scrub without following ordinary hover previews', () => {
    const onSkim = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={onSkim}
      />,
    )

    const committed = screen.getByTestId('dopesheet-playhead-line')
    const initialTransform = committed.style.transform

    act(() => usePlaybackStore.getState().setPreviewFrame(40, 'item-1'))
    expect(committed.style.transform).toBe(initialTransform)

    mainTimelineScrubActiveRef.current = true
    act(() => usePlaybackStore.getState().setScrubFrame(60))
    expect(committed.style.transform).not.toBe(initialTransform)
    expect(mainTimelineScrubHandoffFrameRef.current).toBe(60)

    // The main timeline clears preview before ending the shared gesture. The
    // lower playhead must keep the final position rather than snapping back.
    const finalTransform = committed.style.transform
    act(() => usePlaybackStore.getState().setPreviewFrame(null))
    expect(mainTimelineScrubHandoffFrameRef.current).toBe(60)
    mainTimelineScrubActiveRef.current = false
    expect(committed.style.transform).toBe(finalTransform)
  })

  it('repositions the Edit playhead from the live scroll axis without a React render', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 20
    const timelineScrollContainerRef = { current: scrollContainer }
    const globalFrameToPixels = (globalFrame: number) => globalFrame - scrollContainer.scrollLeft

    act(() => usePlaybackStore.getState().setCurrentFrame(150))
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={50}
        playheadFrame={50}
        playheadClampToItemBounds={false}
        itemFrom={100}
        totalFrames={100}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={() => {}}
        globalFrameToPixels={globalFrameToPixels}
        timelineScrollContainerRef={timelineScrollContainerRef}
      />,
    )

    const committed = screen.getByTestId('dopesheet-playhead-line')
    expect(committed).toHaveStyle({ transform: 'translate3d(130px, 0, 0)' })

    scrollContainer.scrollLeft = 60
    scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))

    expect(committed).toHaveStyle({ transform: 'translate3d(90px, 0, 0)' })

    // Seeking can remain outside the selected clip, but the visible playhead
    // pins to the ruler edge while the shared timeline scrolls underneath it.
    scrollContainer.scrollLeft = 200
    fireEvent.scroll(scrollContainer)

    expect(committed).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' })
  })

  it('keeps the keyframe playhead stable during main-timeline edge scrolling', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 20
    const timelineScrollContainerRef = { current: scrollContainer }
    const globalFrameToPixels = (globalFrame: number) => globalFrame - scrollContainer.scrollLeft

    act(() => usePlaybackStore.getState().setCurrentFrame(150))
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={50}
        playheadFrame={50}
        playheadClampToItemBounds={false}
        itemFrom={100}
        totalFrames={100}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={() => {}}
        globalFrameToPixels={globalFrameToPixels}
        timelineScrollContainerRef={timelineScrollContainerRef}
      />,
    )

    const playhead = screen.getByTestId('dopesheet-playhead-line')
    const cursorLockedTransform = playhead.style.transform
    mainTimelineScrubActiveRef.current = true
    scrollContainer.scrollLeft = 60
    scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))

    expect(playhead.style.transform).toBe(cursorLockedTransform)

    notifyTimelineScrubVisualFrame(scrollContainer, {
      frame: 190,
      source: 'main',
      viewportProgress: 130 / 391,
    })
    expect(playhead.style.transform).toBe(cursorLockedTransform)

    notifyTimelineScrubVisualFrame(scrollContainer, {
      frame: 300,
      source: 'main',
      viewportProgress: 1,
    })
    expect(playhead).toHaveStyle({ transform: 'translate3d(391px, 0, 0)' })
    mainTimelineScrubActiveRef.current = false
  })

  it('derives linked edge-scroll frames from the live main-timeline scale', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const scrollContainer = document.createElement('div')
    const timelineScrollContainerRef = { current: scrollContainer }
    const onScrub = vi.fn((frame: number) => {
      usePlaybackStore.getState().setScrubFrame(frame)
    })
    const onVisualFrame = vi.fn()
    scrollContainer.addEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, (event) => {
      onVisualFrame((event as CustomEvent).detail)
    })
    const onRulerEdgeScroll = vi.fn(() => {
      scrollContainer.scrollLeft += 12
      scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))
      return 12
    })

    render(
      <>
        <TimelinePreviewScrubberVisual
          frameToPixels={(frame) => frame}
          fps={30}
          suppressSignal={timelineSkimmerScrubSignal}
        />
        <DopesheetEditor
          itemId="item-1"
          keyframesByProperty={{ x: [] }}
          currentFrame={0}
          totalFrames={300}
          frameViewport={{ startFrame: 0, endFrame: 100 }}
          clampViewportToContent={false}
          scrubClampToItemBounds={false}
          presentation="classic"
          width={640}
          height={240}
          fps={30}
          onScrub={onScrub}
          onScrubEnd={() => usePlaybackStore.getState().setPreviewFrame(null)}
          onRulerEdgeScroll={onRulerEdgeScroll}
          timelineScrollContainerRef={timelineScrollContainerRef}
          getTimelineLivePixelsPerSecond={() => 240}
        />
      </>,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    const mainSkimmer = screen.getByTestId('timeline-preview-scrubber')
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: PROPERTY_COLUMN_WIDTH,
      y: 0,
      left: PROPERTY_COLUMN_WIDTH,
      top: 0,
      right: 640,
      bottom: 22,
      width: 392,
      height: 22,
      toJSON: () => ({}),
    } as DOMRect)

    act(() => usePlaybackStore.getState().setPreviewFrame(20))
    expect(mainSkimmer).not.toHaveStyle({ display: 'none' })

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 92, clientX: 640 })
    expect(onScrub).toHaveBeenLastCalledWith(49)
    expect(timelineSkimmerScrubSignal.current).toBe(true)
    expect(mainSkimmer).toHaveStyle({ display: 'none' })

    act(() => frameCallbacks.shift()?.(16))

    expect(onVisualFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ frame: 50, source: 'keyframe' }),
    )
    expect(mainSkimmer).toHaveStyle({ display: 'none' })

    fireEvent.pointerUp(ruler, { pointerId: 92, clientX: 640 })
    expect(timelineSkimmerScrubSignal.current).toBe(false)
    animationFrameSpy.mockRestore()
  })

  it('repositions keyframe geometry without scaling between settled React viewport updates', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 20
    const timelineScrollContainerRef = { current: scrollContainer }
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-pan', frame: 30, value: 100, easing: 'linear' }],
        }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={20}
      />,
    )

    const rulerSurface = screen
      .getByTestId('dopesheet-ruler')
      .querySelector<HTMLElement>('[data-motion-ruler-surface]')
    expect(rulerSurface?.style.transform).not.toContain('scaleX')

    const keyframe = screen
      .getByTestId('dopesheet-editor-root')
      .querySelector<HTMLElement>('[data-dopesheet-frame="30"]')
    const initialLeft = Number.parseFloat(keyframe?.style.left ?? 'NaN')

    scrollContainer.scrollLeft = 65
    scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))

    expect(Number.parseFloat(keyframe?.style.left ?? 'NaN')).toBeCloseTo(initialLeft - 45)
    expect(keyframe?.style.transform).toBe('')
  })

  it('applies live zoom as direct keyframe pixel positions', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 60
    const timelineScrollContainerRef = { current: scrollContainer }
    let livePixelsPerSecond = 150
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-zoom', frame: 30, value: 100, easing: 'linear' }],
        }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={20}
        timelinePanBasePixelsPerSecond={100}
        getTimelineLivePixelsPerSecond={() => livePixelsPerSecond}
      />,
    )

    const root = screen.getByTestId('dopesheet-editor-root')
    const keyframe = root.querySelector<HTMLElement>('[data-dopesheet-frame="30"]')
    expect(keyframe?.style.left).toBe('90px')
    expect(root.style.getPropertyValue('--dopesheet-live-axis-transform')).toBe('')

    livePixelsPerSecond = 75
    scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))
    expect(keyframe?.style.left).toBe('15px')
    expect(keyframe?.style.transform).toBe('')
  })

  it('uses live main-timeline pixels during the Edit settle handoff', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 500
    const timelineScrollContainerRef = { current: scrollContainer }
    const mainViewportWidth = 393
    const basePixelsPerSecond = (mainViewportWidth / 100) * 30

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-handoff', frame: 100, value: 100, easing: 'linear' }],
        }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        presentation="classic"
        fps={30}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={100}
        timelinePanBasePixelsPerSecond={basePixelsPerSecond}
        getTimelineLivePixelsPerSecond={() => basePixelsPerSecond}
      />,
    )

    const keyframe = screen
      .getByTestId('dopesheet-editor-root')
      .querySelector<HTMLElement>('[data-dopesheet-frame="100"]')
    const keyframeLeft = Number.parseFloat(keyframe?.style.left ?? 'NaN')

    expect(keyframeLeft).toBeCloseTo((100 / 30) * basePixelsPerSecond - scrollContainer.scrollLeft)
    expect(keyframe?.style.transform).toBe('')
  })

  it('uses the linked Edit viewport width as the authoritative settled axis', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 500
    const timelineScrollContainerRef = { current: scrollContainer }
    const mainViewportWidth = 393
    const basePixelsPerSecond = (mainViewportWidth / 100) * 30

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-linked', frame: 100, value: 100, easing: 'linear' }],
        }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        presentation="classic"
        fps={30}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={100}
        timelinePanBasePixelsPerSecond={basePixelsPerSecond}
        linkedTimelineViewportWidth={mainViewportWidth}
        getTimelineLivePixelsPerSecond={() => basePixelsPerSecond}
      />,
    )

    const root = screen.getByTestId('dopesheet-editor-root')
    const keyframe = root.querySelector<HTMLElement>('[data-dopesheet-frame="100"]')
    expect(Number.parseFloat(keyframe?.style.left ?? 'NaN')).toBeCloseTo(
      (100 / 30) * basePixelsPerSecond - scrollContainer.scrollLeft - 1,
    )
    expect(root.querySelector<HTMLElement>('[data-motion-viewport-surface]')?.style.transform).toBe(
      '',
    )
    expect(screen.getByTestId('dopesheet-playhead-clip')).toHaveStyle({
      left: `${PROPERTY_COLUMN_WIDTH}px`,
    })
  })

  it('offers explicit cleanup when keyframes are parked beyond the clip', () => {
    const onTrimAnimation = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        presentation="classic"
        width={640}
        height={240}
        trimmedKeyframeCount={2}
        onTrimAnimation={onTrimAnimation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '2 trimmed' }))
    expect(onTrimAnimation).toHaveBeenCalledOnce()
  })

  it('pre-renders ruler marks around the linked viewport for immediate pans', () => {
    const scrollContainer = document.createElement('div')
    const timelineScrollContainerRef = { current: scrollContainer }
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={0}
      />,
    )

    const rulerSurface = screen
      .getByTestId('dopesheet-ruler')
      .querySelector('[data-motion-ruler-surface]')
    expect(rulerSurface?.children.length).toBeGreaterThan(10)
  })

  it('hides the skim playhead while scrubbing the keyframe ruler', () => {
    const onSkim = vi.fn((frame: number | null) => {
      usePlaybackStore.getState().setPreviewFrame(frame, frame === null ? null : 'item-1')
    })
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onScrub={() => {}}
        onScrubEnd={() => usePlaybackStore.getState().setPreviewFrame(null)}
        onSkim={onSkim}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    const skim = screen.getByTestId('timeline-preview-scrubber')

    act(() => usePlaybackStore.getState().setPreviewFrame(40, 'item-1'))
    expect(skim.style.display).toBe('')

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 3, clientX: 196 })
    expect(skim.style.display).toBe('none')

    fireEvent.pointerMove(ruler, { pointerId: 3, clientX: 220 })
    expect(skim.style.display).toBe('none')

    fireEvent.pointerUp(ruler, { pointerId: 3, clientX: 220 })
    expect(skim.style.display).toBe('none')

    fireEvent.pointerMove(ruler, { pointerId: 4, clientX: 240 })
    expect(onSkim).toHaveBeenLastCalledWith(expect.any(Number))
    expect(skim.style.display).toBe('')
  })

  it('keeps the navigator in the right viewport column', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('keyframe-navigator-property-column')).toBeInTheDocument()
    expect(screen.getByTestId('keyframe-navigator-viewport-column')).toContainElement(
      screen.getByTestId('keyframe-navigator-thumb'),
    )
  })
})
