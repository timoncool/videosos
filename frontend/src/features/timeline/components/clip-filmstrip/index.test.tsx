import { Profiler } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ClipFilmstrip } from './index'
import {
  resetDecodedFilmstripImagesForTest,
  subscribeFilmstripImage,
} from './filmstrip-image-cache'
import { useTimelineViewportStore } from '../../stores/timeline-viewport-store'
import { _resetZoomStoreForTest, useZoomStore } from '../../stores/zoom-store'

type FilmstripResult = {
  frames: Array<{ index: number; timestamp: number; url: string }> | null
  isLoading: boolean
  isComplete: boolean
  progress: number
  error: string | null
}
type FilmstripOptions = {
  mediaId?: string
  blobUrl?: string
  enabled?: boolean
  targetFrameCount?: number
  targetFrameIndices?: number[]
  priorityWindow?: { startTime: number; endTime: number }
}

const useFilmstripMock = vi.hoisted(() =>
  vi.fn((_options: FilmstripOptions): FilmstripResult => {
    void _options
    return {
      frames: null,
      isLoading: false,
      isComplete: false,
      progress: 0,
      error: null,
    }
  }),
)

const useMediaBlobUrlMock = vi.hoisted(() =>
  vi.fn(() => ({
    blobUrl: 'blob:original',
    setBlobUrl: vi.fn(),
    hasStartedLoadingRef: { current: true },
    blobUrlVersion: 0,
  })),
)

const mediaResolverMocks = vi.hoisted(() => ({
  resolveMediaUrl: vi.fn(),
  resolveProxyUrl: vi.fn((): string | null => null),
}))

const useMediaLibraryStoreMock = vi.hoisted(() =>
  vi.fn((selector: (state: { proxyStatus: Map<string, string> }) => unknown) =>
    selector({
      proxyStatus: new Map<string, string>(),
    }),
  ),
)

const filmstripCacheMocks = vi.hoisted(() => ({
  refreshFrames: vi.fn(() => Promise.resolve()),
}))

const canvasContextMocks = vi.hoisted(() => ({
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  beginPath: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  drawImage: vi.fn(),
  restore: vi.fn(),
}))

class TestImage {
  static instances: TestImage[] = []

  width = 160
  height = 90
  decoding = 'auto'
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private source = ''

  constructor() {
    TestImage.instances.push(this)
  }

  get src(): string {
    return this.source
  }

  set src(value: string) {
    this.source = value
  }
}

vi.mock('../../hooks/use-filmstrip', () => ({
  useFilmstrip: useFilmstripMock,
}))

vi.mock('../../hooks/use-media-blob-url', () => ({
  useMediaBlobUrl: useMediaBlobUrlMock,
}))

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: mediaResolverMocks.resolveMediaUrl,
  resolveProxyUrl: mediaResolverMocks.resolveProxyUrl,
}))

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: useMediaLibraryStoreMock,
}))

vi.mock('../../services/filmstrip-cache', () => ({
  THUMBNAIL_WIDTH: 80,
  filmstripCache: filmstripCacheMocks,
}))

describe('ClipFilmstrip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let frameTimestamp = 0
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++frameId
      queueMicrotask(() => callback((frameTimestamp += 40)))
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
    vi.stubGlobal('Image', TestImage)
    resetDecodedFilmstripImagesForTest()
    _resetZoomStoreForTest()
    useTimelineViewportStore.setState({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 0,
      viewportHeight: 0,
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60)
    ;(
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
        mockReturnValue: (value: CanvasRenderingContext2D) => void
      }
    ).mockReturnValue({
      ...canvasContextMocks,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D)
    TestImage.instances = []

    useMediaBlobUrlMock.mockReturnValue({
      blobUrl: 'blob:original',
      setBlobUrl: vi.fn(),
      hasStartedLoadingRef: { current: true },
      blobUrlVersion: 0,
    })
    useMediaLibraryStoreMock.mockImplementation((selector) =>
      selector({
        proxyStatus: new Map<string, string>(),
      }),
    )
    mediaResolverMocks.resolveProxyUrl.mockReturnValue(null)
  })

  it('prefers a ready proxy as the filmstrip source', () => {
    useMediaLibraryStoreMock.mockImplementation((selector) =>
      selector({
        proxyStatus: new Map([['media-1', 'ready']]),
      }),
    )
    mediaResolverMocks.resolveProxyUrl.mockReturnValue('blob:proxy')

    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(latestCall).toEqual(
      expect.objectContaining({
        mediaId: 'media-1',
        blobUrl: 'blob:proxy',
        enabled: true,
      }),
    )
  })

  it('notifies a late subscriber when a shared image is already decoded', () => {
    const firstOnChange = vi.fn()
    const unsubscribeFirst = subscribeFilmstripImage('blob:shared-frame', firstOnChange, vi.fn())
    const image = TestImage.instances.at(-1)
    expect(image).toBeDefined()

    image?.onload?.()
    expect(firstOnChange).toHaveBeenCalledTimes(1)
    unsubscribeFirst()

    const lateOnChange = vi.fn()
    const unsubscribeLate = subscribeFilmstripImage('blob:shared-frame', lateOnChange, vi.fn())

    expect(lateOnChange).toHaveBeenCalledTimes(1)
    unsubscribeLate()
  })

  it('uses the refreshed proxy URL when blob URLs are invalidated', () => {
    useMediaLibraryStoreMock.mockImplementation((selector) =>
      selector({
        proxyStatus: new Map([['media-1', 'ready']]),
      }),
    )
    mediaResolverMocks.resolveProxyUrl.mockReturnValue('blob:stale-proxy')

    const props = {
      mediaId: 'media-1',
      clipWidth: 320,
      sourceStart: 0,
      sourceDuration: 10,
      trimStart: 0,
      speed: 1,
      fps: 31,
      isVisible: true,
      pixelsPerSecond: 120,
    }
    const { rerender } = render(<ClipFilmstrip {...props} />)

    expect(useFilmstripMock.mock.calls.at(-1)?.[0]?.blobUrl).toBe('blob:stale-proxy')

    mediaResolverMocks.resolveProxyUrl.mockReturnValue('blob:refreshed-proxy')
    useMediaBlobUrlMock.mockReturnValue({
      blobUrl: 'blob:refreshed-original',
      setBlobUrl: vi.fn(),
      hasStartedLoadingRef: { current: false },
      blobUrlVersion: 1,
    })
    rerender(<ClipFilmstrip {...props} fps={32} />)

    expect(useFilmstripMock.mock.calls.at(-1)?.[0]?.blobUrl).toBe('blob:refreshed-proxy')
  })

  it('falls back to the original media blob when no proxy is ready', () => {
    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(latestCall).toEqual(
      expect.objectContaining({
        mediaId: 'media-1',
        blobUrl: 'blob:original',
        enabled: true,
      }),
    )
  })

  it('targets the padded visible thumbnail slots for extraction', () => {
    const { rerender } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={2000}
        sourceStart={0}
        sourceDuration={120}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        visibleStartRatio={0.5}
        visibleEndRatio={0.75}
        pixelsPerSecond={100}
      />,
    )

    const firstCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(firstCall?.priorityWindow).toEqual({ startTime: 0, endTime: 20 })
    expect(firstCall?.targetFrameCount).toBeUndefined()
    expect(firstCall?.targetFrameIndices).toEqual([
      3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])

    rerender(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={2000}
        sourceStart={0}
        sourceDuration={120}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        visibleStartRatio={0.5}
        visibleEndRatio={0.75}
        pixelsPerSecond={200}
      />,
    )

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(latestCall?.priorityWindow).toEqual(firstCall?.priorityWindow)
    expect(latestCall?.targetFrameCount).toBeUndefined()
    expect(latestCall?.targetFrameIndices).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps tile media full width while the canvas clips a short segment', async () => {
    const onRender = vi.fn()
    const widthSetter = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set')
    const heightSetter = vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set')
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:frame-0' }],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })

    const { container } = render(
      <Profiler id="filmstrip" onRender={onRender}>
        <ClipFilmstrip
          mediaId="media-1"
          clipWidth={40}
          sourceStart={0}
          sourceDuration={10}
          trimStart={0}
          speed={1}
          fps={31}
          isVisible
          pixelsPerSecond={120}
        />
      </Profiler>,
    )

    const canvas = container.querySelector('[data-filmstrip-canvas]') as HTMLCanvasElement | null
    const fallback = container.querySelector('[data-filmstrip-fallback]') as HTMLDivElement | null
    expect(canvas).not.toBeNull()
    expect(fallback).not.toBeNull()
    expect(canvas!.style.width).toBe('40px')
    expect(fallback!.style.backgroundImage).toContain('blob:frame-0')
    expect(fallback!.style.backgroundRepeat).toBe('repeat-x')
    expect(fallback!.style.backgroundSize).toBe('107px 60px')
    expect(container.querySelectorAll('img')).toHaveLength(0)

    const source = TestImage.instances.find((image) => image.src === 'blob:frame-0')
    expect(source).toBeDefined()
    const commitCountBeforeDecode = onRender.mock.calls.length
    const widthAssignmentCountBeforeDecode = widthSetter.mock.calls.length
    const heightAssignmentCountBeforeDecode = heightSetter.mock.calls.length
    source!.onload?.()

    await waitFor(() => {
      expect(canvasContextMocks.rect).toHaveBeenCalledWith(0, 0, 107, 60)
      const drawCall = canvasContextMocks.drawImage.mock.calls.at(-1)
      expect(drawCall?.[0]).toBe(source)
      expect(drawCall?.[1]).toBe(0)
      expect(drawCall?.[3]).toBe(107)
      expect(drawCall?.[4]).toBeGreaterThanOrEqual(60)
    })
    expect(onRender).toHaveBeenCalledTimes(commitCountBeforeDecode)
    expect(widthSetter).toHaveBeenCalledTimes(widthAssignmentCountBeforeDecode)
    expect(heightSetter).toHaveBeenCalledTimes(heightAssignmentCountBeforeDecode)
  })

  it('paints live zoom from timeline coordinates without layout reads or a React commit', async () => {
    const frames = Array.from({ length: 10 }, (_, index) => ({
      index,
      timestamp: index,
      url: `blob:live-frame-${index}`,
    }))
    useFilmstripMock.mockReturnValue({
      frames,
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })
    useZoomStore.setState({
      level: 1,
      pixelsPerSecond: 100,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: false,
    })
    useTimelineViewportStore.setState({
      scrollLeft: 0,
      viewportWidth: 400,
      viewportHeight: 120,
    })

    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')

    const onRender = vi.fn()
    const renderTree = (clipWidth: number, pixelsPerSecond: number) => (
      <div data-timeline-scroll-container>
        <div
          data-timeline-item
          data-timeline-start-frame="0"
          data-timeline-duration-frames="96"
          data-timeline-fps="30"
          data-timeline-content-inset-start-px="1"
          data-timeline-content-inset-end-px="1"
        >
          <Profiler id="live-filmstrip" onRender={onRender}>
            <ClipFilmstrip
              mediaId="media-live"
              clipWidth={clipWidth}
              sourceStart={0}
              sourceDuration={10}
              trimStart={0}
              speed={1}
              fps={30}
              isVisible
              pixelsPerSecond={pixelsPerSecond}
            />
          </Profiler>
        </div>
      </div>
    )
    const widthSetter = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set')
    const { container, rerender } = render(renderTree(320, 100))
    const canvas = container.querySelector('[data-filmstrip-canvas]') as HTMLCanvasElement
    const initialCanvas = canvas
    const commitCountBeforeZoom = onRender.mock.calls.length
    const initialSources = new Set(TestImage.instances.map((image) => image.src))
    const clearCountBeforeZoom = canvasContextMocks.clearRect.mock.calls.length

    await act(async () => {
      useZoomStore.setState({
        level: 2,
        pixelsPerSecond: 200,
        isZoomInteracting: true,
      })
      await Promise.resolve()
    })

    expect(onRender).toHaveBeenCalledTimes(commitCountBeforeZoom)
    expect(canvas.style.width).toBe('638px')
    expect(canvasContextMocks.clearRect).toHaveBeenCalledTimes(clearCountBeforeZoom + 1)
    expect(TestImage.instances.some((image) => !initialSources.has(image.src))).toBe(true)
    expect(getBoundingClientRect).not.toHaveBeenCalled()

    const clearCountBeforeSettle = canvasContextMocks.clearRect.mock.calls.length
    const backingWritesBeforeSettle = widthSetter.mock.calls.length
    rerender(renderTree(640, 200))

    expect(container.querySelector('[data-filmstrip-canvas]')).toBe(initialCanvas)
    expect(canvasContextMocks.clearRect).toHaveBeenCalledTimes(clearCountBeforeSettle)
    expect(widthSetter).toHaveBeenCalledTimes(backingWritesBeforeSettle)
  })

  it('refreshes a stale frame URL when a tile source errors', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:stale' }],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })

    const { container } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    expect(container.querySelectorAll('img')).toHaveLength(0)
    const source = TestImage.instances.find((image) => image.src === 'blob:stale')
    expect(source).toBeDefined()
    source!.onerror?.()

    await waitFor(() => {
      expect(filmstripCacheMocks.refreshFrames).toHaveBeenCalledWith('media-1', [0])
    })
  })

  it('reuses a decoded cover source when a clip remounts', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:shared-cover' }],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })

    const props = {
      mediaId: 'media-shared',
      clipWidth: 320,
      sourceStart: 0,
      sourceDuration: 10,
      trimStart: 0,
      speed: 1,
      fps: 32,
      isVisible: true,
      pixelsPerSecond: 120,
    }
    const first = render(<ClipFilmstrip {...props} />)
    const source = TestImage.instances.find((image) => image.src === 'blob:shared-cover')
    expect(source).toBeDefined()
    source!.onload?.()
    await waitFor(() => expect(canvasContextMocks.drawImage).toHaveBeenCalled())

    first.unmount()
    canvasContextMocks.drawImage.mockClear()
    render(<ClipFilmstrip {...props} />)

    expect(TestImage.instances.filter((image) => image.src === 'blob:shared-cover')).toHaveLength(1)
    await waitFor(() => expect(canvasContextMocks.drawImage).toHaveBeenCalled())
  })

  it('keeps the visible filmstrip stable while extraction is still streaming updates', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:initial' }],
      isLoading: true,
      isComplete: false,
      progress: 20,
      error: null,
    })

    const { container, rerender } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    await waitFor(() => {
      expect(TestImage.instances.some((image) => image.src === 'blob:initial')).toBe(true)
    })

    useFilmstripMock.mockReturnValue({
      frames: [
        { index: 0, timestamp: 0, url: 'blob:initial' },
        { index: 4, timestamp: 4, url: 'blob:streamed' },
      ],
      isLoading: true,
      isComplete: false,
      progress: 60,
      error: null,
    })
    rerender(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    expect(TestImage.instances.some((image) => image.src === 'blob:streamed')).toBe(false)

    useFilmstripMock.mockReturnValue({
      frames: [
        { index: 0, timestamp: 0, url: 'blob:initial' },
        { index: 4, timestamp: 4, url: 'blob:streamed' },
      ],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })
    rerender(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    await waitFor(() => {
      expect(TestImage.instances.some((image) => image.src === 'blob:streamed')).toBe(true)
    })
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
