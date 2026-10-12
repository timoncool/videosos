// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  recordPreviewScrubPresentationQuality,
  recordPreviewScrubRequest,
  shouldPublishPreviewScrubDomSnapshot,
} from './preview-scrub-performance'

type PerformanceState = {
  fallbacks: Array<{
    seq: number
    workspace: string
    frame: number
    firstVisibleMs: number
    exactReplacementMs: number | null
  }>
  reset: () => void
}

function getState(): PerformanceState {
  return (globalThis as typeof globalThis & { __PREVIEW_SCRUB_PERF__: PerformanceState })
    .__PREVIEW_SCRUB_PERF__
}

beforeEach(() => getState().reset())

describe('preview scrub fallback performance', () => {
  it('publishes the serialized DOM snapshot only when explicitly requested', () => {
    expect(shouldPublishPreviewScrubDomSnapshot('')).toBe(false)
    expect(shouldPublishPreviewScrubDomSnapshot('?previewScrubPerfSnapshot=0')).toBe(false)
    expect(shouldPublishPreviewScrubDomSnapshot('?previewScrubPerfSnapshot=1')).toBe(true)
  })

  it('tracks first fallback visibility and later exact-frame replacement latency', () => {
    recordPreviewScrubRequest('color', 120, 1)
    recordPreviewScrubPresentationQuality(120, true)

    expect(getState().fallbacks).toHaveLength(1)
    expect(getState().fallbacks[0]).toMatchObject({
      seq: 1,
      workspace: 'color',
      frame: 120,
      exactReplacementMs: null,
    })

    recordPreviewScrubPresentationQuality(120, false)
    expect(getState().fallbacks[0]!.exactReplacementMs).toEqual(expect.any(Number))
  })

  it('does not attach an exact replacement to a superseded fallback request', () => {
    recordPreviewScrubRequest('color', 120, 1)
    recordPreviewScrubPresentationQuality(120, true)
    recordPreviewScrubRequest('color', 121, 1)
    recordPreviewScrubPresentationQuality(121, true)
    recordPreviewScrubPresentationQuality(120, false)

    expect(getState().fallbacks).toEqual([
      expect.objectContaining({ frame: 120, exactReplacementMs: null }),
      expect.objectContaining({ frame: 121, exactReplacementMs: null }),
    ])
  })

  it('keeps the handoff open for a pointer-up request on the same frame', () => {
    recordPreviewScrubRequest('animate', 240, 1)
    recordPreviewScrubPresentationQuality(240, true)
    recordPreviewScrubRequest('animate', 240, 0)
    recordPreviewScrubPresentationQuality(240, false)

    expect(getState().fallbacks).toHaveLength(1)
    expect(getState().fallbacks[0]!.exactReplacementMs).toEqual(expect.any(Number))
  })
})
