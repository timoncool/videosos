/**
 * Pipelined double-buffer frame loop, extracted verbatim from
 * {@link renderComposition} in canvas-render-orchestrator.ts.
 *
 * Renders frame N while frame N-1's encode is still in flight; at most one
 * encode is in flight at a time, and a sample is captured only after the
 * previous encode has drained, so frames reach the encoder in order.
 *
 * Behavior must stay bit-identical to the original inline loop — this is the
 * export hot path. Known pre-existing hole kept on purpose: when the loop
 * exits via a non-abort error (renderFrame throw or pending error) while an
 * encode is in flight, that encode promise is never awaited; only the abort
 * path drains it.
 */

export interface CloseableSample {
  close(): void
}

export interface PipelinedFrameLoopDeps<S extends CloseableSample> {
  totalFrames: number
  signal?: AbortSignal
  /**
   * Read (not throw) a pending async error, e.g. a failed audio task.
   * Checked with a truthiness test at the top of every iteration.
   */
  getPendingError?: () => unknown
  /**
   * Render the frame to the capture surface, including any scale-to-output
   * blit. Overlaps with the previous frame's in-flight encode.
   */
  renderFrame: (frame: number) => Promise<void>
  /**
   * Snapshot the capture surface (e.g. VideoSample construction). Called
   * strictly after the previous encode has drained; must stay synchronous.
   */
  captureSample: (frame: number) => S
  /**
   * Feed the sample to the encoder. `keyFrame` is true only for frame 0.
   * The loop closes the sample when the returned promise settles.
   */
  encodeSample: (sample: S, keyFrame: boolean) => Promise<void>
  /**
   * Abort path: called after the in-flight encode has been drained (its
   * errors discarded), before the AbortError is thrown.
   */
  onAbort: () => Promise<void>
  /** Called once per frame, synchronously after its encode is kicked off. */
  onFrameProgress: (frame: number) => void
}

export async function runPipelinedFrameLoop<S extends CloseableSample>(
  deps: PipelinedFrameLoopDeps<S>,
): Promise<void> {
  const {
    totalFrames,
    signal,
    getPendingError,
    renderFrame,
    captureSample,
    encodeSample,
    onAbort,
    onFrameProgress,
  } = deps

  let pendingEncode: Promise<void> | null = null

  for (let frame = 0; frame < totalFrames; frame++) {
    const pendingError = getPendingError?.()
    if (pendingError) throw pendingError

    // Check for abort — drain any in-flight encode first so the encoder
    // is idle before we cancel the output. Discard encoder errors since
    // we are aborting anyway and must always surface AbortError.
    if (signal?.aborted) {
      if (pendingEncode) {
        try {
          await pendingEncode
        } catch {
          /* discarded — aborting */
        }
      }
      await onAbort()
      throw new DOMException('Render cancelled', 'AbortError')
    }

    // Render frame first — this overlaps with the previous frame's encode
    // that is still in flight. The previous sample already copied its
    // pixels, so writing to the capture surface here cannot corrupt it.
    await renderFrame(frame)

    // Now wait for the previous encode to finish before capturing a new
    // sample. This ensures at most one encode is in flight and that frames
    // are fed to the encoder in order.
    if (pendingEncode) await pendingEncode

    // Snapshot pixels into a sample. The capture copies pixel data
    // immediately — the surface is free for the next render.
    const sample = captureSample(frame)

    // Kick off encoding in the background. NOT awaited here — it runs
    // concurrently with the next iteration's renderFrame().
    const isKeyFrame = frame === 0
    pendingEncode = (async () => {
      try {
        await encodeSample(sample, isKeyFrame)
      } finally {
        // The encoder does NOT close samples. We must close to release the
        // underlying frame's GPU memory, otherwise the browser throttles
        // after ~8-16 outstanding frames.
        sample.close()
      }
    })()

    onFrameProgress(frame)
  }

  // Drain the final in-flight encode before finalizing
  if (pendingEncode) await pendingEncode
}
