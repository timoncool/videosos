import type { BezierControlPoints, KeyframeRef } from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import type { KeyframeMarqueeRect } from '../keyframe-marquee'
import type {
  GraphBezierHandle,
  GraphDragState,
  GraphKeyframePoint,
  GraphPadding,
  GraphViewport,
} from './types'

/** Movement threshold in pixels before committing to drag (vs click) */
export const DRAG_THRESHOLD = 3

/** Snap threshold in pixels - keyframes snap when within this distance */
export const SNAP_THRESHOLD_PX = 8
export const FRAME_ZOOM_IN_FACTOR = 0.8
export const FRAME_ZOOM_OUT_FACTOR = 1.25

/** Drag start state stored in ref to avoid stale closures */
export interface DragStartState {
  mouseX: number
  mouseY: number
  initialFrame: number
  initialValue: number
  boundingRect: DOMRect
  pointerId: number
  point: GraphKeyframePoint
  initialKeyframeStates: Map<
    string,
    {
      itemId: string
      property: GraphKeyframePoint['property']
      frame: number
      value: number
      minValue: number
      maxValue: number
    }
  >
  duplicateOnCommit: boolean
}

/** Info about the adjacent segment for mid-point tangent mirroring */
export interface AdjacentSegmentInfo {
  /** Keyframe ID that owns the adjacent bezier config */
  keyframeId: string
  /** Item ID */
  itemId: string
  /** Property */
  property: GraphKeyframePoint['property']
  /** Which bezier component to update on the adjacent segment */
  handleType: 'in' | 'out'
  /** Start point of the adjacent segment (in screen coords) */
  startPoint: GraphKeyframePoint
  /** End point of the adjacent segment (in screen coords) */
  endPoint: GraphKeyframePoint
  /** Initial bezier config of the adjacent keyframe */
  initialBezier: BezierControlPoints
  /** Initial distance from mid-point to opposite handle */
  initialLength: number
}

/** Bezier drag start state */
export interface BezierDragStartState {
  mouseX: number
  mouseY: number
  boundingRect: DOMRect
  pointerId: number
  handle: GraphBezierHandle
  startPoint: GraphKeyframePoint
  endPoint: GraphKeyframePoint
  initialBezier: BezierControlPoints
  /** Adjacent segment info for mid-point tangent mirroring (null if endpoint) */
  adjacent: AdjacentSegmentInfo | null
  /** The mid-point position (screen coords) — anchor of the dragged handle */
  midPoint: { x: number; y: number }
}

export type MarqueeMode = 'replace' | 'add' | 'toggle'

export interface MarqueeState {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  mode: MarqueeMode
  baseSelection: Set<string>
  started: boolean
}

export interface UseGraphInteractionOptions {
  /** Current viewport */
  viewport: GraphViewport
  /** Graph padding */
  padding: GraphPadding
  /** All keyframe points */
  points: GraphKeyframePoint[]
  /** Currently selected keyframe IDs */
  selectedKeyframeIds: Set<string>
  /** Maximum frame (clip duration) for clamping */
  maxFrame?: number
  /** Minimum value for clamping */
  minValue?: number
  /** Maximum value for clamping */
  maxValue?: number
  /** Callback when viewport changes (zoom/pan) */
  onViewportChange?: (viewport: GraphViewport) => void
  /** Callback when keyframe selection changes */
  onSelectionChange?: (keyframeIds: Set<string>) => void
  /** Callback when clicking empty graph space */
  onBackgroundClick?: () => void
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  /** Callback when keyframes are duplicated to explicit targets */
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
  /** Optional frame-delta constraint for horizontal drags */
  constrainFrameDelta?: (deltaFrames: number, draggedKeyframeIds: string[]) => number
  /** Callback when bezier handle is moved */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void
  /** Whether snapping is enabled */
  snapEnabled?: boolean
  /** Snap targets for frames (other keyframe frames, playhead, etc.) */
  snapFrameTargets?: number[]
  /** Snap targets for values (other keyframe values, 0, min, max, etc.) */
  snapValueTargets?: number[]
  /** Blocked frame ranges (transition regions where keyframes cannot be placed) */
  blockedFrameRanges?: BlockedFrameRange[]
  /** Whether interaction is disabled */
  disabled?: boolean
}

export interface UseGraphInteractionReturn {
  /** Current drag state (null if not dragging) */
  dragState: GraphDragState | null
  /** Whether actively dragging (past threshold) */
  isDragging: boolean
  /** Preview values during drag keyed by keyframe ID */
  previewValues: Record<string, { frame: number; value: number }> | null
  /** Currently dragging handle info */
  draggingHandle: { keyframeId: string; type: 'in' | 'out' } | null
  /** Preview bezier configs during handle drag (avoids store updates until pointer up) */
  previewBezierConfigs: Record<string, BezierControlPoints> | null
  /** Current constraint axis when Shift is held ('x' = frame only, 'y' = value only, null = no constraint) */
  constraintAxis: 'x' | 'y' | null
  /** Handle keyframe pointer down */
  handleKeyframePointerDown: (point: GraphKeyframePoint, event: React.PointerEvent) => void
  /** Handle keyframe click (legacy, for selection only) */
  handleKeyframeClick: (point: GraphKeyframePoint, event: React.MouseEvent) => void
  /** Handle bezier handle pointer down */
  handleBezierPointerDown: (handle: GraphBezierHandle, event: React.PointerEvent) => void
  /** Handle pointer move on graph (SVG level) */
  handlePointerMove: (event: React.PointerEvent) => void
  /** Handle pointer up (SVG level) */
  handlePointerUp: (event: React.PointerEvent) => void
  /** Handle wheel (zoom) */
  handleWheel: (event: React.WheelEvent) => void
  /** Handle pointer down on graph background (starts marquee selection) */
  handleBackgroundPointerDown: (event: React.PointerEvent<SVGElement>) => void
  /** Handle graph background click (deselect) */
  handleBackgroundClick: (event: React.MouseEvent) => void
  /** Timestamp of last keyframe/handle pointerDown (for click dedup) */
  lastInteractionTime: React.RefObject<number>
  /** Active marquee rect while selecting */
  marqueeRect: KeyframeMarqueeRect | null
  /** Zoom in */
  zoomIn: () => void
  /** Zoom out */
  zoomOut: () => void
  /** Fit view to all keyframes */
  fitToContent: () => void
}

export function arePreviewValuesEqual(
  a: Record<string, { frame: number; value: number }> | null,
  b: Record<string, { frame: number; value: number }> | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return a === b

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    const aValue = a[key]
    const bValue = b[key]
    if (!aValue || !bValue) return false
    if (aValue.frame !== bValue.frame || aValue.value !== bValue.value) {
      return false
    }
  }

  return true
}
