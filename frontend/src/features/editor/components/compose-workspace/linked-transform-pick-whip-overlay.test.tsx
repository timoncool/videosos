import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { PropertyLinkPickWhipOverlay } from '@/features/editor/deps/timeline-motion'
import type {
  MotionPickWhipOverlaySnapshot,
  MotionPickWhipPresentation,
} from '@/shared/hooks/use-pick-whip-drag'

function createPresentation(
  initialSnapshot: MotionPickWhipOverlaySnapshot,
): MotionPickWhipPresentation {
  const listeners = new Set<(snapshot: MotionPickWhipOverlaySnapshot) => void>()
  const presentation: MotionPickWhipPresentation = {
    current: initialSnapshot,
    publish: (snapshot) => {
      presentation.current = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      listener(presentation.current)
      return () => listeners.delete(listener)
    },
  }
  return presentation
}

describe('PropertyLinkPickWhipOverlay', () => {
  it('clips the cable to the motion scroll viewport', () => {
    const snapshot: MotionPickWhipOverlaySnapshot = {
      startX: 40,
      startY: 80,
      currentX: 120,
      currentY: 20,
      valid: false,
      clipBounds: { left: 10, top: 50, right: 210, bottom: 350 },
    }
    render(
      <PropertyLinkPickWhipOverlay
        drag={{
          ...snapshot,
          sourceItemId: null,
          presentation: createPresentation(snapshot),
        }}
      />,
    )

    const overlay = screen.getByTestId('property-link-pick-whip')
    expect(overlay.getAttribute('viewBox')).toBe('10 50 200 300')
    expect(overlay).toHaveStyle({ left: '10px', top: '50px', width: '200px', height: '300px' })
  })

  it('shows and clears an invalid-target reason beside the endpoint', () => {
    const snapshot: MotionPickWhipOverlaySnapshot = {
      startX: 40,
      startY: 80,
      currentX: 120,
      currentY: 120,
      valid: false,
      rejectionMessage: 'This parent link would create a circular dependency.',
      clipBounds: { left: 10, top: 50, right: 510, bottom: 350 },
    }
    const presentation = createPresentation(snapshot)
    render(
      <PropertyLinkPickWhipOverlay
        drag={{
          ...snapshot,
          sourceItemId: null,
          presentation,
        }}
      />,
    )

    const overlay = screen.getByTestId('property-link-pick-whip')
    const feedback = screen.getByTestId('property-link-pick-whip-feedback')
    expect(overlay.querySelector('path')).toHaveAttribute('stroke', 'rgb(248 113 113)')
    expect(feedback).toHaveTextContent(snapshot.rejectionMessage!)
    expect(feedback).toHaveStyle({ display: 'block' })

    act(() => {
      presentation.publish({
        ...snapshot,
        valid: true,
        rejectionMessage: null,
      })
    })

    expect(overlay.querySelector('path')).toHaveAttribute('stroke', 'rgb(251 146 60)')
    expect(feedback).toHaveTextContent('')
    expect(feedback).toHaveStyle({ display: 'none' })
  })
})
