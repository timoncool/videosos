import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import type { PropertyAccordionGroup } from './property-groups'
import { getKeyframePropertyLabel } from '@/features/keyframes/utils/property-i18n'
import { DopesheetParameterMenu } from './dopesheet-parameter-menu'
import { DopesheetHeaderFrameInputs } from './dopesheet-header-frame-inputs'
import { DopesheetInterpolationButtons } from './dopesheet-interpolation-buttons'
import { DopesheetClipboardActions } from './dopesheet-clipboard-actions'
import { DopesheetEditActions } from './dopesheet-edit-actions'
import { DopesheetLegendPopover } from './dopesheet-legend-popover'
import { DopesheetViewOptionsMenu } from './dopesheet-view-options-menu'

export interface DopesheetToolbarProps {
  disabled: boolean
  hasAvailableProperties: boolean
  filterKeyframedOnly: boolean
  onToggleKeyframedOnly: () => void
  allPropertyGroups: PropertyAccordionGroup[]
  visibleGroups: Record<string, boolean>
  onToggleVisibleGroup: (id: string) => void
  onExpandAllGroups: () => void
  onCollapseAllGroups: () => void
  onResetParameterView: () => void
  hasPropertyFilters: boolean
  showGraphPane: boolean
  graphDisplayProperty: AnimatableProperty | null
  compoundPropertyRows: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>>
  speedGraphContent: ReactNode
  onGraphModeChange?: (mode: 'value' | 'speed') => void
  graphMode: 'value' | 'speed'
  keyframeCount: number
  isCurrentFrameBlocked: boolean
  canBakeMotion: boolean
  onBakeMotion?: () => void
  headerFrameInputsEnabled: boolean
  totalFrames: number
  globalFrame: number | null
  localFrameInputValue: string
  globalFrameInputValue: string
  setLocalFrameInputValue: (value: string) => void
  setGlobalFrameInputValue: (value: string) => void
  skipNextHeaderFrameBlurRef: React.RefObject<'local' | 'global' | null>
  commitLocalFrameInput: () => void
  commitGlobalFrameInput: () => void
  handleHeaderFrameInputKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    input: 'local' | 'global',
    commit: () => void,
  ) => void
  interpolationOptions: ReadonlyArray<{ value: EasingType; label: string }>
  selectedInterpolation: EasingType | null | undefined
  interpolationDisabled: boolean
  onInterpolationChange?: (value: EasingType) => void
  hasSelection: boolean
  hasKeyframeClipboard: boolean
  isKeyframeClipboardCut: boolean
  onCopyKeyframes?: () => void
  onCutKeyframes?: () => void
  onPasteKeyframes?: () => void
  removeKeyframesAvailable: boolean
  handleRemoveKeyframes: () => void
  horizontalZoomValue: number
  horizontalZoomRatioBase: number
  setHorizontalZoomValue: (value: number) => void
  resetViewport: () => void
  graphVerticalZoomValue: number
  graphPropertyCount: number
  verticalZoomRatioBase: number
  setGraphVerticalZoomValue: (value: number) => void
  graphRulerUnit: 'frames' | 'seconds'
  onChangeRulerUnit: (unit: 'frames' | 'seconds') => void
  showAllGraphHandles: boolean
  onToggleGraphHandleVisibility: () => void
  autoZoomGraphHeight: boolean
  onToggleAutoZoomGraphHeight: () => void
}

export function DopesheetToolbar({
  disabled,
  hasAvailableProperties,
  filterKeyframedOnly,
  onToggleKeyframedOnly,
  allPropertyGroups,
  visibleGroups,
  onToggleVisibleGroup,
  onExpandAllGroups,
  onCollapseAllGroups,
  onResetParameterView,
  hasPropertyFilters,
  showGraphPane,
  graphDisplayProperty,
  compoundPropertyRows,
  speedGraphContent,
  onGraphModeChange,
  graphMode,
  keyframeCount,
  isCurrentFrameBlocked,
  canBakeMotion,
  onBakeMotion,
  headerFrameInputsEnabled,
  totalFrames,
  globalFrame,
  localFrameInputValue,
  globalFrameInputValue,
  setLocalFrameInputValue,
  setGlobalFrameInputValue,
  skipNextHeaderFrameBlurRef,
  commitLocalFrameInput,
  commitGlobalFrameInput,
  handleHeaderFrameInputKeyDown,
  interpolationOptions,
  selectedInterpolation,
  interpolationDisabled,
  onInterpolationChange,
  hasSelection,
  hasKeyframeClipboard,
  isKeyframeClipboardCut,
  onCopyKeyframes,
  onCutKeyframes,
  onPasteKeyframes,
  removeKeyframesAvailable,
  handleRemoveKeyframes,
  horizontalZoomValue,
  horizontalZoomRatioBase,
  setHorizontalZoomValue,
  resetViewport,
  graphVerticalZoomValue,
  graphPropertyCount,
  verticalZoomRatioBase,
  setGraphVerticalZoomValue,
  graphRulerUnit,
  onChangeRulerUnit,
  showAllGraphHandles,
  onToggleGraphHandleVisibility,
  autoZoomGraphHeight,
  onToggleAutoZoomGraphHeight,
}: DopesheetToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {t('timeline.keyframeEditor.parameters')}
          </span>
          <DopesheetParameterMenu
            disabled={disabled}
            hasAvailableProperties={hasAvailableProperties}
            parameterFilter={filterKeyframedOnly ? 'keyframed' : 'all'}
            onToggleKeyframedOnly={onToggleKeyframedOnly}
            allPropertyGroups={allPropertyGroups}
            visibleGroups={visibleGroups}
            onToggleVisibleGroup={onToggleVisibleGroup}
            onExpandAll={onExpandAllGroups}
            onCollapseAll={onCollapseAllGroups}
            onResetParameterView={onResetParameterView}
          />
        </div>

        {hasPropertyFilters && (
          <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {t('timeline.keyframeEditor.filtered')}
          </span>
        )}

        {showGraphPane && graphDisplayProperty && (
          <span className="text-xs text-muted-foreground">
            {t('timeline.keyframeEditor.graphLabel', {
              property:
                compoundPropertyRows[graphDisplayProperty]?.label ??
                getKeyframePropertyLabel(t, graphDisplayProperty),
            })}
          </span>
        )}

        {showGraphPane && speedGraphContent && onGraphModeChange && (
          <div
            className="flex h-6 items-center rounded border border-border/70 bg-background/80 p-0.5"
            role="group"
            aria-label={t('timeline.keyframeEditor.graphType', {
              defaultValue: 'Graph type',
            })}
          >
            {(['value', 'speed'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  'h-5 rounded px-2 text-[10px] font-medium text-muted-foreground active:scale-[0.97]',
                  graphMode === mode && 'bg-muted text-foreground',
                )}
                aria-pressed={graphMode === mode}
                onClick={() => onGraphModeChange(mode)}
              >
                {mode === 'value'
                  ? t('timeline.keyframeEditor.valueGraph', {
                      defaultValue: 'Value',
                    })
                  : t('timeline.keyframeEditor.speedGraph', {
                      defaultValue: 'Speed',
                    })}
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-muted-foreground">
          {t('timeline.keyframeEditor.keyframes', {
            count: keyframeCount,
          })}
        </span>

        {isCurrentFrameBlocked && (
          <span
            className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
            title={t('timeline.keyframeEditor.transitionBlocked')}
          >
            {t('timeline.keyframeEditor.transitionBlockedPill')}
          </span>
        )}

        {canBakeMotion && onBakeMotion && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-sky-300 hover:text-sky-200"
            onClick={onBakeMotion}
            title={t('timeline.keyframeEditor.bakeMotionHint')}
          >
            <Sparkles className="h-3 w-3" />
            {t('timeline.keyframeEditor.bakeMotion')}
          </Button>
        )}

        <DopesheetHeaderFrameInputs
          disabled={disabled}
          inputsEnabled={headerFrameInputsEnabled}
          totalFrames={totalFrames}
          globalFrame={globalFrame}
          localFrameInputValue={localFrameInputValue}
          globalFrameInputValue={globalFrameInputValue}
          setLocalFrameInputValue={setLocalFrameInputValue}
          setGlobalFrameInputValue={setGlobalFrameInputValue}
          skipNextHeaderFrameBlurRef={skipNextHeaderFrameBlurRef}
          commitLocalFrameInput={commitLocalFrameInput}
          commitGlobalFrameInput={commitGlobalFrameInput}
          handleHeaderFrameInputKeyDown={handleHeaderFrameInputKeyDown}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <DopesheetInterpolationButtons
          options={interpolationOptions}
          selected={selectedInterpolation}
          disabled={disabled || interpolationDisabled}
          onSelect={onInterpolationChange}
        />
        <DopesheetClipboardActions
          disabled={disabled}
          hasSelection={hasSelection}
          hasKeyframeClipboard={hasKeyframeClipboard}
          isKeyframeClipboardCut={isKeyframeClipboardCut}
          onCopyKeyframes={onCopyKeyframes}
          onCutKeyframes={onCutKeyframes}
          onPasteKeyframes={onPasteKeyframes}
        />
        <DopesheetEditActions
          disabled={disabled}
          hasSelection={hasSelection}
          removeKeyframesAvailable={removeKeyframesAvailable}
          handleRemoveKeyframes={handleRemoveKeyframes}
          horizontalZoomValue={horizontalZoomValue}
          horizontalZoomDisabled={horizontalZoomRatioBase <= 1}
          setHorizontalZoomValue={setHorizontalZoomValue}
          resetViewport={resetViewport}
          visualizationMode={showGraphPane ? 'graph' : 'dopesheet'}
          graphVerticalZoomValue={graphVerticalZoomValue}
          verticalZoomDisabled={graphPropertyCount === 0 || verticalZoomRatioBase <= 1}
          setGraphVerticalZoomValue={setGraphVerticalZoomValue}
        />
        <DopesheetLegendPopover disabled={disabled} />
        <DopesheetViewOptionsMenu
          disabled={disabled}
          visualizationMode={showGraphPane ? 'graph' : 'dopesheet'}
          graphRulerUnit={graphRulerUnit}
          onChangeRulerUnit={onChangeRulerUnit}
          graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
          onToggleGraphHandleVisibility={onToggleGraphHandleVisibility}
          autoZoomGraphHeight={autoZoomGraphHeight}
          onToggleAutoZoomGraphHeight={onToggleAutoZoomGraphHeight}
        />
      </div>
    </div>
  )
}
