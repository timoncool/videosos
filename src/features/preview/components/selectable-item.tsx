import { useMemo, useState, useCallback } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { CoordinateParams, Transform } from '../types/gizmo'
import { getScreenTransformOrigin, transformToScreenBounds } from '../utils/coordinate-transform'
import { notifyOnBlockedMouseDragIntent } from '../utils/mouse-drag-intent'

interface SelectableItemProps {
  item: TimelineItem
  transform: Transform
  coordParams: CoordinateParams
  isSelected?: boolean
  onSelect: (e: React.MouseEvent) => void
  /** Called on mousedown to start dragging immediately */
  onDragStart?: (e: React.MouseEvent, transform: Transform) => void
  /** Linked Position owns translation, but the item remains selectable. */
  translateBlocked?: boolean
  translateBlockedLabel?: string
  /** Called only when a blocked item is moved far enough to begin a drag. */
  onTranslateBlocked?: () => void
}

/**
 * Clickable hit area for unselected items in the preview canvas.
 * Renders a transparent overlay matching the item's transform bounds.
 * Shows subtle hover state for discoverability.
 */
export function SelectableItem({
  item,
  transform,
  coordParams,
  isSelected = false,
  onSelect,
  onDragStart,
  translateBlocked = false,
  translateBlockedLabel,
  onTranslateBlocked,
}: SelectableItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const transformOrigin = useMemo(() => {
    return getScreenTransformOrigin(transform, coordParams)
  }, [coordParams, transform])

  // Convert to screen bounds for positioning, expanding for stroke width on shapes
  const screenBounds = useMemo(() => {
    const bounds = transformToScreenBounds(transform, coordParams)

    // Expand bounds for stroke width on shape items
    if (item.type === 'shape') {
      const strokeWidth = item.strokeWidth ?? 0

      if (strokeWidth > 0) {
        // Scale stroke width to screen space
        const scale = coordParams.playerSize.width / coordParams.projectSize.width
        const screenStroke = strokeWidth * scale

        // Expand bounds by half stroke on each side (stroke is centered on path)
        bounds.left -= screenStroke / 2
        bounds.top -= screenStroke / 2
        bounds.width += screenStroke
        bounds.height += screenStroke
      }
    }

    return bounds
  }, [transform, coordParams, item])

  // Handle mousedown - select and start dragging in one motion
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      // Select the item first
      onSelect(e)

      if (translateBlocked) {
        if (onTranslateBlocked) {
          notifyOnBlockedMouseDragIntent(e, onTranslateBlocked)
        }
        return
      }

      // Start dragging immediately if handler provided
      onDragStart?.(e, transform)
    },
    [onSelect, onDragStart, onTranslateBlocked, transform, translateBlocked],
  )

  // Only show hover state for unselected items (selected items have gizmo)
  const showHover = isHovered && !isSelected

  return (
    <div
      className="absolute cursor-move"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `rotate(${transform.rotation}deg)`,
        transformOrigin,
        // Z-index to render above GroupGizmo border but below handles
        zIndex: 5,
        // Subtle hover indicator (only for unselected items) - outline only
        border: showHover ? '3px solid rgba(249, 115, 22, 0.4)' : '2px solid transparent',
      }}
      data-gizmo="selectable-item"
      data-translate-blocked={translateBlocked || undefined}
      aria-label={translateBlocked ? translateBlockedLabel : undefined}
      title={translateBlocked ? translateBlockedLabel : undefined}
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    />
  )
}
