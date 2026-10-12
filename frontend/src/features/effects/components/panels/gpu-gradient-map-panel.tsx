import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GRADIENT_MAP_PRESETS } from '@/infrastructure/gpu-effects/effects/color'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { ColorPicker, PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import {
  getEffectDefinitionName,
  getEffectOptionLabel,
  getEffectParamLabel,
} from '@/features/effects/utils/effect-i18n'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import { ParamResetButton } from './param-reset-button'
import type { GpuKeyframePanelProps } from './panel-props'

const FALLBACK_STOPS = ['#000000', '#ffffff']

function parseStops(value: unknown): string[] {
  if (typeof value !== 'string') return [...FALLBACK_STOPS]
  const stops = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return stops.length >= 2 ? stops : [...FALLBACK_STOPS]
}

function resolveHexes(preset: string, customStops: unknown): string[] {
  if (preset === 'custom') return parseStops(customStops)
  return GRADIENT_MAP_PRESETS[preset] ?? GRADIENT_MAP_PRESETS.inferno ?? FALLBACK_STOPS
}

/**
 * Panel for gpu-gradient-map: a palette picker, an editable color-stop list for
 * custom palettes, a live gradient preview, and the mix slider.
 */
export const GpuGradientMapPanel = memo(function GpuGradientMapPanel({
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

  const presetParam = definition.params.preset
  const customStopsParam = definition.params.customStops
  const mixParam = definition.params.mix
  const presetDefault = typeof presetParam?.default === 'string' ? presetParam.default : 'inferno'
  const mixDefault = typeof mixParam?.default === 'number' ? mixParam.default : 1
  const preset =
    typeof gpuEffect.params.preset === 'string' ? gpuEffect.params.preset : presetDefault
  const mix = typeof gpuEffect.params.mix === 'number' ? gpuEffect.params.mix : mixDefault
  const isCustom = preset === 'custom'
  const stops = parseStops(gpuEffect.params.customStops)
  const previewHexes = resolveHexes(preset, gpuEffect.params.customStops)
  const isDefault = Object.entries(definition.params).every(
    ([key, param]) => (gpuEffect.params[key] ?? param.default) === param.default,
  )

  const presetOptions = definition.params.preset?.options ?? []
  const mixKeyframe = getKeyframeProperty(effect.id, 'mix')
  const enabled = effect.enabled

  const commitStops = useCallback(
    (next: string[]) => {
      onParamChange(effect.id, 'customStops', next.join(', '))
    },
    [effect.id, onParamChange],
  )

  const setStop = useCallback(
    (index: number, value: string, live: boolean) => {
      const next = [...stops]
      next[index] = value
      if (live) onParamLiveChange(effect.id, 'customStops', next.join(', '))
      else commitStops(next)
    },
    [stops, effect.id, onParamLiveChange, commitStops],
  )

  const addStop = useCallback(() => {
    commitStops([...stops, stops[stops.length - 1] ?? '#ffffff'])
  }, [stops, commitStops])

  const removeStop = useCallback(
    (index: number) => {
      if (stops.length <= 2) return
      commitStops(stops.filter((_, i) => i !== index))
    },
    [stops, commitStops],
  )

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
          <PropertyRow
            label={getEffectParamLabel(t, definition, 'preset')}
            className={!enabled ? 'opacity-50' : undefined}
          >
            <Select
              value={preset}
              onValueChange={(v) => onParamChange(effect.id, 'preset', v)}
              disabled={!enabled}
            >
              <SelectTrigger className="h-6 text-xs flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presetOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {getEffectOptionLabel(t, definition, 'preset', opt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {presetParam ? (
              <ParamResetButton
                effectId={effect.id}
                paramKey="preset"
                label={getEffectParamLabel(t, definition, 'preset')}
                value={preset}
                defaultValue={presetParam.default}
                onParamChange={onParamChange}
              />
            ) : null}
          </PropertyRow>

          <div className="px-2 pb-1">
            <div
              className="h-3 w-full rounded-sm border border-border"
              style={{ background: `linear-gradient(to right, ${previewHexes.join(', ')})` }}
            />
          </div>

          {isCustom && (
            <>
              {stops.map((hex, index) => (
                <PropertyRow
                  key={index}
                  label={`${getEffectParamLabel(t, definition, 'customStops')} ${index + 1}`}
                  className={!enabled ? 'opacity-50' : undefined}
                >
                  <div className="flex items-center gap-1 min-w-0 w-full">
                    <ColorPicker
                      color={hex}
                      onChange={(v) => setStop(index, v, false)}
                      onLiveChange={(v) => setStop(index, v, true)}
                      disabled={!enabled}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 flex-shrink-0"
                      onClick={() => removeStop(index)}
                      disabled={!enabled || stops.length <= 2}
                      title={t('effects.gradientMap.removeStop', { defaultValue: 'Remove stop' })}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </PropertyRow>
              ))}
              <div className="flex items-center gap-1 px-2 py-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 min-w-0 flex-1 justify-center gap-1.5 text-xs"
                  onClick={addStop}
                  disabled={!enabled}
                >
                  <Plus className="w-3 h-3" />
                  {t('effects.gradientMap.addStop', { defaultValue: 'Add Stop' })}
                </Button>
                {customStopsParam ? (
                  <ParamResetButton
                    effectId={effect.id}
                    paramKey="customStops"
                    label={getEffectParamLabel(t, definition, 'customStops')}
                    value={
                      typeof gpuEffect.params.customStops === 'string'
                        ? gpuEffect.params.customStops
                        : customStopsParam.default
                    }
                    defaultValue={customStopsParam.default}
                    onParamChange={onParamChange}
                  />
                ) : null}
              </div>
            </>
          )}

          <PropertyRow
            label={getEffectParamLabel(t, definition, 'mix')}
            className={!enabled ? 'opacity-50' : undefined}
          >
            <SliderInput
              value={mix}
              onChange={(v) => onParamChange(effect.id, 'mix', v)}
              onLiveChange={(v) => onParamLiveChange(effect.id, 'mix', v)}
              min={0}
              max={1}
              step={0.01}
              disabled={!enabled}
              className="flex-1 min-w-0"
            />
            {mixKeyframe ? (
              <KeyframeToggle
                itemIds={itemIds}
                property={mixKeyframe}
                currentValue={mix}
                disabled={!enabled}
              />
            ) : null}
            {mixParam ? (
              <ParamResetButton
                effectId={effect.id}
                paramKey="mix"
                label={getEffectParamLabel(t, definition, 'mix')}
                value={mix}
                defaultValue={mixParam.default}
                onParamChange={onParamChange}
              />
            ) : null}
          </PropertyRow>
        </div>
      )}
    </div>
  )
})
