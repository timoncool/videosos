import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuSecondaryQualifierPanel } from './gpu-secondary-qualifier-panel'

const definition = getGpuEffect('gpu-secondary-qualifier')!

function makeProps(params: Record<string, number | boolean | string> = {}) {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-secondary-qualifier',
    params,
  }
  const effect: ItemEffect = { id: 'fx-secondary', effect: gpuEffect, enabled: true }
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

describe('GpuSecondaryQualifierPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the qualifier as key, matte, and correction sections', () => {
    render(<GpuSecondaryQualifierPanel {...makeProps()} />)

    expect(screen.getByText('Secondary Qualifier')).toBeInTheDocument()
    expect(screen.getByText('Key')).toBeInTheDocument()
    expect(screen.getByText('Matte')).toBeInTheDocument()
    expect(screen.getByText('Correction')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Hue range selector' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
  })

  it('nudges the hue center from the hue range selector', () => {
    const props = makeProps({ hueCenter: 42 })
    render(<GpuSecondaryQualifierPanel {...props} />)

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue range selector' }), {
      key: 'ArrowRight',
    })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-secondary', 'hueCenter', 43)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'hueCenter', 43)
  })

  it('updates the hue marker immediately while coalescing GPU previews to one per frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const props = makeProps({ hueCenter: 0 })
    render(<GpuSecondaryQualifierPanel {...props} />)

    const selector = screen.getByRole('slider', { name: 'Hue range selector' })
    Object.defineProperty(selector, 'setPointerCapture', { value: vi.fn() })
    vi.spyOn(selector, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 360, 32))

    fireEvent.pointerDown(selector, { pointerId: 1, clientX: 90 })
    fireEvent.pointerMove(selector, { pointerId: 1, clientX: 180 })
    fireEvent.pointerMove(selector, { pointerId: 1, clientX: 270 })

    expect(selector).toHaveAttribute('aria-valuenow', '270')
    expect(props.onParamLiveChange).not.toHaveBeenCalled()
    expect(frameCallbacks).toHaveLength(1)

    frameCallbacks[0]?.(16)
    expect(props.onParamLiveChange).toHaveBeenCalledTimes(1)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-secondary', 'hueCenter', 270)

    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 270 })
    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'hueCenter', 270)
  })

  it('toggles matte preview and inverted matte params', () => {
    const props = makeProps({ showMask: false, invertMask: false })
    render(<GpuSecondaryQualifierPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show Mask' }))
    fireEvent.click(screen.getByRole('button', { name: 'Invert Mask' }))

    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'showMask', true)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'invertMask', true)
  })

  it('resets numeric and matte parameters to their declared defaults', () => {
    const props = makeProps({ hueWidth: 80, invertMask: true })
    render(<GpuSecondaryQualifierPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: hue width/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: invert mask/i }))

    expect(props.onParamChange).toHaveBeenCalledWith(
      'fx-secondary',
      'hueWidth',
      definition.params.hueWidth?.default,
    )
    expect(props.onParamChange).toHaveBeenCalledWith(
      'fx-secondary',
      'invertMask',
      definition.params.invertMask?.default,
    )
  })
})
