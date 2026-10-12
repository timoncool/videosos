import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { AudioFadeHandles } from './audio-fade-handles'

function renderHandles(overrides: Partial<ComponentProps<typeof AudioFadeHandles>> = {}) {
  return render(
    <AudioFadeHandles
      trackLocked={false}
      activeTool="select"
      lineYPercent={50}
      fadeInPercent={20}
      fadeOutPercent={15}
      isSelected={true}
      isEditing={false}
      curveEditingHandle={null}
      fadeInLabel="Fade In 0.80s"
      fadeOutLabel="Fade Out 0.60s"
      fadeInCurveDot={{ xPercent: 20, yPercent: 50 }}
      fadeOutCurveDot={null}
      onFadeHandleMouseDown={vi.fn()}
      onFadeHandleDoubleClick={vi.fn()}
      onFadeCurveDotMouseDown={vi.fn()}
      onFadeCurveDotDoubleClick={vi.fn()}
      {...overrides}
    />,
  )
}

describe('AudioFadeHandles', () => {
  it('hides and disables fade controls below the useful clip width', () => {
    const view = renderHandles()

    expect(view.container.querySelector('[data-clip-fade-controls="audio"]')).toHaveClass(
      'opacity-0',
      '@min-[44px]:opacity-40',
      '@min-[64px]:opacity-100',
    )
    expect(screen.getByRole('button', { name: 'Adjust audio fade in' })).toHaveClass(
      'pointer-events-none',
      '@min-[44px]:pointer-events-auto',
    )
    expect(screen.getByRole('button', { name: /adjust audio fade in curve/i })).toHaveClass(
      'pointer-events-none',
      '@min-[44px]:pointer-events-auto',
    )
  })

  it('keeps curve editing visible and interactive while the clip crosses the threshold', () => {
    const view = renderHandles({ curveEditingHandle: 'in' })

    expect(view.container.querySelector('[data-clip-fade-controls="audio"]')).toHaveClass(
      'opacity-100',
    )
    expect(screen.getByRole('button', { name: /adjust audio fade in curve/i })).toHaveClass(
      'pointer-events-auto',
    )
  })
})
