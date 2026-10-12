import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { VectorKeyframe } from '@/types/keyframe'
import { VectorSpeedGraph } from './vector-speed-graph'

const keyframes: VectorKeyframe[] = [
  { id: 'a', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' },
  { id: 'b', frame: 30, value: { x: 90, y: 0 }, easing: 'linear' },
  { id: 'c', frame: 60, value: { x: 180, y: 0 }, easing: 'linear' },
]

describe('VectorSpeedGraph', () => {
  it('renders sampled velocity and commits speed/influence handles', () => {
    const onTemporalEaseCommit = vi.fn()
    const { container } = render(
      <VectorSpeedGraph
        property="position"
        label="Position speed"
        keyframes={keyframes}
        currentKeyframeId="b"
        fps={30}
        resetLabel="Reset speed"
        onTemporalEaseCommit={onTemporalEaseCommit}
      />,
    )

    expect(screen.getByLabelText('Position speed speed graph')).toBeInTheDocument()
    expect(container.querySelector('path')).toBeInTheDocument()

    const speed = screen.getByLabelText('Out speed')
    fireEvent.change(speed, { target: { value: '45' } })
    fireEvent.blur(speed)

    expect(onTemporalEaseCommit).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ out: expect.objectContaining({ speed: 45 }) }),
    )
  })
})
