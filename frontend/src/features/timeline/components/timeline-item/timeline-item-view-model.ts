import type { ActiveEdgeState } from './trim-constants'

export interface TrimVisualStateInput {
  isTrimming: boolean
  trimHandle: 'start' | 'end' | null
  trimConstrained: boolean
  isRollingEdit: boolean
  rollingEditHandle: 'start' | 'end' | null
  rollingEditConstrained: boolean
  isSlipSlideActive: boolean
  slipSlideConstrained: boolean
  slipSlideConstraintEdge: 'start' | 'end' | null | undefined
  isLinkedSlipCompanion: boolean
  isLinkedSlideCompanion: boolean
  isStretching: boolean
  stretchHandle: 'start' | 'end' | null
  stretchConstrained: boolean
  smartTrimIntent: string | null | undefined
  isRippleEdit: boolean
}

export interface TrimVisualState {
  activeEdges: ActiveEdgeState | null
  startCursorClass: string
  endCursorClass: string
  startTone: 'ripple' | 'default'
  endTone: 'ripple' | 'default'
}

/** Halo edges for the active trim/roll/slip/slide/stretch gesture. */
export function resolveActiveEdgeState({
  isTrimming,
  trimHandle,
  trimConstrained,
  isRollingEdit,
  rollingEditHandle,
  rollingEditConstrained,
  isSlipSlideActive,
  slipSlideConstrained,
  slipSlideConstraintEdge,
  isLinkedSlipCompanion,
  isLinkedSlideCompanion,
  isStretching,
  stretchHandle,
  stretchConstrained,
}: TrimVisualStateInput): ActiveEdgeState | null {
  if (isTrimming && trimHandle) {
    return {
      start: trimHandle === 'start',
      end: trimHandle === 'end',
      constrainedEdge: trimConstrained ? (isRollingEdit ? 'both' : trimHandle) : null,
    }
  }
  if (rollingEditHandle) {
    return {
      start: rollingEditHandle === 'end',
      end: rollingEditHandle === 'start',
      constrainedEdge: rollingEditConstrained ? 'both' : null,
    }
  }
  if (isSlipSlideActive) {
    return {
      start: true,
      end: true,
      constrainedEdge: slipSlideConstrained ? (slipSlideConstraintEdge ?? 'both') : null,
    }
  }
  if (isLinkedSlipCompanion || isLinkedSlideCompanion) {
    return { start: true, end: true, constrainedEdge: null }
  }
  if (isStretching) {
    return {
      start: stretchHandle === 'start',
      end: stretchHandle === 'end',
      constrainedEdge: stretchConstrained ? stretchHandle : null,
    }
  }
  return null
}

/** Handle cursor classes and ripple tones for the trim handles overlay. */
export function resolveTrimCursorAndTones({
  isTrimming,
  trimHandle,
  smartTrimIntent,
  isRippleEdit,
}: TrimVisualStateInput): Omit<TrimVisualState, 'activeEdges'> {
  return {
    startCursorClass:
      smartTrimIntent === 'ripple-start'
        ? 'cursor-ripple-left'
        : smartTrimIntent === 'roll-start'
          ? 'cursor-trim-center'
          : 'cursor-trim-left',
    endCursorClass:
      smartTrimIntent === 'ripple-end'
        ? 'cursor-ripple-right'
        : smartTrimIntent === 'roll-end'
          ? 'cursor-trim-center'
          : 'cursor-trim-right',
    startTone:
      smartTrimIntent === 'ripple-start' || (isTrimming && trimHandle === 'start' && isRippleEdit)
        ? 'ripple'
        : 'default',
    endTone:
      smartTrimIntent === 'ripple-end' || (isTrimming && trimHandle === 'end' && isRippleEdit)
        ? 'ripple'
        : 'default',
  }
}

/**
 * Single source of truth for trim-related visuals: halo edges, handle cursor
 * classes, and ripple tones for the trim handles overlay.
 */
export function resolveTrimVisualState(args: TrimVisualStateInput): TrimVisualState {
  return {
    activeEdges: resolveActiveEdgeState(args),
    ...resolveTrimCursorAndTones(args),
  }
}
