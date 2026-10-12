import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { getDopesheetRowControlState } from './row-controls'

export interface Viewport {
  startFrame: number
  endFrame: number
}

export interface KeyframeMeta {
  property: AnimatableProperty
  keyframe: Keyframe
}

export interface DopesheetPropertyRow {
  property: AnimatableProperty
  keyframes: Keyframe[]
  controls: ReturnType<typeof getDopesheetRowControlState>
}

export interface DopesheetPropertyGroup {
  id: string
  label: string
  rows: DopesheetPropertyRow[]
  frameGroups: Array<{
    frame: number
    keyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
  }>
  currentKeyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
  hasKeyframeAtCurrentFrame: boolean
  prevKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null
  nextKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null
}

export type RenderedSheetEntry =
  | { type: 'group'; group: DopesheetPropertyGroup; top: number }
  | { type: 'row'; row: DopesheetPropertyRow; top: number; indented: boolean }

export interface DragState {
  anchorKeyframeId: string
  selectedKeyframeIds: string[]
  initialFrames: Map<string, number>
  startClientX: number
  pointerId: number
  started: boolean
  duplicateOnCommit: boolean
  appliedDeltaFrames: number
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
