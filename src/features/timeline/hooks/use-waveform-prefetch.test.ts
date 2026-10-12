import { createElement } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { useSelectionStore } from '@/shared/state/selection'
import type { AudioItem, VideoItem } from '@/types/timeline'

const waveformCacheMocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
}))

vi.mock('../services/waveform-cache', () => ({
  waveformCache: {
    prefetch: waveformCacheMocks.prefetch,
  },
}))

import { _resetWaveformPrefetchForTest, useWaveformPrefetch } from './use-waveform-prefetch'
import { _resetPreviewWorkBudgetForTest } from './preview-work-budget'
import { useItemsStore } from '../stores/items-store'
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store'
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store'
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store'
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store'
import { _resetZoomStoreForTest } from '../stores/zoom-store'

function makeVideoItem(id: string, from: number, duration: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames: duration,
    label: `${id}.mp4`,
    src: 'blob:test',
    mediaId: `media-${id}`,
  } as VideoItem
}

function makeAudioItem(id: string, from: number, duration: number): AudioItem {
  return {
    id,
    type: 'audio',
    trackId: 'track-1',
    from,
    durationInFrames: duration,
    label: `${id}.mp3`,
    src: 'blob:test',
    mediaId: `media-${id}`,
  } as AudioItem
}

function WaveformPrefetchProbe({ onRender }: { onRender: () => void }) {
  useWaveformPrefetch()
  onRender()
  return null
}

/**
 * The hook only reaches `waveformCache.prefetch` after a debounce timer, an idle callback and
 * a dynamic import of the cache module. Counting those ticks by hand is what made this suite
 * flaky — the import is cold on the first test that triggers it and resolves a tick later than
 * a warm one. Poll for the effect instead of guessing when it lands.
 */
function stubSynchronousIdleCallback() {
  let idleId = 0
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline)
    idleId += 1
    return idleId
  })
  vi.stubGlobal('cancelIdleCallback', (id: number) => {
    void id
  })
}

/**
 * `setViewport` throttles scroll-only updates through module-level state, so a plain call can
 * be swallowed and land later — leaking one test's scroll position into the next. Every test
 * here depends on the scroll position the hook reads, so bypass the throttle entirely.
 */
function setViewportNow(scrollLeft: number) {
  useTimelineViewportStore.getState().setViewportImmediate({
    scrollLeft,
    scrollTop: 0,
    viewportWidth: 1000,
    viewportHeight: 120,
  })
}

describe('waveform prefetch filtering', () => {
  const fps = 30

  beforeEach(() => {
    _resetWaveformPrefetchForTest()
    _resetPreviewWorkBudgetForTest()
    useTimelineSettingsStore.setState({
      fps,
      scrollPosition: 0,
      snapEnabled: true,
      isDirty: false,
      isTimelineLoading: false,
    })
    _resetZoomStoreForTest()
    useSelectionStore.getState().setDragState(null)
    useRollingEditPreviewStore.getState().clearPreview()
    useRippleEditPreviewStore.getState().clearPreview()
    useSlipEditPreviewStore.getState().clearPreview()
    useSlideEditPreviewStore.getState().clearPreview()
    useTrackPushPreviewStore.getState().clearPreview()
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    waveformCacheMocks.prefetch.mockReset()
    _resetViewportThrottle()
    setViewportNow(0)
  })

  afterEach(() => {
    _resetWaveformPrefetchForTest()
    _resetPreviewWorkBudgetForTest()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not re-render its host component on viewport updates', () => {
    const onRender = vi.fn()
    render(createElement(WaveformPrefetchProbe, { onRender }))

    expect(onRender).toHaveBeenCalledTimes(1)

    act(() => {
      setViewportNow(250)
    })

    act(() => {
      setViewportNow(500)
    })

    expect(onRender).toHaveBeenCalledTimes(1)
  })

  it('waits for active drag interactions before prefetching', async () => {
    stubSynchronousIdleCallback()

    const item = makeVideoItem('ahead', 400, 100)
    useItemsStore.getState().setItems([item])
    vi.spyOn(blobUrlManager, 'get').mockReturnValue('blob:prefetch')

    useSelectionStore.getState().setDragState({
      isDragging: true,
      draggedItemIds: [],
      offset: { x: 0, y: 0 },
    })

    render(createElement(WaveformPrefetchProbe, { onRender: () => {} }))

    // Well past the 90ms prefetch debounce: an active drag must suppress the work entirely,
    // not merely postpone it by a tick.
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(waveformCacheMocks.prefetch).not.toHaveBeenCalled()

    act(() => {
      useSelectionStore.getState().setDragState(null)
      setViewportNow(1)
    })

    await vi.waitFor(() => {
      expect(waveformCacheMocks.prefetch).toHaveBeenCalledWith(item.mediaId, 'blob:prefetch')
    })
  })

  it('prefetches storage-backed waveform cache even before a blob URL exists', async () => {
    stubSynchronousIdleCallback()

    const item = makeAudioItem('ahead', 400, 100)
    useItemsStore.getState().setItems([item])
    vi.spyOn(blobUrlManager, 'get').mockReturnValue(null)

    render(createElement(WaveformPrefetchProbe, { onRender: () => {} }))

    await vi.waitFor(() => {
      expect(waveformCacheMocks.prefetch).toHaveBeenCalledWith(item.mediaId, null)
    })
  })
})
