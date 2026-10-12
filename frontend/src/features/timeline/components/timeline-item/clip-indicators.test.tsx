import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import { ClipIndicators } from './clip-indicators'

describe('ClipIndicators', () => {
  it('toggles the keyframe panel exactly once from the completed click', () => {
    const onKeyframesToggle = vi.fn()
    const parentPointerDown = vi.fn()
    const parentClick = vi.fn()

    render(
      <div onPointerDown={parentPointerDown} onClick={parentClick}>
        <ClipIndicators
          hasKeyframes
          keyframesExpanded={false}
          hasMotion={false}
          currentSpeed={1}
          isReversed={false}
          isStretching={false}
          stretchFeedback={null}
          isBroken={false}
          hasMediaId={false}
          isMask={false}
          isShape={false}
          onKeyframesToggle={onKeyframesToggle}
        />
      </div>,
    )

    const button = screen.getByRole('button', { name: 'Show keyframe panel' })

    fireEvent.pointerDown(button, { button: 0 })
    expect(onKeyframesToggle).not.toHaveBeenCalled()
    expect(parentPointerDown).not.toHaveBeenCalled()

    fireEvent.click(button, { detail: 1 })
    expect(onKeyframesToggle).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('opens animation controls without starting the parent clip gesture', () => {
    const onMotionOpen = vi.fn()
    const parentPointerDown = vi.fn()
    const parentClick = vi.fn()

    render(
      <div onPointerDown={parentPointerDown} onClick={parentClick}>
        <ClipIndicators
          hasKeyframes={false}
          keyframesExpanded={false}
          hasMotion
          currentSpeed={1}
          isReversed={false}
          isStretching={false}
          stretchFeedback={null}
          isBroken={false}
          hasMediaId={false}
          isMask={false}
          isShape={false}
          onMotionOpen={onMotionOpen}
        />
      </div>,
    )

    const button = screen.getByRole('button', { name: 'Open animation controls' })

    fireEvent.pointerDown(button, { button: 0 })
    expect(onMotionOpen).not.toHaveBeenCalled()
    expect(parentPointerDown).not.toHaveBeenCalled()

    fireEvent.click(button, { detail: 1 })
    expect(onMotionOpen).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })
})
