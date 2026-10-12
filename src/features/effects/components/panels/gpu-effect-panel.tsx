import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Scan } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { ColorPicker, PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import {
  getEffectDefinitionName,
  getEffectOptionLabel,
  getEffectParamLabel,
} from '@/features/effects/utils/effect-i18n'
import { getGpuEffectKeyframeValue } from '@/features/effects/utils/effect-keyframes'
import {
  useGizmoStore,
  usePowerWindowEditorStore,
  useSpatialEffectEditorStore,
} from '@/features/effects/deps/preview-contract'
import { getSpatialPointEffectConfig } from '@/infrastructure/gpu-effects/spatial-point-editor'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import { ParamResetButton } from './param-reset-button'
import type { GpuKeyframePanelProps, GpuParamValue } from './panel-props'

type GpuEffectPanelProps = GpuKeyframePanelProps

interface TextParamRowProps {
  effectId: string
  paramKey: string
  label: string
  value: string
  disabled: boolean
  className?: string
  onParamChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
  onParamLiveChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
  defaultValue: string
}

/**
 * Text param row. Mirrors the number/color rows' live-then-commit pattern: the
 * input drives a local draft + live preview on each keystroke and only commits
 * to history on blur, instead of committing on every keystroke.
 */
const TextParamRow = memo(function TextParamRow({
  effectId,
  paramKey,
  label,
  value,
  disabled,
  className,
  onParamChange,
  onParamLiveChange,
  defaultValue,
}: TextParamRowProps) {
  const [draft, setDraft] = useState(value)
  const isEditingRef = useRef(false)

  // Keep the draft in sync with external updates (undo/redo, keyframes, reset)
  // while the field isn't being actively edited.
  useEffect(() => {
    if (!isEditingRef.current) setDraft(value)
  }, [value])

  return (
    <PropertyRow label={label} className={className}>
      <Input
        value={draft}
        onFocus={() => {
          isEditingRef.current = true
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          onParamLiveChange(effectId, paramKey, e.target.value)
        }}
        onBlur={() => {
          isEditingRef.current = false
          if (draft !== value) onParamChange(effectId, paramKey, draft)
        }}
        disabled={disabled}
        className="h-6 text-xs flex-1 min-w-0"
        spellCheck={false}
      />
      <ParamResetButton
        effectId={effectId}
        paramKey={paramKey}
        label={label}
        value={value}
        defaultValue={defaultValue}
        onParamChange={onParamChange}
      />
    </PropertyRow>
  )
})

export const GpuEffectPanel = memo(function GpuEffectPanel({
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
}: GpuEffectPanelProps) {
  const { t } = useTranslation()
  const paramEntries = Object.entries(definition.params)
  const effectName = getEffectDefinitionName(definition)
  const [collapsed, setCollapsed] = useState(false)
  const spatialConfig = getSpatialPointEffectConfig(definition.id)
  const editableItemId = itemIds.length === 1 ? itemIds[0] : null
  const editingItemId = useSpatialEffectEditorStore((s) => s.editingItemId)
  const editingEffectId = useSpatialEffectEditorStore((s) => s.editingEffectId)
  const startSpatialEditing = useSpatialEffectEditorStore((s) => s.startEditing)
  const stopSpatialEditing = useSpatialEffectEditorStore((s) => s.stopEditing)
  const stopPowerWindowEditing = usePowerWindowEditorStore((s) => s.stopEditing)
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
      if (value !== effect.effect.params[key]) liveParams[key] = value
    }
    return Object.keys(liveParams).length > 0
      ? { ...gpuEffect, params: { ...gpuEffect.params, ...liveParams } }
      : gpuEffect
  }, [effect.effect, gpuEffect, previewEffect])
  const isDefault = paramEntries.every(
    ([key, param]) => displayGpuEffect.params[key] === param.default,
  )
  const isEditingOnCanvas =
    spatialConfig !== null &&
    editableItemId !== null &&
    editingItemId === editableItemId &&
    editingEffectId === effect.id

  const toggleCanvasEditor = useCallback(() => {
    if (isEditingOnCanvas) {
      stopSpatialEditing()
    } else if (editableItemId && spatialConfig) {
      stopPowerWindowEditing()
      startSpatialEditing(editableItemId, effect.id)
    }
  }, [
    editableItemId,
    effect.id,
    isEditingOnCanvas,
    spatialConfig,
    startSpatialEditing,
    stopPowerWindowEditing,
    stopSpatialEditing,
  ])

  useEffect(() => {
    if (isEditingOnCanvas && (!effect.enabled || !editableItemId)) stopSpatialEditing()
  }, [editableItemId, effect.enabled, isEditingOnCanvas, stopSpatialEditing])

  // Zero params: header-only row with action buttons
  if (paramEntries.length === 0) {
    return (
      <EffectPanelHeaderRow
        label={effectName}
        effectId={effect.id}
        enabled={effect.enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />
    )
  }

  // Multi-param: header row with buttons, then one row per param
  return (
    <div className="space-y-0">
      <EffectPanelHeaderRow
        label={effectName}
        effectId={effect.id}
        enabled={effect.enabled}
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
        <>
          {spatialConfig ? (
            <div className="px-2 pb-1 pt-1">
              <Button
                type="button"
                variant={isEditingOnCanvas ? 'default' : 'outline'}
                size="sm"
                className="h-7 w-full justify-center gap-1.5 text-xs"
                disabled={!effect.enabled || !editableItemId}
                aria-pressed={isEditingOnCanvas}
                onClick={toggleCanvasEditor}
              >
                <Scan className="h-3.5 w-3.5" />
                {isEditingOnCanvas
                  ? t('effects.powerWindow.editingOnCanvas')
                  : t('effects.powerWindow.editOnCanvas')}
              </Button>
            </div>
          ) : null}
          {paramEntries.map(([key, param]) => {
            const currentValue = displayGpuEffect.params[key] ?? param.default
            const paramVisible = param.visibleWhen?.(displayGpuEffect.params) ?? true
            if (!paramVisible) return null
            const paramEnabled = effect.enabled
            const paramLabel = getEffectParamLabel(t, definition, key)

            if (param.type === 'number') {
              const keyframeProperty = getKeyframeProperty(effect.id, key)
              return (
                <PropertyRow
                  key={key}
                  label={paramLabel}
                  className={!paramEnabled ? 'opacity-50' : undefined}
                >
                  <SliderInput
                    value={currentValue as number}
                    onChange={(v) => onParamChange(effect.id, key, v)}
                    onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                    min={param.min ?? 0}
                    max={param.max ?? 1}
                    step={param.step ?? 0.01}
                    disabled={!paramEnabled}
                    className="flex-1 min-w-0"
                  />
                  {keyframeProperty ? (
                    <KeyframeToggle
                      itemIds={itemIds}
                      property={keyframeProperty}
                      currentValue={currentValue as number}
                      disabled={!paramEnabled}
                    />
                  ) : null}
                  <ParamResetButton
                    effectId={effect.id}
                    paramKey={key}
                    label={paramLabel}
                    value={currentValue as number}
                    defaultValue={param.default}
                    onParamChange={onParamChange}
                  />
                </PropertyRow>
              )
            }

            if (param.type === 'boolean') {
              return (
                <PropertyRow
                  key={key}
                  label={paramLabel}
                  className={!paramEnabled ? 'opacity-50' : undefined}
                >
                  <Button
                    variant={currentValue ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onParamChange(effect.id, key, !currentValue)}
                    disabled={!paramEnabled}
                  >
                    {currentValue ? t('effects.panel.on') : t('effects.panel.off')}
                  </Button>
                  <ParamResetButton
                    effectId={effect.id}
                    paramKey={key}
                    label={paramLabel}
                    value={currentValue as boolean}
                    defaultValue={param.default}
                    onParamChange={onParamChange}
                  />
                </PropertyRow>
              )
            }

            if (param.type === 'select' && param.options) {
              return (
                <PropertyRow
                  key={key}
                  label={paramLabel}
                  className={!paramEnabled ? 'opacity-50' : undefined}
                >
                  <Select
                    value={currentValue as string}
                    onValueChange={(v) => onParamChange(effect.id, key, v)}
                    disabled={!paramEnabled}
                  >
                    <SelectTrigger className="h-6 text-xs flex-1 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {param.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {getEffectOptionLabel(t, definition, key, opt)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ParamResetButton
                    effectId={effect.id}
                    paramKey={key}
                    label={paramLabel}
                    value={currentValue as string}
                    defaultValue={param.default}
                    onParamChange={onParamChange}
                  />
                </PropertyRow>
              )
            }

            if (param.type === 'color') {
              const keyframeProperty = getKeyframeProperty(effect.id, key)
              const keyframeValue = getGpuEffectKeyframeValue(effect, key, currentValue)
              const allowAlpha = [currentValue, param.default].some(
                (value) => typeof value === 'string' && /^#[0-9a-f]{8}$/i.test(value.trim()),
              )
              return (
                <PropertyRow
                  key={key}
                  label={paramLabel}
                  className={!paramEnabled ? 'opacity-50' : undefined}
                >
                  <ColorPicker
                    color={currentValue as string}
                    onChange={(v) => onParamChange(effect.id, key, v)}
                    onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                    allowAlpha={allowAlpha}
                    disabled={!paramEnabled}
                  />
                  {keyframeProperty && keyframeValue !== null ? (
                    <KeyframeToggle
                      itemIds={itemIds}
                      property={keyframeProperty}
                      currentValue={keyframeValue}
                      disabled={!paramEnabled}
                    />
                  ) : null}
                  <ParamResetButton
                    effectId={effect.id}
                    paramKey={key}
                    label={paramLabel}
                    value={currentValue as string}
                    defaultValue={param.default}
                    onParamChange={onParamChange}
                  />
                </PropertyRow>
              )
            }

            if (param.type === 'text') {
              return (
                <TextParamRow
                  key={key}
                  effectId={effect.id}
                  paramKey={key}
                  label={paramLabel}
                  value={currentValue as string}
                  defaultValue={param.default as string}
                  disabled={!paramEnabled}
                  className={!paramEnabled ? 'opacity-50' : undefined}
                  onParamChange={onParamChange}
                  onParamLiveChange={onParamLiveChange}
                />
              )
            }

            return null
          })}
        </>
      )}
    </div>
  )
})
