import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { CompositionItem } from '@/types/timeline'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useZoomStore } from '../../stores/zoom-store'
import { useTimelineItemBounds } from './use-timeline-item-bounds'

function makeCompositionItem(overrides: Partial<CompositionItem> = {}): CompositionItem {
  return {
    id: 'middle',
    type: 'composition',
    trackId: 'video-track',
    from: 50,
    durationInFrames: 50,
    label: 'Nested compound',
    compositionId: 'nested-composition',
    compositionWidth: 1920,
    compositionHeight: 1080,
    originId: 'split-origin',
    sourceStart: 200,
    sourceEnd: 400,
    sourceDuration: 1000,
    sourceFps: 60,
    speed: 2,
    ...overrides,
  }
}

function renderBounds(
  previewBaseItem: CompositionItem,
  overrides: Partial<Parameters<typeof useTimelineItemBounds>[0]> = {},
) {
  return renderHook(() =>
    useTimelineItemBounds({
      previewBaseItem,
      fps: 30,
      isTrimming: false,
      trimHandle: null,
      trimDelta: 0,
      isStretching: false,
      stretchFeedback: null,
      isSlipSlideActive: true,
      slipEditDelta: 0,
      slideEditOffset: 0,
      slideNeighborSide: null,
      slideNeighborDelta: 0,
      slideLeftNeighborForSlidItem: null,
      slideRightNeighborForSlidItem: null,
      rollingEditDelta: 0,
      rollingEditHandle: null,
      rippleEditOffset: 0,
      rippleEdgeDelta: 0,
      trackPushOffset: 0,
      ...overrides,
    }),
  )
}

describe('useTimelineItemBounds source-window previews', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 })
    useZoomStore.setState({ pixelsPerSecond: 30 })
  })

  it('applies slip source deltas to composition wrappers', () => {
    const item = makeCompositionItem()
    const { result } = renderBounds(item, { slipEditDelta: 12 })

    expect(result.current.contentPreviewItem).toMatchObject({
      sourceStart: 212,
      sourceEnd: 412,
    })
    expect(item).toMatchObject({ sourceStart: 200, sourceEnd: 400 })
  })

  it('applies source-native slide continuity deltas to composition wrappers', () => {
    const left = makeCompositionItem({
      id: 'left',
      from: 0,
      sourceStart: 0,
      sourceEnd: 200,
    })
    const middle = makeCompositionItem()
    const right = makeCompositionItem({
      id: 'right',
      from: 100,
      sourceStart: 400,
      sourceEnd: 600,
    })
    const { result } = renderBounds(middle, {
      slideEditOffset: 10,
      slideLeftNeighborForSlidItem: left,
      slideRightNeighborForSlidItem: right,
    })

    expect(result.current.contentPreviewItem).toMatchObject({
      sourceStart: 240,
      sourceEnd: 440,
    })
    expect(middle).toMatchObject({ sourceStart: 200, sourceEnd: 400 })
  })
})
