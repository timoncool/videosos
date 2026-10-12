import { getGpuEffect } from '@/infrastructure/gpu-effects'
import { parseEffectAnimatableProperty, type AnimatableProperty } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'

export interface EffectPropertyResetPlan {
  resettableProperties: AnimatableProperty[]
  effectUpdates: Array<{ effectId: string; effect: ItemEffect['effect'] }>
}

export function buildEffectPropertyResetPlan(
  effects: readonly ItemEffect[],
  properties: readonly AnimatableProperty[],
): EffectPropertyResetPlan {
  const resetsByEffectId = new Map<string, Map<string, number | boolean | string>>()
  const resettableProperties: AnimatableProperty[] = []

  for (const property of properties) {
    const parsed = parseEffectAnimatableProperty(property)
    if (!parsed) continue
    const defaultValue = getGpuEffect(parsed.gpuEffectType)?.params[parsed.paramKey]?.default
    if (defaultValue === undefined) continue
    const resets = resetsByEffectId.get(parsed.effectId) ?? new Map()
    resets.set(parsed.paramKey, defaultValue)
    resetsByEffectId.set(parsed.effectId, resets)
    resettableProperties.push(property)
  }

  const effectUpdates = effects.flatMap((entry) => {
    const resets = resetsByEffectId.get(entry.id)
    if (!resets || entry.effect.type !== 'gpu-effect') return []
    const params = { ...entry.effect.params, ...Object.fromEntries(resets) }
    const changed = [...resets].some(([paramKey, value]) => entry.effect.params[paramKey] !== value)
    return changed ? [{ effectId: entry.id, effect: { ...entry.effect, params } }] : []
  })

  return { resettableProperties, effectUpdates }
}
