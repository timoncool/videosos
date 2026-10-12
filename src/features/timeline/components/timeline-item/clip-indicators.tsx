import { memo, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2Off, Diamond, WandSparkles } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'

type ReverseConformStatus = 'pending' | 'ready' | 'error'

interface ClipIndicatorsProps {
  /** Whether the item has keyframe animations */
  hasKeyframes: boolean
  /** Whether this clip is targeted by the Edit keyframe panel. */
  keyframesExpanded: boolean
  /** Whether the item has live animation (procedural layers, modifiers, or text motion). */
  hasMotion: boolean
  /** Current playback speed (1 = normal) */
  currentSpeed: number
  /** Whether media playback is reversed */
  isReversed: boolean
  reverseConformStatus?: ReverseConformStatus
  /** Whether the item is currently being rate stretched */
  isStretching: boolean
  /** Visual feedback during stretch (speed preview) */
  stretchFeedback: { speed: number } | null
  /** Whether the item's media is broken/missing */
  isBroken: boolean
  /** Whether the item has a mediaId */
  hasMediaId: boolean
  /** Whether the item is a shape configured as a mask */
  isMask: boolean
  /** Whether the item is a shape */
  isShape: boolean
  /** Opens or closes the selected clip's Edit keyframe panel. */
  onKeyframesToggle?: () => void
  /** Selects this clip and opens its Animation controls in the inspector. */
  onMotionOpen?: () => void
}

function stopClipIndicatorEvent(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

const KeyframeIndicator = memo(function KeyframeIndicator({
  expanded,
  onToggle,
}: {
  expanded: boolean
  onToggle?: () => void
}) {
  const { t } = useTranslation()
  const label = t(
    expanded ? 'timeline.keyframeEditor.editLane.hide' : 'timeline.keyframeEditor.editLane.show',
    { defaultValue: expanded ? 'Hide keyframe panel' : 'Show keyframe panel' },
  )

  return (
    <button
      type="button"
      className={cn(
        'pointer-events-auto rounded-sm p-0.5 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400',
        expanded && 'bg-amber-500/20',
      )}
      title={t('timeline.clipIndicators.hasKeyframes')}
      aria-label={label}
      aria-pressed={expanded}
      onPointerDown={stopClipIndicatorEvent}
      onMouseDown={stopClipIndicatorEvent}
      onClick={(event) => {
        stopClipIndicatorEvent(event)
        onToggle?.()
      }}
    >
      <Diamond className="w-3 h-3 text-amber-500 fill-amber-500/50" />
    </button>
  )
})

const ReverseIndicator = memo(function ReverseIndicator({
  status,
}: {
  status?: ReverseConformStatus
}) {
  const { t } = useTranslation()
  let title = t('timeline.clipIndicators.reversedPlayback')
  if (status === 'ready') title = t('timeline.clipIndicators.reversedPrepared')
  if (status === 'pending') title = t('timeline.clipIndicators.preparingReversed')
  if (status === 'error') title = t('timeline.clipIndicators.reversedPrepFailed')

  return (
    <span
      className="px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono"
      title={title}
    >
      REV
    </span>
  )
})

interface ClipLabelIndicatorsProps {
  hasKeyframes: boolean
  keyframesExpanded: boolean
  hasMotion: boolean
  isShapeMask: boolean
  showSpeedBadge: boolean
  currentSpeed: number
  isReversed: boolean
  reverseConformStatus?: ReverseConformStatus
  onKeyframesToggle?: () => void
  onMotionOpen?: () => void
}

function hasClipLabelIndicators({
  hasKeyframes,
  hasMotion,
  isShapeMask,
  showSpeedBadge,
  isReversed,
  reverseConformStatus,
}: ClipLabelIndicatorsProps): boolean {
  return (
    hasKeyframes ||
    hasMotion ||
    isShapeMask ||
    showSpeedBadge ||
    isReversed ||
    reverseConformStatus === 'pending' ||
    reverseConformStatus === 'error'
  )
}

const ClipLabelIndicators = memo(function ClipLabelIndicators({
  hasKeyframes,
  keyframesExpanded,
  hasMotion,
  isShapeMask,
  showSpeedBadge,
  currentSpeed,
  isReversed,
  reverseConformStatus,
  onKeyframesToggle,
  onMotionOpen,
}: ClipLabelIndicatorsProps) {
  const { t } = useTranslation()

  return (
    <div
      className="absolute right-6 z-40 pointer-events-none flex items-center gap-1"
      style={{ top: 0, height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
    >
      {hasKeyframes && (
        <KeyframeIndicator expanded={keyframesExpanded} onToggle={onKeyframesToggle} />
      )}
      {hasMotion && (
        <button
          type="button"
          className="pointer-events-auto rounded-sm p-0.5 text-sky-400 hover:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          title={t('timeline.clipIndicators.hasMotion')}
          aria-label={t('timeline.clipIndicators.hasMotion')}
          onPointerDown={stopClipIndicatorEvent}
          onMouseDown={stopClipIndicatorEvent}
          onClick={(event) => {
            stopClipIndicatorEvent(event)
            onMotionOpen?.()
          }}
        >
          <WandSparkles className="w-3 h-3 text-sky-400" />
        </button>
      )}
      {isShapeMask && (
        <span
          className="px-1 py-0.5 text-[10px] font-bold bg-cyan-500/80 text-white rounded"
          title={t('timeline.clipIndicators.mask')}
        >
          M
        </span>
      )}
      {showSpeedBadge && (
        <span
          className="px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono"
          title={t('timeline.clipIndicators.speed', { speed: currentSpeed.toFixed(2) })}
        >
          {currentSpeed.toFixed(2)}x
        </span>
      )}
      {isReversed && <ReverseIndicator status={reverseConformStatus} />}
      {reverseConformStatus === 'pending' && (
        <span
          className="px-1 py-0.5 text-[10px] font-bold bg-sky-600/80 text-white rounded font-mono"
          title={t('timeline.clipIndicators.preparingReversed')}
        >
          PREP
        </span>
      )}
      {reverseConformStatus === 'error' && (
        <span
          className="px-1 py-0.5 text-[10px] font-bold bg-red-600/80 text-white rounded font-mono"
          title={t('timeline.clipIndicators.reversePrepFailedShort')}
        >
          ERR
        </span>
      )}
    </div>
  )
})

/** Renders status indicators and badges on timeline clips. */
export const ClipIndicators = memo(function ClipIndicators({
  hasKeyframes,
  keyframesExpanded,
  hasMotion,
  currentSpeed,
  isReversed,
  reverseConformStatus,
  isStretching,
  stretchFeedback,
  isBroken,
  hasMediaId,
  isMask,
  isShape,
  onKeyframesToggle,
  onMotionOpen,
}: ClipIndicatorsProps) {
  const { t } = useTranslation()
  const showSpeedBadge = Math.abs(currentSpeed - 1) > 0.005 && !isStretching
  const labelIndicatorProps: ClipLabelIndicatorsProps = {
    hasKeyframes,
    keyframesExpanded,
    hasMotion,
    isShapeMask: isShape && isMask,
    showSpeedBadge,
    currentSpeed,
    isReversed,
    reverseConformStatus,
    onKeyframesToggle,
    onMotionOpen,
  }

  return (
    <>
      {hasClipLabelIndicators(labelIndicatorProps) && (
        <ClipLabelIndicators {...labelIndicatorProps} />
      )}

      {isBroken && hasMediaId && (
        <div
          className="absolute bottom-1 right-1 p-0.5 rounded bg-destructive/90 text-destructive-foreground"
          title={t('timeline.clipIndicators.mediaMissing')}
        >
          <Link2Off className="w-3 h-3" />
        </div>
      )}

      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-10 transition-opacity duration-75',
          isStretching && stretchFeedback ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="text-white font-mono text-sm font-bold">
          {stretchFeedback?.speed.toFixed(2) ?? '1.00'}x
        </span>
      </div>
    </>
  )
})
