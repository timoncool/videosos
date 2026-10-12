/**
 * Timing-strip drag hook.
 * Owns the preview-frames state surfaced to KeyframeTimingStrip + graph
 * preview, the ref mirror used during slide-end commit, and the four
 * timing-strip handlers (selection change, slide start/change/end).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type PreviewFrames = Record<string, number> | null

interface SelectionFramePreview {
  previewFrames: PreviewFrames
}

interface UseTimingStripDragOptions {
  disabled: boolean
  onKeyframeMove?: unknown
  onSelectionChange?: (keyframeIds: Set<string>) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  buildSelectionFramePreview: (
    selectionIds: Iterable<string>,
    requestedDeltaFrames: number,
  ) => SelectionFramePreview
  commitSelectionFramePreview: (
    selectionIds: Iterable<string>,
    previewFrames: PreviewFrames,
  ) => unknown
}

export interface UseTimingStripDragReturn {
  timingStripPreviewFrames: PreviewFrames
  handleTimingStripSelectionChange: (selectedIds: Set<string>) => void
  handleTimingStripSlideStart: (selectedIds: string[]) => void
  handleTimingStripSlideChange: (deltaFrames: number, selectedIds: string[]) => void
  handleTimingStripSlideEnd: (selectedIds: string[]) => void
}

export function useTimingStripDrag({
  disabled,
  onKeyframeMove,
  onSelectionChange,
  onDragStart,
  onDragEnd,
  buildSelectionFramePreview,
  commitSelectionFramePreview,
}: UseTimingStripDragOptions): UseTimingStripDragReturn {
  const [timingStripPreviewFrames, setTimingStripPreviewFrames] = useState<PreviewFrames>(null)
  const timingStripPreviewFramesRef = useRef<PreviewFrames>(null)
  const timingStripDraggedIdsRef = useRef<string[]>([])

  useEffect(() => {
    timingStripPreviewFramesRef.current = timingStripPreviewFrames
  }, [timingStripPreviewFrames])

  const handleTimingStripSelectionChange = useCallback(
    (selectedIds: Set<string>) => {
      onSelectionChange?.(selectedIds)
    },
    [onSelectionChange],
  )

  const handleTimingStripSlideStart = useCallback(
    (selectedIds: string[]) => {
      if (disabled || !onKeyframeMove || selectedIds.length === 0) {
        return
      }

      timingStripDraggedIdsRef.current = selectedIds
      onDragStart?.()
    },
    [disabled, onDragStart, onKeyframeMove],
  )

  const handleTimingStripSlideChange = useCallback(
    (deltaFrames: number, selectedIds: string[]) => {
      timingStripDraggedIdsRef.current = selectedIds
      const preview = buildSelectionFramePreview(selectedIds, deltaFrames)
      setTimingStripPreviewFrames(preview.previewFrames)
    },
    [buildSelectionFramePreview],
  )

  const handleTimingStripSlideEnd = useCallback(
    (selectedIds: string[]) => {
      const dragIds = selectedIds.length > 0 ? selectedIds : timingStripDraggedIdsRef.current
      commitSelectionFramePreview(dragIds, timingStripPreviewFramesRef.current)
      timingStripDraggedIdsRef.current = []
      setTimingStripPreviewFrames(null)
      onDragEnd?.()
    },
    [commitSelectionFramePreview, onDragEnd],
  )

  return {
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  }
}
