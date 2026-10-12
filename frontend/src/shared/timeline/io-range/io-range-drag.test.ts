import type { PointerEvent as ReactPointerEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { beginIoPointerDrag } from './io-range-drag'
import { useIoRangeReadoutStore } from './io-range-readout-store'

describe('beginIoPointerDrag readout positioning', () => {
  afterEach(() => {
    useIoRangeReadoutStore.getState().setReadout(null)
  })

  it('uses an explicit surface anchor instead of the pointer coordinates', () => {
    const target = document.createElement('div')
    Object.assign(target, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    const event = {
      button: 0,
      pointerId: 7,
      clientX: 240,
      clientY: 180,
      currentTarget: target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ReactPointerEvent

    const cleanup = beginIoPointerDrag(event, () => ({
      label: '00:01:00 to 00:05:00',
      x: 120,
      y: 48,
    }))

    expect(useIoRangeReadoutStore.getState().readout).toEqual({
      label: '00:01:00 to 00:05:00',
      x: 120,
      y: 48,
    })
    cleanup?.()
    expect(useIoRangeReadoutStore.getState().readout).toBeNull()
  })
})
