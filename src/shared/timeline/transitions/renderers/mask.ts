/**
 * Mask Transition Renderers
 *
 * Includes: clockWipe, iris
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionDefinition } from '@/types/transition'

const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getIrisMaxRadius(width: number, height: number): number {
  return Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2)) * 1.2
}

// ============================================================================
// Clock Wipe
// ============================================================================

export const clockWipeRenderer: TransitionRenderer = {
  gpuTransitionId: 'clockWipe',
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const centerX = w / 2
    const centerY = h / 2
    const radius = Math.sqrt(w * w + h * h)
    const startAngle = -Math.PI / 2
    const sweepAngle = p * Math.PI * 2
    const currentAngle = startAngle + sweepAngle

    ctx.save()
    ctx.globalAlpha = 0.85 + 0.15 * p
    ctx.drawImage(rightCanvas, 0, 0, w, h)
    ctx.restore()

    ctx.save()
    const clipPath = new Path2D()
    clipPath.moveTo(centerX, centerY)
    clipPath.arc(centerX, centerY, radius, currentAngle, startAngle + Math.PI * 2, false)
    clipPath.closePath()
    ctx.clip(clipPath)
    ctx.globalAlpha = 1 - 0.1 * p
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.restore()
  },
}

export const clockWipeDef: TransitionDefinition = {
  id: 'clockWipe',
  label: 'Clock Wipe',
  description: 'Circular wipe like a clock hand',
  category: 'wipe',
  icon: 'Clock',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
  parameters: [
    {
      key: 'edgeSoftness',
      label: 'Softness',
      type: 'number',
      defaultValue: 8,
      min: 0,
      max: 32,
      step: 0.5,
      unit: 'px',
      description: 'Clock hand edge feather',
    },
  ],
}

// ============================================================================
// Iris
// ============================================================================

const irisRenderer: TransitionRenderer = {
  gpuTransitionId: 'iris',
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const maxRadius = getIrisMaxRadius(w, h)
    const radius = p * maxRadius
    const centerX = w / 2
    const centerY = h / 2

    ctx.save()
    ctx.globalAlpha = 0.85 + 0.15 * p
    ctx.drawImage(rightCanvas, 0, 0, w, h)
    ctx.restore()

    ctx.save()
    const clipPath = new Path2D()
    clipPath.rect(0, 0, w, h)
    clipPath.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.clip(clipPath, 'evenodd')
    ctx.globalAlpha = 1 - 0.1 * p
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.restore()
  },
}

const irisDef: TransitionDefinition = {
  id: 'iris',
  label: 'Iris',
  description: 'Circular iris expanding/contracting',
  category: 'iris',
  icon: 'Circle',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
  parameters: [
    {
      key: 'edgeSoftness',
      label: 'Softness',
      type: 'number',
      defaultValue: 6,
      min: 0,
      max: 32,
      step: 0.5,
      unit: 'px',
      description: 'Iris edge feather',
    },
  ],
}

// ============================================================================
// Registration
// ============================================================================

export function registerMaskTransitions(registry: TransitionRegistry): void {
  if (!registry.has('clockWipe')) {
    registry.register('clockWipe', clockWipeDef, clockWipeRenderer)
  }
  registry.register('iris', irisDef, irisRenderer)
}
