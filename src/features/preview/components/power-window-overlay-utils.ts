import type { ItemEffect } from '@/types/effects'
import type { Point } from '../types/gizmo'
import { clampFinite as clamp } from '@/shared/utils/math'
import { rotatePoint } from '../utils/coordinate-transform'

export type PowerWindowHandle = 'center' | 'east' | 'west' | 'north' | 'south' | 'rotation'

export interface PowerWindowParams {
  shape: string
  centerX: number
  centerY: number
  sizeX: number
  sizeY: number
  rotation: number
}

export interface PowerWindowDragState {
  handle: PowerWindowHandle
  startParams: PowerWindowParams
  startUv: Point
}

interface PowerWindowDragOptions {
  canvasAspectRatio?: number
  snapRotation?: boolean
}

const MIN_WINDOW_SIZE = 0.02
const MAX_WINDOW_SIZE = 1.5

export function readPowerWindowParams(effect: ItemEffect): PowerWindowParams | null {
  if (effect.effect.type !== 'gpu-effect' || effect.effect.gpuEffectType !== 'gpu-power-window') {
    return null
  }
  const params = effect.effect.params
  return {
    shape: typeof params.shape === 'string' ? params.shape : 'ellipse',
    centerX: readNumber(params.centerX, 0.5),
    centerY: readNumber(params.centerY, 0.5),
    sizeX: readNumber(params.sizeX, 0.5),
    sizeY: readNumber(params.sizeY, 0.5),
    rotation: readNumber(params.rotation, 0),
  }
}

export function clampPowerWindowParams(params: PowerWindowParams): PowerWindowParams {
  return {
    ...params,
    centerX: clamp(params.centerX, 0, 1),
    centerY: clamp(params.centerY, 0, 1),
    sizeX: clamp(params.sizeX, MIN_WINDOW_SIZE, MAX_WINDOW_SIZE),
    sizeY: clamp(params.sizeY, MIN_WINDOW_SIZE, MAX_WINDOW_SIZE),
  }
}

export function derivePowerWindowDragParams(
  drag: PowerWindowDragState,
  currentUv: Point,
  options: PowerWindowDragOptions = {},
): PowerWindowParams {
  const next: PowerWindowParams = { ...drag.startParams }
  if (drag.handle === 'center') {
    next.centerX = drag.startParams.centerX + currentUv.x - drag.startUv.x
    next.centerY = drag.startParams.centerY + currentUv.y - drag.startUv.y
    return clampPowerWindowParams(next)
  }

  const center = { x: drag.startParams.centerX, y: drag.startParams.centerY }
  const canvasAspectRatio = resolveCanvasAspectRatio(options.canvasAspectRatio)
  if (drag.handle === 'rotation') {
    const startAngle = getPointerAngle(drag.startUv, center, canvasAspectRatio)
    const currentAngle = getPointerAngle(currentUv, center, canvasAspectRatio)
    const delta = normalizeAngle(currentAngle - startAngle)
    const rotation = normalizeAngle(drag.startParams.rotation + delta)
    next.rotation = options.snapRotation ? Math.round(rotation / 15) * 15 : rotation
    return clampPowerWindowParams(next)
  }

  const local = rotateCanvasUvPoint(
    currentUv,
    center,
    -drag.startParams.rotation,
    canvasAspectRatio,
  )
  if (drag.handle === 'east' || drag.handle === 'west') {
    next.sizeX = Math.abs(local.x - center.x) * 2
  }
  if (drag.handle === 'north' || drag.handle === 'south') {
    next.sizeY = Math.abs(local.y - center.y) * 2
  }
  return clampPowerWindowParams(next)
}

export function buildPowerWindowEffects(
  effects: readonly ItemEffect[],
  effectId: string,
  params: PowerWindowParams,
  paramKeys: readonly (keyof PowerWindowParams)[] = [
    'shape',
    'centerX',
    'centerY',
    'sizeX',
    'sizeY',
    'rotation',
  ],
): ItemEffect[] {
  return effects.map((entry) => {
    if (entry.id !== effectId || entry.effect.type !== 'gpu-effect') return entry
    return {
      ...entry,
      effect: {
        ...entry.effect,
        params: {
          ...entry.effect.params,
          ...(paramKeys.includes('shape') ? { shape: params.shape } : {}),
          ...(paramKeys.includes('centerX') ? { centerX: params.centerX } : {}),
          ...(paramKeys.includes('centerY') ? { centerY: params.centerY } : {}),
          ...(paramKeys.includes('sizeX') ? { sizeX: params.sizeX } : {}),
          ...(paramKeys.includes('sizeY') ? { sizeY: params.sizeY } : {}),
          ...(paramKeys.includes('rotation') ? { rotation: params.rotation } : {}),
        },
      },
    }
  })
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getPointerAngle(point: Point, center: Point, aspectRatio: number): number {
  return (Math.atan2(point.y - center.y, (point.x - center.x) * aspectRatio) * 180) / Math.PI
}

function normalizeAngle(angle: number): number {
  let normalized = angle % 360
  if (normalized > 180) normalized -= 360
  if (normalized <= -180) normalized += 360
  return normalized
}

function resolveCanvasAspectRatio(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

function rotateCanvasUvPoint(
  point: Point,
  center: Point,
  angleDegrees: number,
  aspectRatio: number,
): Point {
  const scaledCenter = { x: center.x * aspectRatio, y: center.y }
  const rotated = rotatePoint({ x: point.x * aspectRatio, y: point.y }, scaledCenter, angleDegrees)
  return { x: rotated.x / aspectRatio, y: rotated.y }
}
