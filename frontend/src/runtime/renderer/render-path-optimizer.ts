export interface FrameRenderOptimizationInput {
  activeMaskCount: number
  activeTransitionCount: number
  hasGpuEffects: boolean
  renderTaskCount: number
}

export interface FrameRenderOptimization {
  shouldDirectRenderSingleTask: boolean
  shouldUseDeferredGpuBatch: boolean
}

/**
 * The scrub cache is optimized for paused random access. During live DOM-video
 * playback, reading it can display an old rendered frame and writing it adds a
 * full-frame GPU copy that contends with the next effect/composite submission.
 */
export function shouldUseScrubbingFrameCache(
  hasScrubbingCache: boolean,
  liveDomVideoPlaybackActive: boolean,
): boolean {
  return hasScrubbingCache && !liveDomVideoPlaybackActive
}

export function resolveFrameRenderOptimization(
  input: FrameRenderOptimizationInput,
): FrameRenderOptimization {
  const shouldDirectRenderSingleTask =
    input.activeMaskCount === 0 &&
    input.activeTransitionCount === 0 &&
    input.renderTaskCount === 1 &&
    !input.hasGpuEffects

  return {
    shouldDirectRenderSingleTask,
    shouldUseDeferredGpuBatch: input.hasGpuEffects && input.renderTaskCount > 0,
  }
}
