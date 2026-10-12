const bucketElementByItemId = new Map<string, HTMLElement>()
const previewCountByBucket = new WeakMap<HTMLElement, number>()
let previewItemIds = new Set<string>()

function changeBucketPreviewCount(element: HTMLElement, delta: number) {
  const nextCount = Math.max(0, (previewCountByBucket.get(element) ?? 0) + delta)
  previewCountByBucket.set(element, nextCount)
  element.classList.toggle('timeline-marquee-preview', nextCount > 0)
}

export function registerTimelineDensityMarqueeBucket(
  element: HTMLElement,
  itemIds: ReadonlyArray<string>,
): () => void {
  let initialPreviewCount = 0
  for (const id of itemIds) {
    bucketElementByItemId.set(id, element)
    if (previewItemIds.has(id)) initialPreviewCount++
  }
  previewCountByBucket.set(element, initialPreviewCount)
  element.classList.toggle('timeline-marquee-preview', initialPreviewCount > 0)

  return () => {
    for (const id of itemIds) {
      if (bucketElementByItemId.get(id) === element) bucketElementByItemId.delete(id)
    }
    previewCountByBucket.delete(element)
    element.classList.remove('timeline-marquee-preview')
  }
}

export function setTimelineDensityMarqueePreview(itemIds: ReadonlyArray<string>): void {
  const nextIds = new Set(itemIds)
  for (const id of previewItemIds) {
    if (nextIds.has(id)) continue
    const element = bucketElementByItemId.get(id)
    if (element) changeBucketPreviewCount(element, -1)
  }
  for (const id of nextIds) {
    if (previewItemIds.has(id)) continue
    const element = bucketElementByItemId.get(id)
    if (element) changeBucketPreviewCount(element, 1)
  }
  previewItemIds = nextIds
}
