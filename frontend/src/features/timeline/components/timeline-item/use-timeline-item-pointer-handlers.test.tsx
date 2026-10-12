import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionItem, TextItem, VideoItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import * as timelineActions from '../../stores/timeline-actions'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import {
  useTimelineItemPointerHandlers,
  type TimelineItemPointerHandlersInput,
} from './use-timeline-item-pointer-handlers'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 20,
    durationInFrames: 30,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 30,
    ...overrides,
  }
}

function makeTextItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'text-1',
    type: 'text',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Title',
    text: 'Title',
    ...overrides,
  } as TextItem
}

function makeCompositionItem(overrides: Partial<CompositionItem> = {}): CompositionItem {
  return {
    id: 'comp-1',
    type: 'composition',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Comp',
    compositionId: 'sub-comp-1',
    ...overrides,
  } as CompositionItem
}

function makeMouseEvent(overrides: Partial<Record<string, unknown>> = {}): React.MouseEvent {
  return {
    stopPropagation: vi.fn(),
    clientX: 100,
    clientY: 50,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    button: 0,
    currentTarget: {
      closest: () => null,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 40,
        width: 200,
        height: 40,
      }),
    },
    ...overrides,
  } as unknown as React.MouseEvent
}

function makeInput(
  overrides: Partial<TimelineItemPointerHandlersInput> = {},
): TimelineItemPointerHandlersInput {
  const item = overrides.item ?? makeVideoItem()
  const activeTool = overrides.activeTool ?? 'select'
  return {
    item,
    trackLocked: false,
    activeTool,
    activeToolRef: { current: activeTool },
    smartTrimIntentRef: { current: null },
    smartBodyIntent: null,
    dragWasActiveRef: { current: false },
    isTrimming: false,
    isStretching: false,
    isSlipSlideActive: false,
    hoveredEdge: null,
    handleDragStart: vi.fn(),
    handleSlipSlideStart: vi.fn(),
    handleStretchStart: vi.fn(),
    handleTrimStart: vi.fn(),
    setPointerHint: vi.fn(),
    ...overrides,
  }
}

function renderHandlers(input: TimelineItemPointerHandlersInput) {
  return renderHook(() => useTimelineItemPointerHandlers(input)).result.current
}

describe('useTimelineItemPointerHandlers', () => {
  beforeEach(() => {
    // Reset spy call history up front: re-spying an already-spied store method
    // returns the accumulated mock, so clear before each test to avoid leakage.
    vi.clearAllMocks()
    // Deterministic single-item selection (linked selection expands target ids)
    useEditorStore.getState().setLinkedSelectionEnabled(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('handleClick', () => {
    it('does nothing on a locked track', () => {
      const selectItems = vi.spyOn(useSelectionStore.getState(), 'selectItems')
      const handlers = renderHandlers(makeInput({ trackLocked: true }))
      const e = makeMouseEvent()

      handlers.handleClick(e)

      expect(e.stopPropagation).toHaveBeenCalled()
      expect(selectItems).not.toHaveBeenCalled()
    })

    it('selects the clicked item with the select tool', () => {
      const selectItems = vi.spyOn(useSelectionStore.getState(), 'selectItems')
      const handlers = renderHandlers(makeInput({ activeTool: 'select' }))

      handlers.handleClick(makeMouseEvent())

      expect(selectItems).toHaveBeenCalledWith(['item-1'])
    })

    it('splits the item at the cursor with the razor tool', () => {
      const splitItem = vi.spyOn(timelineActions, 'splitItem')
      const handlers = renderHandlers(makeInput({ activeTool: 'razor' }))

      handlers.handleClick(makeMouseEvent())

      expect(splitItem).toHaveBeenCalledTimes(1)
      expect(splitItem.mock.calls[0]?.[0]).toBe('item-1')
    })
  })

  describe('handleDoubleClick', () => {
    it('enters the sub-composition for a composition item', () => {
      const enterComposition = vi.spyOn(
        useCompositionNavigationStore.getState(),
        'enterComposition',
      )
      const handlers = renderHandlers(makeInput({ item: makeCompositionItem() }))

      handlers.handleDoubleClick(makeMouseEvent())

      expect(enterComposition).toHaveBeenCalledWith('sub-comp-1', 'Comp', 'comp-1')
    })

    it('opens the source monitor for a media item', () => {
      const setCurrentMediaId = vi.spyOn(useSourcePlayerStore.getState(), 'setCurrentMediaId')
      const setSourcePreviewMediaId = vi.spyOn(useEditorStore.getState(), 'setSourcePreviewMediaId')
      const handlers = renderHandlers(makeInput({ item: makeVideoItem() }))

      handlers.handleDoubleClick(makeMouseEvent())

      expect(setCurrentMediaId).toHaveBeenCalledWith('media-1')
      expect(setSourcePreviewMediaId).toHaveBeenCalledWith('media-1')
    })

    it('does nothing on a locked track', () => {
      const setCurrentMediaId = vi.spyOn(useSourcePlayerStore.getState(), 'setCurrentMediaId')
      const handlers = renderHandlers(makeInput({ trackLocked: true }))

      handlers.handleDoubleClick(makeMouseEvent())

      expect(setCurrentMediaId).not.toHaveBeenCalled()
    })
  })

  describe('handleMouseDown', () => {
    it('starts a drag with the select tool when no edge is hovered', () => {
      const input = makeInput({ activeTool: 'select' })
      const handlers = renderHandlers(input)

      handlers.handleMouseDown(makeMouseEvent())

      expect(input.handleDragStart).toHaveBeenCalledTimes(1)
    })

    it('warns instead of stretching a non-stretchable item', () => {
      const input = makeInput({ item: makeTextItem(), activeTool: 'rate-stretch' })
      const handlers = renderHandlers(input)

      handlers.handleMouseDown(makeMouseEvent())

      expect(input.setPointerHint).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'warning' }),
      )
      expect(input.handleStretchStart).not.toHaveBeenCalled()
    })

    it('starts a rate stretch for a stretchable item', () => {
      const input = makeInput({ item: makeVideoItem(), activeTool: 'rate-stretch' })
      const handlers = renderHandlers(input)

      handlers.handleMouseDown(makeMouseEvent())

      expect(input.handleStretchStart).toHaveBeenCalledTimes(1)
      expect(input.setPointerHint).not.toHaveBeenCalled()
    })

    it('starts slip/slide for a media item with the slip tool', () => {
      const input = makeInput({ item: makeVideoItem(), activeTool: 'slip' })
      const handlers = renderHandlers(input)

      handlers.handleMouseDown(makeMouseEvent())

      expect(input.handleSlipSlideStart).toHaveBeenCalledTimes(1)
      expect(input.handleDragStart).not.toHaveBeenCalled()
    })

    it('warns instead of slipping a non-media item', () => {
      const input = makeInput({ item: makeTextItem(), activeTool: 'slip' })
      const handlers = renderHandlers(input)

      handlers.handleMouseDown(makeMouseEvent())

      expect(input.setPointerHint).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'warning' }),
      )
      expect(input.handleSlipSlideStart).not.toHaveBeenCalled()
    })
  })
})
