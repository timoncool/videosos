interface PreviewSchedulingApi {
  isInputPending?: (options?: { includeContinuous?: boolean }) => boolean
}

type PreviewNavigator = Navigator & {
  scheduling?: PreviewSchedulingApi
}

export function shouldYieldToPendingPreviewInput(
  isPlaying: boolean,
  scheduling: PreviewSchedulingApi | undefined,
): boolean {
  return isPlaying && (scheduling?.isInputPending?.({ includeContinuous: true }) ?? false)
}

export function hasPendingPreviewInput(isPlaying: boolean): boolean {
  const scheduling =
    typeof navigator === 'undefined' ? undefined : (navigator as PreviewNavigator).scheduling
  return shouldYieldToPendingPreviewInput(isPlaying, scheduling)
}

/**
 * Let Chrome service a queued click/key event between playback renders. The
 * timer is only scheduled when isInputPending reports actual work, so ordinary
 * playback and the first visible frame do not gain an unconditional yield.
 */
export function yieldToPendingPreviewInput(): Promise<void> {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}
