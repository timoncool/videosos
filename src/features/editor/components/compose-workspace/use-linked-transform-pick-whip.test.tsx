import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useKeyframesStore, useTimelineCommandStore } from '@/features/editor/deps/timeline-motion'
import { usePropertyLinkPickWhip } from '@/features/editor/deps/timeline-motion'
import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'

function PickWhipHarness({ onRender }: { onRender?: () => void } = {}) {
  onRender?.()
  const { drag, begin } = usePropertyLinkPickWhip()
  return (
    <div data-testid="motion-layer-scroll-area">
      <div data-expression-item-id="target" data-expression-property="x">
        <button type="button" onPointerDown={(event) => begin(event, 'target', 'x')}>
          Target X
        </button>
      </div>
      <div data-testid="source-row" data-expression-item-id="source" data-expression-property="y">
        Source Y
      </div>
      <div data-expression-item-id="vector-target" data-expression-property="position">
        <button type="button" onPointerDown={(event) => begin(event, 'vector-target', 'position')}>
          Target Position
        </button>
      </div>
      <div
        data-testid="vector-source-row"
        data-expression-item-id="vector-source"
        data-expression-property="scale"
      >
        Source Scale
      </div>
      <div
        data-testid="shape-source-row"
        data-expression-item-id="shape-source"
        data-expression-property="trimPathEnd"
      >
        Shape Trim End
      </div>
      {drag ? <PickWhipOverlay presentation={drag.presentation} testId="active-pick-whip" /> : null}
    </div>
  )
}

describe('usePropertyLinkPickWhip', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useKeyframesStore.getState().setKeyframes([])
  })

  it('creates a property link after dragging to a compatible row', async () => {
    render(<PickWhipHarness />)
    const sourceRow = screen.getByTestId('source-row')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => sourceRow),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 9,
      clientX: 0,
      clientY: 0,
    })
    expect(screen.getByTestId('active-pick-whip')).toBeTruthy()
    expect(sourceRow).toHaveAttribute('data-expression-link-eligible', 'true')
    expect(screen.getByTestId('shape-source-row')).toHaveAttribute(
      'data-expression-link-eligible',
      'true',
    )
    expect(screen.getByTestId('vector-source-row')).not.toHaveAttribute(
      'data-expression-link-eligible',
    )

    fireEvent.pointerMove(window, { pointerId: 9, clientX: 24, clientY: 24 })
    await waitFor(() => {
      expect(sourceRow.getAttribute('data-expression-link-hover')).toBe('true')
    })
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 24, clientY: 24 })

    expect(useKeyframesStore.getState().keyframesByItemId.target?.propertyLinks).toEqual([
      {
        type: 'link',
        targetProperty: 'x',
        sourceItemId: 'source',
        sourceProperty: 'y',
        enabled: true,
        timeOffsetFrames: 0,
      },
    ])
    expect(sourceRow.hasAttribute('data-expression-link-hover')).toBe(false)
    expect(sourceRow).not.toHaveAttribute('data-expression-link-eligible')
    expect(screen.getByTestId('shape-source-row')).not.toHaveAttribute(
      'data-expression-link-eligible',
    )
    expect(screen.queryByTestId('active-pick-whip')).toBeNull()
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('clears eligible row highlights when the drag is canceled', () => {
    render(<PickWhipHarness />)
    const sourceRow = screen.getByTestId('source-row')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 18,
      clientX: 0,
      clientY: 0,
    })
    expect(sourceRow).toHaveAttribute('data-expression-link-eligible', 'true')

    fireEvent.pointerCancel(window, { pointerId: 18 })

    expect(sourceRow).not.toHaveAttribute('data-expression-link-eligible')
    expect(screen.queryByTestId('active-pick-whip')).toBeNull()
  })

  it('coalesces pointer presentation and hit testing to one animation frame', () => {
    const animationFrames: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animationFrames.push(callback)
        return animationFrames.length
      })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const onRender = vi.fn()
    render(<PickWhipHarness onRender={onRender} />)
    const sourceRow = screen.getByTestId('source-row')
    const hitTest = vi.fn(() => sourceRow)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hitTest,
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 17,
      clientX: 0,
      clientY: 0,
    })
    const renderCountAfterBegin = onRender.mock.calls.length

    fireEvent.pointerMove(window, { pointerId: 17, clientX: 8, clientY: 8 })
    fireEvent.pointerMove(window, { pointerId: 17, clientX: 16, clientY: 16 })
    fireEvent.pointerMove(window, { pointerId: 17, clientX: 24, clientY: 24 })

    expect(animationFrames).toHaveLength(1)
    expect(hitTest).not.toHaveBeenCalled()
    expect(onRender).toHaveBeenCalledTimes(renderCountAfterBegin)

    act(() => animationFrames.shift()?.(16))

    expect(hitTest).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('active-pick-whip').querySelector('circle')?.getAttribute('cx')).toBe(
      '24',
    )
    expect(onRender).toHaveBeenCalledTimes(renderCountAfterBegin)

    fireEvent.pointerUp(window, { pointerId: 17, clientX: 24, clientY: 24 })
    Reflect.deleteProperty(document, 'elementFromPoint')
    requestFrame.mockRestore()
    cancelFrame.mockRestore()
  })

  it('accepts Shape scalar rows as link sources', () => {
    render(<PickWhipHarness />)
    const sourceRow = screen.getByTestId('shape-source-row')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => sourceRow),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 10,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 24, clientY: 24 })
    fireEvent.pointerUp(window, { pointerId: 10, clientX: 24, clientY: 24 })

    expect(useKeyframesStore.getState().keyframesByItemId.target?.propertyLinks?.[0]).toMatchObject(
      {
        targetProperty: 'x',
        sourceItemId: 'shape-source',
        sourceProperty: 'trimPathEnd',
      },
    )
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('links Vector2 rows and rejects scalar-to-vector targets', () => {
    render(<PickWhipHarness />)
    const vectorSource = screen.getByTestId('vector-source-row')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => vectorSource),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target Position' }), {
      button: 0,
      pointerId: 15,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 15, clientX: 24, clientY: 24 })
    fireEvent.pointerUp(window, { pointerId: 15, clientX: 24, clientY: 24 })

    expect(useKeyframesStore.getState().keyframesByItemId['vector-target']?.propertyLinks).toEqual([
      {
        type: 'link',
        targetProperty: 'position',
        sourceItemId: 'vector-source',
        sourceProperty: 'scale',
        enabled: true,
        timeOffsetFrames: 0,
      },
    ])

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 16,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 16, clientX: 24, clientY: 24 })
    fireEvent.pointerUp(window, { pointerId: 16, clientX: 24, clientY: 24 })

    expect(useKeyframesStore.getState().keyframesByItemId.target?.propertyLinks).toBeUndefined()
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('keeps the cable anchored to its pick whip while the editor scrolls', async () => {
    render(<PickWhipHarness />)
    const button = screen.getByRole('button', { name: 'Target X' })
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    let top = 20
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left: 10,
          top,
          width: 12,
          height: 12,
          right: 22,
          bottom: top + 12,
          x: 10,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left: 4,
          top: 12,
          width: 500,
          height: 300,
          right: 504,
          bottom: 312,
          x: 4,
          y: 12,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    })

    fireEvent.pointerDown(button, {
      button: 0,
      pointerId: 11,
      clientX: 16,
      clientY: 26,
    })
    expect(screen.getByTestId('active-pick-whip').querySelector('path')?.getAttribute('d')).toMatch(
      /^M 16 26 /,
    )
    expect(screen.getByTestId('active-pick-whip').getAttribute('viewBox')).toBe('4 12 500 300')

    top = 68
    fireEvent.scroll(button.parentElement!)

    await waitFor(() => {
      expect(
        screen.getByTestId('active-pick-whip').querySelector('path')?.getAttribute('d'),
      ).toMatch(/^M 16 74 /)
    })
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 16, clientY: 26 })
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('auto-scrolls when the pointer is held near a vertical viewport edge', () => {
    const animationFrames: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animationFrames.push(callback)
        return animationFrames.length
      })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    render(<PickWhipHarness />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 300,
      right: 500,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
      scrollTop: { configurable: true, value: 100, writable: true },
    })
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 12,
      clientX: 100,
      clientY: 150,
    })
    fireEvent.pointerMove(window, { pointerId: 12, clientX: 100, clientY: 292 })
    expect(animationFrames).toHaveLength(2)

    act(() => {
      const currentFrame = animationFrames.splice(0)
      for (const callback of currentFrame) callback(16)
    })

    expect(scrollArea.scrollTop).toBeGreaterThan(100)
    fireEvent.pointerUp(window, { pointerId: 12, clientX: 100, clientY: 292 })
    Reflect.deleteProperty(document, 'elementFromPoint')
    requestFrame.mockRestore()
    cancelFrame.mockRestore()
  })
})
