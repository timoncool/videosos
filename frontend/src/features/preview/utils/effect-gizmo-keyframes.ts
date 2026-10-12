import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { getAutoKeyframeOperation, type AutoKeyframeOperation } from '../deps/keyframes'

interface EffectGizmoCommitPlan {
  autoKeyframeOperations: AutoKeyframeOperation[]
  baseParamUpdates: Record<string, number>
}

/**
 * Split a gizmo's numeric parameter edits into keyframe operations and base
 * effect updates using the same auto-key rules as inspector sliders.
 */
export function planEffectGizmoCommit(
  item: TimelineItem,
  effect: ItemEffect,
  itemKeyframes: ItemKeyframes | undefined,
  currentFrame: number,
  updates: Record<string, number>,
): EffectGizmoCommitPlan {
  if (effect.effect.type !== 'gpu-effect') {
    return { autoKeyframeOperations: [], baseParamUpdates: updates }
  }

  const autoKeyframeOperations: AutoKeyframeOperation[] = []
  const baseParamUpdates: Record<string, number> = {}
  for (const [paramKey, value] of Object.entries(updates)) {
    const property = buildEffectAnimatableProperty(effect.effect.gpuEffectType, effect.id, paramKey)
    const operation = getAutoKeyframeOperation(item, itemKeyframes, property, value, currentFrame)
    if (operation) {
      autoKeyframeOperations.push(operation)
    } else {
      baseParamUpdates[paramKey] = value
    }
  }

  return { autoKeyframeOperations, baseParamUpdates }
}
