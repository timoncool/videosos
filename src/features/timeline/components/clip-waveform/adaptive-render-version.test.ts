import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getWaveformActiveTileCount,
  getWaveformZoomCommitPhaseMs,
  getWaveformZoomRedrawIntervalMs,
  useAdaptiveWaveformPixelsPerSecond,
} from './adaptive-render-version'
import { _resetZoomStoreForTest, useZoomStore } from '../../stores/zoom-store'

describe('adaptive waveform render version helpers', () => {
  it('derives active tile count from the visible window plus overscan', () => {
    expect(
      getWaveformActiveTileCount({
        renderWidth: 5200,
        visibleStartPx: 900,
        visibleEndPx: 3100,
      }),
    ).toBe(5)
  })

  it('clamps active tile count to the total tile count for short clips', () => {
    expect(
      getWaveformActiveTileCount({
        renderWidth: 700,
        visibleStartPx: 0,
        visibleEndPx: 700,
      }),
    ).toBe(1)
  })

  it('uses shorter redraw intervals for fewer visible tiles', () => {
    expect(getWaveformZoomRedrawIntervalMs(2)).toBe(16)
    expect(getWaveformZoomRedrawIntervalMs(4)).toBe(20)
    expect(getWaveformZoomRedrawIntervalMs(8)).toBe(24)
    expect(getWaveformZoomRedrawIntervalMs(12)).toBe(32)
  })

  it('adds a stable phase delay for heavier redraw batches', () => {
    expect(getWaveformZoomCommitPhaseMs(2, 'media-1')).toBe(0)
    expect(getWaveformZoomCommitPhaseMs(8, 'media-1')).toBe(
      getWaveformZoomCommitPhaseMs(8, 'media-1'),
    )
    expect(getWaveformZoomCommitPhaseMs(12, 'media-1')).toBeGreaterThanOrEqual(0)
    expect(getWaveformZoomCommitPhaseMs(12, 'media-1')).toBeLessThanOrEqual(72)
  })
})

describe('useAdaptiveWaveformPixelsPerSecond', () => {
  let now = 100

  beforeEach(() => {
    vi.useFakeTimers()
    now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    _resetZoomStoreForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces rapid live zoom updates and commits the latest sharp geometry', async () => {
    const { result } = renderHook(() =>
      useAdaptiveWaveformPixelsPerSecond({
        pixelsPerSecond: 100,
        activeTileCount: 2,
        phaseKey: 'media-1',
      }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current).toBe(100)

    act(() => {
      useZoomStore.setState({ pixelsPerSecond: 140, isZoomInteracting: true })
      useZoomStore.setState({ pixelsPerSecond: 180, isZoomInteracting: true })
    })
    expect(result.current).toBe(100)

    now = 116
    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(result.current).toBe(180)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('commits immediately after the redraw budget even for a phased waveform', async () => {
    const phaseKey = Array.from({ length: 20 }, (_, index) => `media-${index}`).find(
      (key) => getWaveformZoomCommitPhaseMs(5, key) > 0,
    )
    expect(phaseKey).toBeDefined()

    const { result } = renderHook(() =>
      useAdaptiveWaveformPixelsPerSecond({
        pixelsPerSecond: 100,
        activeTileCount: 5,
        phaseKey,
      }),
    )

    now = 140
    await act(async () => {
      useZoomStore.setState({ pixelsPerSecond: 180, isZoomInteracting: true })
      await Promise.resolve()
    })

    expect(result.current).toBe(180)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('never falls back to settled geometry when mounted during live zoom', () => {
    useZoomStore.setState({
      pixelsPerSecond: 180,
      isZoomInteracting: true,
    })
    const phaseKey = Array.from({ length: 20 }, (_, index) => `media-${index}`).find(
      (key) => getWaveformZoomCommitPhaseMs(5, key) > 0,
    )
    expect(phaseKey).toBeDefined()

    const { result } = renderHook(() =>
      useAdaptiveWaveformPixelsPerSecond({
        pixelsPerSecond: 100,
        activeTileCount: 5,
        phaseKey,
      }),
    )

    expect(result.current).toBe(180)

    act(() => {
      vi.runAllTimers()
    })

    expect(result.current).toBe(180)
  })

  it('tracks every held-slider step once each redraw budget has elapsed', async () => {
    const phaseKey = Array.from({ length: 20 }, (_, index) => `media-${index}`).find(
      (key) => getWaveformZoomCommitPhaseMs(5, key) > 0,
    )
    const { result } = renderHook(() =>
      useAdaptiveWaveformPixelsPerSecond({
        pixelsPerSecond: 100,
        activeTileCount: 5,
        phaseKey,
      }),
    )

    for (const nextPixelsPerSecond of [180, 140, 220, 120, 200]) {
      now += 40
      await act(async () => {
        useZoomStore.setState({
          pixelsPerSecond: nextPixelsPerSecond,
          isZoomInteracting: true,
        })
        await Promise.resolve()
      })
      expect(result.current).toBe(nextPixelsPerSecond)
    }

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('ignores global timeline zoom when live tracking is disabled', async () => {
    useZoomStore.setState({
      pixelsPerSecond: 180,
      isZoomInteracting: true,
    })
    const { result, rerender } = renderHook(
      ({ pixelsPerSecond }) =>
        useAdaptiveWaveformPixelsPerSecond({
          pixelsPerSecond,
          activeTileCount: 2,
          enabled: false,
        }),
      { initialProps: { pixelsPerSecond: 75 } },
    )

    expect(result.current).toBe(75)

    await act(async () => {
      useZoomStore.setState({ pixelsPerSecond: 220 })
      await Promise.resolve()
    })
    expect(result.current).toBe(75)

    rerender({ pixelsPerSecond: 90 })
    expect(result.current).toBe(90)
  })

  it('stops live commits while hidden and catches up when tracking is re-enabled', async () => {
    useZoomStore.setState({
      pixelsPerSecond: 100,
      isZoomInteracting: true,
    })
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useAdaptiveWaveformPixelsPerSecond({
          pixelsPerSecond: 75,
          activeTileCount: 2,
          enabled,
        }),
      { initialProps: { enabled: true } },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(100)

    rerender({ enabled: false })
    expect(result.current).toBe(75)

    now = 116
    await act(async () => {
      useZoomStore.setState({ pixelsPerSecond: 220 })
      vi.runAllTimers()
      await Promise.resolve()
    })
    expect(result.current).toBe(75)

    rerender({ enabled: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(220)
  })
})
