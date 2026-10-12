import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { MotionPathOverlay } from './motion-path-overlay'

describe('MotionPathOverlay', () => {
  it('renders paths and keyframe dots for supplied motion points', () => {
    render(
      <MotionPathOverlay
        width={640}
        height={360}
        paths={[
          {
            itemId: 'clip-1',
            points: [
              { frame: 0, x: 0, y: 0, screenX: 10, screenY: 20, isKeyframe: true },
              { frame: 15, x: 100, y: 50, screenX: 110, screenY: 70, isKeyframe: false },
              { frame: 30, x: 200, y: 100, screenX: 210, screenY: 120, isKeyframe: true },
            ],
          },
        ]}
      />,
    )

    const overlay = screen.getByTestId('motion-path-overlay')
    expect(overlay).toHaveAttribute('viewBox', '0 0 640 360')
    expect(overlay.querySelectorAll('path')).toHaveLength(2)
    expect(overlay.querySelectorAll('circle')).toHaveLength(2)
  })

  it('renders nothing when there are no paths', () => {
    const { container } = render(<MotionPathOverlay width={640} height={360} paths={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('exposes active v2 path points and spatial handles for direct editing', () => {
    const onKeyframePointerDown = vi.fn()
    const onTangentPointerDown = vi.fn()
    const onCreateSpatialTangents = vi.fn()
    const { container } = render(
      <MotionPathOverlay
        width={640}
        height={360}
        activeFrame={10}
        paths={[
          {
            itemId: 'clip-1',
            points: [
              {
                frame: 10,
                x: 100,
                y: 50,
                screenX: 110,
                screenY: 70,
                isKeyframe: true,
                keyframeId: 'position-1',
                spatial: {
                  inTangent: { x: -20, y: 0 },
                  outTangent: { x: 20, y: 0 },
                  continuous: true,
                },
                inHandle: { screenX: 90, screenY: 70 },
                outHandle: { screenX: 130, screenY: 70 },
              },
            ],
          },
        ]}
        onKeyframePointerDown={onKeyframePointerDown}
        onTangentPointerDown={onTangentPointerDown}
        onCreateSpatialTangents={onCreateSpatialTangents}
      />,
    )

    const keyframe = container.querySelector('[data-motion-path-keyframe-id="position-1"]')!
    fireEvent.pointerDown(keyframe)
    expect(onKeyframePointerDown).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({ keyframeId: 'position-1' }),
      expect.anything(),
    )

    const outgoing = container.querySelector('[data-motion-path-handle="out"]')!
    fireEvent.pointerDown(outgoing)
    expect(onTangentPointerDown).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({ keyframeId: 'position-1' }),
      'out',
      expect.anything(),
    )

    fireEvent.doubleClick(keyframe)
    expect(onCreateSpatialTangents).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({ keyframeId: 'position-1' }),
    )
  })
})
