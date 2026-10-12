import type { TFunction } from 'i18next'
import { isEffectAnimatableProperty, type AnimatableProperty } from '@/types/keyframe'
import type { DopesheetPropertyGroup, DopesheetPropertyRow } from './dopesheet-types'

export interface GroupHeaderStateArgs {
  group: DopesheetPropertyGroup
  graphProperties: ReadonlySet<AnimatableProperty>
  isPropertyLocked: (property: AnimatableProperty) => boolean
  canClearRow: (row: DopesheetPropertyRow) => boolean
  hasResetToDefault: boolean
  disabled: boolean
  groupLabel: string
  t: TFunction
}

/** Derived visibility, lock, and reset state for a property group header. */
export function resolveGroupHeaderState({
  group,
  graphProperties,
  isPropertyLocked,
  canClearRow,
  hasResetToDefault,
  disabled,
  groupLabel,
  t,
}: GroupHeaderStateArgs): {
  groupProperties: AnimatableProperty[]
  curveVisible: boolean
  allRowsLocked: boolean
  canResetEffectGroup: boolean
  canResetGroup: boolean
  resetGroupLabel: string
} {
  const groupProperties = group.rows.map((row) => row.property)
  const curveVisible = groupProperties.some((p) => graphProperties.has(p))
  const allRowsLocked =
    group.rows.length > 0 && group.rows.every((row) => isPropertyLocked(row.property))
  const canClearAny = group.rows.some((row) => canClearRow(row))
  const isEffectGroup = group.rows.every((row) => isEffectAnimatableProperty(row.property))
  const canResetEffectGroup =
    isEffectGroup &&
    hasResetToDefault &&
    !disabled &&
    group.rows.some((row) => !isPropertyLocked(row.property))
  const canResetGroup = canResetEffectGroup || canClearAny
  const resetGroupLabel = t(
    canResetEffectGroup
      ? 'timeline.keyframeEditor.resetEffectGroupDefault'
      : 'timeline.keyframeEditor.resetGroupAnimation',
    {
      group: groupLabel,
      defaultValue: canResetEffectGroup
        ? `Reset all ${groupLabel} properties to their default values`
        : `Reset all ${groupLabel} animations to their base values`,
    },
  )
  return {
    groupProperties,
    curveVisible,
    allRowsLocked,
    canResetEffectGroup,
    canResetGroup,
    resetGroupLabel,
  }
}
