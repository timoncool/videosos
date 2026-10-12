import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import {
  mainTimelineScrubActiveRef,
  resetTimelineSkimmerScrubForTest,
  timelineSkimmerScrubSignal,
} from '@/shared/timeline/main-timeline-scrub'
import { setTimelineState } from '../test-helpers'
import { TimelineMarkers } from './timeline-markers'

vi.mock('../contexts/timeline-zoom-context', () => ({
  useTimelineCommittedZoomContext: () => ({
    timeToPixels: (time: number) => time * 100,
    frameToPixels: (frame: number) => frame * (100 / 30),
    pixelsPerSecond: 100,
  }),
}))

describe('TimelineMarkers ruler scrub cancellation', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
      isPlaying: false,
    })
    setTimelineState({ fps: 30, inPoint: null, outPoint: null, markers: [] })
    mainTimelineScrubActiveRef.current = false
    resetTimelineSkimmerScrubForTest()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() })),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('releases scrub ownership and cancels the RAF when the window loses focus', async () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const { container } = render(
      <div className="timeline-container">
        <TimelineMarkers duration={10} width={1000} />
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1000 },
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
    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    ruler.getBoundingClientRect = scrollContainer.getBoundingClientRect

    fireEvent.mouseDown(ruler, { button: 0, clientX: 290 })
    expect(mainTimelineScrubActiveRef.current).toBe(true)
    expect(timelineSkimmerScrubSignal.current).toBe(true)
    expect(frameCallbacks).toHaveLength(1)

    fireEvent.blur(window)

    expect(mainTimelineScrubActiveRef.current).toBe(false)
    expect(timelineSkimmerScrubSignal.current).toBe(false)
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    await waitFor(() => expect(document.body.style.cursor).toBe(''))
  })

  it('shares one viewport geometry read across each active scrub frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const { container } = render(
      <div className="timeline-container">
        <TimelineMarkers duration={10} width={1000} />
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1000 },
      scrollLeft: { configurable: true, value: 200, writable: true },
    })
    const viewportRect = {
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 400,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect
    const readViewportRect = vi.fn(() => viewportRect)
    scrollContainer.getBoundingClientRect = readViewportRect

    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    const readRulerRect = vi.fn(
      () =>
        ({
          ...viewportRect,
          x: -100,
          left: -100,
          right: 900,
          width: 1000,
        }) as DOMRect,
    )
    ruler.getBoundingClientRect = readRulerRect

    // viewport x 150 + scrollLeft 200 = timeline x 350 = frame 105.
    fireEvent.mouseDown(ruler, { button: 0, clientX: 250 })
    expect(frameCallbacks).toHaveLength(1)
    readViewportRect.mockClear()
    readRulerRect.mockClear()

    act(() => frameCallbacks[0]?.(performance.now()))

    expect(readViewportRect).toHaveBeenCalledOnce()
    expect(readRulerRect).not.toHaveBeenCalled()
    expect(usePlaybackStore.getState().currentFrame).toBe(105)

    fireEvent.mouseUp(document, { clientX: 250 })
  })

  it('keeps a stationary same-frame click on the committed frame pixel', () => {
    const { container } = render(
      <div className="timeline-container">
        <TimelineMarkers duration={10} width={1000} />
        <div data-timeline-playhead="tracks" />
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1000 },
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
    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    ruler.getBoundingClientRect = scrollContainer.getBoundingClientRect
    const playhead = container.querySelector('[data-timeline-playhead="tracks"]') as HTMLDivElement

    // At 100 px/s and 30 fps, x=24 resolves to frame 7, whose committed
    // integer pixel is round(7 * 100 / 30) = 23.
    fireEvent.mouseDown(ruler, { button: 0, clientX: 24 })
    expect(playhead).toHaveStyle({ transform: 'translate3d(23px, 0, 0)' })

    fireEvent.mouseUp(document, { clientX: 24 })
    expect(usePlaybackStore.getState().currentFrame).toBe(7)
    expect(playhead).toHaveStyle({ transform: 'translate3d(23px, 0, 0)' })
  })

  it('keeps the skim target while moving from the ruler into timeline tracks', async () => {
    const { container } = render(
      <div className="timeline-container" data-timeline-scroll-container>
        <TimelineMarkers duration={10} width={1000} />
        <div data-testid="timeline-track" />
      </div>,
    )
    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    const track = container.querySelector('[data-testid="timeline-track"]') as HTMLDivElement

    ruler.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 34,
      width: 1000,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.mouseMove(ruler, { clientX: 100 })
    await waitFor(() => expect(usePlaybackStore.getState().previewFrame).toBe(30))

    fireEvent.mouseLeave(ruler, { relatedTarget: track })

    expect(usePlaybackStore.getState().previewFrame).toBe(30)
  })

  it('clears the skim target when the pointer truly leaves the timeline', async () => {
    const { container } = render(
      <div className="timeline-container" data-timeline-scroll-container>
        <TimelineMarkers duration={10} width={1000} />
      </div>,
    )
    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    ruler.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 34,
      width: 1000,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.mouseMove(ruler, { clientX: 100 })
    await waitFor(() => expect(usePlaybackStore.getState().previewFrame).toBe(30))

    fireEvent.mouseLeave(ruler, { relatedTarget: outside })

    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    outside.remove()
  })

  it('publishes only the newest ruler hover once per display frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const { container } = render(
      <div className="timeline-container" data-timeline-scroll-container>
        <TimelineMarkers duration={10} width={1000} />
      </div>,
    )
    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    ruler.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1000,
        top: 0,
        bottom: 34,
        width: 1000,
        height: 34,
      }) as DOMRect

    fireEvent.mouseMove(ruler, { clientX: 50 })
    fireEvent.mouseMove(ruler, { clientX: 75 })
    fireEvent.mouseMove(ruler, { clientX: 100 })

    expect(frameCallbacks).toHaveLength(1)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()

    act(() => frameCallbacks[0]?.(performance.now()))
    expect(usePlaybackStore.getState().previewFrame).toBe(30)
  })

  it('keeps the IO strip in its own lane above the viewport ruler canvas', () => {
    setTimelineState({ inPoint: 15, outPoint: 45 })

    const { container } = render(
      <div className="timeline-container">
        <TimelineMarkers duration={10} width={1000} />
      </div>,
    )

    const strip = container.querySelector(
      '[data-testid="edit-timeline-io-strip"]',
    ) as HTMLDivElement
    const canvas = container.querySelector('[data-main-timeline-ruler-canvas]') as HTMLCanvasElement
    const canvasLane = canvas.parentElement as HTMLDivElement

    expect(strip).toHaveStyle({ top: '0px', height: '12px' })
    expect(canvasLane).toHaveClass('bottom-0')
    expect(canvasLane).toHaveStyle({ top: '12px' })
    expect(canvas.style.marginTop).toBe('')
  })
})
