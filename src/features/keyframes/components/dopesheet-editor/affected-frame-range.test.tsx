import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'

describe('DopesheetEditor affected frame range', () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a pointer-transparent clipped band behind classic Edit lanes', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          rotation: [{ id: 'rotation-1', frame: 40, value: 90, easing: 'linear' }],
        }}
        frameViewport={{ startFrame: -20, endFrame: 180 }}
        totalFrames={100}
        affectedFrameRange={{ fromFrame: 0, toFrame: 100 }}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    const highlight = screen.getByTestId('dopesheet-affected-frame-range')
    expect(highlight).toHaveAttribute('data-from-frame', '0')
    expect(highlight).toHaveAttribute('data-to-frame', '100')
    expect(highlight).toHaveClass('border-foreground/[0.10]', 'bg-foreground/[0.035]')
    expect(highlight.parentElement).toHaveClass('pointer-events-none', 'overflow-hidden')
  })

  it('observes classic keyframe rows against the dopesheet scroller on first render', async () => {
    const observedRoots: Array<Element | Document | null> = []

    class IntersectionObserverMock {
      readonly root: Element | Document | null
      readonly rootMargin = '96px 0px'
      readonly thresholds = [0]

      constructor(
        private readonly callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        this.root = options?.root ?? null
        observedRoots.push(this.root)
      }

      observe(target: Element) {
        this.callback(
          [
            {
              isIntersecting: this.root !== null,
              target,
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver,
        )
      }

      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }

    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          rotation: [{ id: 'rotation-1', frame: 40, value: 90, easing: 'linear' }],
        }}
        frameViewport={{ startFrame: -20, endFrame: 180 }}
        totalFrames={100}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    const scrollArea = screen.getByTestId('dopesheet-scroll-area')
    await waitFor(() => {
      expect(screen.getByTestId('row-keyframe-rotation-rotation-1')).toBeInTheDocument()
    })
    expect(observedRoots.length).toBeGreaterThan(0)
    expect(observedRoots.every((root) => root === scrollArea)).toBe(true)
  })
})
