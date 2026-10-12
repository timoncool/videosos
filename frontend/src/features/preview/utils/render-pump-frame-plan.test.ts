// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import {
  isAtomicPreviewTarget,
  resolveActivePreviewPresentationTarget,
  resolveBackwardScrubFlags,
  resolveBackwardScrubFramePlan,
  resolveRenderPumpTargetFrame,
  resolveReleasedScrubSnapshotGuardUntilMs,
  resolveScrubDirectionPlan,
  selectBoundaryPrewarmFrames,
  selectBoundarySourcePrewarmSources,
  shouldDropStalePausedPreviewRender,
  shouldPreservePausedTransportPresentation,
  shouldProbePreviewSourcePixels,
  shouldRejectBlankReleasedScrubHandoff,
  shouldRejectBlankTransportHandoff,
  shouldRecoverFailedActivePreseekSchedule,
  shouldRestoreCommittedPreviewSnapshot,
  shouldUseRenderedPlaybackOverlay,
  type RenderPumpFrameState,
} from './render-pump-frame-plan'

function makeState(overrides: Partial<RenderPumpFrameState> = {}): RenderPumpFrameState {
  return {
    currentFrame: 100,
    currentFrameEpoch: 1,
    previewFrame: null,
    previewFrameEpoch: 0,
    ...overrides,
  }
}

describe('render pump frame plan', () => {
  it('avoids synchronous canvas pixel probes during playback', () => {
    expect(shouldProbePreviewSourcePixels(true)).toBe(false)
    expect(shouldProbePreviewSourcePixels(false)).toBe(true)
  })

  it('routes reverse shuttle through the rendered playback overlay', () => {
    expect(
      shouldUseRenderedPlaybackOverlay(
        {
          isPlaying: true,
          playbackRate: -4,
        },
        false,
      ),
    ).toBe(true)
    expect(
      shouldUseRenderedPlaybackOverlay(
        {
          isPlaying: true,
          playbackRate: 4,
        },
        false,
      ),
    ).toBe(false)
    expect(
      shouldUseRenderedPlaybackOverlay(
        {
          isPlaying: false,
          playbackRate: -1,
        },
        true,
      ),
    ).toBe(false)
  })

  it('preserves the authoritative paused transport frame from delayed repaint', () => {
    expect(
      shouldPreservePausedTransportPresentation({
        holdActive: true,
        heldFrame: 100,
        renderedFrame: 100,
        displayedFrame: 100,
        currentFrame: 100,
        previewFrame: null,
        isPlaying: false,
      }),
    ).toBe(true)

    expect(
      shouldPreservePausedTransportPresentation({
        holdActive: true,
        heldFrame: 100,
        renderedFrame: 100,
        displayedFrame: 100,
        currentFrame: 100,
        previewFrame: 101,
        isPlaying: false,
      }),
    ).toBe(false)
  })

  it('drops superseded hover renders after the ruler target changes or clears', () => {
    expect(
      shouldDropStalePausedPreviewRender({
        renderedFrame: 120,
        currentFrame: 100,
        previewFrame: null,
        isPlaying: false,
      }),
    ).toBe(true)
    expect(
      shouldDropStalePausedPreviewRender({
        renderedFrame: 120,
        currentFrame: 100,
        previewFrame: 121,
        isPlaying: false,
      }),
    ).toBe(true)
    expect(
      shouldDropStalePausedPreviewRender({
        renderedFrame: 121,
        currentFrame: 100,
        previewFrame: 121,
        isPlaying: false,
      }),
    ).toBe(false)
  })

  it('restores the committed snapshot when hover skimming leaves the ruler', () => {
    expect(
      shouldRestoreCommittedPreviewSnapshot({
        previewFrame: null,
        previousPreviewFrame: 120,
        currentFrame: 100,
        snapshotFrame: 100,
      }),
    ).toBe(true)
    expect(
      shouldRestoreCommittedPreviewSnapshot({
        previewFrame: null,
        previousPreviewFrame: 120,
        currentFrame: 100,
        snapshotFrame: 99,
      }),
    ).toBe(false)
  })

  it('keeps a nonblank front buffer when a same-frame transport handoff renders blank', () => {
    expect(
      shouldRejectBlankTransportHandoff({
        isTransportSettling: true,
        renderedFrame: 100,
        displayedFrame: 100,
        probeRenderedFrameBlank: () => true,
        probeDisplayedFrameBlank: () => false,
      }),
    ).toBe(true)

    expect(
      shouldRejectBlankTransportHandoff({
        isTransportSettling: true,
        renderedFrame: 101,
        displayedFrame: 100,
        probeRenderedFrameBlank: () => true,
        probeDisplayedFrameBlank: () => false,
      }),
    ).toBe(true)
  })

  it('does not reject ordinary, different-frame, or intentionally blank renders', () => {
    const base = {
      isTransportSettling: true,
      renderedFrame: 100,
      displayedFrame: 100,
      probeRenderedFrameBlank: () => true,
      probeDisplayedFrameBlank: () => false,
    }

    expect(shouldRejectBlankTransportHandoff({ ...base, isTransportSettling: false })).toBe(false)
    expect(shouldRejectBlankTransportHandoff({ ...base, displayedFrame: 98 })).toBe(false)
    expect(
      shouldRejectBlankTransportHandoff({ ...base, probeRenderedFrameBlank: () => false }),
    ).toBe(false)
    expect(
      shouldRejectBlankTransportHandoff({ ...base, probeDisplayedFrameBlank: () => true }),
    ).toBe(false)
  })

  it('does not sample transport pixels when the frame gate already fails', () => {
    const probeRenderedFrameBlank = vi.fn(() => true)
    const probeDisplayedFrameBlank = vi.fn(() => false)

    expect(
      shouldRejectBlankTransportHandoff({
        isTransportSettling: false,
        renderedFrame: 100,
        displayedFrame: 100,
        probeRenderedFrameBlank,
        probeDisplayedFrameBlank,
      }),
    ).toBe(false)

    expect(probeRenderedFrameBlank).not.toHaveBeenCalled()
    expect(probeDisplayedFrameBlank).not.toHaveBeenCalled()
  })

  it('keeps a known-good committed frame when a delayed scrub-release render is blank', () => {
    const base = {
      releaseGuardFrame: 100,
      renderedFrame: 100,
      currentFrame: 100,
      previewFrame: null,
      isPlaying: false,
      snapshotFrame: 100,
      probeRenderedFrameBlank: () => true,
      probeSnapshotFrameBlank: () => false,
    }

    expect(shouldRejectBlankReleasedScrubHandoff(base)).toBe(true)
    expect(shouldRejectBlankReleasedScrubHandoff({ ...base, releaseGuardFrame: null })).toBe(false)
    expect(shouldRejectBlankReleasedScrubHandoff({ ...base, renderedFrame: 101 })).toBe(false)
    expect(shouldRejectBlankReleasedScrubHandoff({ ...base, previewFrame: 101 })).toBe(false)
    expect(
      shouldRejectBlankReleasedScrubHandoff({ ...base, probeRenderedFrameBlank: () => false }),
    ).toBe(false)
    expect(
      shouldRejectBlankReleasedScrubHandoff({ ...base, probeSnapshotFrameBlank: () => true }),
    ).toBe(false)
  })

  it('does not sample scrub-handoff pixels when the frame gate already fails', () => {
    const probeRenderedFrameBlank = vi.fn(() => true)
    const probeSnapshotFrameBlank = vi.fn(() => false)

    expect(
      shouldRejectBlankReleasedScrubHandoff({
        releaseGuardFrame: 100,
        renderedFrame: 101,
        currentFrame: 100,
        previewFrame: null,
        isPlaying: false,
        snapshotFrame: 100,
        probeRenderedFrameBlank,
        probeSnapshotFrameBlank,
      }),
    ).toBe(false)

    expect(probeRenderedFrameBlank).not.toHaveBeenCalled()
    expect(probeSnapshotFrameBlank).not.toHaveBeenCalled()
  })

  it('bounds committed snapshot ownership so later same-frame edits can take over', () => {
    expect(
      resolveReleasedScrubSnapshotGuardUntilMs({
        nowMs: 2_500,
      }),
    ).toBe(32_500)
  })

  it('does not let a disposed render-pump generation release a newer active preseek gate', () => {
    const currentSchedule = {
      effectDisposed: false,
      recoveredFailedSchedule: false,
      scheduleVersion: 2,
      activeScheduleVersion: 2,
      mounted: true,
      isPlaying: false,
      currentTarget: 120,
      targetFrame: 120,
    }

    expect(shouldRecoverFailedActivePreseekSchedule(currentSchedule)).toBe(true)
    expect(
      shouldRecoverFailedActivePreseekSchedule({
        ...currentSchedule,
        // Models an old promise settling after the replacement effect has set
        // the shared mounted ref back to true.
        effectDisposed: true,
      }),
    ).toBe(false)
    expect(
      shouldRecoverFailedActivePreseekSchedule({
        ...currentSchedule,
        scheduleVersion: 1,
      }),
    ).toBe(false)
  })

  it('pins the current rendered frame across forced-overlay play and pause handoffs', () => {
    expect(
      resolveActivePreviewPresentationTarget({
        state: { currentFrame: 100, previewFrame: null, isPlaying: true },
        prev: { currentFrame: 100, previewFrame: null, isPlaying: false },
        settlingReleasedScrubFrame: null,
        forceFastScrubOverlay: true,
      }),
    ).toBe(100)

    expect(
      resolveActivePreviewPresentationTarget({
        state: { currentFrame: 112, previewFrame: null, isPlaying: false },
        prev: { currentFrame: 112, previewFrame: null, isPlaying: true },
        settlingReleasedScrubFrame: null,
        forceFastScrubOverlay: true,
      }),
    ).toBe(112)
  })

  it('does not pin ordinary playback ticks or player-only play state changes', () => {
    expect(
      resolveActivePreviewPresentationTarget({
        state: { currentFrame: 101, previewFrame: null, isPlaying: true },
        prev: { currentFrame: 100, previewFrame: null, isPlaying: true },
        settlingReleasedScrubFrame: null,
        forceFastScrubOverlay: true,
      }),
    ).toBeNull()

    expect(
      resolveActivePreviewPresentationTarget({
        state: { currentFrame: 100, previewFrame: null, isPlaying: true },
        prev: { currentFrame: 100, previewFrame: null, isPlaying: false },
        settlingReleasedScrubFrame: null,
        forceFastScrubOverlay: false,
      }),
    ).toBeNull()
  })

  it('keeps scrub and released-scrub targets ahead of play state handoffs', () => {
    expect(
      resolveActivePreviewPresentationTarget({
        state: { currentFrame: 100, previewFrame: 124, isPlaying: false },
        prev: { currentFrame: 99, previewFrame: 123, isPlaying: false },
        settlingReleasedScrubFrame: null,
        forceFastScrubOverlay: true,
      }),
    ).toBe(124)

    expect(
      resolveActivePreviewPresentationTarget({
        state: { currentFrame: 125, previewFrame: null, isPlaying: false },
        prev: { currentFrame: 124, previewFrame: 125, isPlaying: false },
        settlingReleasedScrubFrame: 125,
        forceFastScrubOverlay: true,
      }),
    ).toBe(125)
  })

  it('prefers preview frame over current frame', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState({ previewFrame: 124 }),
      forceFastScrubOverlay: false,
      isPausedInsideTransition: false,
    })

    expect(target).toBe(124)
  })

  it('routes an ordinary ruler release back through the exact current-frame renderer', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState({ previewFrame: null, currentFrame: 142 }),
      forceFastScrubOverlay: false,
      isPausedInsideTransition: false,
      settlingReleasedScrubFrame: 142,
    })

    expect(target).toBe(142)
  })

  it('uses current frame when overlay is forced', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState(),
      forceFastScrubOverlay: true,
      isPausedInsideTransition: false,
    })

    expect(target).toBe(100)
  })

  it('uses current frame for paused transition overlay requests', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState({ previewFrame: null, currentFrame: 142 }),
      forceFastScrubOverlay: false,
      isPausedInsideTransition: true,
    })

    expect(target).toBe(142)
  })

  it('keeps preview frame ahead of paused transition fallback', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState({ previewFrame: 151, currentFrame: 142 }),
      forceFastScrubOverlay: false,
      isPausedInsideTransition: true,
    })

    expect(target).toBe(151)
  })

  it('detects atomic preview targets', () => {
    expect(
      isAtomicPreviewTarget(
        makeState({
          currentFrame: 88,
          currentFrameEpoch: 9,
          previewFrame: 88,
          previewFrameEpoch: 9,
        }),
      ),
    ).toBe(true)

    expect(
      isAtomicPreviewTarget(
        makeState({
          currentFrame: 88,
          currentFrameEpoch: 9,
          previewFrame: 88,
          previewFrameEpoch: 8,
        }),
      ),
    ).toBe(false)
  })

  it('tracks scrub direction and dropped preview frames', () => {
    const plan = resolveScrubDirectionPlan({
      state: makeState({ previewFrame: 110 }),
      prev: makeState({ previewFrame: 104 }),
      targetFrame: 110,
      prevTargetFrame: 104,
    })

    expect(plan).toEqual({
      direction: 1,
      scrubUpdates: 1,
      scrubDroppedFrames: 5,
    })
  })

  it('falls back to player only for non-atomic backward scrubs without forced overlay', () => {
    expect(
      resolveBackwardScrubFlags({
        scrubDirection: -1,
        forceFastScrubOverlay: false,
        isAtomicScrubTarget: false,
        preserveHighFidelityBackwardPreview: false,
      }),
    ).toEqual({
      suppressBackgroundPrewarm: true,
      fallbackToPlayer: true,
    })

    expect(
      resolveBackwardScrubFlags({
        scrubDirection: -1,
        forceFastScrubOverlay: true,
        isAtomicScrubTarget: false,
        preserveHighFidelityBackwardPreview: false,
      }).fallbackToPlayer,
    ).toBe(false)
  })

  it('quantizes and throttles backward scrub renders', () => {
    const firstPlan = resolveBackwardScrubFramePlan({
      targetFrame: 119,
      scrubDirection: -1,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      nowMs: 100,
      lastBackwardScrubRenderAt: 0,
      lastBackwardRequestedFrame: null,
    })

    expect(firstPlan).toEqual({
      requestedFrame: 118,
      throttleRequest: false,
      nextLastBackwardScrubRenderAt: 100,
      nextLastBackwardRequestedFrame: 118,
    })

    const throttledPlan = resolveBackwardScrubFramePlan({
      targetFrame: 117,
      scrubDirection: -1,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      nowMs: 110,
      lastBackwardScrubRenderAt: 100,
      lastBackwardRequestedFrame: 118,
    })

    expect(throttledPlan.throttleRequest).toBe(true)
    expect(throttledPlan.requestedFrame).toBe(116)
  })

  it('keeps full-fidelity backward targets when preservation is required', () => {
    expect(
      resolveBackwardScrubFramePlan({
        targetFrame: 117,
        scrubDirection: -1,
        isAtomicScrubTarget: false,
        preserveHighFidelityBackwardPreview: true,
        nowMs: 110,
        lastBackwardScrubRenderAt: 100,
        lastBackwardRequestedFrame: 118,
      }),
    ).toEqual({
      requestedFrame: 117,
      throttleRequest: false,
      nextLastBackwardScrubRenderAt: 0,
      nextLastBackwardRequestedFrame: null,
    })
  })

  it('selects nearby boundary frames with direction bias', () => {
    const frames = selectBoundaryPrewarmFrames({
      boundaryFrames: [70, 95, 101, 108, 130],
      targetFrame: 100,
      direction: 1,
      fps: 30,
    })

    expect(frames).toEqual([100, 101, 102, 107, 108, 109])
  })

  it('falls back to nearest boundary frames when direction has no candidates', () => {
    const frames = selectBoundaryPrewarmFrames({
      boundaryFrames: [91, 94, 96],
      targetFrame: 100,
      direction: 1,
      fps: 30,
    })

    expect(frames).toEqual([95, 96, 97, 93, 94])
  })

  it('selects nearby boundary sources and caps total sources', () => {
    const sources = selectBoundarySourcePrewarmSources({
      boundarySources: [
        { frame: 92, srcs: ['a', 'b', 'c'] },
        { frame: 101, srcs: ['d', 'e', 'f'] },
        { frame: 104, srcs: ['g', 'h', 'i'] },
      ],
      targetFrame: 100,
      direction: 1,
      fps: 30,
    })

    expect(sources).toEqual(['d', 'e', 'f', 'g', 'h', 'i'])
  })

  it('uses directional boundary source fallback and preserves selected entry ordering', () => {
    const sources = selectBoundarySourcePrewarmSources({
      boundarySources: [
        { frame: 94, srcs: ['a'] },
        { frame: 96, srcs: ['b', 'c'] },
      ],
      targetFrame: 100,
      direction: 1,
      fps: 30,
    })

    expect(sources).toEqual(['b', 'c', 'a'])
  })
})
