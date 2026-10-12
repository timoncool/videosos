import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompositionInputProps } from '@/types/export'
import { usePlaybackStore } from '@/shared/state/playback'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  useCompositionsStore,
} from '@/features/preview/deps/timeline-contract'
import { resolveMediaUrls } from '@/features/preview/deps/media-library-contract'
import {
  importCompositionRenderer,
  type CompositionRendererInstance,
} from '@/features/preview/deps/export'
import { createLogger } from '@/shared/logging/logger'
import { getPreviewNeedsOverflow, getPreviewPlayerSize } from '../utils/preview-pixel-snap'
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager'
import { useComparisonCompositionFrame } from './use-comparison-composition-frame'

const RESOLVED_TRACK_CACHE_LIMIT = 12
const COMPARISON_LOADING_DELAY_MS = 80
const resolvedTrackPromiseCache = new Map<string, Promise<CompositionInputProps['tracks']>>()

function getOrCreateResolvedTrackPromise(
  key: string,
  load: () => Promise<CompositionInputProps['tracks']>,
): Promise<CompositionInputProps['tracks']> {
  const cached = resolvedTrackPromiseCache.get(key)
  if (cached) {
    resolvedTrackPromiseCache.delete(key)
    resolvedTrackPromiseCache.set(key, cached)
    return cached
  }

  const promise = load().catch((error) => {
    if (resolvedTrackPromiseCache.get(key) === promise) {
      resolvedTrackPromiseCache.delete(key)
    }
    throw error
  })
  resolvedTrackPromiseCache.set(key, promise)
  while (resolvedTrackPromiseCache.size > RESOLVED_TRACK_CACHE_LIMIT) {
    const oldestKey = resolvedTrackPromiseCache.keys().next().value
    if (oldestKey === undefined) break
    resolvedTrackPromiseCache.delete(oldestKey)
  }
  return promise
}

function getLogger() {
  return createLogger('InlineCompositionPreview')
}

function reportInitializationFailure(cancelled: boolean, error: unknown): void {
  if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
    getLogger().warn('Failed to initialize inline composition renderer', { error })
  }
}

interface InlineCompositionPreviewProps {
  compositionId: string
  seekFrame: number | null
  containerSize: {
    width: number
    height: number
  }
  presentation?: 'workspace' | 'frame'
}

type InlinePresentation = NonNullable<InlineCompositionPreviewProps['presentation']>

function cloneComparisonTracks(
  presentation: InlinePresentation,
  input: CompositionInputProps | null,
): CompositionInputProps['tracks'] | null {
  if (presentation !== 'frame' || !input) return null
  return structuredClone(input.tracks)
}

function selectResolvedTracks({
  presentation,
  comparisonTracks,
  resolvedTrackResult,
  resolutionKey,
}: {
  presentation: InlinePresentation
  comparisonTracks: CompositionInputProps['tracks'] | null
  resolvedTrackResult: { key: string; tracks: CompositionInputProps['tracks'] } | null
  resolutionKey: string
}): CompositionInputProps['tracks'] | null {
  if (presentation === 'frame') return comparisonTracks
  if (resolvedTrackResult?.key !== resolutionKey) return null
  return resolvedTrackResult.tracks
}

function getComparisonSessionKey({
  presentation,
  rendererInput,
  resolutionKey,
  width,
  height,
}: {
  presentation: InlinePresentation
  rendererInput: CompositionInputProps | null
  resolutionKey: string
  width: number
  height: number
}): string | null {
  if (presentation !== 'frame' || !rendererInput) return null
  return `${resolutionKey}:${width}x${height}`
}

function selectRendererReady(
  presentation: InlinePresentation,
  comparisonReady: boolean,
  workspaceReady: boolean,
): boolean {
  return presentation === 'frame' ? comparisonReady : workspaceReady
}

function selectLoadingVisibility(
  presentation: InlinePresentation,
  comparisonLoading: boolean,
  loading: boolean,
): boolean {
  return presentation === 'frame' ? comparisonLoading : loading
}

export const InlineCompositionPreview = memo(function InlineCompositionPreview({
  compositionId,
  seekFrame,
  containerSize,
  presentation = 'workspace',
}: InlineCompositionPreviewProps) {
  const useProxy = usePlaybackStore((s) => s.useProxy)
  const requestKey = `${compositionId}:${useProxy ? 'proxy' : 'source'}`

  return (
    <InlineCompositionPreviewContent
      key={requestKey}
      compositionId={compositionId}
      seekFrame={seekFrame}
      containerSize={containerSize}
      presentation={presentation}
    />
  )
})

const InlineCompositionPreviewContent = memo(function InlineCompositionPreviewContent({
  compositionId,
  seekFrame,
  containerSize,
  presentation = 'workspace',
}: InlineCompositionPreviewProps) {
  const composition = useCompositionsStore((s) => s.compositionById[compositionId])
  const compositionGraphSignature = useCompositionsStore((s) =>
    buildSubCompositionPreviewSignature(compositionId, s.compositionById),
  )
  const zoom = usePlaybackStore((s) => s.zoom)
  const useProxy = usePlaybackStore((s) => s.useProxy)
  const blobUrlVersion = useBlobUrlVersion()
  const resolutionKey = `${compositionId}:${compositionGraphSignature}:${useProxy ? 'proxy' : 'source'}:${blobUrlVersion}`
  const [resolvedTrackResult, setResolvedTrackResult] = useState<{
    key: string
    tracks: CompositionInputProps['tracks']
  } | null>(null)

  const compositionInput = useMemo(() => {
    if (!composition || !compositionGraphSignature) return null
    return buildSubCompositionInput(composition)
  }, [composition, compositionGraphSignature])
  const comparisonTracks = useMemo(
    () => cloneComparisonTracks(presentation, compositionInput),
    [compositionInput, presentation],
  )
  const resolvedTracks = selectResolvedTracks({
    presentation,
    comparisonTracks,
    resolvedTrackResult,
    resolutionKey,
  })

  useEffect(() => {
    if (presentation === 'frame') {
      setResolvedTrackResult(null)
      return
    }
    if (!compositionInput) {
      setResolvedTrackResult(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setResolvedTrackResult(null)

    const loadResolvedTracks = async () => {
      const nextResolvedTracks = await getOrCreateResolvedTrackPromise(resolutionKey, async () => {
        return resolveMediaUrls(compositionInput.tracks, { useProxy })
      })
      if (controller.signal.aborted) return
      if (!cancelled) {
        setResolvedTrackResult({ key: resolutionKey, tracks: nextResolvedTracks })
      }
    }

    void loadResolvedTracks().catch(() => {
      if (!cancelled) {
        setResolvedTrackResult({ key: resolutionKey, tracks: [] })
      }
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [compositionId, compositionInput, presentation, resolutionKey, useProxy])

  const compositionWidth = composition?.width || 640
  const compositionHeight = composition?.height || 360
  const clampedSeekFrame = Math.min(
    Math.max(1, composition?.durationInFrames ?? 1) - 1,
    Math.max(0, seekFrame ?? 0),
  )
  const clampedSeekFrameRef = useRef(clampedSeekFrame)
  clampedSeekFrameRef.current = clampedSeekFrame

  const containerWidth = containerSize.width
  const containerHeight = containerSize.height
  const playerSize = useMemo(
    () =>
      getPreviewPlayerSize({
        sourceSize: { width: compositionWidth, height: compositionHeight },
        containerSize: { width: containerWidth, height: containerHeight },
        zoom,
      }),
    [compositionHeight, compositionWidth, containerHeight, containerWidth, zoom],
  )

  const needsOverflow = useMemo(
    () => getPreviewNeedsOverflow({ playerSize, containerSize, zoom }),
    [containerSize, playerSize, zoom],
  )

  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<CompositionRendererInstance | null>(null)
  const offscreenRef = useRef<OffscreenCanvas | null>(null)
  const lastPresentedFrameRef = useRef<number | null>(null)
  const [workspaceRendererReady, setWorkspaceRendererReady] = useState(false)

  const rendererInput = useMemo<CompositionInputProps | null>(() => {
    if (!compositionGraphSignature || !compositionInput || !resolvedTracks) return null
    return { ...compositionInput, tracks: resolvedTracks }
  }, [compositionGraphSignature, compositionInput, resolvedTracks])
  const comparisonSessionKey = getComparisonSessionKey({
    presentation,
    rendererInput,
    resolutionKey,
    width: compositionWidth,
    height: compositionHeight,
  })
  const comparisonRendererReady = useComparisonCompositionFrame({
    enabled: presentation === 'frame',
    sessionKey: comparisonSessionKey,
    compositionId,
    input: rendererInput,
    width: compositionWidth,
    height: compositionHeight,
    useProxyMedia: useProxy,
    frame: clampedSeekFrame,
    displayCanvasRef,
    onError: reportInitializationFailure,
  })
  const rendererReady = selectRendererReady(
    presentation,
    comparisonRendererReady,
    workspaceRendererReady,
  )

  const renderAndPresent = useCallback(
    async (
      renderer: CompositionRendererInstance,
      offscreen: OffscreenCanvas,
      frame: number,
    ): Promise<boolean> => {
      await renderer.renderFrame(frame)
      if (rendererRef.current !== renderer) return false
      const display = displayCanvasRef.current
      if (!display) return false
      const displayCtx = display.getContext('2d')
      if (!displayCtx) return false
      if (display.width !== offscreen.width || display.height !== offscreen.height) {
        display.width = offscreen.width
        display.height = offscreen.height
      }
      displayCtx.clearRect(0, 0, display.width, display.height)
      displayCtx.drawImage(offscreen, 0, 0, display.width, display.height)
      lastPresentedFrameRef.current = frame
      return true
    },
    [],
  )

  useEffect(() => {
    if (presentation === 'frame') return
    if (!rendererInput) {
      setWorkspaceRendererReady(false)
      return
    }
    if (typeof OffscreenCanvas === 'undefined') {
      setWorkspaceRendererReady(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    let createdRenderer: CompositionRendererInstance | null = null
    setWorkspaceRendererReady(false)
    lastPresentedFrameRef.current = null

    const offscreen = new OffscreenCanvas(compositionWidth, compositionHeight)
    const ctx = offscreen.getContext('2d')
    if (!ctx) {
      return
    }

    const boot = async () => {
      try {
        const { createCompositionRenderer } = await importCompositionRenderer()
        const renderer = await createCompositionRenderer(rendererInput, offscreen, ctx, {
          mode: 'preview',
          useProxyMedia: useProxy,
        })
        if (cancelled) {
          renderer.dispose()
          return
        }
        createdRenderer = renderer
        rendererRef.current = renderer
        offscreenRef.current = offscreen

        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline()
        }

        await renderer.preload({
          priorityFrame: clampedSeekFrameRef.current,
          signal: controller.signal,
        })
        if (cancelled) return
        const presented = await renderAndPresent(renderer, offscreen, clampedSeekFrameRef.current)
        if (!cancelled && presented) setWorkspaceRendererReady(true)
      } catch (error) {
        reportInitializationFailure(cancelled, error)
      }
    }

    void boot()

    return () => {
      cancelled = true
      controller.abort()
      if (createdRenderer) {
        try {
          createdRenderer.dispose()
        } catch (error) {
          getLogger().warn('Failed to dispose inline composition renderer', { error })
        }
      }
      if (rendererRef.current === createdRenderer) {
        rendererRef.current = null
        offscreenRef.current = null
      }
    }
  }, [rendererInput, compositionWidth, compositionHeight, presentation, useProxy, renderAndPresent])

  useEffect(() => {
    if (presentation === 'frame') return
    if (!rendererReady) return
    const renderer = rendererRef.current
    const offscreen = offscreenRef.current
    if (!renderer || !offscreen) return
    if (lastPresentedFrameRef.current === clampedSeekFrame) return

    let cancelled = false

    const run = async () => {
      try {
        const presented = await renderAndPresent(renderer, offscreen, clampedSeekFrame)
        if (cancelled) return
        if (!presented) return
      } catch (error) {
        if (!cancelled) {
          getLogger().debug('Inline composition frame render failed', {
            error,
            frame: clampedSeekFrame,
          })
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [clampedSeekFrame, presentation, rendererReady, renderAndPresent])

  const isLoading = !resolvedTracks || !rendererReady
  const [showDelayedComparisonLoading, setShowDelayedComparisonLoading] = useState(false)
  useEffect(() => {
    if (presentation !== 'frame' || !isLoading) {
      setShowDelayedComparisonLoading(false)
      return
    }
    const timer = setTimeout(
      () => setShowDelayedComparisonLoading(true),
      COMPARISON_LOADING_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [isLoading, presentation])

  if (!composition || !compositionInput) {
    return (
      <div className="w-full h-full bg-video-preview-background flex items-center justify-center text-sm text-muted-foreground">
        Loading compound clip...
      </div>
    )
  }

  const showLoading = selectLoadingVisibility(presentation, showDelayedComparisonLoading, isLoading)

  if (presentation === 'frame') {
    return (
      <div className="relative w-full h-full bg-black" aria-label="Compound clip frame preview">
        <canvas
          ref={displayCanvasRef}
          width={compositionWidth}
          height={compositionHeight}
          className="block w-full h-full object-contain"
        />
        {showLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-black/30">
            Loading compound clip...
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      aria-label="Inline compound clip preview"
    >
      <div
        className="min-w-full min-h-full grid place-items-center"
        style={{ padding: `calc(${EDITOR_LAYOUT_CSS_VALUES.previewPadding} / 2)` }}
      >
        <div className="relative">
          <div
            className="relative shadow-2xl overflow-hidden bg-black"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              outline: '2px solid hsl(var(--border))',
              outlineOffset: 0,
            }}
          >
            <canvas
              ref={displayCanvasRef}
              width={compositionWidth}
              height={compositionHeight}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
            {showLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-black/30">
                Loading compound clip...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
