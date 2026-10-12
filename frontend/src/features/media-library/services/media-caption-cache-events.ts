type CaptionCacheInvalidator = (
  mediaId: string,
  thumbRelPaths: ReadonlyArray<string | undefined>,
) => void

const invalidators = new Set<CaptionCacheInvalidator>()

export function registerMediaCaptionCacheInvalidator(
  invalidator: CaptionCacheInvalidator,
): () => void {
  invalidators.add(invalidator)
  return () => {
    invalidators.delete(invalidator)
  }
}

export function invalidateMediaCaptionCaches(
  mediaId: string,
  thumbRelPaths: ReadonlyArray<string | undefined> = [],
): void {
  for (const invalidate of invalidators) {
    invalidate(mediaId, thumbRelPaths)
  }
}
