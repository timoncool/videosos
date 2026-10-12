/**
 * Wipe Transition Renderers
 *
 * Includes the legacy directional wipe (shown as Motion / Slide) plus
 * DaVinci-style Wipe category variants.
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionDefinition, WipeDirection } from '@/types/transition'
import { clockWipeDef, clockWipeRenderer } from './mask'

const ALL_DIRECTIONS: WipeDirection[] = ['from-left', 'from-right', 'from-top', 'from-bottom']
const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const

type WipeMask = 'band' | 'center' | 'edge' | 'radial' | 'spiral' | 'venetianBlind' | 'x'

interface WipeVariant {
  id: string
  label: string
  description: string
  icon: string
  mask: WipeMask
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  }
}

function getSpiralStrokeWidth(width: number, height: number, progress: number): number {
  const p = clamp01(progress)
  if (p === 0) return 0
  const spacing = (Math.sqrt(width * width + height * height) * 0.58) / 3.8
  return Math.max(0, spacing * (0.04 + p * 1.25))
}

function getXStrokeWidth(width: number, height: number, progress: number): number {
  return Math.sqrt(width * width + height * height) * clamp01(progress) * 0.36
}

function addRadialFanPath(path: Path2D, width: number, height: number, progress: number): void {
  const p = clamp01(progress)
  if (p <= 0) {
    path.rect(0, 0, width, height)
    return
  }
  if (p >= 1) return

  const cx = width / 2
  const cy = height / 2
  const radius = Math.sqrt(width * width + height * height)
  const segmentCount = 4
  const segmentAngle = (Math.PI * 2) / segmentCount

  for (let index = 0; index < segmentCount; index += 1) {
    const segmentStart = -Math.PI / 2 + index * segmentAngle
    const startAngle = segmentStart + p * segmentAngle
    const endAngle = segmentStart + segmentAngle
    const start = polarPoint(cx, cy, radius, startAngle)
    path.moveTo(cx, cy)
    path.lineTo(start.x, start.y)
    path.arc(cx, cy, radius, startAngle, endAngle)
    path.closePath()
  }
}

function drawSpiralCutout(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
): void {
  const cx = width / 2
  const cy = height / 2
  const maxRadius = Math.sqrt(width * width + height * height) * 0.58
  const turns = 3.8
  const steps = 220

  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = getSpiralStrokeWidth(width, height, progress)
  ctx.beginPath()
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const angle = t * Math.PI * 2 * turns
    const radius = maxRadius * t
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

function drawXCutout(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'butt'
  ctx.lineWidth = getXStrokeWidth(width, height, progress)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(width, height)
  ctx.moveTo(width, 0)
  ctx.lineTo(0, height)
  ctx.stroke()
  ctx.restore()
}

function addOutgoingMaskPath(
  path: Path2D,
  kind: WipeMask,
  width: number,
  height: number,
  progress: number,
  direction: WipeDirection = 'from-top',
): CanvasFillRule | undefined {
  const p = clamp01(progress)

  if (kind === 'band') {
    const stripeCount = 10
    const stripeHeight = height / stripeCount
    for (let index = 0; index < stripeCount; index += 1) {
      const stagger = (index % 2) * 0.18
      const local = clamp01((p - stagger) / Math.max(0.2, 1 - stagger))
      const revealWidth = width * local
      if (index % 2 === 0) {
        path.rect(revealWidth, index * stripeHeight, width - revealWidth, stripeHeight)
      } else {
        path.rect(0, index * stripeHeight, width - revealWidth, stripeHeight)
      }
    }
    return undefined
  }

  if (kind === 'venetianBlind') {
    const stripeCount = 10
    const stripeHeight = height / stripeCount
    for (let index = 0; index < stripeCount; index += 1) {
      const y = index * stripeHeight
      path.rect(0, y, width, stripeHeight * (1 - p))
    }
    return undefined
  }

  if (kind === 'center') {
    const sideWidth = (width / 2) * (1 - p)
    path.rect(0, 0, sideWidth, height)
    path.rect(width - sideWidth, 0, sideWidth, height)
    return undefined
  }

  if (kind === 'edge') {
    switch (direction) {
      case 'from-left':
        path.rect(width * p, 0, width * (1 - p), height)
        break
      case 'from-right':
        path.rect(0, 0, width * (1 - p), height)
        break
      case 'from-bottom':
        path.rect(0, 0, width, height * (1 - p))
        break
      case 'from-top':
      default:
        path.rect(0, height * p, width, height * (1 - p))
        break
    }
    return undefined
  }

  if (kind === 'radial') {
    addRadialFanPath(path, width, height, p)
    return undefined
  }

  if (kind === 'spiral') return undefined

  const insetX = (width / 2) * p
  const insetY = (height / 2) * p
  path.moveTo(0, 0)
  path.lineTo(insetX, 0)
  path.lineTo(0, insetY)
  path.closePath()
  path.moveTo(width, 0)
  path.lineTo(width - insetX, 0)
  path.lineTo(width, insetY)
  path.closePath()
  path.moveTo(0, height)
  path.lineTo(insetX, height)
  path.lineTo(0, height - insetY)
  path.closePath()
  path.moveTo(width, height)
  path.lineTo(width - insetX, height)
  path.lineTo(width, height - insetY)
  path.closePath()
  return undefined
}

function createWipeMaskRenderer(kind: WipeMask): TransitionRenderer {
  let scratchCanvas: OffscreenCanvas | null = null
  let scratchCtx: OffscreenCanvasRenderingContext2D | null = null

  function getScratchContext(
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
    if (!scratchCanvas || scratchCanvas.width !== width || scratchCanvas.height !== height) {
      scratchCanvas = new OffscreenCanvas(width, height)
      scratchCtx = scratchCanvas.getContext('2d')
    }
    if (!scratchCtx) return null
    scratchCtx.clearRect(0, 0, width, height)
    return { canvas: scratchCanvas, ctx: scratchCtx }
  }

  return {
    renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
      const p = clamp01(progress)
      const dir = (direction as WipeDirection) || 'from-top'
      const w = canvas?.width ?? leftCanvas.width
      const h = canvas?.height ?? leftCanvas.height

      ctx.drawImage(rightCanvas, 0, 0, w, h)

      if (kind === 'spiral') {
        const scratch = getScratchContext(w, h)
        if (!scratch) {
          return
        }

        scratch.ctx.drawImage(leftCanvas, 0, 0, w, h)
        drawSpiralCutout(scratch.ctx, w, h, p)
        ctx.drawImage(scratch.canvas, 0, 0)
        return
      }

      if (kind === 'x') {
        const scratch = getScratchContext(w, h)
        if (!scratch) {
          return
        }

        scratch.ctx.drawImage(leftCanvas, 0, 0, w, h)
        drawXCutout(scratch.ctx, w, h, p)
        ctx.drawImage(scratch.canvas, 0, 0)
        return
      }

      ctx.save()
      const clipPath = new Path2D()
      const fillRule = addOutgoingMaskPath(clipPath, kind, w, h, p, dir)
      if (fillRule) {
        ctx.clip(clipPath, fillRule)
      } else {
        ctx.clip(clipPath)
      }
      ctx.drawImage(leftCanvas, 0, 0, w, h)
      ctx.restore()
    },
  }
}

const wipeRenderer: TransitionRenderer = {
  gpuTransitionId: 'wipe',
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = clamp01(progress)
    const dir = (direction as WipeDirection) || 'from-left'
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height

    const outgoingPath = new Path2D()
    const incomingPath = new Path2D()
    switch (dir) {
      case 'from-left':
        incomingPath.rect(0, 0, p * w, h)
        outgoingPath.rect(p * w, 0, w, h)
        break
      case 'from-right':
        incomingPath.rect((1 - p) * w, 0, w, h)
        outgoingPath.rect(0, 0, (1 - p) * w, h)
        break
      case 'from-top':
        incomingPath.rect(0, 0, w, p * h)
        outgoingPath.rect(0, p * h, w, h)
        break
      case 'from-bottom':
        incomingPath.rect(0, (1 - p) * h, w, h)
        outgoingPath.rect(0, 0, w, (1 - p) * h)
        break
    }

    ctx.save()
    ctx.clip(incomingPath)
    ctx.drawImage(rightCanvas, 0, 0)
    ctx.restore()

    ctx.save()
    ctx.clip(outgoingPath)
    ctx.drawImage(leftCanvas, 0, 0)
    ctx.restore()
  },
}

const wipeDef: TransitionDefinition = {
  id: 'wipe',
  label: 'Slide',
  description: 'Slide reveal from one direction',
  category: 'motion',
  icon: 'ArrowRight',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

const WIPE_VARIANTS: WipeVariant[] = [
  {
    id: 'bandWipe',
    label: 'Band Wipe',
    description: 'Alternating band wipe reveal',
    icon: 'Rows3',
    mask: 'band',
  },
  {
    id: 'centerWipe',
    label: 'Center Wipe',
    description: 'Center-opening wipe reveal',
    icon: 'Columns2',
    mask: 'center',
  },
  {
    id: 'edgeWipe',
    label: 'Edge Wipe',
    description: 'Single-edge wipe reveal',
    icon: 'PanelTopOpen',
    mask: 'edge',
  },
  {
    id: 'radialWipe',
    label: 'Radial Wipe',
    description: 'Radial wedge wipe reveal',
    icon: 'Asterisk',
    mask: 'radial',
  },
  {
    id: 'spiralWipe',
    label: 'Spiral Wipe',
    description: 'Spiral-style rotating wipe reveal',
    icon: 'RotateCw',
    mask: 'spiral',
  },
  {
    id: 'venetianBlindWipe',
    label: 'Venetian Blind Wipe',
    description: 'Horizontal blind wipe reveal',
    icon: 'Rows4',
    mask: 'venetianBlind',
  },
  {
    id: 'xWipe',
    label: 'X Wipe',
    description: 'X-shaped wipe reveal',
    icon: 'X',
    mask: 'x',
  },
]

function createWipeDefinition(variant: WipeVariant): TransitionDefinition {
  const hasDirection = variant.id === 'edgeWipe'
  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    category: 'wipe',
    icon: variant.icon,
    hasDirection,
    directions: hasDirection ? ALL_DIRECTIONS : undefined,
    supportedTimings: [...ALL_TIMINGS],
    defaultDuration: 30,
    minDuration: 5,
    maxDuration: 90,
  }
}

export function registerWipeTransitions(registry: TransitionRegistry): void {
  registry.register('wipe', wipeDef, wipeRenderer)
  for (const variant of WIPE_VARIANTS) {
    registry.register(
      variant.id,
      createWipeDefinition(variant),
      createWipeMaskRenderer(variant.mask),
    )
    if (variant.id === 'centerWipe') {
      registry.register('clockWipe', clockWipeDef, clockWipeRenderer)
    }
  }
}
