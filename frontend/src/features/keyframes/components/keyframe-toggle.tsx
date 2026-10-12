/**
 * Keyframe toggle button component.
 * Diamond-shaped button that appears next to animatable properties.
 * - Hollow diamond: No keyframe at current frame (click to add)
 * - Filled diamond: Keyframe exists at current frame (click to remove)
 * - Disabled with strikethrough: Frame is in transition region (keyframes not allowed)
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Diamond } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/shared/ui/cn'
import {
  addKeyframes,
  removeKeyframes,
  useItemsStore,
  useKeyframesStore,
  useTransitionsStore,
} from '@/features/keyframes/deps/timeline'
import { useThrottledFrame } from '@/features/keyframes/deps/preview-contract'
import type { AnimatableProperty, ItemKeyframes, Keyframe } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isFrameInTransitionRegion, getTransitionBlockedMessage } from '../utils/transition-region'

interface KeyframeToggleProps {
  /** The item ID(s) to toggle keyframes for */
  itemIds: string[]
  /** The property to animate */
  property: AnimatableProperty
  /** Current value of the property (used when adding keyframe) */
  currentValue: number
  /** Resolve the latest value lazily without rerendering the toggle */
  getCurrentValue?: () => number
  /** Per-item values for mixed selections; falls back to currentValue when omitted */
  currentValuesByItemId?: Readonly<Record<string, number>>
  /** Optional class name for the button */
  className?: string
  /** Disabled state */
  disabled?: boolean
}

interface KeyframeToggleTargetState {
  itemId: string
  item: Pick<TimelineItem, 'from' | 'durationInFrames'> | undefined
  relativeFrame: number
  propertyKeyframes: ItemKeyframes['properties'][number] | undefined
  keyframeAtFrame: Keyframe | undefined
  transitionBlockedRange: ReturnType<typeof isFrameInTransitionRegion>
}

function getRelevantTransitions(transitions: Transition[], itemIds: string[]): Transition[] {
  if (itemIds.length === 0) return []
  return transitions.filter(
    (transition) =>
      itemIds.includes(transition.leftClipId) || itemIds.includes(transition.rightClipId),
  )
}

function buildTargetStates(
  itemIds: string[],
  selectedItemBounds: Array<number | undefined>,
  selectedItemKeyframes: Array<ItemKeyframes | undefined>,
  currentFrame: number,
  property: AnimatableProperty,
  transitions: Transition[],
): KeyframeToggleTargetState[] {
  return itemIds.map((itemId, index) => {
    const from = selectedItemBounds[index * 2]
    const durationInFrames = selectedItemBounds[index * 2 + 1]
    const item =
      from === undefined || durationInFrames === undefined ? undefined : { from, durationInFrames }
    const itemKeyframes = selectedItemKeyframes[index]
    const relativeFrame = item ? currentFrame - item.from : 0
    const propertyKeyframes = itemKeyframes?.properties.find((entry) => entry.property === property)
    return {
      itemId,
      item,
      relativeFrame,
      propertyKeyframes,
      keyframeAtFrame: propertyKeyframes?.keyframes.find(
        (keyframe) => keyframe.frame === relativeFrame,
      ),
      transitionBlockedRange: item
        ? isFrameInTransitionRegion(relativeFrame, itemId, item, transitions)
        : undefined,
    }
  })
}

function toggleTargetKeyframes(
  states: KeyframeToggleTargetState[],
  property: AnimatableProperty,
  currentValue: number,
  getCurrentValue: (() => number) | undefined,
  currentValuesByItemId: Readonly<Record<string, number>> | undefined,
  removeKeyframesAction: typeof removeKeyframes,
  addKeyframesAction: typeof addKeyframes,
): void {
  const allHaveKeyframes =
    states.length > 0 && states.every((state) => state.keyframeAtFrame !== undefined)
  if (allHaveKeyframes) {
    removeKeyframesAction(
      states.flatMap((state) =>
        state.keyframeAtFrame
          ? [{ itemId: state.itemId, property, keyframeId: state.keyframeAtFrame.id }]
          : [],
      ),
    )
    return
  }

  const resolvedCurrentValue = getCurrentValue?.() ?? currentValue
  addKeyframesAction(
    states.flatMap((state) =>
      state.keyframeAtFrame
        ? []
        : [
            {
              itemId: state.itemId,
              property,
              frame: state.relativeFrame,
              value: currentValuesByItemId?.[state.itemId] ?? resolvedCurrentValue,
            },
          ],
    ),
  )
}

interface KeyframeToggleButtonProps {
  className?: string
  effectiveDisabled: boolean
  hasAnyKeyframes: boolean
  hasKeyframe: boolean
  isInTransition: boolean
  isOutsideBounds: boolean
  onToggle: () => void
  relativeFrame: number
  transitionBlockedRange: ReturnType<typeof isFrameInTransitionRegion>
}

type Translate = ReturnType<typeof useTranslation>['t']

function getToggleInteractionClasses(
  effectiveDisabled: boolean,
  isInTransition: boolean,
): string[] {
  const classes: string[] = []
  if (effectiveDisabled) classes.push('opacity-50 cursor-not-allowed')
  if (isInTransition) classes.push('line-through')
  return classes
}

function getToggleKeyframeColorClass(
  hasAnyKeyframes: boolean,
  hasKeyframe: boolean,
  isInTransition: boolean,
): string {
  if (isInTransition) return 'text-muted-foreground/50'
  if (hasKeyframe) return 'text-amber-500'
  if (hasAnyKeyframes) return 'text-amber-500/50'
  return 'text-muted-foreground'
}

function getToggleButtonClassName(
  className: string | undefined,
  effectiveDisabled: boolean,
  hasAnyKeyframes: boolean,
  hasKeyframe: boolean,
  isInTransition: boolean,
): string {
  return cn(
    'flex items-center justify-center w-5 h-5 rounded-sm transition-colors',
    'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    ...getToggleInteractionClasses(effectiveDisabled, isInTransition),
    getToggleKeyframeColorClass(hasAnyKeyframes, hasKeyframe, isInTransition),
    className,
  )
}

function getToggleButtonLabel(
  t: Translate,
  isInTransition: boolean,
  isOutsideBounds: boolean,
  hasKeyframe: boolean,
): string {
  if (isInTransition) {
    return t('timeline.keyframeEditor.keyframesBlockedTransition', {
      defaultValue: 'Keyframes blocked (transition region)',
    })
  }
  if (isOutsideBounds) {
    return t('timeline.keyframeEditor.playheadOutsideClipBounds', {
      defaultValue: 'Playhead outside clip bounds',
    })
  }
  return hasKeyframe
    ? t('timeline.keyframeEditor.removeKeyframe', { defaultValue: 'Remove keyframe' })
    : t('timeline.keyframeEditor.addKeyframe', { defaultValue: 'Add keyframe' })
}

function KeyframeToggleTooltipBody({
  hasKeyframe,
  isInTransition,
  isOutsideBounds,
  relativeFrame,
  transitionBlockedRange,
}: Pick<
  KeyframeToggleButtonProps,
  'hasKeyframe' | 'isInTransition' | 'isOutsideBounds' | 'relativeFrame' | 'transitionBlockedRange'
>) {
  const { t } = useTranslation()
  if (isInTransition && transitionBlockedRange) {
    return <>{getTransitionBlockedMessage(transitionBlockedRange)}</>
  }
  if (isOutsideBounds) {
    return (
      <>
        {t('timeline.keyframeEditor.playheadIsOutsideClipBounds', {
          defaultValue: 'Playhead is outside clip bounds',
        })}
      </>
    )
  }
  return hasKeyframe ? (
    <>
      {t('timeline.keyframeEditor.removeKeyframeAtFrame', {
        frame: relativeFrame,
        defaultValue: 'Remove keyframe at frame {{frame}}',
      })}
    </>
  ) : (
    <>
      {t('timeline.keyframeEditor.addKeyframeAtFrame', {
        frame: relativeFrame,
        defaultValue: 'Add keyframe at frame {{frame}}',
      })}
    </>
  )
}

function KeyframeToggleButton({
  className,
  effectiveDisabled,
  hasAnyKeyframes,
  hasKeyframe,
  isInTransition,
  isOutsideBounds,
  onToggle,
  relativeFrame,
  transitionBlockedRange,
}: KeyframeToggleButtonProps) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          disabled={effectiveDisabled}
          className={getToggleButtonClassName(
            className,
            effectiveDisabled,
            hasAnyKeyframes,
            hasKeyframe,
            isInTransition,
          )}
          aria-label={getToggleButtonLabel(t, isInTransition, isOutsideBounds, hasKeyframe)}
        >
          <Diamond
            className={cn(
              'w-3 h-3 rotate-0 transition-transform',
              hasKeyframe && !isInTransition && 'fill-current',
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[200px]">
        <KeyframeToggleTooltipBody
          hasKeyframe={hasKeyframe}
          isInTransition={isInTransition}
          isOutsideBounds={isOutsideBounds}
          relativeFrame={relativeFrame}
          transitionBlockedRange={transitionBlockedRange}
        />
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Keyframe toggle button for property panels.
 * Adds or removes a keyframe at the current playhead position.
 */
export function KeyframeToggle({
  itemIds,
  property,
  currentValue,
  getCurrentValue,
  currentValuesByItemId,
  className,
  disabled = false,
}: KeyframeToggleProps) {
  // Get current frame (throttled to reduce re-renders during playback)
  const currentFrame = useThrottledFrame()

  const selectedItemKeyframes = useKeyframesStore(
    useShallow(useCallback((s) => itemIds.map((itemId) => s.keyframesByItemId[itemId]), [itemIds])),
  )
  const selectedItemBounds = useItemsStore(
    useShallow(
      useCallback(
        (state) =>
          itemIds.flatMap((itemId): Array<number | undefined> => {
            const item = state.itemById[itemId]
            return item ? [item.from, item.durationInFrames] : [undefined, undefined]
          }),
        [itemIds],
      ),
    ),
  )

  // Get transitions to check for blocked regions
  const transitions = useTransitionsStore(
    useShallow(useCallback((s) => getRelevantTransitions(s.transitions, itemIds), [itemIds])),
  )

  const targetStates = useMemo(
    () =>
      buildTargetStates(
        itemIds,
        selectedItemBounds,
        selectedItemKeyframes,
        currentFrame,
        property,
        transitions,
      ),
    [currentFrame, itemIds, property, selectedItemBounds, selectedItemKeyframes, transitions],
  )

  const transitionBlockedRange = targetStates.find(
    (state) => state.transitionBlockedRange !== undefined,
  )?.transitionBlockedRange
  const isInTransition = transitionBlockedRange !== undefined
  const isOutsideBounds =
    targetStates.length === 0 ||
    targetStates.some(
      ({ item, relativeFrame }) =>
        !item || relativeFrame < 0 || relativeFrame >= item.durationInFrames,
    )
  const hasKeyframe =
    targetStates.length > 0 && targetStates.every((state) => state.keyframeAtFrame !== undefined)
  const hasAnyKeyframes = targetStates.some(
    (state) => (state.propertyKeyframes?.keyframes.length ?? 0) > 0,
  )
  const relativeFrame = targetStates[0]?.relativeFrame ?? 0

  // Handle toggle click
  const handleToggle = useCallback(() => {
    if (disabled || isInTransition || isOutsideBounds) return

    toggleTargetKeyframes(
      targetStates,
      property,
      currentValue,
      getCurrentValue,
      currentValuesByItemId,
      removeKeyframes,
      addKeyframes,
    )
  }, [
    disabled,
    isInTransition,
    isOutsideBounds,
    property,
    targetStates,
    currentValuesByItemId,
    currentValue,
    getCurrentValue,
  ])

  // Compute effective disabled state
  const effectiveDisabled = disabled || isInTransition || isOutsideBounds

  return (
    <KeyframeToggleButton
      className={className}
      effectiveDisabled={effectiveDisabled}
      hasAnyKeyframes={hasAnyKeyframes}
      hasKeyframe={hasKeyframe}
      isInTransition={isInTransition}
      isOutsideBounds={isOutsideBounds}
      onToggle={handleToggle}
      relativeFrame={relativeFrame}
      transitionBlockedRange={transitionBlockedRange}
    />
  )
}
