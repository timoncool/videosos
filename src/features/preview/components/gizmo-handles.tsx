import type { CSSProperties } from 'react'
import type { CropEdge } from '../utils/crop-gizmo'
import type { GizmoHandle } from '../types/gizmo'
import { getScaleCursor, HANDLE_SIZE, ROTATION_HANDLE_OFFSET } from '../utils/coordinate-transform'

/**
 * Scale handle positions (corners and edges).
 */
const SCALE_HANDLES: GizmoHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNER_SCALE_HANDLES = new Set<GizmoHandle>(['nw', 'ne', 'se', 'sw'])

/**
 * Screen bounds for the gizmo container.
 */
interface ScreenBounds {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Props for GizmoHandles component.
 */
interface GizmoHandlesProps {
  /** Screen bounds of the gizmo */
  bounds: ScreenBounds
  /** Current rotation of the item (for cursor calculation) */
  rotation: number
  /** Whether currently interacting (darker border color) */
  isInteracting: boolean
  /** Whether this is a mask shape (uses cyan instead of orange) */
  isMask?: boolean
  /** Called when dragging starts on the border (translate) */
  onTranslateStart: (e: React.MouseEvent) => void
  /** Whether translation is owned by a linked Position property. */
  translateBlocked?: boolean
  translateBlockedLabel?: string
  /** Called when dragging starts on a scale handle */
  onScaleStart: (handle: GizmoHandle, e: React.MouseEvent) => void
  /** Called when dragging starts on the rotation handle */
  onRotateStart: (e: React.MouseEvent) => void
  /** Current crop viewport in screen pixels, relative to the gizmo container */
  cropRect?: { left: number; top: number; width: number; height: number }
  /** Called when dragging starts on a crop edge handle */
  onCropStart?: (edge: CropEdge, e: React.MouseEvent) => void
}

/**
 * Shared handle rendering for transform gizmos.
 *
 * Renders:
 * - Dashed selection border
 * - 8 scale handles (corners and edges)
 * - Rotation handle with guide line
 *
 * Used by both TransformGizmo and GroupGizmo.
 */
export function GizmoHandles({
  bounds,
  rotation,
  isInteracting,
  isMask = false,
  onTranslateStart,
  translateBlocked = false,
  translateBlockedLabel,
  onScaleStart,
  onRotateStart,
  cropRect,
  onCropStart,
}: GizmoHandlesProps) {
  // Get style for a scale handle
  const getHandleStyle = (handle: GizmoHandle): CSSProperties => {
    const half = HANDLE_SIZE / 2
    const { width, height } = bounds

    const positions: Record<string, { left: number; top: number }> = {
      nw: { left: -half, top: -half },
      n: { left: width / 2 - half, top: -half },
      ne: { left: width - half, top: -half },
      e: { left: width - half, top: height / 2 - half },
      se: { left: width - half, top: height - half },
      s: { left: width / 2 - half, top: height - half },
      sw: { left: -half, top: height - half },
      w: { left: -half, top: height / 2 - half },
    }

    return {
      position: 'absolute',
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      ...positions[handle],
      cursor: getScaleCursor(handle, rotation),
    }
  }

  // Border color based on mask state and interaction
  const borderColor = isMask
    ? isInteracting
      ? '#0891b2'
      : '#06b6d4' // Cyan for masks
    : isInteracting
      ? '#ea580c'
      : '#f97316' // Orange for regular

  return (
    <>
      {/* Selection border */}
      <div
        className="absolute cursor-move"
        style={{
          inset: -2,
          border: `2px dashed ${borderColor}`,
          boxSizing: 'border-box',
          zIndex: 101,
        }}
        role="button"
        aria-label={
          translateBlocked
            ? (translateBlockedLabel ?? 'Position is controlled by a property link')
            : 'Move selected element'
        }
        aria-disabled={translateBlocked || undefined}
        tabIndex={0}
        data-gizmo="border"
        data-translate-blocked={translateBlocked || undefined}
        onMouseDown={onTranslateStart}
        onDoubleClick={(e) => e.stopPropagation()}
      />

      {/* Scale handles */}
      {SCALE_HANDLES.filter((handle) => !cropRect || CORNER_SCALE_HANDLES.has(handle)).map(
        (handle) => {
          const handleLabels: Record<GizmoHandle, string> = {
            nw: 'Resize from top-left corner',
            n: 'Resize from top edge',
            ne: 'Resize from top-right corner',
            e: 'Resize from right edge',
            se: 'Resize from bottom-right corner',
            s: 'Resize from bottom edge',
            sw: 'Resize from bottom-left corner',
            w: 'Resize from left edge',
            rotate: 'Rotate element',
          }
          return (
            <div
              key={handle}
              className="bg-white border border-orange-500"
              style={{ ...getHandleStyle(handle), zIndex: 102 }}
              role="button"
              aria-label={handleLabels[handle]}
              tabIndex={0}
              data-gizmo={`scale-${handle}`}
              onMouseDown={(e) => onScaleStart(handle, e)}
            />
          )
        },
      )}

      {cropRect && onCropStart && (
        <>
          <div
            className="pointer-events-none absolute border border-orange-400/80"
            style={{
              left: cropRect.left,
              top: cropRect.top,
              width: cropRect.width,
              height: cropRect.height,
              boxSizing: 'border-box',
              zIndex: 102,
            }}
            data-gizmo="crop-outline"
          />
          {(['left', 'right', 'top', 'bottom'] as const).map((edge) => {
            const horizontal = edge === 'top' || edge === 'bottom'
            const width = horizontal ? 24 : 6
            const height = horizontal ? 6 : 24
            const left = horizontal
              ? cropRect.left + cropRect.width / 2 - width / 2
              : edge === 'left'
                ? cropRect.left - width / 2
                : cropRect.left + cropRect.width - width / 2
            const top = horizontal
              ? edge === 'top'
                ? cropRect.top - height / 2
                : cropRect.top + cropRect.height - height / 2
              : cropRect.top + cropRect.height / 2 - height / 2
            return (
              <div
                key={edge}
                className="absolute border border-white bg-orange-500 shadow-sm"
                style={{
                  left,
                  top,
                  width,
                  height,
                  cursor: getScaleCursor(
                    edge === 'left' ? 'w' : edge === 'right' ? 'e' : edge === 'top' ? 'n' : 's',
                    rotation,
                  ),
                  zIndex: 103,
                }}
                role="button"
                aria-label={`Crop ${edge} edge`}
                tabIndex={0}
                data-gizmo={`crop-${edge}`}
                onMouseDown={(e) => onCropStart(edge, e)}
              />
            )
          })}
        </>
      )}

      {/* Rotation handle */}
      <div
        className="absolute bg-white border border-orange-500 rounded-full cursor-crosshair"
        style={{
          width: 10,
          height: 10,
          left: '50%',
          top: -ROTATION_HANDLE_OFFSET,
          marginLeft: -5,
          zIndex: 102,
        }}
        role="button"
        aria-label="Rotate selected element"
        tabIndex={0}
        data-gizmo="rotate"
        onMouseDown={onRotateStart}
      />

      {/* Rotation guide line */}
      <div
        className="absolute border-l border-dashed border-orange-500 pointer-events-none"
        style={{
          left: '50%',
          top: -ROTATION_HANDLE_OFFSET + 10,
          height: ROTATION_HANDLE_OFFSET - 10,
        }}
      />
    </>
  )
}
