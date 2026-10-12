import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { GlobalTooltip } from './global-tooltip'

describe('GlobalTooltip', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the button tooltip active while the pointer moves across its icon', () => {
    vi.useFakeTimers()
    const { getByRole, getByTestId } = render(
      <>
        <button data-tooltip="Media">
          <svg data-testid="icon" />
        </button>
        <GlobalTooltip />
      </>,
    )
    const button = getByRole('button')
    const icon = getByTestId('icon')
    const tooltip = document.querySelector('[role="tooltip"]')

    fireEvent.mouseEnter(button)
    act(() => vi.advanceTimersByTime(200))

    fireEvent.mouseEnter(icon, { relatedTarget: button })
    act(() => vi.advanceTimersByTime(100))

    expect(tooltip).toHaveAttribute('data-visible', 'true')
    expect(tooltip).toHaveTextContent('Media')

    fireEvent.mouseLeave(icon, { relatedTarget: button })
    expect(tooltip).toHaveAttribute('data-visible', 'true')
  })

  it('hides the tooltip after the pointer leaves the owning button', () => {
    vi.useFakeTimers()
    const { getByRole } = render(
      <>
        <button data-tooltip="Media" />
        <GlobalTooltip />
      </>,
    )
    const button = getByRole('button')
    const tooltip = document.querySelector('[role="tooltip"]')

    fireEvent.mouseEnter(button)
    act(() => vi.advanceTimersByTime(300))
    expect(tooltip).toHaveAttribute('data-visible', 'true')

    fireEvent.mouseLeave(button)
    expect(tooltip).toHaveAttribute('data-visible', 'false')
  })
})
