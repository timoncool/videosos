/**
 * Playback & Navigation shortcuts: Space, Arrow Left/Right, Home/End, Up/Down snap points.
 */

import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useItemsStore } from '../../stores/items-store'
import { useMarkersStore } from '../../stores/markers-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { getFilteredItemSnapEdges } from '../../utils/timeline-snap-utils'
import { getVisibleTrackIds } from '../../utils/group-utils'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'

/** Compute snap points on-demand from current store state (avoids reactive subscriptions). */
function getSnapPoints(): number[] {
  const items = useItemsStore.getState().items
  const markers = useMarkersStore.getState().markers
  const transitions = useTransitionsStore.getState().transitions
  const tracks = useItemsStore.getState().tracks
  const visibleTrackIds = getVisibleTrackIds(tracks)
  const points = new Set<number>()

  for (const edge of getFilteredItemSnapEdges(items, transitions, visibleTrackIds)) {
    points.add(edge.frame)
  }
  for (const marker of markers) {
    points.add(marker.frame)
  }
  return Array.from(points).sort((a, b) => a - b)
}

export function usePlaybackShortcuts(callbacks: TimelineShortcutCallbacks) {
  const hotkeys = useResolvedHotkeys()
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const shuttleForward = usePlaybackStore((s) => s.shuttleForward)
  const shuttleReverse = usePlaybackStore((s) => s.shuttleReverse)
  const pause = usePlaybackStore((s) => s.pause)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const setDisplayedFrame = usePreviewBridgeStore((s) => s.setDisplayedFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const commitTimelineSeek = useCallback(
    (frame: number) => {
      setPreviewFrame(null)
      setDisplayedFrame(null)
      setCurrentFrame(frame)
    },
    [setPreviewFrame, setDisplayedFrame, setCurrentFrame],
  )

  // Playback: Space - Play/Pause
  useHotkeys(
    hotkeys.PLAY_PAUSE,
    (event) => {
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.toggle()
        return
      }
      togglePlayPause()
      if (isPlaying && callbacks.onPause) {
        callbacks.onPause()
      } else if (!isPlaying && callbacks.onPlay) {
        callbacks.onPlay()
      }
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [togglePlayPause, isPlaying, callbacks],
  )

  // Shuttle: L advances forward through 1x, 2x, and 4x. Ignore browser key
  // repeat so one physical press produces one transport transition.
  useHotkeys(
    'l',
    (event) => {
      if (event.repeat) return
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.shuttleForward()
        return
      }
      const wasPlaying = usePlaybackStore.getState().isPlaying
      shuttleForward()
      if (!wasPlaying) {
        callbacks.onPlay?.()
      }
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [callbacks, shuttleForward],
  )

  // Shuttle: J mirrors L in reverse. Browser media stays on a paused visual
  // seek path for negative rates; the Clock still advances at display cadence.
  useHotkeys(
    'j',
    (event) => {
      if (event.repeat) return
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.shuttleReverse()
        return
      }
      const wasPlaying = usePlaybackStore.getState().isPlaying
      shuttleReverse()
      if (!wasPlaying) {
        callbacks.onPlay?.()
      }
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [callbacks, shuttleReverse],
  )

  // K owns pause only while a transport is active. When already paused it
  // yields to the existing Edit keyframe shortcut.
  useHotkeys(
    'k',
    (event) => {
      if (event.repeat) return
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        if (!playerMethods.isPlaying()) return
        event.preventDefault()
        event.stopPropagation()
        playerMethods.pause()
        return
      }
      if (!usePlaybackStore.getState().isPlaying) return
      event.preventDefault()
      event.stopPropagation()
      pause()
      callbacks.onPause?.()
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [callbacks, pause],
  )

  // Navigation: Arrow Left - Previous frame
  useHotkeys(
    hotkeys.PREVIOUS_FRAME,
    (event) => {
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.frameBack(1)
        return
      }
      const currentFrame = usePlaybackStore.getState().currentFrame
      commitTimelineSeek(Math.max(0, currentFrame - 1))
    },
    HOTKEY_OPTIONS,
    [commitTimelineSeek],
  )

  // Navigation: Arrow Right - Next frame
  useHotkeys(
    hotkeys.NEXT_FRAME,
    (event) => {
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.frameForward(1)
        return
      }
      const currentFrame = usePlaybackStore.getState().currentFrame
      commitTimelineSeek(currentFrame + 1)
    },
    HOTKEY_OPTIONS,
    [commitTimelineSeek],
  )

  // Navigation: Home - Go to start
  useHotkeys(
    hotkeys.GO_TO_START,
    (event) => {
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.seek(0)
        return
      }
      commitTimelineSeek(0)
    },
    HOTKEY_OPTIONS,
    [commitTimelineSeek],
  )

  // Navigation: End - Go to end of timeline (last frame of last item)
  useHotkeys(
    hotkeys.GO_TO_END,
    (event) => {
      event.preventDefault()
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState()
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.seek(playerMethods.getDurationInFrames() - 1)
        return
      }
      const currentItems = useItemsStore.getState().items
      const lastFrame = currentItems.reduce((max, item) => {
        const itemEnd = item.from + item.durationInFrames
        return Math.max(max, itemEnd)
      }, 0)
      commitTimelineSeek(lastFrame)
    },
    HOTKEY_OPTIONS,
    [commitTimelineSeek],
  )

  // Navigation: Down - Jump to next snap point (clip edge or marker)
  useHotkeys(
    hotkeys.NEXT_SNAP_POINT,
    (event) => {
      event.preventDefault()
      const currentFrame = usePlaybackStore.getState().currentFrame
      const nextEdge = getSnapPoints().find((edge) => edge > currentFrame)
      if (nextEdge !== undefined) {
        commitTimelineSeek(nextEdge)
      }
    },
    HOTKEY_OPTIONS,
    [commitTimelineSeek],
  )

  // Navigation: Up - Jump to previous snap point (clip edge or marker)
  useHotkeys(
    hotkeys.PREVIOUS_SNAP_POINT,
    (event) => {
      event.preventDefault()
      const currentFrame = usePlaybackStore.getState().currentFrame
      const snapPoints = getSnapPoints()
      let previousEdge: number | undefined
      for (let i = snapPoints.length - 1; i >= 0; i--) {
        if (snapPoints[i]! < currentFrame) {
          previousEdge = snapPoints[i]!
          break
        }
      }
      if (previousEdge !== undefined) {
        commitTimelineSeek(previousEdge)
      }
    },
    HOTKEY_OPTIONS,
    [commitTimelineSeek],
  )
}
