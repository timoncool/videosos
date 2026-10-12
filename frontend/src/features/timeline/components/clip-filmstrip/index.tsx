import { memo, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { FilmstripSkeleton } from './filmstrip-skeleton'
import { computeFilmstripRenderWindow } from './render-window'
import { getFilmstripTileStride } from './filmstrip-canvas-geometry'
import { VisibleFilmstripCanvas } from './visible-filmstrip-canvas'
import { useFilmstrip, type FilmstripFrame } from '../../hooks/use-filmstrip'
import { resolveMediaUrl, resolveProxyUrl } from '@/features/timeline/deps/media-library-resolver'
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url'
import { filmstripCache, THUMBNAIL_WIDTH } from '../../services/filmstrip-cache'
import { createLogger } from '@/shared/logging/logger'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { observeParentElementHeight } from '../measure-parent-height'
import { useTimelineViewportStore } from '../../stores/timeline-viewport-store'
import { CLIP_VISIBILITY_PREFETCH_MARGIN_PX } from '../../hooks/use-clip-visibility'

const logger = createLogger('ClipFilmstrip')

// Pad the rendered tile window beyond the visible range so a fast scrub never
// outruns the mounted tiles within a frame. Matches the animated-image filmstrip.
const VIEWPORT_PAD_TILES = 2
const VIEWPORT_PAD_PX = 600
const coverFrameIndexByMediaId = new Map<string, number>()

interface ClipFilmstripProps {
  /** Media ID from the timeline item */
  mediaId: string
  /** Visible width of the clip in pixels */
  clipWidth: number
  /** Optional overscan width used to hide trailing-edge width commit lag */
  renderWidth?: number
  /** Source start time in seconds (for trimmed clips) */
  sourceStart: number
  /** Source end time in seconds (for trimmed clips) */
  sourceEnd?: number
  /** Total source duration in seconds */
  sourceDuration: number
  /** Trim start in seconds (how much trimmed from beginning) */
  trimStart: number
  /** Playback speed multiplier */
  speed: number
  /** Whether the clip plays source media in reverse */
  isReversed?: boolean
  /** Frames per second */
  fps: number
  /** Whether the clip is visible (from IntersectionObserver) */
  isVisible: boolean
  /** Visible horizontal range within this clip (0-1 ratios) */
  visibleStartRatio?: number
  visibleEndRatio?: number
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number
  /** Disable deferred width/zoom while active edit previews are running */
  preferImmediateRendering?: boolean
}

/**
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails as a tiled filmstrip.
 * Uses adaptive tile density during active zoom to keep interactions responsive
 * without deferring the zoom state itself.
 * Auto-fills container height.
 */
export const ClipFilmstrip = memo(function ClipFilmstrip({
  mediaId,
  clipWidth,
  renderWidth,
  sourceStart,
  sourceEnd,
  sourceDuration,
  trimStart,
  speed,
  isReversed = false,
  isVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
  preferImmediateRendering = false,
}: ClipFilmstripProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const viewportWidth = useTimelineViewportStore((state) => state.viewportWidth)
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId)
  const refreshingFrameIndicesRef = useRef<Set<number>>(new Set())
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(mediaId) ?? null)

  // A tab-wake refresh replaces the proxy URL while its status stays `ready`.
  // Re-read it on render so the blob URL version update cannot retain a revoked URL.
  const proxyBlobUrl = proxyStatus === 'ready' ? resolveProxyUrl(mediaId) : null
  const filmstripSourceUrl = proxyBlobUrl ?? blobUrl

  // Measure container height
  useEffect(() => {
    return observeParentElementHeight(containerRef.current, setHeight)
  }, [])

  // Calculate thumbnail width based on height (16:9 aspect ratio)
  const thumbnailWidth = Math.round(height * (16 / 9)) || THUMBNAIL_WIDTH

  const renderPixelsPerSecond = pixelsPerSecond
  const visibleClipWidth = clipWidth
  const renderClipWidth = Math.max(visibleClipWidth, renderWidth ?? visibleClipWidth)
  const effectiveStart = Math.max(0, sourceStart + trimStart)
  const effectiveEnd = Math.min(
    sourceDuration,
    Math.max(
      effectiveStart,
      sourceEnd ?? effectiveStart + (visibleClipWidth / Math.max(1, renderPixelsPerSecond)) * speed,
    ),
  )
  const initialPriorityWindowRef = useRef<{
    mediaId: string
    window: { startTime: number; endTime: number }
  } | null>(null)
  if (initialPriorityWindowRef.current?.mediaId !== mediaId) {
    initialPriorityWindowRef.current = null
  }
  if (isVisible && !initialPriorityWindowRef.current && effectiveEnd > effectiveStart) {
    initialPriorityWindowRef.current = {
      mediaId,
      window: {
        startTime: effectiveStart,
        endTime: Math.min(sourceDuration, Math.max(effectiveEnd, effectiveStart + 1)),
      },
    }
  }

  // Prioritize the first visible source window once per media item. Keeping this
  // stable avoids the old zoom-driven target churn while still making a freshly
  // dropped visible clip fill in the part the user can actually see first.
  const priorityWindow =
    initialPriorityWindowRef.current?.mediaId === mediaId
      ? initialPriorityWindowRef.current.window
      : null
  const targetFrameCount = undefined
  const filmstripRenderWindow = useMemo(
    () =>
      computeFilmstripRenderWindow({
        renderWidth: renderClipWidth,
        visibleWidth: visibleClipWidth,
        tileWidth: thumbnailWidth,
        visibleStartRatio,
        visibleEndRatio,
        minimumPadTiles: VIEWPORT_PAD_TILES,
        minimumPadPx: VIEWPORT_PAD_PX,
        maxWindowWidth:
          viewportWidth > 0 ? viewportWidth + CLIP_VISIBILITY_PREFETCH_MARGIN_PX * 2 : undefined,
      }),
    [
      renderClipWidth,
      visibleClipWidth,
      thumbnailWidth,
      visibleStartRatio,
      visibleEndRatio,
      viewportWidth,
    ],
  )
  const targetFrameIndices = useMemo(() => {
    if (!isVisible || height <= 0 || renderPixelsPerSecond <= 0) return undefined
    if (effectiveEnd <= effectiveStart || sourceDuration <= 0) return undefined

    const pixelsPerSourceSecond = renderPixelsPerSecond / Math.max(0.0001, speed)
    const tileWidth = thumbnailWidth
    const { startTile, endTile } = filmstripRenderWindow
    if (endTile <= startTile) return undefined
    const tileStride = getFilmstripTileStride(startTile, endTile)

    const totalFrameCount = Math.max(1, Math.ceil(sourceDuration))
    const indices = new Set<number>()
    for (let slot = startTile; slot < endTile; slot += tileStride) {
      const slotCenterX = slot * tileWidth + tileWidth * tileStride * 0.5
      const slotCenterTime = isReversed
        ? effectiveEnd - slotCenterX / pixelsPerSourceSecond
        : effectiveStart + slotCenterX / pixelsPerSourceSecond
      indices.add(Math.max(0, Math.min(totalFrameCount - 1, Math.floor(slotCenterTime))))
    }

    return indices.size > 0 ? Array.from(indices).sort((a, b) => a - b) : undefined
  }, [
    isVisible,
    height,
    renderPixelsPerSecond,
    effectiveEnd,
    effectiveStart,
    sourceDuration,
    speed,
    thumbnailWidth,
    filmstripRenderWindow,
    isReversed,
  ])

  // Load blob URL lazily when visible, and retry after global invalidation.
  useEffect(() => {
    if (!isVisible || !mediaId || proxyBlobUrl || hasStartedLoadingRef.current) {
      return
    }
    hasStartedLoadingRef.current = true

    let mounted = true
    const loadBlobUrl = async () => {
      try {
        const url = await resolveMediaUrl(mediaId)
        if (mounted && url) {
          setBlobUrl(url)
        }
      } catch (error) {
        logger.error('Failed to load media blob URL:', error)
      }
    }

    loadBlobUrl()

    return () => {
      mounted = false
    }
  }, [mediaId, isVisible, proxyBlobUrl, blobUrlVersion, hasStartedLoadingRef, setBlobUrl])

  // Use filmstrip hook. `enabled` no longer requires the source blob URL —
  // disk-cached frames can render before useMediaBlobUrl resolves. The
  // extraction path inside the hook still gates on blobUrl.
  const { frames, isLoading, error } = useFilmstrip({
    mediaId,
    blobUrl: filmstripSourceUrl,
    duration: sourceDuration,
    isVisible,
    enabled: sourceDuration > 0,
    priorityWindow,
    targetFrameCount,
    targetFrameIndices,
  })
  const [stableFrames, setStableFrames] = useState<FilmstripFrame[] | null>(null)

  useEffect(() => {
    setStableFrames(null)
  }, [mediaId])

  useEffect(() => {
    if (!frames || frames.length === 0) {
      if (!isLoading) {
        setStableFrames(null)
      }
      return
    }

    setStableFrames((current) => {
      if (isLoading && current && current.length > 0) {
        return current
      }
      return frames
    })
  }, [frames, isLoading])

  const renderFrames = stableFrames ?? frames

  const handleFrameSourceError = useCallback(
    (frameIndex: number) => {
      if (!mediaId || refreshingFrameIndicesRef.current.has(frameIndex)) {
        return
      }

      refreshingFrameIndicesRef.current.add(frameIndex)
      void filmstripCache
        .refreshFrames(mediaId, [frameIndex])
        .catch((refreshError) => {
          logger.warn('Failed to refresh stale filmstrip frame URL:', refreshError)
        })
        .finally(() => {
          refreshingFrameIndicesRef.current.delete(frameIndex)
        })
    },
    [mediaId],
  )

  // Share one stable fallback frame per media item. Every clip instance then
  // reuses the same decoded source across virtualization and zoom remounts.
  const coverFrame = useMemo(() => {
    if (!renderFrames || renderFrames.length === 0) return null
    const cachedIndex = coverFrameIndexByMediaId.get(mediaId)
    if (cachedIndex !== undefined) {
      const exact = renderFrames.find((frame) => frame.index === cachedIndex)
      if (exact) return exact
    }
    const fallback = renderFrames[Math.floor(renderFrames.length / 2)] ?? renderFrames[0] ?? null
    if (fallback) {
      coverFrameIndexByMediaId.set(mediaId, fallback.index)
    }
    return fallback
  }, [mediaId, renderFrames])
  if (error) {
    return null
  }

  // Show skeleton while actively loading.
  if (!renderFrames || renderFrames.length === 0 || height === 0) {
    if (!isLoading && height > 0) {
      return <div ref={containerRef} className="absolute inset-0" />
    }
    return (
      <div ref={containerRef} className="absolute inset-0">
        <FilmstripSkeleton clipWidth={visibleClipWidth} height={height || 40} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      data-filmstrip-fallback
      style={{
        backgroundImage: coverFrame?.url ? `url(${coverFrame.url})` : undefined,
        backgroundRepeat: 'repeat-x',
        backgroundSize: `${thumbnailWidth}px ${height}px`,
      }}
    >
      <VisibleFilmstripCanvas
        renderWidth={renderClipWidth}
        height={height}
        visibleStartPx={filmstripRenderWindow.paddedStartX}
        visibleEndPx={filmstripRenderWindow.paddedEndX}
        frames={renderFrames}
        pixelsPerSecond={renderPixelsPerSecond}
        effectiveStart={effectiveStart}
        effectiveEnd={effectiveEnd}
        speed={speed}
        isReversed={isReversed}
        tileWidth={thumbnailWidth}
        coverFrame={coverFrame}
        onSourceError={handleFrameSourceError}
        liveTimelineViewport={!preferImmediateRendering && isVisible}
        liveViewportOverscanPx={CLIP_VISIBILITY_PREFETCH_MARGIN_PX}
      />
    </div>
  )
})
