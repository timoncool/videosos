import type { TFunction } from 'i18next'
import {
  PROPERTY_LABELS,
  isBuiltInAnimatableProperty,
  isPathVertexAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
} from '@/types/keyframe'
import { getGpuEffect } from '@/infrastructure/gpu-effects'

export function getKeyframePropertyLabel(t: TFunction, property: AnimatableProperty): string {
  if (isBuiltInAnimatableProperty(property)) {
    return t(`keyframes.properties.${property}`, { defaultValue: PROPERTY_LABELS[property] })
  }
  if (isPathVertexAnimatableProperty(property)) return PROPERTY_LABELS[property] ?? property

  const parsed = parseEffectAnimatableProperty(property)
  if (!parsed) {
    return property
  }

  const definition = getGpuEffect(parsed.gpuEffectType)
  const param = definition?.params[parsed.paramKey]
  if (definition && param) {
    const paramLabel = t(`effects.params.${parsed.paramKey}`, { defaultValue: param.label })
    return `${definition.name}: ${paramLabel}`
  }

  return parsed.paramKey
}

/** Parameter-only label for rows nested beneath an effect-instance header. */
export function getKeyframePropertyShortLabel(t: TFunction, property: AnimatableProperty): string {
  if (isBuiltInAnimatableProperty(property)) {
    return t(`keyframes.properties.${property}`, { defaultValue: PROPERTY_LABELS[property] })
  }
  if (isPathVertexAnimatableProperty(property)) return PROPERTY_LABELS[property] ?? property

  const parsed = parseEffectAnimatableProperty(property)
  if (!parsed) return property

  const param = getGpuEffect(parsed.gpuEffectType)?.params[parsed.paramKey]
  return param
    ? t(`effects.params.${parsed.paramKey}`, { defaultValue: param.label })
    : parsed.paramKey
}

export function getKeyframeGroupLabel(t: TFunction, groupId: string, fallback: string): string {
  return t(`keyframes.groups.${groupId}`, { defaultValue: fallback })
}
