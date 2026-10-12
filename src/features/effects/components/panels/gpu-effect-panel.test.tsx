import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import type { AnimatableProperty } from '@/types/keyframe'
import { GpuEffectPanel } from './gpu-effect-panel'
import {
  usePowerWindowEditorStore,
  useSpatialEffectEditorStore,
} from '@/features/effects/deps/preview-contract'

vi.mock('@/features/effects/deps/keyframes-contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/effects/deps/keyframes-contract')>()),
  KeyframeToggle: ({ property }: { property: string }) => (
    <button type="button" aria-label={`Keyframe ${property}`} />
  ),
}))

const definition = getGpuEffect('gpu-fluted-glass')!

function makeProps() {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: definition.id,
    params: {
      ...getGpuEffectDefaultParams(definition.id),
      shadows: 0.49,
    },
  }
  const effect: ItemEffect = { id: 'fluted-1', effect: gpuEffect, enabled: true }

  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn<(effectId: string, paramKey: string) => AnimatableProperty | null>(
      () => null,
    ),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuEffectPanel parameter resets', () => {
  beforeEach(() => {
    usePowerWindowEditorStore.getState().stopEditing()
    useSpatialEffectEditorStore.getState().stopEditing()
  })
  it('keeps a reset control beside each visible parameter and restores its default', () => {
    const props = makeProps()
    render(<GpuEffectPanel {...props} />)

    expect(screen.getByRole('button', { name: /reset to defaults: back color/i })).toBeDisabled()
    expect(screen.getByDisplayValue('00000000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset to defaults: shape/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: shadows/i }))

    expect(props.onParamChange).toHaveBeenCalledWith(
      'fluted-1',
      'shadows',
      definition.params.shadows?.default,
    )
  })

  it('renders a distinct collapsible effect header without hiding its actions', () => {
    const props = makeProps()
    render(<GpuEffectPanel {...props} />)

    const disclosure = screen.getByRole('button', { name: /^Fluted Glass/ })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(disclosure.parentElement).toHaveClass('bg-muted/35')

    fireEvent.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Modified from defaults')).toBeInTheDocument()
    expect(screen.queryByText('Back Color')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset to defaults$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove effect/i })).toBeInTheDocument()
  })

  it('shows keyframe controls for registered color parameters', () => {
    const props = makeProps()
    props.getKeyframeProperty.mockImplementation(
      (effectId: string, paramKey: string) =>
        `effect:gpu-fluted-glass:${effectId}:${paramKey}` as const,
    )
    render(<GpuEffectPanel {...props} />)

    expect(
      screen.getByRole('button', {
        name: 'Keyframe effect:gpu-fluted-glass:fluted-1:colorBack',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Keyframe effect:gpu-fluted-glass:fluted-1:colorShadow',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Keyframe effect:gpu-fluted-glass:fluted-1:colorHighlight',
      }),
    ).toBeInTheDocument()
  })

  it('opens the shared point editor for supported spatial effects', () => {
    const twirlDefinition = getGpuEffect('gpu-twirl')!
    const gpuEffect: GpuEffect = {
      type: 'gpu-effect',
      gpuEffectType: twirlDefinition.id,
      params: getGpuEffectDefaultParams(twirlDefinition.id),
    }
    const effect: ItemEffect = { id: 'twirl-1', effect: gpuEffect, enabled: true }
    usePowerWindowEditorStore.getState().startEditing('clip-1', 'power-1')

    render(
      <GpuEffectPanel
        {...makeProps()}
        effect={effect}
        gpuEffect={gpuEffect}
        definition={twirlDefinition}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /edit on canvas/i }))

    expect(usePowerWindowEditorStore.getState().isEditing).toBe(false)
    expect(useSpatialEffectEditorStore.getState()).toMatchObject({
      isEditing: true,
      editingItemId: 'clip-1',
      editingEffectId: 'twirl-1',
    })
    expect(screen.getByRole('button', { name: /editing on canvas/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
