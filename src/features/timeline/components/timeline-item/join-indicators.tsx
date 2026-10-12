import { createContext, memo, useContext, useDeferredValue, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import { useZoomStore } from '../../stores/zoom-store'
import { getDemotionAwarePixelsPerSecond } from '../../utils/timeline-dom-density'

const JOIN_INDICATOR_MIN_ZOOM_PPS = 30
const TimelineJoinIndicatorsEnabledContext = createContext(true)

export function TimelineJoinIndicatorsZoomGate({ children }: { children: ReactNode }) {
  const enabledAtRenderZoom = useZoomStore((state) => {
    return (
      getDemotionAwarePixelsPerSecond(
        state.contentPixelsPerSecond,
        state.pixelsPerSecond,
        state.isZoomInteracting,
      ) >= JOIN_INDICATOR_MIN_ZOOM_PPS
    )
  })
  const deferredEnabled = useDeferredValue(enabledAtRenderZoom)
  // Promotion can wait for React's transition lane, but zoom-out demotion must
  // be immediate so even a saturated split cohort removes its indicator leaves
  // before the settle commit.
  const enabled = enabledAtRenderZoom && deferredEnabled

  return (
    <TimelineJoinIndicatorsEnabledContext.Provider value={enabled}>
      {children}
    </TimelineJoinIndicatorsEnabledContext.Provider>
  )
}

interface JoinIndicatorsProps {
  hasJoinableLeft: boolean
  hasJoinableRight: boolean
  trackLocked: boolean
  dragAffectsJoin: { left: boolean; right: boolean }
  hoveredEdge: 'start' | 'end' | null
  isTrimming: boolean
  isStretching: boolean
  isBeingDragged: boolean
}

/**
 * Keeps the global 30 PPS branch off the TimelineItem render path. Crossing
 * that threshold updates these tiny leaves through a transition, so a dense
 * split cohort cannot synchronously rerender every full clip component.
 */
export const ZoomGatedJoinIndicators = memo(function ZoomGatedJoinIndicators(
  props: JoinIndicatorsProps,
) {
  const enabled = useContext(TimelineJoinIndicatorsEnabledContext)
  return enabled ? <JoinIndicators {...props} /> : null
})

/**
 * Join indicators for timeline items
 * Shows glowing edges when clips can be joined with neighbors
 */
const JoinIndicators = memo(function JoinIndicators({
  hasJoinableLeft,
  hasJoinableRight,
  trackLocked,
  dragAffectsJoin,
  hoveredEdge,
  isTrimming,
  isStretching,
  isBeingDragged,
}: JoinIndicatorsProps) {
  const { t } = useTranslation()
  // Hide join indicators when this item is being dragged (anchor or follower)
  // This ensures indicators don't show when moving to a different track
  const showLeft =
    hasJoinableLeft &&
    !trackLocked &&
    !dragAffectsJoin.left &&
    !isBeingDragged &&
    hoveredEdge !== 'start' &&
    !isTrimming &&
    !isStretching

  const showRight =
    hasJoinableRight &&
    !trackLocked &&
    !dragAffectsJoin.right &&
    !isBeingDragged &&
    hoveredEdge !== 'end' &&
    !isTrimming &&
    !isStretching

  const joinIndicatorStyle = {
    backgroundColor: 'var(--color-timeline-join)',
    boxShadow: '0 0 3px 0 var(--color-timeline-join)',
  } as const

  return (
    <>
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-px pointer-events-none transition-opacity duration-75',
          showLeft ? 'opacity-100' : 'opacity-0',
        )}
        style={joinIndicatorStyle}
        title={t('timeline.joinIndicators.canJoinPrevious')}
      />
      <div
        className={cn(
          'absolute right-0 top-0 bottom-0 w-px pointer-events-none transition-opacity duration-75',
          showRight ? 'opacity-100' : 'opacity-0',
        )}
        style={joinIndicatorStyle}
        title={t('timeline.joinIndicators.canJoinNext')}
      />
    </>
  )
})
