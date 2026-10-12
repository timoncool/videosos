/**
 * Basic Transition Renderers
 *
 * Includes: fade
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionDefinition } from '@/types/transition'

// ============================================================================
// Fade
// ============================================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// cos²/sin² weights — always sum to 1, preserving alpha for soft crop & masks.
// Mirrors the export path's legacy fade (canvas-transitions.ts) so registering
// this renderer does not change export output; the dip-through-black look
// lives on as the `dipToColorDissolve` preset.
function fadeWeight(progress: number, isOutgoing: boolean): number {
  const c = Math.cos((progress * Math.PI) / 2)
  return isOutgoing ? c * c : 1 - c * c
}

function fadeScale(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return 1 - 0.04 * progress
  }
  return 1.04 - 0.04 * progress
}

function drawFadeParticipant(
  ctx: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
  width: number,
  height: number,
  scale: number,
  alpha: number,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(width / 2, height / 2)
  ctx.scale(scale, scale)
  ctx.translate(-width / 2, -height / 2)
  ctx.drawImage(source, 0, 0)
  ctx.restore()
}

const fadeRenderer: TransitionRenderer = {
  gpuTransitionId: 'fade',
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? Math.max(leftCanvas.width, rightCanvas.width)
    const h = canvas?.height ?? Math.max(leftCanvas.height, rightCanvas.height)

    ctx.save()
    ctx.globalCompositeOperation = 'copy'
    drawFadeParticipant(ctx, rightCanvas, w, h, fadeScale(p, false), fadeWeight(p, false))

    ctx.globalCompositeOperation = 'lighter'
    drawFadeParticipant(ctx, leftCanvas, w, h, fadeScale(p, true), fadeWeight(p, true))
    ctx.restore()
  },
}

const fadeDef: TransitionDefinition = {
  id: 'fade',
  label: 'Fade',
  description: 'Equal-power crossfade between clips',
  category: 'basic',
  icon: 'Blend',
  hasDirection: false,
  supportedTimings: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

// ============================================================================
// Registration
// ============================================================================

export function registerBasicTransitions(registry: TransitionRegistry): void {
  registry.register('fade', fadeDef, fadeRenderer)
}
