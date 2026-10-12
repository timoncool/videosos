export const MARQUEE_CANDIDATE_ATTRIBUTE = 'data-marquee-candidate'

export function updateMarqueeCandidateElements(
  elements: ReadonlyMap<string, HTMLElement>,
  previousIds: ReadonlySet<string>,
  nextIds: readonly string[],
): Set<string> {
  const nextIdSet = new Set(nextIds)

  for (const itemId of previousIds) {
    if (!nextIdSet.has(itemId)) {
      elements.get(itemId)?.removeAttribute(MARQUEE_CANDIDATE_ATTRIBUTE)
    }
  }
  for (const itemId of nextIdSet) {
    if (!previousIds.has(itemId)) {
      elements.get(itemId)?.setAttribute(MARQUEE_CANDIDATE_ATTRIBUTE, 'true')
    }
  }

  return nextIdSet
}
