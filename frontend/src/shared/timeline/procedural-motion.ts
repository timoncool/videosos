import type { TimelineItem } from '@/types/timeline'

export function hasEnabledProceduralMotion(item: TimelineItem): boolean {
  if (item.motionModifiers?.some((modifier) => modifier.enabled)) return true
  if (item.motionLayers?.some((layer) => layer.enabled)) return true
  return item.effects?.some((effect) => effect.audioPulse?.enabled) ?? false
}
