export interface AnimationPresetFilterCandidate<T> {
  item: T
  label: string
  compatible: boolean
}

export function matchesAnimationPresetQuery(label: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return normalizedQuery.length === 0 || label.toLocaleLowerCase().includes(normalizedQuery)
}

export function filterAnimationPresetCandidates<T>(
  candidates: readonly AnimationPresetFilterCandidate<T>[],
  query: string,
  compatibleOnly: boolean,
): T[] {
  return candidates
    .filter(
      (candidate) =>
        (!compatibleOnly || candidate.compatible) &&
        matchesAnimationPresetQuery(candidate.label, query),
    )
    .map((candidate) => candidate.item)
}
