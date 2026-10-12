import type { TextMotionEffect } from '@/types/text-motion'
import type { TimelineItem } from '@/types/timeline'
import type { TextMotionSlot } from '@/types/text-motion'
import { getTextMotionPreset, segmentTextUnits } from '@/shared/typography/text-motion'

export interface TextMotionTimelineBand {
  slot: TextMotionSlot
  presetId: TextMotionEffect['presetId']
  fromFrame: number
  toFrame: number
  clipFromFrame: number
  clipToFrame: number
  unitCount: number
  durationFrames: number
  offsetFrames: number
}

function getTextMotionUnitCount(
  item: Extract<TimelineItem, { type: 'text' }>,
  effect: TextMotionEffect,
) {
  const unit = effect.unit ?? getTextMotionPreset(effect.presetId).unit
  return Math.max(1, segmentTextUnits(item.text.split(/\r?\n/u), unit).unitCount)
}

function getTextMotionWindow(
  item: Extract<TimelineItem, { type: 'text' }>,
  effect: TextMotionEffect | undefined,
): { length: number; unitCount: number } {
  if (!effect) return { length: 0, unitCount: 0 }
  const unitCount = getTextMotionUnitCount(item, effect)
  const maxRank =
    effect.order === 'center' ? Math.floor((unitCount - 1) / 2) : Math.max(0, unitCount - 1)
  const requested = Math.max(0, effect.durationFrames) + Math.max(0, effect.staggerFrames) * maxRank
  return { length: Math.min(item.durationInFrames / 2, requested), unitCount }
}

/** Resolve the absolute timeline spans occupied by a text item's procedural slots. */
export function getTextMotionTimelineBands(item: TimelineItem): TextMotionTimelineBand[] {
  if (item.type !== 'text' || !item.textMotion) return []
  const { in: inEffect, loop: loopEffect, out: outEffect } = item.textMotion
  const inWindow = getTextMotionWindow(item, inEffect)
  const outWindow = getTextMotionWindow(item, outEffect)
  const clipEnd = item.from + item.durationInFrames
  const inOffset = Math.min(
    Math.max(0, inEffect?.offsetFrames ?? 0),
    Math.max(0, item.durationInFrames - inWindow.length),
  )
  const outOffset = Math.min(
    Math.max(0, outEffect?.offsetFrames ?? 0),
    Math.max(0, item.durationInFrames - outWindow.length),
  )
  const inFrom = item.from + inOffset
  const inTo = inFrom + inWindow.length
  const outTo = clipEnd - outOffset
  const outFrom = outTo - outWindow.length
  const bands: TextMotionTimelineBand[] = []

  if (inEffect && inWindow.length > 0) {
    bands.push({
      slot: 'in',
      presetId: inEffect.presetId,
      fromFrame: inFrom,
      toFrame: inTo,
      clipFromFrame: item.from,
      clipToFrame: clipEnd,
      unitCount: inWindow.unitCount,
      durationFrames: inEffect.durationFrames,
      offsetFrames: inOffset,
    })
  }
  if (loopEffect) {
    const loopFrom = inEffect ? inTo : item.from
    const loopTo = outEffect ? outFrom : clipEnd
    if (loopTo > loopFrom) {
      bands.push({
        slot: 'loop',
        presetId: loopEffect.presetId,
        fromFrame: loopFrom,
        toFrame: loopTo,
        clipFromFrame: item.from,
        clipToFrame: clipEnd,
        unitCount: getTextMotionUnitCount(item, loopEffect),
        durationFrames: loopEffect.durationFrames,
        offsetFrames: 0,
      })
    }
  }
  if (outEffect && outWindow.length > 0) {
    bands.push({
      slot: 'out',
      presetId: outEffect.presetId,
      fromFrame: outFrom,
      toFrame: outTo,
      clipFromFrame: item.from,
      clipToFrame: clipEnd,
      unitCount: outWindow.unitCount,
      durationFrames: outEffect.durationFrames,
      offsetFrames: outOffset,
    })
  }
  return bands
}
