let activeCompositionId: string | null = null

export function getActiveCompositionId(): string | null {
  return activeCompositionId
}

export function setActiveCompositionId(nextActiveCompositionId: string | null): void {
  activeCompositionId = nextActiveCompositionId
}
