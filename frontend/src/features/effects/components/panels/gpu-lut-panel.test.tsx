import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuLutPanel } from './gpu-lut-panel'

const definition = getGpuEffect('gpu-lut')!

function makeProps() {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: definition.id,
    params: {
      ...getGpuEffectDefaultParams(definition.id),
      intensity: 0.4,
      lutName: 'Film Look',
      lutSize: '2',
      lutData: 'encoded-data',
    },
  }
  const effect: ItemEffect = { id: 'lut-1', effect: gpuEffect, enabled: true }
  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onParamsBatchChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuLutPanel parameter resets', () => {
  it('resets intensity independently and clears imported LUT data atomically', () => {
    const props = makeProps()
    render(<GpuLutPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: intensity/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: lut$/i }))

    expect(props.onParamChange).toHaveBeenCalledWith(
      'lut-1',
      'intensity',
      definition.params.intensity?.default,
    )
    expect(props.onParamsBatchChange).toHaveBeenCalledWith('lut-1', {
      lutName: definition.params.lutName?.default,
      lutSize: definition.params.lutSize?.default,
      lutData: definition.params.lutData?.default,
    })
  })
})
