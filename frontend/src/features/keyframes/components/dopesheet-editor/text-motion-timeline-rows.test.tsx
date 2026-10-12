import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ComponentProps } from 'react'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import { TextMotionTimelineRows } from './text-motion-timeline-rows'

const BANDS: TextMotionTimelineBand[] = [
  {
    slot: 'in',
    presetId: 'typewriter',
    fromFrame: 0,
    toFrame: 10,
    clipFromFrame: 0,
    clipToFrame: 50,
    unitCount: 3,
    durationFrames: 10,
    offsetFrames: 0,
  },
  {
    slot: 'out',
    presetId: 'fade-down',
    fromFrame: 42,
    toFrame: 50,
    clipFromFrame: 0,
    clipToFrame: 50,
    unitCount: 3,
    durationFrames: 8,
    offsetFrames: 0,
  },
]

function renderRows(callbacks: Partial<ComponentProps<typeof TextMotionTimelineRows>> = {}) {
  return render(
    <TextMotionTimelineRows
      bands={BANDS}
      gridStyle={{ gridTemplateColumns: '200px 1fr', height: 30 }}
      ticks={[0, 10, 20, 30, 40, 50]}
      axisWidth={500}
      frameToX={(frame) => frame * 2}
      getPixelsPerFrame={() => 2}
      disabled={false}
      onBackgroundPointerDown={vi.fn()}
      {...callbacks}
    />,
  )
}

describe('TextMotionTimelineRows', () => {
  it('renders procedural slots at their clip-relative spans and opens a clicked slot', () => {
    const onBandClick = vi.fn()
    renderRows({ onBandClick })

    expect(screen.getByTestId('edit-text-motion-band-in')).toHaveAttribute('data-from-frame', '0')
    expect(screen.getByTestId('edit-text-motion-band-out')).toHaveAttribute('data-to-frame', '50')
    expect(screen.getByTestId('edit-text-motion-band-in-visual')).toHaveClass(
      'rounded-[2px]',
      'bg-sky-400/40',
    )
    expect(screen.getByTestId('edit-text-motion-band-in-handle')).toHaveClass('bg-transparent')

    fireEvent.click(screen.getByTestId('edit-text-motion-band-in'))
    expect(onBandClick).toHaveBeenCalledWith('in')
  })

  it('previews duration locally and commits one value on pointer release', () => {
    const onDurationDragStart = vi.fn()
    const onDurationCommit = vi.fn()
    renderRows({ onDurationDragStart, onDurationCommit })
    const band = screen.getByTestId('edit-text-motion-band-in')
    const handle = screen.getByTestId('edit-text-motion-band-in-handle')

    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 20 })
    fireEvent.pointerMove(handle, { pointerId: 2, buttons: 1, clientX: 40 })

    expect(onDurationDragStart).toHaveBeenCalledTimes(1)
    expect(onDurationCommit).not.toHaveBeenCalled()
    expect(band).toHaveAttribute('data-to-frame', '20')

    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 40 })
    expect(onDurationCommit).toHaveBeenCalledWith('in', 20)
  })

  it('offsets an in or out animation by dragging its body', () => {
    const onOffsetDragStart = vi.fn()
    const onOffsetCommit = vi.fn()
    renderRows({ onOffsetDragStart, onOffsetCommit })
    const inBand = screen.getByTestId('edit-text-motion-band-in')
    const outBand = screen.getByTestId('edit-text-motion-band-out')

    fireEvent.pointerDown(inBand, { pointerId: 5, button: 0, clientX: 20 })
    fireEvent.pointerMove(inBand, { pointerId: 5, buttons: 1, clientX: 40 })

    expect(onOffsetDragStart).toHaveBeenCalledTimes(1)
    expect(inBand).toHaveAttribute('data-from-frame', '10')
    expect(inBand).toHaveAttribute('data-to-frame', '20')

    fireEvent.pointerUp(inBand, { pointerId: 5, clientX: 40 })
    expect(onOffsetCommit).toHaveBeenCalledWith('in', 10)

    fireEvent.pointerDown(outBand, { pointerId: 6, button: 0, clientX: 100 })
    fireEvent.pointerMove(outBand, { pointerId: 6, buttons: 1, clientX: 80 })
    expect(outBand).toHaveAttribute('data-from-frame', '32')
    expect(outBand).toHaveAttribute('data-to-frame', '40')

    fireEvent.pointerUp(outBand, { pointerId: 6, clientX: 80 })
    expect(onOffsetCommit).toHaveBeenLastCalledWith('out', 10)
  })

  it('discards a pointer-cancelled preview', () => {
    const onDurationCancel = vi.fn()
    const onDurationCommit = vi.fn()
    renderRows({ onDurationCancel, onDurationCommit })
    const band = screen.getByTestId('edit-text-motion-band-out')
    const handle = screen.getByTestId('edit-text-motion-band-out-handle')

    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 3, buttons: 1, clientX: 80 })
    expect(band).toHaveAttribute('data-from-frame', '32')

    fireEvent.pointerCancel(handle, { pointerId: 3, clientX: 80 })
    expect(onDurationCancel).toHaveBeenCalledTimes(1)
    expect(onDurationCommit).not.toHaveBeenCalled()
    expect(band).toHaveAttribute('data-from-frame', '42')
  })

  it('uses an internal handle for loop duration without moving the loop band', () => {
    const onDurationCommit = vi.fn()
    renderRows({
      bands: [
        {
          slot: 'loop',
          presetId: 'pulse',
          fromFrame: 10,
          toFrame: 50,
          clipFromFrame: 0,
          clipToFrame: 60,
          unitCount: 3,
          durationFrames: 10,
          offsetFrames: 0,
        },
      ],
      onDurationCommit,
    })
    const band = screen.getByTestId('edit-text-motion-band-loop')
    const handle = screen.getByTestId('edit-text-motion-band-loop-handle')

    expect(handle).toHaveStyle({ left: '20px' })
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 20 })
    fireEvent.pointerMove(handle, { pointerId: 4, buttons: 1, clientX: 40 })

    expect(band).toHaveAttribute('data-from-frame', '10')
    expect(band).toHaveAttribute('data-to-frame', '50')
    expect(handle).toHaveStyle({ left: '40px' })

    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 40 })
    expect(onDurationCommit).toHaveBeenCalledWith('loop', 20)
  })

  it('shrinks the loop preview while an edge animation is offset', () => {
    renderRows({
      bands: [
        BANDS[0]!,
        {
          slot: 'loop',
          presetId: 'pulse',
          fromFrame: 10,
          toFrame: 42,
          clipFromFrame: 0,
          clipToFrame: 50,
          unitCount: 3,
          durationFrames: 10,
          offsetFrames: 0,
        },
        BANDS[1]!,
      ],
    })
    const inBand = screen.getByTestId('edit-text-motion-band-in')
    const loopBand = screen.getByTestId('edit-text-motion-band-loop')
    const outBand = screen.getByTestId('edit-text-motion-band-out')

    fireEvent.pointerDown(inBand, { pointerId: 7, button: 0, clientX: 20 })
    fireEvent.pointerMove(inBand, { pointerId: 7, buttons: 1, clientX: 40 })
    expect(loopBand).toHaveAttribute('data-from-frame', '20')
    fireEvent.pointerUp(inBand, { pointerId: 7, clientX: 40 })

    fireEvent.pointerDown(outBand, { pointerId: 8, button: 0, clientX: 100 })
    fireEvent.pointerMove(outBand, { pointerId: 8, buttons: 1, clientX: 80 })
    expect(loopBand).toHaveAttribute('data-to-frame', '32')
  })
})
