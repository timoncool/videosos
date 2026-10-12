import { memo, useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import type { CompositionInputProps } from '@/types/export'
import { HeadlessPlayer, type PlayerRef } from '@/features/preview/deps/player-core'
import { MainComposition } from '@/features/preview/deps/composition-runtime'
import { useItemsStore } from '@/features/preview/deps/timeline-store'

interface DomTextScrubOverlayProps {
  playerRef: RefObject<PlayerRef | null>
  visible: boolean
  durationInFrames: number
  fps: number
  renderSize: { width: number; height: number }
  layoutSize: { width: number; height: number }
  inputProps: CompositionInputProps
}

const ignoreFrameChange = () => undefined
const ignorePlayStateChange = () => undefined

/**
 * A text-only Player that remains mounted beside the primary composition.
 * Scrub updates are coalesced to one seek per animation frame, keeping native
 * DOM/CSS text metrics without making media elements participate in the seek.
 */
export const DomTextScrubOverlay = memo(function DomTextScrubOverlay({
  playerRef,
  visible,
  durationInFrames,
  fps,
  renderSize,
  layoutSize,
  inputProps,
}: DomTextScrubOverlayProps) {
  const pendingFrameRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)

  const flushFrame = useCallback(() => {
    rafRef.current = null
    const frame = pendingFrameRef.current
    pendingFrameRef.current = null
    if (frame === null || frame === lastFrameRef.current || !playerRef.current) return
    playerRef.current.seekTo(frame)
    lastFrameRef.current = frame
  }, [playerRef])

  useLayoutEffect(() => {
    if (!visible) return

    const queueFrame = (frame: number) => {
      pendingFrameRef.current = Math.max(0, Math.round(frame))
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushFrame)
      }
    }
    const getVisibleFrame = () => {
      const playbackState = usePlaybackStore.getState()
      return getResolvedPlaybackFrame({
        currentFrame: playbackState.currentFrame,
        currentFrameEpoch: playbackState.currentFrameEpoch,
        previewFrame: playbackState.previewFrame,
        previewFrameEpoch: playbackState.previewFrameEpoch,
        isPlaying: playbackState.isPlaying,
        displayedFrame: usePreviewBridgeStore.getState().displayedFrame,
      })
    }
    let resolvedFrame = getVisibleFrame()
    queueFrame(resolvedFrame)

    const syncVisibleFrame = () => {
      const frame = getVisibleFrame()
      if (frame === resolvedFrame) return
      resolvedFrame = frame
      queueFrame(frame)
    }
    const unsubscribePlayback = usePlaybackStore.subscribe(syncVisibleFrame)
    const unsubscribePreviewBridge = usePreviewBridgeStore.subscribe(syncVisibleFrame)

    return () => {
      unsubscribePlayback()
      unsubscribePreviewBridge()
      pendingFrameRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [flushFrame, visible])

  return (
    <div
      aria-hidden="true"
      data-dom-text-scrub-overlay
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 6,
        visibility: visible ? 'visible' : 'hidden',
        contain: 'layout paint style',
      }}
    >
      <HeadlessPlayer
        ref={playerRef}
        durationInFrames={durationInFrames}
        fps={fps}
        width={renderSize.width}
        height={renderSize.height}
        autoPlay={false}
        loop={false}
        layoutSize={layoutSize}
        style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
        onFrameChange={ignoreFrameChange}
        onPlayStateChange={ignorePlayStateChange}
      >
        <MainComposition
          {...inputProps}
          backgroundColor="transparent"
          useProxyMedia
          transparentBackground
          liveItemTransformSource={useItemsStore}
        />
      </HeadlessPlayer>
    </div>
  )
})
