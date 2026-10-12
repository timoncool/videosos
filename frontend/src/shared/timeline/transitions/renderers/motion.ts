/**
 * Motion Transition Renderers
 *
 * Includes shape-split reveals that complement the directional Push and Slide
 * transitions registered by the existing slide/wipe renderers.
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionDefinition } from '@/types/transition'

const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const

type MotionMask = 'barnDoor' | 'split'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function addOutgoingMaskPath(
  path: Path2D,
  kind: MotionMask,
  width: number,
  height: number,
  progress: number,
): void {
  const p = clamp01(progress)
  const centerX = width / 2
  const centerY = height / 2

  if (kind === 'barnDoor') {
    const panelWidth = Math.max(0, centerX * (1 - p))
    path.rect(0, 0, panelWidth, height)
    path.rect(width - panelWidth, 0, panelWidth, height)
    return
  }

  const panelWidth = Math.max(0, centerX * (1 - p))
  const panelHeight = Math.max(0, centerY * (1 - p))
  path.rect(0, 0, panelWidth, panelHeight)
  path.rect(width - panelWidth, 0, panelWidth, panelHeight)
  path.rect(0, height - panelHeight, panelWidth, panelHeight)
  path.rect(width - panelWidth, height - panelHeight, panelWidth, panelHeight)
}

function createMotionMaskRenderer(kind: MotionMask): TransitionRenderer {
  return {
    renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
      const p = clamp01(progress)
      const w = canvas?.width ?? leftCanvas.width
      const h = canvas?.height ?? leftCanvas.height

      ctx.drawImage(rightCanvas, 0, 0, w, h)

      ctx.save()
      const clipPath = new Path2D()
      addOutgoingMaskPath(clipPath, kind, w, h, p)
      ctx.clip(clipPath)
      ctx.drawImage(leftCanvas, 0, 0, w, h)
      ctx.restore()
    },
  }
}

const barnDoorDef: TransitionDefinition = {
  id: 'barnDoor',
  label: 'Barn Door',
  description: 'Center-opening two-panel reveal',
  category: 'motion',
  icon: 'Columns2',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

const splitDef: TransitionDefinition = {
  id: 'split',
  label: 'Split',
  description: 'Four-panel split reveal',
  category: 'motion',
  icon: 'SplitSquareVertical',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

export function registerMotionTransitions(registry: TransitionRegistry): void {
  registry.register('barnDoor', barnDoorDef, createMotionMaskRenderer('barnDoor'))
  registry.register('split', splitDef, createMotionMaskRenderer('split'))
}
