import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { VideoFadeHandles } from './video-fade-handles'

describe('VideoFadeHandles', () => {
  it('renders both fade handles when the select tool is active', () => {
    const view = render(
      <VideoFadeHandles
        trackLocked={false}
        activeTool="select"
        lineYPercent={50}
        fadeInPercent={20}
        fadeOutPercent={15}
        isSelected={false}
        isEditing={false}
        fadeInLabel="Fade In 0.80s"
        fadeOutLabel="Fade Out 0.60s"
        onFadeHandleMouseDown={vi.fn()}
        onFadeHandleDoubleClick={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Adjust video fade in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust video fade out' })).toBeInTheDocument()
    expect(view.container.querySelector('[data-clip-fade-controls="video"]')).toHaveClass(
      'opacity-0',
      '@min-[44px]:opacity-40',
      '@min-[64px]:opacity-100',
    )
    expect(screen.getByRole('button', { name: 'Adjust video fade in' })).toHaveClass(
      'pointer-events-none',
      '@min-[44px]:pointer-events-auto',
    )
  })

  it('keeps an active fade edit visible and interactive below the density threshold', () => {
    const view = render(
      <VideoFadeHandles
        trackLocked={false}
        activeTool="select"
        lineYPercent={50}
        fadeInPercent={20}
        fadeOutPercent={15}
        isSelected={true}
        isEditing={true}
        editingHandle="in"
        fadeInLabel="Fade In 0.80s"
        fadeOutLabel="Fade Out 0.60s"
        onFadeHandleMouseDown={vi.fn()}
        onFadeHandleDoubleClick={vi.fn()}
      />,
    )

    expect(view.container.querySelector('[data-clip-fade-controls="video"]')).toHaveClass(
      'opacity-100',
    )
    expect(screen.getByRole('button', { name: 'Adjust video fade in' })).toHaveClass(
      'pointer-events-auto',
    )
  })

  it('shows the hover label and prevents double-click from bubbling', () => {
    const parentClick = vi.fn()
    const parentDoubleClick = vi.fn()
    const onFadeHandleDoubleClick = vi.fn()

    render(
      <div onClick={parentClick} onDoubleClick={parentDoubleClick}>
        <VideoFadeHandles
          trackLocked={false}
          activeTool="select"
          lineYPercent={50}
          fadeInPercent={25}
          fadeOutPercent={25}
          isSelected={true}
          isEditing={false}
          fadeInLabel="Fade In 1.00s"
          fadeOutLabel="Fade Out 1.00s"
          onFadeHandleMouseDown={vi.fn()}
          onFadeHandleDoubleClick={onFadeHandleDoubleClick}
        />
      </div>,
    )

    const fadeInHandle = screen.getByRole('button', { name: 'Adjust video fade in' })

    fireEvent.mouseEnter(fadeInHandle)
    expect(screen.getByText('Fade In 1.00s')).toBeInTheDocument()

    fireEvent.click(fadeInHandle)
    fireEvent.doubleClick(fadeInHandle)

    expect(parentClick).not.toHaveBeenCalled()
    expect(parentDoubleClick).not.toHaveBeenCalled()
    expect(onFadeHandleDoubleClick).toHaveBeenCalledTimes(1)
  })
})
