// React and external libraries
import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'

// Stores and selectors
import { useMarkersStore } from '../stores/markers-store'
import { updateMarker } from '../stores/timeline-actions'
import { useSelectionStore } from '@/shared/state/selection'

// Utilities and hooks
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { resolveMarkerNames } from '@/shared/timeline/marker-names'
import { pixelsToFrameNow } from '../utils/zoom-conversions'

// Types
import type { ProjectMarker } from '@/types/timeline'

/**
 * Timeline Project Markers Component
 *
 * Renders user-created markers on the timeline ruler
 * - Triangle handles pointing down (like playhead diamond but inverted)
 * - Vertical line across the ruler
 * - Draggable for repositioning
 * - Shows the marker's label on hover
 */
export const TimelineProjectMarkers = memo(function TimelineProjectMarkers() {
  const { t } = useTranslation()
  const markers = useMarkersStore((s) => s.markers)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const selectMarker = useSelectionStore((s) => s.selectMarker)
  const { frameToPixels } = useTimelineCommittedZoomContext()

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const markerNames = useMemo(
    () => resolveMarkerNames(markers, (index) => t('timeline.markerName', { index })),
    [markers, t],
  )

  // Use refs to avoid stale closures
  const pixelsToFrameRef = useRef(pixelsToFrameNow)
  const updateMarkerRef = useRef(updateMarker)

  // Update refs when functions change
  useEffect(() => {
    updateMarkerRef.current = updateMarker
  }, [])

  // Handle drag start and selection
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, markerId: string) => {
      e.preventDefault()
      e.stopPropagation()
      // Select the marker (clears any clip selection)
      selectMarker(markerId)
      setDraggingId(markerId)
    },
    [selectMarker],
  )

  // Handle dragging
  useEffect(() => {
    if (!draggingId) return

    const originalCursor = document.body.style.cursor
    document.body.style.cursor = 'grabbing'

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current?.closest('.timeline-ruler')
      if (!container) return

      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const frame = Math.max(0, pixelsToFrameRef.current(x))

      updateMarkerRef.current(draggingId, { frame })
    }

    const handleMouseUp = () => {
      setDraggingId(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = originalCursor
    }
  }, [draggingId])

  if (markers.length === 0) return null

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      {markers.map((marker) => (
        <MarkerIndicator
          key={marker.id}
          marker={marker}
          markerId={marker.id}
          name={markerNames.get(marker.id) ?? ''}
          leftPosition={frameToPixels(marker.frame)}
          isDragging={draggingId === marker.id}
          isSelected={selectedMarkerId === marker.id}
          onMouseDown={handleMouseDown}
        />
      ))}
    </div>
  )
})

interface MarkerIndicatorProps {
  marker: ProjectMarker
  markerId: string
  /** The marker's label, or its "Marker N" fallback. */
  name: string
  leftPosition: number
  isDragging: boolean
  isSelected: boolean
  onMouseDown: (e: React.MouseEvent, markerId: string) => void
}

const MarkerIndicator = memo(function MarkerIndicator({
  marker,
  markerId,
  name,
  leftPosition,
  isDragging,
  isSelected,
  onMouseDown,
}: MarkerIndicatorProps) {
  // Stable callback that passes markerId
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onMouseDown(e, markerId)
    },
    [onMouseDown, markerId],
  )

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${leftPosition}px`,
        top: '-2px',
        transform: 'translateX(-50%)',
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: isSelected ? 20 : 15,
      }}
      onMouseDown={handleMouseDown}
      data-tooltip={name}
      data-tooltip-side="bottom"
    >
      {/* Invisible larger hit area */}
      <div
        className="absolute"
        style={{
          top: '-4px',
          left: '50%',
          width: '20px',
          height: '20px',
          transform: 'translateX(-50%)',
          backgroundColor: 'transparent',
        }}
      />
      {/* Selection outline triangle (larger, behind) */}
      {isSelected && (
        <div
          className="absolute"
          style={{
            top: '-4px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '12px solid transparent',
            borderRight: '12px solid transparent',
            borderTop: '18px solid white',
          }}
        />
      )}
      {/* Visible triangle (CSS triangle pointing down) */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: `12px solid ${marker.color}`,
          filter: `drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3))`,
        }}
      />
    </div>
  )
})
