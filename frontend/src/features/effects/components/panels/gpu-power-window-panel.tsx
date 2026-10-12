import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Eye, EyeOff, Scan, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import {
  useGizmoStore,
  usePowerWindowEditorStore,
  useSpatialEffectEditorStore,
} from '@/features/effects/deps/preview-contract'
import { getEffectDefinitionName, getEffectParamLabel } from '@/features/effects/utils/effect-i18n'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import { ParamResetButton } from './param-reset-button'
import type { GpuKeyframePanelProps } from './panel-props'

const WINDOW_KEYS = ['centerX', 'centerY', 'sizeX', 'sizeY', 'rotation', 'feather'] as const
const CORRECTION_KEYS = ['exposure', 'saturation', 'temperature', 'tint', 'strength'] as const

function getNumberParam(
  params: Record<string, number | boolean | string>,
  key: string,
  fallback: number,
): number {
  const value = params[key]
  return typeof value === 'number' ? value : fallback
}

export const GpuPowerWindowPanel = memo(function GpuPowerWindowPanel({
  itemIds,
  effect,
  gpuEffect,
  definition,
  getKeyframeProperty,
  onParamChange,
  onParamLiveChange,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuKeyframePanelProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const paramEntries = Object.entries(definition.params)
  const enabled = effect.enabled
  const editableItemId = itemIds.length === 1 ? itemIds[0] : null
  const editingItemId = usePowerWindowEditorStore((s) => s.editingItemId)
  const editingEffectId = usePowerWindowEditorStore((s) => s.editingEffectId)
  const startEditing = usePowerWindowEditorStore((s) => s.startEditing)
  const stopEditing = usePowerWindowEditorStore((s) => s.stopEditing)
  const stopSpatialEditing = useSpatialEffectEditorStore((s) => s.stopEditing)
  const previewEffect = useGizmoStore(
    useCallback(
      (state) =>
        editableItemId
          ? state.preview?.[editableItemId]?.effects?.find((entry) => entry.id === effect.id)
          : undefined,
      [editableItemId, effect.id],
    ),
  )
  const displayGpuEffect = useMemo(() => {
    if (previewEffect?.effect.type !== 'gpu-effect' || effect.effect.type !== 'gpu-effect') {
      return gpuEffect
    }

    const liveParams: Record<string, number | boolean | string> = {}
    for (const [key, value] of Object.entries(previewEffect.effect.params)) {
      if (value !== effect.effect.params[key]) {
        liveParams[key] = value
      }
    }

    return Object.keys(liveParams).length > 0
      ? { ...gpuEffect, params: { ...gpuEffect.params, ...liveParams } }
      : gpuEffect
  }, [effect.effect, gpuEffect, previewEffect])
  const isDefault = paramEntries.every(
    ([key, param]) => displayGpuEffect.params[key] === param.default,
  )
  const activeShape =
    typeof displayGpuEffect.params.shape === 'string' ? displayGpuEffect.params.shape : 'ellipse'
  const isEditingOnCanvas =
    editableItemId !== null && editingItemId === editableItemId && editingEffectId === effect.id

  const toggleCanvasEditor = useCallback(() => {
    if (isEditingOnCanvas) {
      stopEditing()
    } else if (editableItemId) {
      stopSpatialEditing()
      startEditing(editableItemId, effect.id)
    }
  }, [editableItemId, effect.id, isEditingOnCanvas, startEditing, stopEditing, stopSpatialEditing])

  useEffect(() => {
    if (isEditingOnCanvas && (!enabled || !editableItemId)) {
      stopEditing()
    }
  }, [editableItemId, enabled, isEditingOnCanvas, stopEditing])

  const renderNumberRow = (key: string) => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return null
    const value = getNumberParam(displayGpuEffect.params, key, param.default as number)
    const keyframeProperty = getKeyframeProperty(effect.id, key)
    const min = param.min ?? 0
    const max = param.max ?? 1
    const step = param.step ?? 0.01
    const label = getEffectParamLabel(t, definition, key)
    const commitValue = (nextValue: number) => onParamChange(effect.id, key, nextValue)
    const previewValue = (nextValue: number) => onParamLiveChange(effect.id, key, nextValue)
    return (
      <PropertyRow key={key} label={label} className={!enabled ? 'opacity-50' : undefined}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <SliderInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={commitValue}
            onLiveChange={previewValue}
            disabled={!enabled}
            className="flex-1 min-w-0"
          />
          {keyframeProperty ? (
            <KeyframeToggle
              itemIds={itemIds}
              property={keyframeProperty}
              currentValue={value}
              disabled={!enabled}
            />
          ) : null}
          <ParamResetButton
            effectId={effect.id}
            paramKey={key}
            label={label}
            value={value}
            defaultValue={param.default}
            onParamChange={onParamChange}
          />
        </div>
      </PropertyRow>
    )
  }

  const renderBooleanToggle = (key: 'showMask' | 'invertMask') => {
    const param = definition.params[key]
    const active = Boolean(displayGpuEffect.params[key] ?? param?.default)
    const label = getEffectParamLabel(t, definition, key)
    return (
      <div key={key} className="flex min-w-0 flex-1 items-center gap-1">
        <Button
          variant={active ? 'default' : 'outline'}
          size="sm"
          className="h-7 min-w-0 flex-1 gap-1.5 px-2 text-xs"
          onClick={() => onParamChange(effect.id, key, !active)}
          disabled={!enabled}
          aria-pressed={active}
        >
          {key === 'showMask' ? (
            active ? (
              <Eye className="h-3 w-3" />
            ) : (
              <EyeOff className="h-3 w-3" />
            )
          ) : null}
          {label}
        </Button>
        {param ? (
          <ParamResetButton
            effectId={effect.id}
            paramKey={key}
            label={label}
            value={active}
            defaultValue={param.default}
            onParamChange={onParamChange}
          />
        ) : null}
      </div>
    )
  }

  const renderShapeButton = (shape: 'ellipse' | 'rectangle') => {
    const isActive = activeShape === shape
    const label = t(`effects.powerWindow.${shape}`)
    const Icon = shape === 'ellipse' ? Circle : Square
    return (
      <Button
        key={shape}
        variant={isActive ? 'default' : 'outline'}
        size="sm"
        className="h-7 flex-1 gap-1.5 px-2 text-xs"
        onClick={() => onParamChange(effect.id, 'shape', shape)}
        disabled={!enabled}
        aria-pressed={isActive}
      >
        <Icon className="h-3 w-3" />
        {label}
      </Button>
    )
  }

  return (
    <div className="space-y-0">
      <EffectPanelHeaderRow
        label={getEffectDefinitionName(definition)}
        effectId={effect.id}
        enabled={enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />

      {collapsed ? null : (
        <div className="space-y-0">
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.powerWindow.window')}
          </div>
          <div className="px-2 pb-1">
            <Button
              variant={isEditingOnCanvas ? 'default' : 'outline'}
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-xs"
              onClick={toggleCanvasEditor}
              disabled={!enabled || !editableItemId}
              aria-pressed={isEditingOnCanvas}
            >
              <Scan className="h-3 w-3" />
              {isEditingOnCanvas
                ? t('effects.powerWindow.editingOnCanvas')
                : t('effects.powerWindow.editOnCanvas')}
            </Button>
          </div>
          <div className="px-2 pb-1 flex gap-1">
            {renderShapeButton('ellipse')}
            {renderShapeButton('rectangle')}
            {definition.params.shape ? (
              <ParamResetButton
                effectId={effect.id}
                paramKey="shape"
                label={getEffectParamLabel(t, definition, 'shape')}
                value={activeShape}
                defaultValue={definition.params.shape.default}
                onParamChange={onParamChange}
              />
            ) : null}
          </div>
          {WINDOW_KEYS.map(renderNumberRow)}

          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.powerWindow.matte')}
          </div>
          <div className="px-2 pb-1 flex gap-1">
            {renderBooleanToggle('showMask')}
            {renderBooleanToggle('invertMask')}
          </div>

          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.powerWindow.correction')}
          </div>
          {CORRECTION_KEYS.map(renderNumberRow)}
        </div>
      )}
    </div>
  )
})
