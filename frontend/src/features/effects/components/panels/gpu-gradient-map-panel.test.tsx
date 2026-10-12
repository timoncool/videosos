import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuGradientMapPanel } from './gpu-gradient-map-panel'

const definition = getGpuEffect('gpu-gradient-map')!

function makeProps() {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: definition.id,
    params: {
      ...getGpuEffectDefaultParams(definition.id),
      preset: 'custom',
      customStops: '#111111, #eeeeee',
      mix: 0.4,
    },
  }
  const effect: ItemEffect = { id: 'gradient-1', effect: gpuEffect, enabled: true }
  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuGradientMapPanel parameter resets', () => {
  it('restores palette, custom stops, and mix independently', () => {
    const props = makeProps()
    render(<GpuGradientMapPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: palette/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: custom stops/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: mix/i }))

    expect(props.onParamChange).toHaveBeenCalledWith(
      'gradient-1',
      'preset',
      definition.params.preset?.default,
    )
    expect(props.onParamChange).toHaveBeenCalledWith(
      'gradient-1',
      'customStops',
      definition.params.customStops?.default,
    )
    expect(props.onParamChange).toHaveBeenCalledWith(
      'gradient-1',
      'mix',
      definition.params.mix?.default,
    )
  })
})
