import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import { usePlaybackStore } from '@/shared/state/playback'
import { useGizmoStore } from '../stores/gizmo-store'
import { usePowerWindowEditorStore } from '../stores/power-window-editor-store'
import { PowerWindowOverlayContainer } from './power-window-overlay'

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
        id: 'window-1',
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-power-window',
          params: {
            shape: 'ellipse',
            centerX: 0.5,
            centerY: 0.5,
            sizeX: 0.5,
            sizeY: 0.5,
            rotation: 0,
          },
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

describe('PowerWindowOverlayContainer', () => {
  beforeEach(() => {
    mocks.selectionState.selectedItemIds = ['clip-1']
    mocks.timelineState.setItemEffects.mockClear()
    mocks.timelineState.applyAutoKeyframeOperations.mockClear()
    mocks.timelineState.keyframesByItemId = {}
    usePowerWindowEditorStore.getState().stopEditing()
    useGizmoStore.getState().clearPreview()
  })

  it('only shows the targeted window in edit mode and exits on Escape', () => {
    render(<PowerWindowOverlayContainer {...overlayProps} />)
    expect(screen.queryByTestId('power-window-overlay')).not.toBeInTheDocument()

    act(() => {
      usePowerWindowEditorStore.getState().startEditing('clip-1', 'window-1')
    })
    const overlay = screen.getByTestId('power-window-overlay')
    expect(overlay).toHaveStyle({ left: '0px', top: '0px', width: '960px', height: '540px' })
    expect(screen.getByRole('button', { name: 'Move power window' }).parentElement).toHaveStyle({
      left: '50%',
      top: '50%',
      width: '50%',
      height: '50%',
      borderRadius: '50%',
    })
    expect(screen.getByRole('button', { name: 'Rotate power window' })).toHaveAttribute(
      'title',
      'Rotate power window · Hold Shift to snap to 15°',
    )

    act(() => {
      const effect = mocks.timelineState.items[0]!.effects![0]!
      useGizmoStore.getState().setEffectsPreviewNew({
        'clip-1': [
          {
            ...effect,
            effect: {
              ...effect.effect,
              params: { ...effect.effect.params, centerX: 0.72 },
            },
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'Move power window' }).parentElement).toHaveStyle({
      left: '72%',
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('power-window-overlay')).not.toBeInTheDocument()
    expect(usePowerWindowEditorStore.getState().isEditing).toBe(false)
    expect(useGizmoStore.getState().preview).toBeNull()
  })

  it('shows the video window when timeline selection also contains linked audio', () => {
    mocks.selectionState.selectedItemIds = ['clip-1', 'linked-audio-1']
    render(<PowerWindowOverlayContainer {...overlayProps} />)

    act(() => {
      usePowerWindowEditorStore.getState().startEditing('clip-1', 'window-1')
    })

    expect(screen.getByTestId('power-window-overlay')).toBeInTheDocument()
    expect(usePowerWindowEditorStore.getState()).toMatchObject({
      isEditing: true,
      editingItemId: 'clip-1',
      editingEffectId: 'window-1',
    })
  })

  it('preserves the latest live correction settings when a gizmo drag begins', () => {
    render(<PowerWindowOverlayContainer {...overlayProps} />)
    act(() => usePowerWindowEditorStore.getState().startEditing('clip-1', 'window-1'))

    act(() => {
      const effect = mocks.timelineState.items[0]!.effects![0]!
      useGizmoStore.getState().setEffectsPreviewNew({
        'clip-1': [
          {
            ...effect,
            effect: {
              ...effect.effect,
              params: { ...effect.effect.params, exposure: 1.25, saturation: 1.4 },
            },
          },
        ],
      })
    })

    const handle = screen.getByRole('button', { name: 'Move power window' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 480, clientY: 270 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 320 })

    const committedEffects = mocks.timelineState.setItemEffects.mock.calls[0]?.[0]?.[0]?.effects
    expect(committedEffects?.[0]?.effect.params).toMatchObject({
      exposure: 1.25,
      saturation: 1.4,
    })
    expect(usePowerWindowEditorStore.getState().isEditing).toBe(true)
  })

  it('updates existing geometry keyframes without overwriting base geometry', () => {
    const property = buildEffectAnimatableProperty('gpu-power-window', 'window-1', 'centerX')
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
    render(<PowerWindowOverlayContainer {...overlayProps} />)
    act(() => usePowerWindowEditorStore.getState().startEditing('clip-1', 'window-1'))

    const handle = screen.getByRole('button', { name: 'Move power window' })
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
