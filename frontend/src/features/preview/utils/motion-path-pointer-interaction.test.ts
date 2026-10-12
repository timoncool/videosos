import { describe, expect, it, vi } from 'vite-plus/test'
import { attachWindowMotionPathPointerInteraction } from './motion-path-pointer-interaction'

function dispatchPointer(type: string, pointerId: number) {
  window.dispatchEvent(new PointerEvent(type, { pointerId }))
}

describe('attachWindowMotionPathPointerInteraction', () => {
  it('tracks only the owning pointer and commits on release', () => {
    const onMove = vi.fn()
    const onCommit = vi.fn()
    attachWindowMotionPathPointerInteraction({ pointerId: 7, onMove, onCommit })

    dispatchPointer('pointermove', 4)
    dispatchPointer('pointermove', 7)
    dispatchPointer('pointerup', 7)
    dispatchPointer('pointermove', 7)

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('cancels without committing', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    attachWindowMotionPathPointerInteraction({
      pointerId: 9,
      onMove: vi.fn(),
      onCommit,
      onCancel,
    })

    dispatchPointer('pointercancel', 9)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
