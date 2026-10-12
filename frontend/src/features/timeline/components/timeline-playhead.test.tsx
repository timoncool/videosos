import { createRef, Profiler } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import { TimelinePlayhead } from './timeline-playhead'
import { useZoomStore, _resetZoomStoreForTest } from '../stores/zoom-store'
import { setTimelineState } from '../test-helpers'
import {
  mainTimelineScrubActiveRef,
  mainTimelineScrubHandoffFrameRef,
  resetTimelineSkimmerScrubForTest,
  timelineSkimmerScrubSignal,
} from '@/shared/timeline/main-timeline-scrub'
import { notifyTimelineScrubVisualFrame } from '@/shared/timeline/live-scroll-sync'

describe('TimelinePlayhead', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 12,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      playbackScrubResumeTransport: null,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1,
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1,
    })
    setTimelineState({ fps: 30 })
    _resetZoomStoreForTest()
    useZoomStore.getState().setZoomLevelSynchronized(1)
    mainTimelineScrubActiveRef.current = false
    mainTimelineScrubHandoffFrameRef.current = null
    resetTimelineSkimmerScrubForTest()
  })

  it('skips transform assignments until playback reaches the next rounded pixel', () => {
    useZoomStore.getState().setZoomLevelSynchronized(0.1)
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )
    const playhead = container.querySelector<HTMLElement>('[data-timeline-playhead="ruler"]')!
    expect(playhead).toHaveStyle({ transform: 'translate3d(4px, 0, 0)' })

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

    act(() => usePlaybackStore.setState({ currentFrame: 13 }))
    expect(transformAssignments).toEqual([])

    act(() => usePlaybackStore.setState({ currentFrame: 14 }))
    expect(transformAssignments).toEqual(['translate3d(5px, 0, 0)'])
  })

  it('tracks live zoom imperatively without a React commit', () => {
    const onRender = vi.fn()
    const { container } = render(
      <Profiler id="playhead" onRender={onRender}>
        <div className="timeline-ruler">
          <TimelinePlayhead inRuler maxFrame={300} />
        </div>
      </Profiler>,
    )
    const playhead = container.querySelector<HTMLElement>('[data-timeline-playhead="ruler"]')!
    const initialCommitCount = onRender.mock.calls.length

    expect(playhead).toHaveStyle({ transform: 'translate3d(40px, 0, 0)' })

    act(() => {
      useZoomStore.setState({
        level: 2,
        pixelsPerSecond: 200,
        isZoomInteracting: true,
      })
    })

    expect(playhead).toHaveStyle({ transform: 'translate3d(80px, 0, 0)' })
    expect(onRender).toHaveBeenCalledTimes(initialCommitCount)
  })

  it('tracks FPS changes imperatively without a React commit', () => {
    const onRender = vi.fn()
    const { container } = render(
      <Profiler id="playhead" onRender={onRender}>
        <div className="timeline-ruler">
          <TimelinePlayhead inRuler maxFrame={300} />
        </div>
      </Profiler>,
    )
    const playhead = container.querySelector<HTMLElement>('[data-timeline-playhead="ruler"]')!
    const initialCommitCount = onRender.mock.calls.length

    expect(playhead).toHaveStyle({ transform: 'translate3d(40px, 0, 0)' })

    act(() => {
      setTimelineState({ fps: 60 })
    })

    expect(playhead).toHaveStyle({ transform: 'translate3d(20px, 0, 0)' })
    expect(onRender).toHaveBeenCalledTimes(initialCommitCount)
  })

  it('uses atomic scrub updates while dragging and clears preview on release', async () => {
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )

    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement | null
    expect(ruler).toBeTruthy()

    ruler!.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })

    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement | null
    expect(hitArea).toBeTruthy()
    expect(hitArea).toHaveAttribute('data-playhead-handle')
    expect(hitArea).toHaveStyle({ cursor: 'ew-resize' })

    fireEvent.mouseDown(hitArea!, { clientX: 24, clientY: 8, button: 0 })
    expect(mainTimelineScrubActiveRef.current).toBe(true)
    expect(timelineSkimmerScrubSignal.current).toBe(true)
    expect(document.body).toHaveStyle({ cursor: 'ew-resize' })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 8 })

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(36)
      expect(usePlaybackStore.getState().currentFrame).toBe(36)
    })

    fireEvent.mouseUp(document, { clientX: 120, clientY: 8 })
    expect(mainTimelineScrubActiveRef.current).toBe(false)
    expect(timelineSkimmerScrubSignal.current).toBe(false)
    expect(document.body.style.cursor).toBe('')

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentFrame).toBe(36)
      expect(usePlaybackStore.getState().previewFrame).toBeNull()
    })
  })

  it('temporarily pauses active playback and resumes its transport from the released frame', async () => {
    usePlaybackStore.setState({
      isPlaying: true,
      playbackRate: 4,
      transportMode: 'shuttle',
    })
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )
    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement
    ruler.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })
    const hitArea = container.querySelector('[data-playhead-handle]') as HTMLDivElement

    fireEvent.mouseDown(hitArea, { clientX: 24, clientY: 8, button: 0 })

    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      playbackScrubResumeTransport: {
        playbackRate: 4,
        transportMode: 'shuttle',
      },
    })
    expect(mainTimelineScrubActiveRef.current).toBe(true)

    fireEvent.mouseMove(document, { clientX: 120, clientY: 8 })
    fireEvent.mouseUp(document, { clientX: 120, clientY: 8 })

    expect(usePlaybackStore.getState()).toMatchObject({
      currentFrame: 36,
      isPlaying: false,
    })

    await waitFor(() =>
      expect(usePlaybackStore.getState()).toMatchObject({
        currentFrame: 36,
        isPlaying: true,
        playbackRate: 4,
        transportMode: 'shuttle',
        playbackScrubResumeTransport: null,
      }),
    )
    expect(mainTimelineScrubActiveRef.current).toBe(false)
  })

  it('releases scrub ownership and cancels the RAF when the window loses focus', async () => {
    usePlaybackStore.setState({
      isPlaying: true,
      playbackRate: -2,
      transportMode: 'shuttle',
    })
    const frameCallbacks: FrameRequestCallback[] = []
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )
    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement
    ruler.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })
    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement

    fireEvent.mouseDown(hitArea, { clientX: 120, clientY: 8, button: 0 })
    expect(mainTimelineScrubActiveRef.current).toBe(true)
    expect(timelineSkimmerScrubSignal.current).toBe(true)
    expect(frameCallbacks).toHaveLength(1)

    fireEvent.blur(window)

    expect(mainTimelineScrubActiveRef.current).toBe(false)
    expect(timelineSkimmerScrubSignal.current).toBe(false)
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(usePlaybackStore.getState().playbackScrubResumeTransport).toBeNull()
    await waitFor(() => expect(document.body.style.cursor).toBe(''))
  })

  it('uses an explicit ruler origin when the unified playhead is its sibling', () => {
    const rulerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <div className="timeline-container">
        <div ref={rulerRef} className="timeline-ruler" />
        <TimelinePlayhead inRuler maxFrame={300} coordinateSurfaceRef={rulerRef} />
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperty(scrollContainer, 'scrollLeft', {
      configurable: true,
      value: 100,
      writable: true,
    })
    scrollContainer.getBoundingClientRect = () => ({
      x: 10,
      y: 0,
      left: 10,
      top: 0,
      right: 610,
      bottom: 200,
      width: 600,
      height: 200,
      toJSON: () => ({}),
    })
    rulerRef.current!.getBoundingClientRect = () => ({
      x: -70,
      y: 0,
      left: -70,
      top: 0,
      right: 530,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })

    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement
    fireEvent.mouseDown(hitArea, { clientX: 130, clientY: 8, button: 0 })
    fireEvent.mouseUp(document, { clientX: 130, clientY: 8 })

    expect(usePlaybackStore.getState().currentFrame).toBe(60)
  })

  it('keeps a stationary handle drag on the committed frame pixel', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )
    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement
    ruler.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })
    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement
    const playhead = container.querySelector('[data-timeline-playhead="ruler"]') as HTMLDivElement

    fireEvent.mouseDown(hitArea, { clientX: 24, clientY: 8, button: 0 })
    frameCallbacks.shift()?.(16)
    expect(playhead).toHaveStyle({ transform: 'translate3d(23px, 0, 0)' })

    fireEvent.mouseUp(document, { clientX: 24, clientY: 8 })
    expect(usePlaybackStore.getState().currentFrame).toBe(7)
    expect(playhead).toHaveStyle({ transform: 'translate3d(23px, 0, 0)' })
  })

  it('follows a keyframe scrub visual frame before its throttled store update', () => {
    const { container } = render(
      <div className="timeline-container">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    const playhead = container.querySelector('[data-timeline-playhead="ruler"]') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 301 },
      scrollLeft: { configurable: true, value: 100, writable: true },
    })

    notifyTimelineScrubVisualFrame(scrollContainer, {
      frame: 90,
      source: 'keyframe',
      viewportProgress: 2 / 3,
    })

    expect(playhead).toHaveStyle({ transform: 'translate3d(300px, 0, 0)' })
    expect(usePlaybackStore.getState().currentFrame).toBe(12)

    notifyTimelineScrubVisualFrame(scrollContainer, {
      frame: 300,
      source: 'keyframe',
      viewportProgress: 1,
    })
    expect(playhead).toHaveStyle({ transform: 'translate3d(400px, 0, 0)' })
  })

  it('auto-scrolls at the viewport edge while keeping both playheads cursor-locked', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const { container } = render(
      <div className="timeline-container">
        <div className="timeline-ruler">
          <TimelinePlayhead inRuler maxFrame={300} />
        </div>
        <div className="timeline-tracks">
          <TimelinePlayhead maxFrame={300} />
        </div>
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1200 },
      scrollLeft: { configurable: true, value: 100, writable: true },
    })
    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    })
    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement
    const rulerPlayhead = container.querySelector<HTMLElement>('[data-timeline-playhead="ruler"]')!
    const tracksPlayhead = container.querySelector<HTMLElement>(
      '[data-timeline-playhead="tracks"]',
    )!

    fireEvent.mouseDown(hitArea, { clientX: 300, clientY: 8, button: 0 })
    expect(frameCallbacks).toHaveLength(1)
    frameCallbacks.shift()?.(16)
    const firstScrollLeft = scrollContainer.scrollLeft
    expect(firstScrollLeft).toBeGreaterThan(100)
    expect(Number.parseFloat(rulerPlayhead.style.transform.match(/\(([^p]+)/)?.[1] ?? '0')).toBe(
      299 + firstScrollLeft,
    )
    expect(tracksPlayhead.style.transform).toBe(rulerPlayhead.style.transform)
    expect(frameCallbacks).toHaveLength(1)

    frameCallbacks.shift()?.(32)
    expect(scrollContainer.scrollLeft).toBeGreaterThan(firstScrollLeft)
    expect(Number.parseFloat(rulerPlayhead.style.transform.match(/\(([^p]+)/)?.[1] ?? '0')).toBe(
      299 + scrollContainer.scrollLeft,
    )
    expect(tracksPlayhead.style.transform).toBe(rulerPlayhead.style.transform)

    fireEvent.mouseUp(document, { clientX: 300, clientY: 8 })
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    animationFrameSpy.mockRestore()
  })

  it('clamps the draggable playhead visual to the project end', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const { container } = render(
      <div className="timeline-container">
        <div className="timeline-ruler">
          <TimelinePlayhead inRuler maxFrame={30} />
        </div>
        <div className="timeline-tracks">
          <TimelinePlayhead maxFrame={30} />
        </div>
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1200 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    })
    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement
    const rulerPlayhead = container.querySelector<HTMLElement>('[data-timeline-playhead="ruler"]')!
    const tracksPlayhead = container.querySelector<HTMLElement>(
      '[data-timeline-playhead="tracks"]',
    )!

    fireEvent.mouseDown(hitArea, { clientX: 250, clientY: 8, button: 0 })
    frameCallbacks.shift()?.(16)

    expect(rulerPlayhead).toHaveStyle({
      transform: 'translate3d(100px, 0, 0)',
    })
    expect(tracksPlayhead.style.transform).toBe(rulerPlayhead.style.transform)
    expect(usePlaybackStore.getState().currentFrame).toBe(30)

    fireEvent.mouseUp(document, { clientX: 250, clientY: 8 })
    animationFrameSpy.mockRestore()
  })
})
