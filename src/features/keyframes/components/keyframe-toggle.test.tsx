import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { CompositionItem, VideoItem } from '@/types/timeline'
import {
  useItemsStore,
  useKeyframesStore,
  useTransitionsStore,
} from '@/features/keyframes/deps/timeline'
import { KeyframeToggle } from './keyframe-toggle'

const mocks = vi.hoisted(() => ({
  addKeyframes: vi.fn(),
  removeKeyframes: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/keyframes/deps/preview-contract', () => ({
  useThrottledFrame: () => 10,
}))

vi.mock('@/features/keyframes/deps/timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/keyframes/deps/timeline')>()
  return {
    ...actual,
    addKeyframes: mocks.addKeyframes,
    removeKeyframes: mocks.removeKeyframes,
  }
})

const VIDEO_ITEM: VideoItem = {
  id: 'video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'video.mp4',
  src: 'blob:video',
  mediaId: 'media-1',
}

const COMPOSITION_ITEM: CompositionItem = {
  id: 'composition-1',
  type: 'composition',
  trackId: 'track-2',
  from: 5,
  durationInFrames: 90,
  label: 'Compound clip',
  compositionId: 'nested-1',
  compositionWidth: 3840,
  compositionHeight: 2160,
}

function renderToggle() {
  render(
    <TooltipProvider>
      <KeyframeToggle
        itemIds={[VIDEO_ITEM.id, COMPOSITION_ITEM.id]}
        property="cropLeft"
        currentValue={0}
        currentValuesByItemId={{
          [VIDEO_ITEM.id]: 480,
          [COMPOSITION_ITEM.id]: 960,
        }}
      />
    </TooltipProvider>,
  )
}

describe('KeyframeToggle multi-selection', () => {
  beforeEach(() => {
    mocks.addKeyframes.mockReset()
    mocks.removeKeyframes.mockReset()
    useItemsStore.getState().setItems([VIDEO_ITEM, COMPOSITION_ITEM])
    useKeyframesStore.setState({ keyframesByItemId: {} })
    useTransitionsStore.setState({ transitions: [] })
  })

  it('adds one keyframe per selected item using its relative frame and current value', () => {
    renderToggle()

    fireEvent.click(screen.getByRole('button'))

    expect(mocks.addKeyframes).toHaveBeenCalledWith([
      { itemId: VIDEO_ITEM.id, property: 'cropLeft', frame: 10, value: 480 },
      { itemId: COMPOSITION_ITEM.id, property: 'cropLeft', frame: 5, value: 960 },
    ])
    expect(mocks.removeKeyframes).not.toHaveBeenCalled()
  })

  it('resolves a lazily supplied current value only when adding a keyframe', () => {
    const getCurrentValue = vi.fn(() => 123)
    render(
      <TooltipProvider>
        <KeyframeToggle
          itemIds={[VIDEO_ITEM.id]}
          property="x"
          currentValue={0}
          getCurrentValue={getCurrentValue}
        />
      </TooltipProvider>,
    )

    expect(getCurrentValue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button'))

    expect(getCurrentValue).toHaveBeenCalledOnce()
    expect(mocks.addKeyframes).toHaveBeenCalledWith([
      { itemId: VIDEO_ITEM.id, property: 'x', frame: 10, value: 123 },
    ])
  })

  it('removes the current keyframe from every selected item as one batch', () => {
    const getCurrentValue = vi.fn(() => 999)
    useKeyframesStore.setState({
      keyframesByItemId: {
        [VIDEO_ITEM.id]: {
          itemId: VIDEO_ITEM.id,
          properties: [
            {
              property: 'cropLeft',
              keyframes: [{ id: 'video-key', frame: 10, value: 480, easing: 'linear' }],
            },
          ],
        },
        [COMPOSITION_ITEM.id]: {
          itemId: COMPOSITION_ITEM.id,
          properties: [
            {
              property: 'cropLeft',
              keyframes: [{ id: 'composition-key', frame: 5, value: 960, easing: 'linear' }],
            },
          ],
        },
      },
    })
    render(
      <TooltipProvider>
        <KeyframeToggle
          itemIds={[VIDEO_ITEM.id, COMPOSITION_ITEM.id]}
          property="cropLeft"
          currentValue={0}
          getCurrentValue={getCurrentValue}
        />
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(getCurrentValue).not.toHaveBeenCalled()
    expect(mocks.removeKeyframes).toHaveBeenCalledWith([
      { itemId: VIDEO_ITEM.id, property: 'cropLeft', keyframeId: 'video-key' },
      { itemId: COMPOSITION_ITEM.id, property: 'cropLeft', keyframeId: 'composition-key' },
    ])
    expect(mocks.addKeyframes).not.toHaveBeenCalled()
  })
})
