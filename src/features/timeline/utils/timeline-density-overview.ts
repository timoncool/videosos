import type { TimelineItem } from '@/types/timeline'

export interface TimelineDensityBucket {
  index: number
  from: number
  durationInFrames: number
  items: ReadonlyArray<TimelineItem>
}

export function buildTimelineDensityBuckets(
  items: ReadonlyArray<TimelineItem>,
  maxBucketCount: number,
): TimelineDensityBucket[] {
  if (items.length === 0 || maxBucketCount <= 0) return []
  let orderedItems = items
  for (let index = 1; index < items.length; index++) {
    if (items[index]!.from >= items[index - 1]!.from) continue
    orderedItems = [...items].sort((left, right) => left.from - right.from)
    break
  }
  const bucketSize = Math.max(1, Math.ceil(items.length / maxBucketCount))
  const buckets: TimelineDensityBucket[] = []

  for (let startIndex = 0; startIndex < orderedItems.length; startIndex += bucketSize) {
    const bucketItems = orderedItems.slice(startIndex, startIndex + bucketSize)
    let from = Number.POSITIVE_INFINITY
    let end = Number.NEGATIVE_INFINITY
    for (const item of bucketItems) {
      from = Math.min(from, item.from)
      end = Math.max(end, item.from + item.durationInFrames)
    }
    buckets.push({
      index: buckets.length,
      from,
      durationInFrames: Math.max(1, end - from),
      items: bucketItems,
    })
  }

  return buckets
}

export function findTimelineDensityBucketItem(
  bucket: TimelineDensityBucket,
  frame: number,
): TimelineItem {
  let closest = bucket.items[0]!
  let closestDistance = Number.POSITIVE_INFINITY
  for (const item of bucket.items) {
    if (frame >= item.from && frame < item.from + item.durationInFrames) return item
    const center = item.from + item.durationInFrames / 2
    const distance = Math.abs(center - frame)
    if (distance < closestDistance) {
      closest = item
      closestDistance = distance
    }
  }
  return closest
}
