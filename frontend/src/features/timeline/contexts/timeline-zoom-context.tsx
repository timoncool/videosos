/**
 * Timeline Zoom Utilities
 *
 * Provides zoom-related values and helper functions for timeline components.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { useSettledZoomStore, useZoomStore } from '../stores/zoom-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'

export const SettledContentPixelsPerSecondContext = createContext<number | null>(null)

const subscribeToNothing = () => () => {}
const getNullZoomSnapshot = () => null
const subscribeToLiveZoom = (onStoreChange: () => void) => useZoomStore.subscribe(onStoreChange)
const subscribeToSettledZoom = (onStoreChange: () => void) =>
  useSettledZoomStore.subscribe(onStoreChange)
const getLivePixelsPerSecondSnapshot = () => useZoomStore.getState().pixelsPerSecond
const getSettledPixelsPerSecondSnapshot = () =>
  useSettledZoomStore.getState().contentPixelsPerSecond

/**
 * Reads settled content geometry through the concurrent bridge when mounted in
 * the main timeline. Standalone consumers (including focused tests) retain the
 * direct store fallback. Active edit previews deliberately bypass the bridge
 * and stay on the live zoom value.
 */
export function useTimelineContentPixelsPerSecond(preferImmediateRendering = false): number {
  const bridgedPixelsPerSecond = useContext(SettledContentPixelsPerSecondContext)
  const useDirectSettledZoom = !preferImmediateRendering && bridgedPixelsPerSecond === null
  const directPixelsPerSecond = useSyncExternalStore(
    preferImmediateRendering
      ? subscribeToLiveZoom
      : useDirectSettledZoom
        ? subscribeToSettledZoom
        : subscribeToNothing,
    preferImmediateRendering
      ? getLivePixelsPerSecondSnapshot
      : useDirectSettledZoom
        ? getSettledPixelsPerSecondSnapshot
        : getNullZoomSnapshot,
    preferImmediateRendering
      ? getLivePixelsPerSecondSnapshot
      : useDirectSettledZoom
        ? getSettledPixelsPerSecondSnapshot
        : getNullZoomSnapshot,
  )

  if (preferImmediateRendering) {
    return directPixelsPerSecond ?? getLivePixelsPerSecondSnapshot()
  }
  return bridgedPixelsPerSecond ?? directPixelsPerSecond ?? 0
}

interface TimelineZoomValue {
  zoomLevel: number
  pixelsPerSecond: number
  timeToPixels: (timeInSeconds: number) => number
  pixelsToTime: (pixels: number) => number
  frameToPixels: (frame: number) => number
  pixelsToFrame: (pixels: number) => number
  fps: number
}

function useTimelineZoomValue(
  zoomLevelSelector: (state: ReturnType<typeof useZoomStore.getState>) => number,
  pixelsPerSecondSelector: (state: ReturnType<typeof useZoomStore.getState>) => number,
): TimelineZoomValue {
  const zoomLevel = useZoomStore(zoomLevelSelector)
  const pixelsPerSecond = useZoomStore(pixelsPerSecondSelector)
  const fps = useTimelineSettingsStore((s) => s.fps)

  return useMemo(
    () => ({
      zoomLevel,
      pixelsPerSecond,
      fps,
      timeToPixels: (t: number) => t * pixelsPerSecond,
      pixelsToTime: (p: number) => (pixelsPerSecond > 0 ? p / pixelsPerSecond : 0),
      frameToPixels: (f: number) => (f / fps) * pixelsPerSecond,
      pixelsToFrame: (p: number) => Math.round((p / pixelsPerSecond) * fps),
    }),
    [zoomLevel, pixelsPerSecond, fps],
  )
}

/**
 * Hook to get timeline zoom values and helper functions.
 *
 * Reads directly from Zustand stores.
 */
export function useTimelineZoomContext(): TimelineZoomValue {
  return useTimelineZoomValue(
    (s) => s.level,
    (s) => s.pixelsPerSecond,
  )
}

/** Settled geometry hook for expensive clip and waveform content. */
export function useTimelineCommittedZoomContext(): TimelineZoomValue {
  const zoomLevel = useSettledZoomStore((state) => state.contentLevel)
  const pixelsPerSecond = useSettledZoomStore((state) => state.contentPixelsPerSecond)
  const fps = useTimelineSettingsStore((state) => state.fps)

  return useMemo(
    () => ({
      zoomLevel,
      pixelsPerSecond,
      fps,
      timeToPixels: (time: number) => time * pixelsPerSecond,
      pixelsToTime: (pixels: number) => (pixelsPerSecond > 0 ? pixels / pixelsPerSecond : 0),
      frameToPixels: (frame: number) => (frame / fps) * pixelsPerSecond,
      pixelsToFrame: (pixels: number) => Math.round((pixels / pixelsPerSecond) * fps),
    }),
    [fps, pixelsPerSecond, zoomLevel],
  )
}
