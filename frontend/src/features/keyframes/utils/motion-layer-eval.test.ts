// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ResolvedTransform } from '@/types/transform'
import {
  applyMotionAnimationLayers,
  createMotionAnimationLayer,
  removeMotionAnimationLayers,
} from './motion-layer-eval'

const anchor: ResolvedTransform = {
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  anchorX: 100,
  anchorY: 50,
  rotation: 10,
  opacity: 1,
  cornerRadius: 0,
}

describe('motion animation layers', () => {
  it('stores preset output as additive position and multiplicative scale contributions', () => {
    const layer = createMotionAnimationLayer({
      name: 'Slide and zoom',
      source: 'built-in-preset',
      sourcePresetId: 'slide-in-left',
      anchor,
      payloads: [
        { property: 'x', frame: 0, value: -100, easing: 'linear' },
        { property: 'x', frame: 10, value: 100, easing: 'linear' },
        { property: 'width', frame: 0, value: 100, easing: 'linear' },
        { property: 'width', frame: 10, value: 200, easing: 'linear' },
      ],
    })

    const resolved = applyMotionAnimationLayers(anchor, [layer], 5)
    expect(resolved.x).toBeCloseTo(0)
    expect(resolved.width).toBeCloseTo(150)
  })

  it('layers on top of an independently animated pose', () => {
    const layer = createMotionAnimationLayer({
      name: 'Offset',
      source: 'built-in-preset',
      sourcePresetId: 'slide-in-right',
      anchor,
      payloads: [
        { property: 'x', frame: 0, value: 140, easing: 'linear' },
        { property: 'x', frame: 10, value: 100, easing: 'linear' },
      ],
    })
    const animatedPose = { ...anchor, x: 300 }

    expect(applyMotionAnimationLayers(animatedPose, [layer], 0).x).toBe(340)
    expect(applyMotionAnimationLayers(animatedPose, [layer], 10).x).toBe(300)
  })

  it('can invert its contribution for canvas edits without a release jump', () => {
    const layer = createMotionAnimationLayer({
      name: 'Pulse',
      source: 'built-in-preset',
      sourcePresetId: 'pulse',
      anchor,
      payloads: [
        { property: 'x', frame: 0, value: 120, easing: 'linear' },
        { property: 'width', frame: 0, value: 250, easing: 'linear' },
      ],
    })
    const visual = applyMotionAnimationLayers(anchor, [layer], 0)

    expect(removeMotionAnimationLayers(visual, [layer], 0)).toEqual(anchor)
  })
})
