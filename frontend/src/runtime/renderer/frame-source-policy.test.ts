// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'

import {
  isPreviewGpuEffectFrameHoldFresh,
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldHoldPreviewGpuEffectFrame,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
  waitForPreviewDomVideoDrawDecision,
} from './frame-source-policy'

function makeDomVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    currentTime: 5,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    dataset: {},
    ...overrides,
  } as HTMLVideoElement
}

describe('frame-source-policy', () => {
  it('uses a DOM video that becomes seek-ready inside the bounded wait', async () => {
    const target = new EventTarget()
    const mutableVideo = Object.assign(target, {
      currentTime: 10,
      readyState: 1,
      videoWidth: 1920,
      videoHeight: 1080,
      dataset: {},
    })
    const video = mutableVideo as unknown as HTMLVideoElement

    const waiting = waitForPreviewDomVideoDrawDecision(
      { domVideo: video, sourceTime: 10, speed: 1, isRenderingTransition: false },
      50,
    )
    mutableVideo.readyState = 4
    video.dispatchEvent(new Event('seeked'))

    await expect(waiting).resolves.toMatchObject({ hasReadyDomVideo: true, shouldDraw: true })
  })

  it('accepts a ready DOM video when drift is within threshold', () => {
    const decision = resolvePreviewDomVideoDrawDecision({
      domVideo: makeDomVideo({ currentTime: 10.12 }),
      sourceTime: 10,
      speed: 1,
      isRenderingTransition: false,
    })

    expect(decision.hasReadyDomVideo).toBe(true)
    expect(decision.shouldDraw).toBe(true)
    expect(decision.driftThreshold).toBe(0.2)
  })

  it('uses a frame-level drift limit while a transport frame is settling', () => {
    const decision = resolvePreviewDomVideoDrawDecision({
      domVideo: makeDomVideo({ currentTime: 10 + 1 / 30 }),
      sourceTime: 10,
      speed: 1,
      isRenderingTransition: false,
      maxDriftSeconds: 0.5 / 30,
    })

    expect(decision.hasReadyDomVideo).toBe(true)
    expect(decision.shouldDraw).toBe(false)
    expect(decision.driftThreshold).toBeCloseTo(0.5 / 30)
  })

  it('holds the last GPU-effect frame across a transient metadata-only state', () => {
    expect(
      shouldHoldPreviewGpuEffectFrame({
        domVideo: makeDomVideo({ readyState: 1, currentTime: 10.08 }),
        sourceTime: 10,
        speed: 1,
        isRenderingTransition: false,
        currentFrame: 101,
        cachedFrame: 100,
        hasCachedFrame: true,
        fps: 30,
      }),
    ).toBe(true)
    expect(
      shouldHoldPreviewGpuEffectFrame({
        domVideo: makeDomVideo({ readyState: 0, currentTime: 10.08 }),
        sourceTime: 10,
        speed: 1,
        isRenderingTransition: false,
        currentFrame: 102,
        cachedFrame: 100,
        hasCachedFrame: true,
        fps: 30,
      }),
    ).toBe(true)
  })

  it('does not hold a stale, empty, or drifted GPU-effect frame', () => {
    const base = {
      sourceTime: 10,
      speed: 1,
      isRenderingTransition: false,
      currentFrame: 101,
      cachedFrame: 100,
      hasCachedFrame: true,
      fps: 30,
    }

    expect(
      shouldHoldPreviewGpuEffectFrame({
        ...base,
        domVideo: makeDomVideo({ readyState: 0, videoWidth: 0, currentTime: 10 }),
      }),
    ).toBe(false)
    expect(
      shouldHoldPreviewGpuEffectFrame({
        ...base,
        domVideo: makeDomVideo({ readyState: 1, currentTime: 10.5 }),
      }),
    ).toBe(false)
    expect(
      shouldHoldPreviewGpuEffectFrame({
        ...base,
        domVideo: makeDomVideo({ readyState: 1, currentTime: 10 }),
        currentFrame: 132,
      }),
    ).toBe(false)
  })

  it('bounds a missing-video continuity hold to one second', () => {
    expect(
      isPreviewGpuEffectFrameHoldFresh({
        currentFrame: 129,
        cachedFrame: 100,
        hasCachedFrame: true,
        fps: 30,
      }),
    ).toBe(true)
    expect(
      isPreviewGpuEffectFrameHoldFresh({
        currentFrame: 131,
        cachedFrame: 100,
        hasCachedFrame: true,
        fps: 30,
      }),
    ).toBe(false)
  })

  it('widens DOM video tolerance when transition hold is active', () => {
    const decision = resolvePreviewDomVideoDrawDecision({
      domVideo: makeDomVideo({
        currentTime: 10.8,
        dataset: { transitionHold: '1' } as DOMStringMap,
      }),
      sourceTime: 10,
      speed: 1,
      isRenderingTransition: false,
    })

    expect(decision.shouldDraw).toBe(true)
    expect(decision.driftThreshold).toBe(1.0)
  })

  it('warms mediabunny in the background for variable-speed preview playback', () => {
    expect(
      resolvePreviewMediabunnyInitAction({
        renderMode: 'preview',
        hasMediabunny: false,
        isMediabunnyDisabled: false,
        hasEnsureVideoItemReady: true,
        speed: 1.25,
      }),
    ).toBe('warm-background-and-skip')
  })

  it('warms mediabunny without blocking 1x preview playback', () => {
    expect(
      resolvePreviewMediabunnyInitAction({
        renderMode: 'preview',
        hasMediabunny: false,
        isMediabunnyDisabled: false,
        hasEnsureVideoItemReady: true,
        speed: 1,
      }),
    ).toBe('warm-background-and-continue')
  })

  it('uses strict waiting fallback only when preview has no decoder or fallback element', () => {
    expect(
      shouldUsePreviewStrictWaitingFallback({
        renderMode: 'preview',
        hasMediabunny: false,
        hasFallbackVideoElement: false,
      }),
    ).toBe(true)
    expect(
      shouldUsePreviewStrictWaitingFallback({
        renderMode: 'preview',
        hasMediabunny: true,
        hasFallbackVideoElement: false,
      }),
    ).toBe(false)
    expect(
      shouldUsePreviewStrictWaitingFallback({
        renderMode: 'export',
        hasMediabunny: false,
        hasFallbackVideoElement: false,
      }),
    ).toBe(false)
  })

  it('only tries worker bitmaps when preview lacks a ready DOM video', () => {
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'preview',
        hasReadyDomVideo: false,
      }),
    ).toBe(true)
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'preview',
        hasReadyDomVideo: true,
      }),
    ).toBe(false)
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'export',
        hasReadyDomVideo: false,
      }),
    ).toBe(false)
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'export',
        hasReadyDomVideo: false,
        allowPredecodedVideoFrames: true,
      }),
    ).toBe(true)
  })

  it('allows preview video element fallback when mediabunny is unavailable', () => {
    expect(
      shouldAllowPreviewVideoElementFallback({
        renderMode: 'preview',
        hasFallbackVideoElement: true,
        hasMediabunny: false,
        isMediabunnyDisabled: false,
        mediabunnyFailedThisFrame: false,
      }),
    ).toBe(true)
    expect(
      shouldAllowPreviewVideoElementFallback({
        renderMode: 'preview',
        hasFallbackVideoElement: true,
        hasMediabunny: true,
        isMediabunnyDisabled: false,
        mediabunnyFailedThisFrame: false,
      }),
    ).toBe(false)
  })
})
