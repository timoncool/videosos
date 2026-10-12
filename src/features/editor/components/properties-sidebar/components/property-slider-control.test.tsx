import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PropertySliderControl } from './property-slider-control'

vi.mock('@/features/editor/deps/keyframes', () => ({
  KeyframeToggle: ({ property }: { property: string }) => (
    <button type="button" data-testid="keyframe-toggle" data-property={property} />
  ),
}))

describe('PropertySliderControl', () => {
  it('composes the shared slider, keyframe action, and reset action', () => {
    const onReset = vi.fn()
    render(
      <PropertySliderControl
        value={25}
        onChange={vi.fn()}
        min={0}
        max={100}
        unit="%"
        keyframe={{ itemIds: ['shape'], property: 'trimPathStart', currentValue: 25 }}
        onReset={onReset}
        resetLabel="Reset to default"
      />,
    )

    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByTestId('keyframe-toggle')).toHaveAttribute('data-property', 'trimPathStart')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('omits optional actions when a property does not support them', () => {
    render(<PropertySliderControl value={4} onChange={vi.fn()} min={0} max={50} unit="px" />)

    expect(screen.queryByTestId('keyframe-toggle')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
