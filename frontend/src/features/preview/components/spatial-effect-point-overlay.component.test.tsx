import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import { usePlaybackStore } from '@/shared/state/playback'
import { useGizmoStore } from '../stores/gizmo-store'
import { useSpatialEffectEditorStore } from '../stores/spatial-effect-editor-store'
import { SpatialEffectPointOverlayContainer } from './spatial-effect-point-overlay'

const mocks = vi.hoisted(() => {
  const item: TimelineItem = {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 120,
    label: 'clip.mp4',
    src: 'blob:clip-1',
    mediaId: 'media-1',
    effects: [
      {
        id: 'twirl-1',
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-twirl',
          params: { amount: 0.5, radius: 0.5, centerX: 0.5, centerY: 0.5 },
        },
      },
    ],
  }
  return {
    selectionState: { selectedItemIds: ['clip-1'] },
    timelineState: {
      items: [item],
      keyframesByItemId: {} as Record<string, ItemKeyframes | undefined>,
      setItemEffects: vi.fn(),
      applyAutoKeyframeOperations: vi.fn(),
    },
  }
})

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: (selector: (state: typeof mocks.selectionState) => unknown) =>
    selector(mocks.selectionState),
}))

vi.mock('../deps/timeline-store', () => ({
  applyAutoKeyframeOperations: mocks.timelineState.applyAutoKeyframeOperations,
  setItemEffects: mocks.timelineState.setItemEffects,
  useItemsStore: (selector: (state: typeof mocks.timelineState) => unknown) =>
    selector(mocks.timelineState),
  useKeyframesStore: (selector: (state: typeof mocks.timelineState) => unknown) =>
    selector(mocks.timelineState),
}))

const overlayProps = {
  containerRect: new DOMRect(0, 0, 960, 540),
  playerSize: { width: 960, height: 540 },
  projectSize: { width: 1920, height: 1080 },
  zoom: 1,
}

describe('SpatialEffectPointOverlayContainer', () => {
  beforeEach(() => {
    mocks.selectionState.selectedItemIds = ['clip-1']
    mocks.timelineState.setItemEffects.mockClear()
    mocks.timelineState.applyAutoKeyframeOperations.mockClear()
    mocks.timelineState.keyframesByItemId = {}
    useSpatialEffectEditorStore.getState().stopEditing()
    useGizmoStore.getState().clearPreview()
  })

  it('follows live parameter previews and exits cleanly on Escape', () => {
    render(<SpatialEffectPointOverlayContainer {...overlayProps} />)

    act(() => useSpatialEffectEditorStore.getState().startEditing('clip-1', 'twirl-1'))
    const handle = screen.getByRole('button', { name: 'Move effect center' })
    expect(handle).toHaveStyle({ left: '50%', top: '50%' })

    act(() => {
      const effect = mocks.timelineState.items[0]!.effects![0]!
      useGizmoStore.getState().setEffectsPreviewNew({
        'clip-1': [
          {
            ...effect,
            effect: {
              ...effect.effect,
              params: { ...effect.effect.params, centerX: 0.25, centerY: 0.75 },
            },
          },
        ],
      })
    })
    expect(handle).toHaveStyle({ left: '25%', top: '75%' })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('spatial-effect-point-overlay')).not.toBeInTheDocument()
    expect(useSpatialEffectEditorStore.getState().isEditing).toBe(false)
    expect(useGizmoStore.getState().preview).toBeNull()
  })

  it('keeps the video point active when canvas selection changes', () => {
    mocks.selectionState.selectedItemIds = ['another-clip']
    render(<SpatialEffectPointOverlayContainer {...overlayProps} />)

    act(() => useSpatialEffectEditorStore.getState().startEditing('clip-1', 'twirl-1'))

    expect(screen.getByTestId('spatial-effect-point-overlay')).toBeInTheDocument()
    expect(useSpatialEffectEditorStore.getState().isEditing).toBe(true)
  })

  it('keeps edit mode active and contains the click produced on release', () => {
    const handleCanvasClick = vi.fn()
    render(
      <div onClick={handleCanvasClick}>
        <SpatialEffectPointOverlayContainer {...overlayProps} />
      </div>,
    )
    act(() => useSpatialEffectEditorStore.getState().startEditing('clip-1', 'twirl-1'))

    const handle = screen.getByRole('button', { name: 'Move effect center' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 480, clientY: 270 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 320 })
    fireEvent.click(handle)

    expect(useSpatialEffectEditorStore.getState().isEditing).toBe(true)
    expect(screen.getByTestId('spatial-effect-point-overlay')).toBeInTheDocument()
    expect(handleCanvasClick).not.toHaveBeenCalled()
  })

  it('preserves the latest live effect settings when a point drag begins', () => {
    render(<SpatialEffectPointOverlayContainer {...overlayProps} />)
    act(() => useSpatialEffectEditorStore.getState().startEditing('clip-1', 'twirl-1'))

    act(() => {
      const effect = mocks.timelineState.items[0]!.effects![0]!
      useGizmoStore.getState().setEffectsPreviewNew({
        'clip-1': [
          {
            ...effect,
            effect: {
              ...effect.effect,
              params: { ...effect.effect.params, amount: 4.2, radius: 0.8 },
            },
          },
        ],
      })
    })

    const handle = screen.getByRole('button', { name: 'Move effect center' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 480, clientY: 270 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 320 })

    const committedEffects = mocks.timelineState.setItemEffects.mock.calls[0]?.[0]?.[0]?.effects
    expect(committedEffects?.[0]?.effect.params).toMatchObject({ amount: 4.2, radius: 0.8 })
    expect(useSpatialEffectEditorStore.getState().isEditing).toBe(true)
  })

  it('updates an existing point keyframe without overwriting its base value', () => {
    const property = buildEffectAnimatableProperty('gpu-twirl', 'twirl-1', 'centerX')
    mocks.timelineState.keyframesByItemId = {
      'clip-1': {
        itemId: 'clip-1',
        properties: [
          {
            property,
            keyframes: [{ id: 'center-x-key', frame: 15, value: 0.5, easing: 'linear' }],
          },
        ],
      },
    }
    usePlaybackStore.setState({ currentFrame: 15 })
    render(<SpatialEffectPointOverlayContainer {...overlayProps} />)
    act(() => useSpatialEffectEditorStore.getState().startEditing('clip-1', 'twirl-1'))

    const handle = screen.getByRole('button', { name: 'Move effect center' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 480, clientY: 270 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 320 })

    expect(mocks.timelineState.applyAutoKeyframeOperations).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'update',
        property,
        keyframeId: 'center-x-key',
      }),
    ])
    const committedEffects = mocks.timelineState.setItemEffects.mock.calls[0]?.[0]?.[0]?.effects
    expect(committedEffects?.[0]?.effect.params.centerX).toBe(0.5)
    expect(committedEffects?.[0]?.effect.params.centerY).not.toBe(0.5)
  })
})
