import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { CompoundPropertyInputs } from './compound-property-inputs'

describe('CompoundPropertyInputs', () => {
  it('updates only the two axis subscribers from a live value source', () => {
    const listeners = new Set<() => void>()
    let liveValue: { x: number; y: number } | null = null
    const source = {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => liveValue,
    }
    const parentRender = vi.fn()

    function Harness() {
      parentRender()
      return (
        <CompoundPropertyInputs
          config={{
            label: 'Position',
            value: { x: 10, y: 20 },
            liveValueSource: source,
            unit: 'px',
            onCommit: vi.fn(),
          }}
        />
      )
    }

    render(<Harness />)
    expect(screen.getByLabelText('Position X')).toHaveValue('10.00')
    expect(screen.getByLabelText('Position Y')).toHaveValue('20.00')

    act(() => {
      liveValue = { x: 45, y: 60 }
      for (const listener of listeners) listener()
    })

    expect(screen.getByLabelText('Position X')).toHaveValue('45.00')
    expect(screen.getByLabelText('Position Y')).toHaveValue('60.00')
    expect(parentRender).toHaveBeenCalledOnce()

    act(() => {
      liveValue = null
      for (const listener of listeners) listener()
    })
    expect(screen.getByLabelText('Position X')).toHaveValue('10.00')
    expect(screen.getByLabelText('Position Y')).toHaveValue('20.00')
    expect(parentRender).toHaveBeenCalledOnce()
  })

  it('commits changed axes on blur without authoring a new keyframe', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit,
        }}
      />,
    )

    const y = screen.getByLabelText('Position Y')
    fireEvent.change(y, { target: { value: '42' } })
    fireEvent.blur(y)

    expect(onCommit).toHaveBeenCalledWith('y', 42, { allowCreate: false })
  })

  it('only allows explicit Enter to create a keyframe', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Scale',
          value: { x: 100, y: 100 },
          unit: '%',
          onCommit,
        }}
      />,
    )

    const x = screen.getByLabelText('Scale X')
    fireEvent.change(x, { target: { value: '125' } })
    fireEvent.keyDown(x, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('x', 125, { allowCreate: true })
  })

  it('allows blur creation only when auto-key is enabled', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          allowCreateOnBlur: true,
          onCommit,
        }}
      />,
    )

    const y = screen.getByLabelText('Position Y')
    fireEvent.change(y, { target: { value: '24' } })
    fireEvent.blur(y)

    expect(onCommit).toHaveBeenCalledWith('y', 24, { allowCreate: true })
  })

  it('gives both axes additional width on spacious Motion surfaces', () => {
    render(
      <CompoundPropertyInputs
        spacious
        config={{
          label: 'Anchor',
          value: { x: 960, y: 540 },
          unit: 'px',
          onCommit: vi.fn(),
        }}
      />,
    )

    const inputGroup = screen.getByTestId('compound-property-inputs')
    const axisLinkSpacer = screen.getByTestId('compound-property-axis-link-spacer')

    expect(inputGroup).toHaveClass('w-[192px]')
    expect(inputGroup.firstElementChild).toBe(axisLinkSpacer)
    expect(axisLinkSpacer).toHaveClass('w-5')
    expect(screen.getByLabelText('Anchor X')).toHaveValue('960.00')
    expect(screen.getByLabelText('Anchor Y')).toHaveValue('540.00')
  })

  it('can hide visible axis glyphs without removing accessible axis names', () => {
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          showAxisLabels: false,
          onCommit: vi.fn(),
        }}
      />,
    )

    expect(screen.queryByText('X')).not.toBeInTheDocument()
    expect(screen.queryByText('Y')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Position X')).toHaveValue('10.00')
    expect(screen.getByLabelText('Position Y')).toHaveValue('20.00')
  })

  it('exposes an explicit axes link without stealing either numeric input', () => {
    const onChange = vi.fn()
    render(
      <CompoundPropertyInputs
        spacious
        config={{
          label: 'Scale',
          value: { x: 100, y: 100 },
          unit: '%',
          axisLink: { linked: true, onChange },
          onCommit: vi.fn(),
        }}
      />,
    )

    const inputGroup = screen.getByTestId('compound-property-inputs')
    const axisLink = screen.getByRole('button', { name: 'Unlink Scale axes' })

    expect(inputGroup.firstElementChild).toBe(axisLink)
    fireEvent.click(axisLink)
    expect(onChange).toHaveBeenCalledWith(false)
    expect(screen.getByLabelText('Scale X')).toBeInTheDocument()
    expect(screen.getByLabelText('Scale Y')).toBeInTheDocument()
  })

  it('scrubs either axis horizontally with live preview and one drag boundary', () => {
    const onCommit = vi.fn()
    const onScrubStart = vi.fn()
    const onScrubPreview = vi.fn()
    const onScrubEnd = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit,
          onScrubStart,
          onScrubPreview,
          onScrubEnd,
          scrubStep: 1,
          decimals: 0,
        }}
      />,
    )

    const x = screen.getByLabelText('Position X')
    fireEvent.pointerDown(x, { button: 0, pointerId: 7, clientX: 100 })
    fireEvent.pointerMove(x, { pointerId: 7, clientX: 120 })
    fireEvent.pointerUp(x, { pointerId: 7, clientX: 120 })

    expect(onScrubStart).toHaveBeenCalledOnce()
    expect(onScrubStart).toHaveBeenCalledWith('x')
    expect(onScrubPreview).toHaveBeenLastCalledWith('x', 30)
    expect(onScrubEnd).toHaveBeenCalledWith('x', 30)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the final scrub value when preview has no matching end handler', () => {
    const onCommit = vi.fn()
    const onScrubPreview = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit,
          onScrubPreview,
          scrubStep: 1,
          decimals: 0,
        }}
      />,
    )

    const x = screen.getByLabelText('Position X')
    fireEvent.pointerDown(x, { button: 0, pointerId: 11, clientX: 100 })
    fireEvent.pointerMove(x, { pointerId: 11, clientX: 120 })
    fireEvent.pointerUp(x, { pointerId: 11, clientX: 120 })

    expect(onScrubPreview).toHaveBeenLastCalledWith('x', 30)
    expect(onCommit).toHaveBeenCalledWith('x', 30, { allowCreate: true })
  })

  it('cancels a scrub without committing its preview or undo boundary', () => {
    const onScrubPreview = vi.fn()
    const onScrubEnd = vi.fn()
    const onScrubCancel = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          scrubStep: 1,
          decimals: 0,
          onCommit: vi.fn(),
          onScrubStart: vi.fn(),
          onScrubPreview,
          onScrubEnd,
          onScrubCancel,
        }}
      />,
    )

    const x = screen.getByLabelText('Position X')
    fireEvent.pointerDown(x, { button: 0, pointerId: 9, clientX: 100 })
    fireEvent.pointerMove(x, { pointerId: 9, clientX: 120 })
    expect(x).toHaveValue('30')

    fireEvent.pointerCancel(x, { pointerId: 9 })

    expect(x).toHaveValue('10')
    expect(onScrubPreview).toHaveBeenLastCalledWith('x', 30)
    expect(onScrubCancel).toHaveBeenCalledOnce()
    expect(onScrubEnd).not.toHaveBeenCalled()
  })

  it('rounds typed Position values to whole pixels', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          decimals: 0,
          scrubStep: 1,
          onCommit,
        }}
      />,
    )

    const x = screen.getByLabelText('Position X')
    fireEvent.change(x, { target: { value: '42.6' } })
    fireEvent.keyDown(x, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith('x', 43, { allowCreate: true })
    expect(x).toHaveValue('43')
  })

  it('gives compact compound inputs enough width for both values', () => {
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit: vi.fn(),
        }}
      />,
    )

    expect(screen.getByTestId('compound-property-inputs')).toHaveClass('w-[132px]')
  })

  it('commits a horizontal scrub on release when live preview is unavailable', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit,
        }}
      />,
    )

    const y = screen.getByLabelText('Position Y')
    fireEvent.pointerDown(y, { button: 0, pointerId: 8, clientX: 100 })
    fireEvent.pointerMove(y, { pointerId: 8, clientX: 120 })
    fireEvent.pointerUp(y, { pointerId: 8, clientX: 120 })

    expect(onCommit).toHaveBeenCalledWith('y', 20.2, { allowCreate: true })
  })
})
