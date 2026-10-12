// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { TransitionRegistry } from '../registry'
import { registerBasicTransitions } from './basic'

interface RecordedDraw {
  source: unknown
  alpha: number
  composite: string
  scale: number
}

interface RecordedFill {
  fillStyle: string
  composite: string
}

/**
 * Records the draw calls `renderCanvas` makes so tests can assert on the
 * weights and compositing without a real rasterizer.
 */
class RecordingContext {
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  fillStyle = ''
  draws: RecordedDraw[] = []
  fills: RecordedFill[] = []

  private scaleX = 1
  private stack: Array<{ alpha: number; composite: string; scaleX: number }> = []

  save(): void {
    this.stack.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      scaleX: this.scaleX,
    })
  }

  restore(): void {
    const state = this.stack.pop()
    if (state) {
      this.globalAlpha = state.alpha
      this.globalCompositeOperation = state.composite
      this.scaleX = state.scaleX
    }
  }

  translate(): void {}

  scale(x: number): void {
    this.scaleX *= x
  }

  drawImage(source: unknown): void {
    this.draws.push({
      source,
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      scale: this.scaleX,
    })
  }

  fillRect(): void {
    this.fills.push({ fillStyle: this.fillStyle, composite: this.globalCompositeOperation })
  }
}

function renderFadeAt(progress: number) {
  const registry = new TransitionRegistry()
  registerBasicTransitions(registry)
  const renderer = registry.getRenderer('fade')
  expect(renderer?.renderCanvas).toBeDefined()

  const ctx = new RecordingContext()
  const left = { width: 640, height: 360 }
  const right = { width: 640, height: 360 }
  renderer!.renderCanvas!(
    ctx as unknown as OffscreenCanvasRenderingContext2D,
    left as unknown as OffscreenCanvas,
    right as unknown as OffscreenCanvas,
    progress,
    undefined,
    { width: 640, height: 360 },
  )

  const drawsFor = (source: unknown) => ctx.draws.filter((draw) => draw.source === source)
  return { ctx, left, right, drawsFor }
}

describe('fade renderCanvas (equal-power crossfade)', () => {
  it('draws both clips at half weight at the midpoint instead of dipping to black', () => {
    const { drawsFor, left, right } = renderFadeAt(0.5)

    const outgoing = drawsFor(left)
    const incoming = drawsFor(right)
    expect(outgoing).toHaveLength(1)
    expect(incoming).toHaveLength(1)
    expect(outgoing[0]!.alpha).toBeCloseTo(0.5, 5)
    expect(incoming[0]!.alpha).toBeCloseTo(0.5, 5)
  })

  it('weights follow the export path cos²/sin² curve, summing to 1 at every progress', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const { drawsFor, left, right } = renderFadeAt(p)
      const c = Math.cos((p * Math.PI) / 2)
      expect(drawsFor(left)[0]!.alpha).toBeCloseTo(c * c, 5)
      expect(drawsFor(right)[0]!.alpha).toBeCloseTo(1 - c * c, 5)
    }
  })

  it('shows exactly the outgoing clip at progress 0 and the incoming clip at progress 1', () => {
    const start = renderFadeAt(0)
    expect(start.drawsFor(start.left)[0]!.alpha).toBeCloseTo(1, 5)

    const end = renderFadeAt(1)
    expect(end.drawsFor(end.right)[0]!.alpha).toBeCloseTo(1, 5)
    const lingeringOutgoing = end.drawsFor(end.left)
    if (lingeringOutgoing.length > 0) {
      expect(lingeringOutgoing[0]!.alpha).toBeCloseTo(0, 5)
    }
  })

  it('composites the outgoing clip additively with no black underfill', () => {
    const { ctx, drawsFor, left } = renderFadeAt(0.5)

    expect(ctx.fills).toHaveLength(0)
    expect(drawsFor(left)[0]!.composite).toBe('lighter')
  })

  it('applies the legacy 4% scale drift from the export path', () => {
    const start = renderFadeAt(0)
    expect(start.drawsFor(start.left)[0]!.scale).toBeCloseTo(1, 5)
    expect(start.drawsFor(start.right)[0]!.scale).toBeCloseTo(1.04, 5)

    const end = renderFadeAt(1)
    expect(end.drawsFor(end.right)[0]!.scale).toBeCloseTo(1, 5)
  })
})

describe('fade definition', () => {
  it('describes a crossfade, not a dip through black', () => {
    const registry = new TransitionRegistry()
    registerBasicTransitions(registry)
    const definition = registry.getDefinition('fade')
    expect(definition?.description).not.toMatch(/dip/i)
    expect(definition?.description).toMatch(/crossfade/i)
  })
})
