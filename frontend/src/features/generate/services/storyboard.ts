/**
 * The storyboard, as LTX Studio's and the competitors' script-to-shots flow: a script is split into shots, each
 * shot gets a frame from a picture model and a clip from a video model that starts on that frame, and the
 * clips land one after another on the timeline. This module fills a model's form for one shot by what each
 * field means.
 */

import type { Field, MediaRef } from './generate-api'

export interface Shot {
  id: string
  prompt: string
  seconds: number
  imageJob: string | null
  videoJob: string | null
}

export interface Storyboard {
  script: string
  shots: Shot[]
}

export interface ShotInput {
  prompt: string
  seconds?: number
  firstFrame?: MediaRef
  /** The project's frame as "w:h", for a model that asks for an aspect ratio. */
  aspect?: string
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** The project's frame as an aspect ratio, "16:9" for 1920x1080. */
export function aspectOf(width: number, height: number): string {
  const divisor = gcd(width, height) || 1
  return `${width / divisor}:${height / divisor}`
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
}

/** The model's own duration closest to the shot's seconds, taking the longer one on a tie. */
function durationValue(field: Field, seconds: number): unknown {
  if (field.type === 'select') {
    const options = field.options.filter((option) => Number.isFinite(numberOf(option.value)))
    if (options.length === 0) return undefined
    return options.reduce((best, option) => {
      const gap = Math.abs(numberOf(option.value) - seconds)
      const bestGap = Math.abs(numberOf(best.value) - seconds)
      return gap < bestGap || (gap === bestGap && numberOf(option.value) > numberOf(best.value))
        ? option
        : best
    }).value
  }
  if (field.type === 'integer' || field.type === 'number') {
    const clamped = Math.min(field.max ?? seconds, Math.max(field.min ?? seconds, seconds))
    return field.type === 'integer' ? Math.round(clamped) : clamped
  }
  return undefined
}

/** A shot's values for a model's form: its prompt, its length, its first frame and the project's aspect ratio. */
export function shotValues(fields: Field[], shot: ShotInput): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.role === 'prompt' && values[field.key] === undefined) values[field.key] = shot.prompt
    if (field.role === 'duration' && shot.seconds !== undefined) {
      const value = durationValue(field, shot.seconds)
      if (value !== undefined) values[field.key] = value
    }
    if (field.role === 'first_frame' && shot.firstFrame) values[field.key] = [shot.firstFrame]
    if (
      field.role === 'aspect' &&
      shot.aspect &&
      field.type === 'select' &&
      field.options.some((option) => option.value === shot.aspect)
    ) {
      values[field.key] = shot.aspect
    }
  }
  return values
}

/** How long a run with these values is, by the model's duration field; the shot's own seconds without one. */
export function sentSeconds(
  fields: Field[],
  values: Record<string, unknown>,
  fallback: number,
): number {
  const field = fields.find((each) => each.role === 'duration')
  const seconds = field ? numberOf(values[field.key] ?? field.default) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback
}
