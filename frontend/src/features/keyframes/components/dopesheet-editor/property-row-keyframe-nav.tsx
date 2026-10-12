import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'

export interface PropertyRowKeyframeNavProps {
  property: AnimatableProperty
  rowLabel: string
  prevKeyframe: Keyframe | null
  nextKeyframe: Keyframe | null
  currentKeyframes: Keyframe[]
  hasKeyframeAtCurrentFrame: boolean
  disabled: boolean
  rowLocked: boolean
  isCurrentFrameBlocked: boolean
  canNavigate: boolean
  canAddKeyframe: boolean
  onNavigate: (property: AnimatableProperty, keyframe: Keyframe | null) => void
  onToggleKeyframe: (property: AnimatableProperty, currentKeyframes: Keyframe[]) => void
  t: TFunction
}

/**
 * Previous / toggle / next keyframe buttons at the trailing edge of a
 * dopesheet property row.
 */
export function PropertyRowKeyframeNav({
  property,
  rowLabel,
  prevKeyframe,
  nextKeyframe,
  currentKeyframes,
  hasKeyframeAtCurrentFrame,
  disabled,
  rowLocked,
  isCurrentFrameBlocked,
  canNavigate,
  canAddKeyframe,
  onNavigate,
  onToggleKeyframe,
  t,
}: PropertyRowKeyframeNavProps) {
  return (
    <div className="flex w-[60px] shrink-0 items-center gap-0 rounded-sm border border-border/70 bg-background/85 px-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
        onClick={() => onNavigate(property, prevKeyframe)}
        disabled={disabled || prevKeyframe === null || !canNavigate}
        title={t('timeline.keyframeEditor.previousPropertyKeyframe', {
          property: rowLabel,
          defaultValue: `Previous ${rowLabel} keyframe`,
        })}
        aria-label={t('timeline.keyframeEditor.previousPropertyKeyframe', {
          property: rowLabel,
          defaultValue: `Previous ${rowLabel} keyframe`,
        })}
      >
        <ChevronLeft className="h-[9px] w-[9px]" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-5 w-5 p-0 hover:bg-transparent',
          hasKeyframeAtCurrentFrame
            ? 'text-neutral-200 hover:text-neutral-200'
            : 'text-muted-foreground hover:text-foreground',
          isCurrentFrameBlocked && !hasKeyframeAtCurrentFrame && 'opacity-40 cursor-not-allowed',
        )}
        onClick={() => onToggleKeyframe(property, currentKeyframes)}
        disabled={
          disabled ||
          rowLocked ||
          (!hasKeyframeAtCurrentFrame && (isCurrentFrameBlocked || !canAddKeyframe))
        }
        title={
          !hasKeyframeAtCurrentFrame && isCurrentFrameBlocked
            ? t('timeline.keyframeEditor.transitionBlocked')
            : hasKeyframeAtCurrentFrame
              ? t('timeline.keyframeEditor.removePropertyKeyframeAtPlayhead', {
                  property: rowLabel,
                  defaultValue: `Remove ${rowLabel} keyframe at playhead`,
                })
              : t('timeline.keyframeEditor.togglePropertyKeyframeAtPlayhead', {
                  property: rowLabel,
                  defaultValue: `Toggle ${rowLabel} keyframe at playhead`,
                })
        }
        aria-label={
          !hasKeyframeAtCurrentFrame && isCurrentFrameBlocked
            ? t('timeline.keyframeEditor.transitionBlocked')
            : hasKeyframeAtCurrentFrame
              ? t('timeline.keyframeEditor.removePropertyKeyframeAtPlayhead', {
                  property: rowLabel,
                  defaultValue: `Remove ${rowLabel} keyframe at playhead`,
                })
              : t('timeline.keyframeEditor.togglePropertyKeyframeAtPlayhead', {
                  property: rowLabel,
                  defaultValue: `Toggle ${rowLabel} keyframe at playhead`,
                })
        }
      >
        <span
          className={cn(
            'block h-[7px] w-[7px] rotate-45 border transition-colors',
            hasKeyframeAtCurrentFrame
              ? 'border-neutral-200 bg-neutral-200'
              : 'border-current bg-transparent',
          )}
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
        onClick={() => onNavigate(property, nextKeyframe)}
        disabled={disabled || nextKeyframe === null || !canNavigate}
        title={t('timeline.keyframeEditor.nextPropertyKeyframe', {
          property: rowLabel,
          defaultValue: `Next ${rowLabel} keyframe`,
        })}
        aria-label={t('timeline.keyframeEditor.nextPropertyKeyframe', {
          property: rowLabel,
          defaultValue: `Next ${rowLabel} keyframe`,
        })}
      >
        <ChevronRight className="h-[9px] w-[9px]" />
      </Button>
    </div>
  )
}
