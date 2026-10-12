/**
 * Flip Transition Renderers
 *
 * Includes: flip
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionDefinition, FlipDirection } from '@/types/transition'

const ALL_DIRECTIONS: FlipDirection[] = ['from-left', 'from-right', 'from-top', 'from-bottom']
const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const

// ============================================================================
// Flip
// ============================================================================

const flipRenderer: TransitionRenderer = {
  gpuTransitionId: 'flip',
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = Math.max(0, Math.min(1, progress))
    const dir = (direction as FlipDirection) || 'from-left'
    const isHorizontal = dir === 'from-left' || dir === 'from-right'
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const midpoint = 0.5

    if (p < midpoint) {
      const flipProgress = p / midpoint
      const scale = Math.cos((flipProgress * Math.PI) / 2)
      ctx.save()
      ctx.translate(w / 2, h / 2)
      if (isHorizontal) {
        ctx.scale(scale, 1)
      } else {
        ctx.scale(1, scale)
      }
      ctx.translate(-w / 2, -h / 2)
      ctx.drawImage(leftCanvas, 0, 0)
      ctx.restore()
    } else {
      const flipProgress = (p - midpoint) / midpoint
      const scale = Math.sin((flipProgress * Math.PI) / 2)
      ctx.save()
      ctx.translate(w / 2, h / 2)
      if (isHorizontal) {
        ctx.scale(scale, 1)
      } else {
        ctx.scale(1, scale)
      }
      ctx.translate(-w / 2, -h / 2)
      ctx.drawImage(rightCanvas, 0, 0)
      ctx.restore()
    }
  },
}

const flipDef: TransitionDefinition = {
  id: 'flip',
  label: 'Flip',
  description: '3D flip transition',
  category: 'custom',
  icon: 'FlipHorizontal',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 60,
}

// ============================================================================
// Registration
// ============================================================================

export function registerFlipTransitions(registry: TransitionRegistry): void {
  registry.register('flip', flipDef, flipRenderer)
}
