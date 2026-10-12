import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import type { CollisionRect } from '../../utils/collision-utils'

function findNextAvailableSpaceOnTrack(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>,
): number {
  let nextFrom = Math.max(0, proposedFrom)

  for (const item of trackItems) {
    const itemEnd = item.from + item.durationInFrames
    if (itemEnd <= nextFrom) {
      continue
    }

    if (item.from >= nextFrom + durationInFrames) {
      break
    }

    nextFrom = itemEnd
  }

  return nextFrom
}

export function placeItemsWithoutTimelineOverlap(items: TimelineItem[]): TimelineItem[] {
  const occupiedRangesByTrack = new Map<string, CollisionRect[]>()
  const placedItems: TimelineItem[] = []

  for (const item of useItemsStore.getState().items) {
    const trackItems = occupiedRangesByTrack.get(item.trackId)
    if (trackItems) {
      trackItems.push(item)
    } else {
      occupiedRangesByTrack.set(item.trackId, [item])
    }
  }

  for (const trackItems of occupiedRangesByTrack.values()) {
    trackItems.sort((a, b) => a.from - b.from)
  }

  // Incoming items of one linked group (a video and its audio) move as one unit: they keep their offsets and
  // land where every one of them is free, so the pair never comes apart.
  const units: TimelineItem[][] = []
  const unitByGroup = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const group = item.linkedGroupId ? unitByGroup.get(item.linkedGroupId) : undefined
    if (group) {
      group.push(item)
      continue
    }
    const unit = [item]
    units.push(unit)
    if (item.linkedGroupId) unitByGroup.set(item.linkedGroupId, unit)
  }
  const unitStart = (unit: TimelineItem[]) => Math.min(...unit.map((item) => item.from))
  units.sort((a, b) => unitStart(a) - unitStart(b))

  for (const unit of units) {
    const start = unitStart(unit)
    let candidate = Math.max(0, start)
    for (;;) {
      let next = candidate
      for (const item of unit) {
        const offset = item.from - start
        const free = findNextAvailableSpaceOnTrack(
          candidate + offset,
          item.durationInFrames,
          occupiedRangesByTrack.get(item.trackId) ?? [],
        )
        next = Math.max(next, free - offset)
      }
      if (next === candidate) break
      candidate = next
    }

    for (const item of unit) {
      const finalFrom = candidate + item.from - start
      const placedItem = finalFrom === item.from ? item : { ...item, from: finalFrom }
      placedItems.push(placedItem)
      let trackItems = occupiedRangesByTrack.get(item.trackId)
      if (!trackItems) {
        trackItems = []
        occupiedRangesByTrack.set(item.trackId, trackItems)
      }
      trackItems.push({
        trackId: placedItem.trackId,
        from: placedItem.from,
        durationInFrames: placedItem.durationInFrames,
      })
      trackItems.sort((a, b) => a.from - b.from)
    }
  }

  return placedItems
}
