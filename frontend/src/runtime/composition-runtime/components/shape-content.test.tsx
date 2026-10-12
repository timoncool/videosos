import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import { ItemVisualTransformProvider } from '../contexts/item-visual-transform-context'
import { KeyframesProvider } from '../contexts/keyframes-context'
import { SequenceContext } from '@/runtime/composition-runtime/deps/player'
import { ShapeContent } from './shape-content'
import { useGizmoStore } from '@/runtime/composition-runtime/deps/stores'

const shape: ShapeItem = {
  id: 'shape-1',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Rectangle',
  shapeType: 'rectangle',
  fillColor: '#22d3ee',
  strokeWidth: 0,
  transform: { x: 0, y: 0, width: 200, height: 100 },
}

describe('ShapeContent', () => {
  afterEach(() => {
    cleanup()
    useGizmoStore.getState().clearPreview()
  })

  it('draws with the evaluated visual dimensions instead of the static item transform', () => {
    const { container } = render(
      <ItemVisualTransformProvider
        value={{
          width: 480,
          height: 270,
        }}
      >
        <ShapeContent item={shape} />
      </ItemVisualTransformProvider>,
    )

    expect(container.querySelector('svg')).toHaveAttribute('width', '480')
    expect(container.querySelector('svg')).toHaveAttribute('height', '270')
    expect(container.querySelector('svg')).toHaveAttribute('overflow', 'visible')
  })

  it('applies normalized trim-path values to the shape stroke', () => {
    const { container } = render(
      <ShapeContent
        item={{
          ...shape,
          strokeColor: '#ffffff',
          strokeWidth: 4,
          trimPathStart: 25,
          trimPathEnd: 75,
          trimPathOffset: 90,
        }}
      />,
    )

    const path = container.querySelector('path')
    expect(path).toHaveAttribute('pathLength', '100')
    expect(path).toHaveAttribute('stroke-dasharray', '50 50')
    expect(path).toHaveAttribute('stroke-dashoffset', '-50')
  })

  it('renders a Shape property linked to another layer scalar', () => {
    const source: ShapeItem = {
      ...shape,
      id: 'source-shape',
      label: 'Source shape',
      transform: { ...shape.transform, x: 50 },
    }
    const target = { ...shape, strokeColor: '#ffffff', strokeWidth: 4 }
    const { container } = render(
      <KeyframesProvider
        keyframes={[
          {
            itemId: target.id,
            properties: [],
            expressions: [
              {
                type: 'link',
                targetProperty: 'trimPathEnd',
                sourceItemId: source.id,
                sourceProperty: 'x',
                enabled: true,
                timeOffsetFrames: 0,
              },
            ],
          },
        ]}
        items={[target, source]}
        canvas={{ width: 1920, height: 1080, fps: 30 }}
      >
        <ShapeContent item={target} />
      </KeyframesProvider>,
    )

    expect(container.querySelector('path')).toHaveAttribute('stroke-dasharray', '50 50')
  })

  it('updates trim offset immediately from the live properties preview', () => {
    const { container } = render(
      <ShapeContent
        item={{
          ...shape,
          strokeColor: '#ffffff',
          strokeWidth: 4,
          trimPathStart: 0,
          trimPathEnd: 50,
        }}
      />,
    )

    expect(container.querySelector('path')).toHaveAttribute('stroke-dashoffset', '0')
    act(() => {
      useGizmoStore.getState().setPropertiesPreviewNew({
        [shape.id]: { trimPathOffset: 90 },
      })
    })
    expect(container.querySelector('path')).toHaveAttribute('stroke-dashoffset', '-25')
  })

  it('renders and live-previews the additive two-stop linear gradient fill', () => {
    const { container } = render(
      <ShapeContent
        item={{
          ...shape,
          fillType: 'linear',
          gradientStartColor: '#112233',
          gradientEndColor: '#aabbcc',
          gradientAngle: 0,
        }}
      />,
    )

    const gradient = container.querySelector('linearGradient')
    expect(gradient).toHaveAttribute('gradientUnits', 'userSpaceOnUse')
    expect(gradient).toHaveAttribute('x1', '0')
    expect(gradient).toHaveAttribute('y1', '50')
    expect(gradient).toHaveAttribute('x2', '200')
    expect(gradient).toHaveAttribute('y2', '50')
    expect(container.querySelectorAll('stop')[0]).toHaveAttribute('stop-color', '#112233')
    expect(container.querySelectorAll('stop')[1]).toHaveAttribute('stop-color', '#aabbcc')
    expect(container.querySelector('path')?.getAttribute('fill')).toMatch(/^url\(#shape-gradient-/)

    act(() => {
      useGizmoStore.getState().setPropertiesPreviewNew({
        [shape.id]: { gradientAngle: 90, gradientEndColor: '#ff00ff' },
      })
    })

    expect(Number(container.querySelector('linearGradient')?.getAttribute('x1'))).toBeCloseTo(100)
    expect(container.querySelector('linearGradient')).toHaveAttribute('y1', '0')
    expect(Number(container.querySelector('linearGradient')?.getAttribute('x2'))).toBeCloseTo(100)
    expect(container.querySelector('linearGradient')).toHaveAttribute('y2', '100')
    expect(container.querySelectorAll('stop')[1]).toHaveAttribute('stop-color', '#ff00ff')
  })

  it('derives a missing shared-sequence offset from the sequence context', () => {
    const { container } = render(
      <SequenceContext.Provider
        value={{ from: 105, parentFrom: 100, localFrame: 25, durationInFrames: 120 }}
      >
        <KeyframesProvider
          keyframes={[
            {
              itemId: shape.id,
              properties: [
                {
                  property: 'trimPathEnd',
                  keyframes: [
                    { id: 'start', frame: 0, value: 0, easing: 'linear' },
                    { id: 'end', frame: 30, value: 100, easing: 'linear' },
                  ],
                },
              ],
            },
          ]}
        >
          <ShapeContent
            item={{
              ...shape,
              from: 15,
              strokeColor: '#ffffff',
              strokeWidth: 4,
            }}
          />
        </KeyframesProvider>
      </SequenceContext.Provider>,
    )

    expect(container.querySelector('path')).toHaveAttribute('stroke-dasharray', '50 50')
  })

  it('renders an open custom path as stroke-only with its cap and join styling', () => {
    const { container } = render(
      <ShapeContent
        item={{
          ...shape,
          shapeType: 'path',
          pathClosed: false,
          fillEnabled: true,
          strokeEnabled: true,
          strokeColor: '#ffffff',
          strokeWidth: 4,
          strokeLineCap: 'round',
          strokeLineJoin: 'bevel',
          pathVertices: [
            { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
            { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
          ],
        }}
      />,
    )

    const path = container.querySelector('path')
    expect(container.querySelector('svg')).toHaveAttribute('overflow', 'visible')
    expect(path?.getAttribute('d')).not.toMatch(/Z\s*$/)
    expect(path).toHaveAttribute('fill', 'none')
    expect(path).toHaveAttribute('stroke-linecap', 'round')
    expect(path).toHaveAttribute('stroke-linejoin', 'bevel')
  })

  it('renders a tapered stroke with smoothly varying segment widths', () => {
    const { container } = render(
      <ShapeContent
        item={{
          ...shape,
          strokeEnabled: true,
          strokeColor: '#ffffff',
          strokeWidth: 10,
          taperStartWidth: 0,
          taperStartLength: 50,
          taperEndWidth: 0,
          taperEndLength: 50,
        }}
      />,
    )

    const taperedSegments = Array.from(container.querySelectorAll('path[stroke="#ffffff"]'))
    const widths = taperedSegments.map((path) => Number(path.getAttribute('stroke-width')))
    expect(taperedSegments).toHaveLength(48)
    expect(widths[0]).toBeLessThan(widths[24]!)
    expect(widths.at(-1)).toBeLessThan(widths[24]!)
  })

  it('renders custom-path taper as one continuous outline without a wrapped start cap', () => {
    const { container } = render(
      <ShapeContent
        item={{
          ...shape,
          shapeType: 'path',
          pathClosed: false,
          strokeEnabled: true,
          strokeColor: '#ffffff',
          strokeWidth: 20,
          strokeLineCap: 'round',
          taperStartWidth: 0,
          taperStartLength: 100,
          pathVertices: [
            { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
            { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
          ],
        }}
      />,
    )

    expect(container.querySelectorAll('[data-taper-outline="true"]')).toHaveLength(1)
    expect(container.querySelector('[data-taper-outline="true"]')).toHaveAttribute(
      'data-taper-cap-count',
      '1',
    )
    expect(container.querySelectorAll('[data-taper-cap="true"]')).toHaveLength(0)
    expect(container.querySelectorAll('path[stroke="#ffffff"]')).toHaveLength(0)
  })

  it('live-previews trim offset on a tapered custom path', () => {
    const taperedPath: ShapeItem = {
      ...shape,
      shapeType: 'path',
      pathClosed: false,
      strokeEnabled: true,
      strokeColor: '#ffffff',
      strokeWidth: 20,
      taperStartWidth: 0,
      taperStartLength: 100,
      trimPathEnd: 50,
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0.2, 0] },
        { position: [1, 1], inHandle: [-0.2, 0], outHandle: [0, 0] },
      ],
    }
    const { container } = render(<ShapeContent item={taperedPath} />)
    const initialOutline = container.querySelector('[data-taper-outline="true"]')?.getAttribute('d')

    act(() => {
      useGizmoStore.getState().setPropertiesPreviewNew({
        [shape.id]: { trimPathOffset: 270 },
      })
    })

    const updatedOutline = container.querySelector('[data-taper-outline="true"]')?.getAttribute('d')
    expect(updatedOutline).not.toBe(initialOutline)
    expect(updatedOutline?.match(/\bM\b/g)).toHaveLength(2)
  })
})
