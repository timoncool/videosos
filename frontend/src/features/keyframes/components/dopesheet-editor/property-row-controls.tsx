import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from 'react'
import { Braces, LineChart, Link2, Lock, Timer, Unlink, Unlink2, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/ui/cn'
import { MINI_ICON_BUTTON_CLASS, MINI_ICON_CLASS } from './dopesheet-constants'
import { isColorAnimatableProperty } from '@/features/keyframes/property-value-ranges'
import { handleRowValueInputKeyDown, resolveNumericInputRange } from './property-row-view-model'
import type {
  AnimatableProperty,
  DirectLinkableProperty,
  PropertyExpression,
} from '@/types/keyframe'
import { PickWhipIcon } from './pick-whip-icon'
import {
  CompoundPropertyInputs,
  type CompoundPropertyInputConfig,
} from './compound-property-inputs'

export function DopesheetResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
      onClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      aria-label={label}
      title={label}
    >
      <X className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface PropertyRowResetProps {
  classic: boolean
  canResetRow: boolean
  resetRowLabel: string
  canResetEffectProperty: boolean
  property: AnimatableProperty
  onResetToDefault?: (properties: AnimatableProperty[]) => void
  onClearProperty: (property: AnimatableProperty) => void
}

export function PropertyRowReset({
  classic,
  canResetRow,
  resetRowLabel,
  canResetEffectProperty,
  property,
  onResetToDefault,
  onClearProperty,
}: PropertyRowResetProps) {
  if (classic) return null
  if (!canResetRow) {
    return (
      <span
        aria-hidden="true"
        className={MINI_ICON_BUTTON_CLASS}
        data-testid={`dopesheet-row-reset-spacer-${property}`}
      />
    )
  }
  return (
    <DopesheetResetButton
      label={resetRowLabel}
      onReset={() => {
        if (canResetEffectProperty) {
          onResetToDefault?.([property])
        } else {
          onClearProperty(property)
        }
      }}
    />
  )
}

export interface PropertyRowCurveButtonProps {
  property: AnimatableProperty
  rowLabel: string
  singleCurveMode: boolean
  showGraphPane: boolean
  selectedCurveVisibleExternally: boolean
  selectedProperty: AnimatableProperty | null
  graphProperties: ReadonlySet<AnimatableProperty>
  visible: boolean
  onCurveVisibilityChange?: (property: AnimatableProperty, visible: boolean) => void
  showSinglePropertyCurve: (property: AnimatableProperty) => void
  togglePropertyCurve: (property: AnimatableProperty) => void
  t: TFunction
}

export function PropertyRowCurveButton({
  property,
  rowLabel,
  singleCurveMode,
  showGraphPane,
  selectedCurveVisibleExternally,
  selectedProperty,
  graphProperties,
  visible,
  onCurveVisibilityChange,
  showSinglePropertyCurve,
  togglePropertyCurve,
  t,
}: PropertyRowCurveButtonProps) {
  if (!visible) return null
  const curveVisible = singleCurveMode
    ? (showGraphPane || selectedCurveVisibleExternally) && selectedProperty === property
    : graphProperties.has(property)
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
        if (singleCurveMode) {
          if (curveVisible) {
            onCurveVisibilityChange?.(property, false)
          } else {
            showSinglePropertyCurve(property)
          }
          return
        }
        togglePropertyCurve(property)
      }}
      title={t('timeline.keyframeEditor.showPropertyCurve', {
        property: rowLabel,
        defaultValue: `Show ${rowLabel} curve`,
      })}
      aria-label={t('timeline.keyframeEditor.showPropertyCurve', {
        property: rowLabel,
        defaultValue: `Show ${rowLabel} curve`,
      })}
      aria-pressed={curveVisible}
    >
      <LineChart className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface PropertyRowLockButtonProps {
  rowLocked: boolean
  property: AnimatableProperty
  rowLabel: string
  visible: boolean
  setAllRowsLocked: (locked: boolean) => void
  toggleLockedProperty: (property: AnimatableProperty) => void
  t: TFunction
}

export function PropertyRowLockButton({
  rowLocked,
  property,
  rowLabel,
  visible,
  setAllRowsLocked,
  toggleLockedProperty,
  t,
}: PropertyRowLockButtonProps) {
  if (!visible) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        MINI_ICON_BUTTON_CLASS,
        'self-center text-muted-foreground hover:text-foreground',
        rowLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60',
      )}
      onClick={(event) => {
        event.stopPropagation()
        if (event.shiftKey) {
          setAllRowsLocked(!rowLocked)
          return
        }
        toggleLockedProperty(property)
      }}
      title={`${
        rowLocked
          ? t('timeline.keyframeEditor.unlockPropertyRow', {
              property: rowLabel,
              defaultValue: `Unlock ${rowLabel} row`,
            })
          : t('timeline.keyframeEditor.lockPropertyRow', {
              property: rowLabel,
              defaultValue: `Lock ${rowLabel} row`,
            })
      } — ${t('timeline.keyframeEditor.lockAllRowsHint', {
        defaultValue: 'Shift-click to lock or unlock every row',
      })}`}
      aria-label={
        rowLocked
          ? t('timeline.keyframeEditor.unlockPropertyRow', {
              property: rowLabel,
              defaultValue: `Unlock ${rowLabel} row`,
            })
          : t('timeline.keyframeEditor.lockPropertyRow', {
              property: rowLabel,
              defaultValue: `Lock ${rowLabel} row`,
            })
      }
      aria-pressed={rowLocked}
    >
      <Lock className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface PropertyRowAutoKeyButtonProps {
  property: AnimatableProperty
  rowLabel: string
  autoKeyEnabled: boolean | undefined
  disabled: boolean
  rowLocked: boolean
  canCommit: boolean
  onToggleAutoKey: (property: AnimatableProperty) => void
  t: TFunction
}

export function PropertyRowAutoKeyButton({
  property,
  rowLabel,
  autoKeyEnabled,
  disabled,
  rowLocked,
  canCommit,
  onToggleAutoKey,
  t,
}: PropertyRowAutoKeyButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        MINI_ICON_BUTTON_CLASS,
        'self-center text-muted-foreground hover:text-foreground',
        autoKeyEnabled &&
          'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
      )}
      onClick={() => onToggleAutoKey(property)}
      disabled={disabled || rowLocked || !canCommit}
      title={
        autoKeyEnabled
          ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
              target: rowLabel,
              defaultValue: `Auto-key enabled for ${rowLabel}`,
            })
          : t('timeline.keyframeEditor.enableAutoKeyFor', {
              target: rowLabel,
              defaultValue: `Enable auto-key for ${rowLabel}`,
            })
      }
      aria-label={
        autoKeyEnabled
          ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
              target: rowLabel,
              defaultValue: `Auto-key enabled for ${rowLabel}`,
            })
          : t('timeline.keyframeEditor.enableAutoKeyFor', {
              target: rowLabel,
              defaultValue: `Enable auto-key for ${rowLabel}`,
            })
      }
      aria-pressed={autoKeyEnabled ?? false}
    >
      <Timer className={MINI_ICON_CLASS} />
    </Button>
  )
}

export interface PropertyRowLinkButtonProps {
  linkableProperty: DirectLinkableProperty | null
  rowLabel: string
  visible: boolean
  hasPropertyLink: boolean
  sourceLabels: Partial<Record<DirectLinkableProperty, string>> | undefined
  linkSource: { sourceProperty: string } | undefined
  onBeginLink?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  onRemoveLink?: (property: DirectLinkableProperty) => void
  t: TFunction
}

export function PropertyRowLinkButton({
  linkableProperty,
  rowLabel,
  visible,
  hasPropertyLink,
  sourceLabels,
  linkSource,
  onBeginLink,
  onRemoveLink,
  t,
}: PropertyRowLinkButtonProps) {
  if (!visible || !linkableProperty || !onBeginLink) return null
  const linkSourceLabel =
    (linkableProperty ? sourceLabels?.[linkableProperty] : undefined) ??
    linkSource?.sourceProperty ??
    ''
  if (!hasPropertyLink) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          MINI_ICON_BUTTON_CLASS,
          'self-center touch-none text-muted-foreground opacity-30 hover:text-foreground hover:opacity-70',
        )}
        onPointerDown={(event) => {
          event.stopPropagation()
          onBeginLink(event, linkableProperty)
        }}
        title={t('timeline.keyframeEditor.dragToLinkProperty', {
          property: rowLabel,
          defaultValue: `Drag to link ${rowLabel} to another property`,
        })}
        aria-label={t('timeline.keyframeEditor.dragToLinkProperty', {
          property: rowLabel,
          defaultValue: `Drag to link ${rowLabel} to another property`,
        })}
      >
        <PickWhipIcon className={MINI_ICON_CLASS} data-testid="pick-whip-icon" />
      </Button>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            MINI_ICON_BUTTON_CLASS,
            'self-center text-orange-400 hover:bg-orange-500/10 hover:text-orange-300',
          )}
          onPointerDown={(event) => {
            event.stopPropagation()
            onBeginLink(event, linkableProperty)
          }}
          title={t('timeline.keyframeEditor.linkedExpression', {
            source: linkSourceLabel,
            defaultValue: `Linked to ${linkSourceLabel}. Drag to re-link or click for options.`,
          })}
          aria-label={t('timeline.keyframeEditor.linkedExpression', {
            source: linkSourceLabel,
            defaultValue: `Linked to ${linkSourceLabel}`,
          })}
        >
          <PickWhipIcon className={MINI_ICON_CLASS} data-testid="pick-whip-icon" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-56 space-y-2 p-2">
        <div className="text-[10px] font-medium text-foreground">
          {t('timeline.keyframeEditor.propertyLink', {
            defaultValue: 'Property link',
          })}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{linkSourceLabel}</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start px-2 text-[10px] text-destructive hover:text-destructive"
          onClick={() => onRemoveLink?.(linkableProperty)}
        >
          <Unlink className="mr-1.5 h-3 w-3" />
          {t('timeline.keyframeEditor.removePropertyLink', {
            defaultValue: 'Remove property link',
          })}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export interface PropertyRowAxisConstraintButtonProps {
  axisConstraint:
    | {
        label: string
        constrained: boolean
        onChange: (constrained: boolean) => void
      }
    | undefined
  visible: boolean
  disabled: boolean
  rowLocked: boolean
}

export function PropertyRowAxisConstraintButton({
  axisConstraint,
  visible,
  disabled,
  rowLocked,
}: PropertyRowAxisConstraintButtonProps) {
  if (!visible || !axisConstraint) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        MINI_ICON_BUTTON_CLASS,
        'ml-0.5 self-center text-muted-foreground hover:text-foreground',
        axisConstraint.constrained && 'text-orange-400 hover:text-orange-300',
      )}
      onClick={(event) => {
        event.stopPropagation()
        axisConstraint.onChange(!axisConstraint.constrained)
      }}
      disabled={disabled || rowLocked}
      title={
        axisConstraint.constrained
          ? `Unconstrain ${axisConstraint.label} axes`
          : `Constrain ${axisConstraint.label} axes`
      }
      aria-label={
        axisConstraint.constrained
          ? `Unconstrain ${axisConstraint.label} axes`
          : `Constrain ${axisConstraint.label} axes`
      }
      aria-pressed={axisConstraint.constrained}
    >
      {axisConstraint.constrained ? (
        <Link2 className={MINI_ICON_CLASS} />
      ) : (
        <Unlink2 className={MINI_ICON_CLASS} />
      )}
    </Button>
  )
}

export interface PropertyRowCompoundInputProps {
  property: AnimatableProperty
  compoundRow: CompoundPropertyInputConfig
  compoundSecondaryProperties: Partial<Record<AnimatableProperty, AnimatableProperty>>
  spacious: boolean
  disabled: boolean
  rowLocked: boolean
  hasPropertyLink: boolean
  hasKeyframeAtCurrentFrame: boolean
  isCurrentFrameBlocked: boolean
  autoKeyEnabled: boolean
  activateProperty: (property: AnimatableProperty) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragCancel?: () => void
  onPropertyValuePreview?: (property: AnimatableProperty, value: number) => void
}

export function PropertyRowCompoundInput({
  property,
  compoundRow,
  compoundSecondaryProperties,
  spacious,
  disabled,
  rowLocked,
  hasPropertyLink,
  hasKeyframeAtCurrentFrame,
  isCurrentFrameBlocked,
  autoKeyEnabled,
  activateProperty,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onPropertyValuePreview,
}: PropertyRowCompoundInputProps) {
  return (
    <CompoundPropertyInputs
      spacious={spacious}
      config={{
        ...compoundRow,
        disabled:
          compoundRow.disabled ||
          disabled ||
          rowLocked ||
          hasPropertyLink ||
          (!hasKeyframeAtCurrentFrame && isCurrentFrameBlocked),
        linked: hasPropertyLink,
        allowCreateOnBlur: autoKeyEnabled,
        onScrubStart: (axis) => {
          const scrubProperty =
            axis === 'y' ? (compoundSecondaryProperties[property] ?? property) : property
          activateProperty(scrubProperty)
          if (compoundRow.onScrubStart) compoundRow.onScrubStart(axis)
          else onDragStart?.()
        },
        onScrubPreview:
          compoundRow.onScrubPreview || onPropertyValuePreview
            ? (axis, value) => {
                if (compoundRow.onScrubPreview) {
                  compoundRow.onScrubPreview(axis, value)
                  return
                }
                const scrubProperty =
                  axis === 'y' ? (compoundSecondaryProperties[property] ?? property) : property
                onPropertyValuePreview?.(scrubProperty, value)
              }
            : undefined,
        onScrubEnd: compoundRow.onScrubEnd
          ? compoundRow.onScrubEnd
          : onPropertyValuePreview
            ? () => onDragEnd?.()
            : undefined,
        onScrubCancel: compoundRow.onScrubCancel
          ? compoundRow.onScrubCancel
          : onPropertyValuePreview
            ? () => onDragCancel?.()
            : undefined,
      }}
    />
  )
}

export interface PropertyRowValueInputProps {
  property: AnimatableProperty
  rowLabel: string
  spacious: boolean
  hasPropertyLink: boolean
  disabled: boolean
  rowLocked: boolean
  canCommit: boolean
  hasKeyframeAtCurrentFrame: boolean
  isCurrentFrameBlocked: boolean
  autoKeyEnabled: boolean
  propertyValues: Partial<Record<AnimatableProperty, number>>
  valueDrafts: Partial<Record<AnimatableProperty, string>>
  valueDraftAtFocusRef: RefObject<Partial<Record<AnimatableProperty, string>>>
  skipNextBlurCommitPropertyRef: RefObject<AnimatableProperty | null>
  onValueChange: (property: AnimatableProperty, value: string) => void
  onScrubStart: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  onScrubMove: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  onScrubEnd: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  onScrubCancel: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  onValueCommit: (property: AnimatableProperty, options?: { allowCreate?: boolean }) => void
  onFocusProperty: (property: AnimatableProperty) => void
  onEditingChange: Dispatch<SetStateAction<AnimatableProperty | null>>
  onDraftsChange: Dispatch<SetStateAction<Partial<Record<AnimatableProperty, string>>>>
  formatDisplayValue: (property: AnimatableProperty, value: number | undefined) => string
  t: TFunction
}

export function PropertyRowValueInput({
  property,
  rowLabel,
  spacious,
  hasPropertyLink,
  disabled,
  rowLocked,
  canCommit,
  hasKeyframeAtCurrentFrame,
  isCurrentFrameBlocked,
  autoKeyEnabled,
  propertyValues,
  valueDrafts,
  valueDraftAtFocusRef,
  skipNextBlurCommitPropertyRef,
  onValueChange,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onScrubCancel,
  onValueCommit,
  onFocusProperty,
  onEditingChange,
  onDraftsChange,
  formatDisplayValue,
  t,
}: PropertyRowValueInputProps) {
  const isColor = isColorAnimatableProperty(property)
  const numericRange = resolveNumericInputRange(property)
  return (
    <Input
      type={isColor ? 'text' : 'number'}
      autoComplete="off"
      data-bwignore="true"
      value={valueDrafts[property] ?? ''}
      onChange={(event) => onValueChange(property, event.target.value)}
      onPointerDown={(event) => onScrubStart(event, property)}
      onPointerMove={(event) => onScrubMove(event, property)}
      onPointerUp={(event) => onScrubEnd(event, property)}
      onPointerCancel={(event) => onScrubCancel(event, property)}
      onFocus={() => {
        onFocusProperty(property)
        onEditingChange(property)
        valueDraftAtFocusRef.current[property] = valueDrafts[property] ?? ''
      }}
      onBlur={() => {
        const draftChanged =
          valueDraftAtFocusRef.current[property] !== (valueDrafts[property] ?? '')
        delete valueDraftAtFocusRef.current[property]
        if (skipNextBlurCommitPropertyRef.current === property) {
          skipNextBlurCommitPropertyRef.current = null
        } else if (draftChanged) {
          onValueCommit(property, {
            allowCreate: autoKeyEnabled,
          })
        }
        onEditingChange((current) => (current === property ? null : current))
      }}
      onKeyDown={(event) =>
        handleRowValueInputKeyDown(event, {
          property,
          propertyValues,
          skipNextBlurCommitPropertyRef,
          onValueCommit,
          onEditingChange,
          onDraftsChange,
          formatDisplayValue,
        })
      }
      step={numericRange.step}
      min={numericRange.min}
      max={numericRange.max}
      inputMode={isColor ? 'text' : 'decimal'}
      className={cn(
        'h-5 border-border/70 bg-background/85 px-1.5 py-0 text-right text-[10px] leading-none tabular-nums md:text-[10px]',
        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        isColor ? 'w-[68px]' : spacious ? 'w-[80px]' : 'w-[44px]',
        !isColor && 'cursor-ew-resize select-none',
        hasPropertyLink && 'text-orange-400',
      )}
      disabled={
        disabled ||
        rowLocked ||
        hasPropertyLink ||
        !canCommit ||
        (!hasKeyframeAtCurrentFrame && isCurrentFrameBlocked)
      }
      aria-label={t('timeline.keyframeEditor.propertyValueAtPlayhead', {
        property: rowLabel,
        defaultValue: `${rowLabel} value at playhead`,
      })}
      title={t('timeline.keyframeEditor.scrubPropertyValue', {
        property: rowLabel,
        defaultValue: `Drag horizontally to adjust ${rowLabel}. Hold Shift for fine or Alt for ultra-fine control.`,
      })}
    />
  )
}

export interface PropertyRowExpressionButtonProps {
  linkableProperty: DirectLinkableProperty | null
  rowLabel: string
  visible: boolean
  canEdit: boolean
  expressionError: string | undefined
  disabled: boolean
  rowLocked: boolean
  propertyExpression: PropertyExpression | undefined
  onOpenExpression: (property: DirectLinkableProperty, expression?: PropertyExpression) => void
}

export function PropertyRowExpressionButton({
  linkableProperty,
  rowLabel,
  visible,
  canEdit,
  expressionError,
  disabled,
  rowLocked,
  propertyExpression,
  onOpenExpression,
}: PropertyRowExpressionButtonProps) {
  if (!visible || !linkableProperty || !canEdit) return null
  const expressionEnabled = propertyExpression?.enabled ?? false
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || rowLocked}
      className={cn(
        MINI_ICON_BUTTON_CLASS,
        'self-center hover:bg-sky-500/10 hover:text-sky-300',
        expressionError
          ? 'text-red-400'
          : expressionEnabled
            ? 'text-sky-400'
            : 'text-muted-foreground opacity-30 hover:opacity-70',
      )}
      title={
        expressionError
          ? `${rowLabel} expression error: ${expressionError}`
          : propertyExpression
            ? `Edit ${rowLabel} expression (Advanced)`
            : `Add ${rowLabel} expression (Advanced)`
      }
      aria-label={
        expressionError
          ? `Edit ${rowLabel} expression: ${expressionError}`
          : propertyExpression
            ? `Edit ${rowLabel} expression`
            : `Add ${rowLabel} expression`
      }
      onClick={() => onOpenExpression(linkableProperty, propertyExpression)}
    >
      <Braces className={MINI_ICON_CLASS} />
    </Button>
  )
}
