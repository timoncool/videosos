import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '../stores/items-store'
import { commitTrackHeights, resetTrackHeights } from '../stores/actions/track-height-actions'
import { resizeAllTracksInList, resizeTrackInList } from '../utils/track-resize'
import { getTrackKind } from '../utils/classic-tracks'
import { flushTrackHeightOverrides } from '../utils/track-heights'
import { createRafCoalescedCallback } from '../utils/raf-coalesced-callback'

interface TrackResizeState {
  trackId: string | null
  startY: number
  startHeight: number
  currentHeight: number
  deltaDirection: -1 | 1
  applyToAll: boolean
  didChange: boolean
}

const IDLE_RESIZE_STATE: TrackResizeState = {
  trackId: null,
  startY: 0,
  startHeight: 0,
  currentHeight: 0,
  deltaDirection: 1,
  applyToAll: false,
  didChange: false,
}

export function useTrackHeightResize() {
  const [resizeState, setResizeState] = useState<TrackResizeState>(IDLE_RESIZE_STATE)
  const resizeStateRef = useRef(resizeState)
  resizeStateRef.current = resizeState

  const finishResize = useCallback(() => {
    const state = resizeStateRef.current
    if (!state.trackId) return

    // Overrides accumulate in memory during the drag; land them on mouseup.
    if (state.didChange) {
      flushTrackHeightOverrides()
    }

    setResizeState(IDLE_RESIZE_STATE)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const state = resizeStateRef.current
    if (!state.trackId) return

    event.preventDefault()
    event.stopPropagation()

    const currentTracks = useItemsStore.getState().tracks
    const nextHeight = state.startHeight + (event.clientY - state.startY) * state.deltaDirection
    const nextTracks = state.applyToAll
      ? resizeAllTracksInList(currentTracks, nextHeight)
      : resizeTrackInList(currentTracks, state.trackId, nextHeight)

    if (nextTracks === currentTracks) {
      return
    }

    const resizedTrack = nextTracks.find((track) => track.id === state.trackId)
    if (!resizedTrack) return

    commitTrackHeights(nextTracks)

    setResizeState((prev) => ({
      ...prev,
      currentHeight: resizedTrack.height,
      didChange: true,
    }))
  }, [])

  const handleMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!resizeStateRef.current.trackId) return

      event.preventDefault()
      event.stopPropagation()
      finishResize()
    },
    [finishResize],
  )

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, trackId: string) => {
      const track = useItemsStore.getState().tracks.find((candidate) => candidate.id === trackId)
      if (!track) return

      event.preventDefault()
      event.stopPropagation()
      usePlaybackStore.getState().setPreviewFrame(null)

      setResizeState({
        trackId,
        startY: event.clientY,
        startHeight: track.height,
        currentHeight: track.height,
        deltaDirection: getTrackKind(track) === 'audio' ? 1 : -1,
        applyToAll: event.altKey,
        didChange: false,
      })

      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [],
  )

  const handleResizeReset = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, trackId: string) => {
      const track = useItemsStore.getState().tracks.find((candidate) => candidate.id === trackId)
      if (!track) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      // Reset drops the override so the track follows the saved Track Size
      // preset again — not the built-in default, which would silently discard
      // the user's choice.
      resetTrackHeights(trackId, event.altKey)
      flushTrackHeightOverrides()
    },
    [],
  )

  useEffect(() => {
    if (!resizeState.trackId) return

    // Each move commits a new tracks array (re-rendering every row), so coalesce
    // the high-frequency pointer stream to at most one commit per frame.
    const coalescedMouseMove = createRafCoalescedCallback(handleMouseMove)
    const queueMouseMove = (event: MouseEvent) => coalescedMouseMove.queue(event)
    const handleCoalescedMouseUp = (event: MouseEvent) => {
      coalescedMouseMove.flush()
      handleMouseUp(event)
    }

    document.addEventListener('mousemove', queueMouseMove, { capture: true })
    document.addEventListener('mouseup', handleCoalescedMouseUp, { capture: true })

    const preventClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener('click', preventClick, { capture: true, once: true })

    return () => {
      coalescedMouseMove.cancel()
      document.removeEventListener('mousemove', queueMouseMove, { capture: true })
      document.removeEventListener('mouseup', handleCoalescedMouseUp, { capture: true })
      document.removeEventListener('click', preventClick, { capture: true })
    }
  }, [handleMouseMove, handleMouseUp, resizeState.trackId])

  return {
    handleTrackResizeStart: handleResizeStart,
    handleTrackResizeReset: handleResizeReset,
  }
}
