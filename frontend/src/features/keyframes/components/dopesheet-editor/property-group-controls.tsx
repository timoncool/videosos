import { ChevronDown, ChevronLeft, ChevronRight, LineChart, Lock } from 'lucide-react'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { MINI_ICON_BUTTON_CLASS, MINI_ICON_CLASS } from './dopesheet-constants'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { DopesheetPropertyGroup } from './dopesheet-types'
import { DopesheetResetButton } from './property-row-controls'

export interface GroupCurvesButtonProps {
  groupProperties: AnimatableProperty[]
  groupLabel: string
  curveVisible: boolean
  onToggleGroupCurves: (properties: AnimatableProperty[]) => void
  t: TFunction
}

export function GroupCurvesButton({
  groupProperties,
  groupLabel,
  curveVisible,
  onToggleGroupCurves,
  t,
}: GroupCurvesButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        MINI_ICON_BUTTON_CLASS,
        'self-center text-muted-foreground hover:text-foreground',
        curveVisible ? 'text-orange-500 hover:text-orange-400' : 'opacity-30 hover:opacity-60',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onToggleGroupCurves(groupProperties)
      }}
      disabled={groupProperties.length === 0}
      title={t('timeline.keyframeEditor.showAllGroupCurves', {
        group: groupLabel,
        defaultValue: `Show all ${groupLabel} curves`,
      })}
      aria-label={t('timeline.keyframeEditor.showAllGroupCurves', {
        group: groupLabel,
        defaultValue: `Show all ${groupLabel} curves`,
      })}
      aria-pressed={curveVisible}
    >
      <LineChart className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface GroupLockButtonProps {
  groupProperties: AnimatableProperty[]
  groupLabel: string
  allRowsLocked: boolean
  setAllRowsLocked: (locked: boolean) => void
  setGroupLocked: (properties: AnimatableProperty[], locked: boolean) => void
  t: TFunction
}

export function GroupLockButton({
  groupProperties,
  groupLabel,
  allRowsLocked,
  setAllRowsLocked,
  setGroupLocked,
  t,
}: GroupLockButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        MINI_ICON_BUTTON_CLASS,
        'self-center text-muted-foreground hover:text-foreground',
        allRowsLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60',
      )}
      onClick={(event) => {
        event.stopPropagation()
        if (event.shiftKey) {
          setAllRowsLocked(!allRowsLocked)
          return
        }
        setGroupLocked(groupProperties, !allRowsLocked)
      }}
      disabled={groupProperties.length === 0}
      title={`${
        allRowsLocked
          ? t('timeline.keyframeEditor.unlockGroupRows', {
              group: groupLabel,
              defaultValue: `Unlock ${groupLabel} rows`,
            })
          : t('timeline.keyframeEditor.lockGroupRows', {
              group: groupLabel,
              defaultValue: `Lock ${groupLabel} rows`,
            })
      } — ${t('timeline.keyframeEditor.lockAllRowsHint', {
        defaultValue: 'Shift-click to lock or unlock every row',
      })}`}
      aria-label={
        allRowsLocked
          ? t('timeline.keyframeEditor.unlockGroupRows', {
              group: groupLabel,
              defaultValue: `Unlock ${groupLabel} rows`,
            })
          : t('timeline.keyframeEditor.lockGroupRows', {
              group: groupLabel,
              defaultValue: `Lock ${groupLabel} rows`,
            })
      }
      aria-pressed={allRowsLocked}
    >
      <Lock className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface GroupExpandButtonProps {
  groupId: string
  groupLabel: string
  isOpen: boolean
  setAllGroupsExpanded: (expanded: boolean) => void
  toggleGroup: (groupId: string) => void
  t: TFunction
}

export function GroupExpandButton({
  groupId,
  groupLabel,
  isOpen,
  setAllGroupsExpanded,
  toggleGroup,
  t,
}: GroupExpandButtonProps) {
  return (
    <button
      type="button"
      className="group flex min-w-0 flex-1 items-center gap-px rounded-sm px-0 text-left leading-none transition-colors hover:bg-background/40"
      onClick={(event) => {
        if (event.shiftKey) {
          setAllGroupsExpanded(!isOpen)
          return
        }
        toggleGroup(groupId)
      }}
      title={t('timeline.keyframeEditor.shiftToggleAllGroups', {
        defaultValue: 'Shift-click to expand or collapse all property groups',
      })}
      aria-expanded={isOpen}
      aria-label={
        isOpen
          ? t('timeline.keyframeEditor.collapseGroup', {
              group: groupLabel,
              defaultValue: `Collapse ${groupLabel}`,
            })
          : t('timeline.keyframeEditor.expandGroup', {
              group: groupLabel,
              defaultValue: `Expand ${groupLabel}`,
            })
      }
    >
      {isOpen ? (
        <ChevronDown
          className={cn(
            MINI_ICON_CLASS,
            'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80',
          )}
        />
      ) : (
        <ChevronRight
          className={cn(
            MINI_ICON_CLASS,
            'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80',
          )}
        />
      )}
      <span className="truncate pl-px text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-foreground">
        {groupLabel}
      </span>
    </button>
  )
}

export interface GroupKeyframeNavButtonProps {
  direction: 'prev' | 'next'
  entry: DopesheetPropertyGroup['prevKeyframe']
  fallbackProperty: AnimatableProperty
  groupLabel: string
  disabled: boolean
  canNavigate: boolean
  onNavigate: (property: AnimatableProperty, keyframe: Keyframe | null) => void
  t: TFunction
}

export function GroupKeyframeNavButton({
  direction,
  entry,
  fallbackProperty,
  groupLabel,
  disabled,
  canNavigate,
  onNavigate,
  t,
}: GroupKeyframeNavButtonProps) {
  const isPrev = direction === 'prev'
  const Icon = isPrev ? ChevronLeft : ChevronRight
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
      onClick={(event) => {
        event.stopPropagation()
        onNavigate(entry?.property ?? fallbackProperty, entry?.keyframe ?? null)
      }}
      disabled={disabled || !entry || !canNavigate}
      title={
        isPrev
          ? t('timeline.keyframeEditor.previousGroupKeyframe', {
              group: groupLabel,
              defaultValue: `Previous ${groupLabel} keyframe`,
            })
          : t('timeline.keyframeEditor.nextGroupKeyframe', {
              group: groupLabel,
              defaultValue: `Next ${groupLabel} keyframe`,
            })
      }
      aria-label={
        isPrev
          ? t('timeline.keyframeEditor.previousGroupKeyframe', {
              group: groupLabel,
              defaultValue: `Previous ${groupLabel} keyframe`,
            })
          : t('timeline.keyframeEditor.nextGroupKeyframe', {
              group: groupLabel,
              defaultValue: `Next ${groupLabel} keyframe`,
            })
      }
    >
      <Icon className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface GroupResetProps {
  groupId: string
  canResetGroup: boolean
  resetGroupLabel: string
  canResetEffectGroup: boolean
  groupProperties: AnimatableProperty[]
  onResetToDefault?: (properties: AnimatableProperty[]) => void
  onClearGroup: () => void
}

export function GroupReset({
  groupId,
  canResetGroup,
  resetGroupLabel,
  canResetEffectGroup,
  groupProperties,
  onResetToDefault,
  onClearGroup,
}: GroupResetProps) {
  if (!canResetGroup) {
    return (
      <span
        aria-hidden="true"
        className={MINI_ICON_BUTTON_CLASS}
        data-testid={`dopesheet-group-reset-spacer-${groupId}`}
      />
    )
  }
  return (
    <DopesheetResetButton
      label={resetGroupLabel}
      onReset={() => {
        if (canResetEffectGroup) {
          onResetToDefault?.(groupProperties)
        } else {
          onClearGroup()
        }
      }}
    />
  )
}
