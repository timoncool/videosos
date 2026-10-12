/**
 * WASM-free discovery of a Lottie's editable *value* slots — the numeric
 * (`scalar`) and 2D (`vector`) entries of its top-level `slots` table. Unlike
 * colors and text (which we bake into the animation JSON), these are applied at
 * render time through dotlottie-web's native slot setters (`setScalarSlot` /
 * `setVectorSlot`), the only reliable path for them. Color, gradient and text
 * slots are handled elsewhere (see `lottie-color` / `lottie-text`) and skipped
 * here.
 *
 * Slot type is inferred from the default value's shape: a number is a scalar; a
 * length-2 number array is a vector. Length 3–4 arrays (RGB/RGBA colors) and
 * object values (gradients/text documents) are intentionally left out so a color
 * slot is never mistaken for a vector.
 */

import { parseLottieJsonObject as parseJson } from './lottie-json'

/** A scalar (single number) or 2D vector value carried by a value slot. */
export type LottieSlotValue = number | [number, number]

interface LottieSlotBase {
  /** Slot id, addressing the override (`setScalarSlot`/`setVectorSlot`). */
  id: string
  /** Human-readable label (the slot's name, or its id). */
  label: string
}
/** An editable single-number slot (opacity, rotation, stroke width, …). */
export interface LottieScalarSlot extends LottieSlotBase {
  type: 'scalar'
  /** Current default value (static, or the first keyframe of an animated slot). */
  value: number
}
/** An editable 2D slot (position, scale, size, …). */
export interface LottieVectorSlot extends LottieSlotBase {
  type: 'vector'
  /** Current default `[x, y]` (static, or the first keyframe if animated). */
  value: [number, number]
}
/** An editable numeric/2D slot discovered in a Lottie animation. */
export type LottieValueSlot = LottieScalarSlot | LottieVectorSlot

interface SlotProp {
  a?: unknown
  k?: unknown
}
interface SlotDef {
  p?: SlotProp
  nm?: unknown
}

function isVec2(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
}

/** The static value of a slot property, resolving the first keyframe if animated. */
function slotStaticValue(p: SlotProp | undefined): unknown {
  if (!p || typeof p !== 'object') return undefined
  if (p.a === 1) {
    const first = Array.isArray(p.k) ? (p.k[0] as { s?: unknown } | undefined) : undefined
    return first?.s
  }
  return p.k
}

function trimmedName(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

/**
 * List the editable scalar/vector value slots of a Lottie animation object,
 * keyed by slot id. Returns an empty array for animations with no such slots or
 * for unparseable input.
 */
export function extractLottieValueSlots(json: unknown): LottieValueSlot[] {
  const data = parseJson(json)
  const slots = data?.slots
  if (!slots || typeof slots !== 'object') return []

  const result: LottieValueSlot[] = []
  for (const [id, def] of Object.entries(slots as Record<string, SlotDef>)) {
    const value = slotStaticValue(def?.p)
    const label = trimmedName(def?.nm) || id
    if (typeof value === 'number') {
      result.push({ id, type: 'scalar', label, value })
    } else if (isVec2(value)) {
      result.push({ id, type: 'vector', label, value: [value[0], value[1]] })
    }
    // Colors (len 3–4), gradients and text (objects) are handled elsewhere.
  }
  return result
}
