/**
 * WASM-free helpers for reading and overriding shape colors in a Lottie
 * animation object. Covers solid fills (`ty:'fl'`) and strokes (`ty:'st'`),
 * static (`c.a !== 1`) or animated (`c.a === 1`; overriding freezes every
 * keyframe to the chosen color). Gradients (`gf`/`gs`) are intentionally not
 * edited inline — themeable gradients are recolored through their color slots
 * instead, which is the author-intended and renderer-reliable path.
 * Colors are normalized `[r, g, b]` floats. Shapes nest inside group shapes
 * (`ty:'gr'`, `item.it`), which are walked recursively. Author-defined color
 * *slots* (the canonical theming mechanism — a top-level `slots` table
 * referenced by `sid`) are also surfaced and patched (keyed `s:<id>`). Kept
 * separate from the dotlottie renderer so import/editing can inspect and patch
 * colors without the WASM.
 *
 * Callers pass an already-parsed animation object (see
 * `extractLottieAnimation` / `fetchLottieAnimation`, which handle `.json` and
 * `.lottie` archives). Extraction and patching walk in the same deterministic
 * order so ordinal keys (`c0`, `c1`, …) stay aligned. Animated gradients are out
 * of scope.
 */

import { parseLottieJsonObject as parseJson } from './lottie-json'

/** A single editable color discovered in a Lottie animation. */
export interface LottieColorLayer {
  /** Stable ordinal key (document-order index of the color) addressing the override. */
  key: string
  /** Current color as `#rrggbb`. */
  color: string
  /** Human-readable label (shape/layer name, or a positional fallback). */
  label: string
  /**
   * Whether `label` is an author-given name (a color slot, or a shape with its
   * own `nm`) rather than a generated fallback like `Fill`/`Stroke`. Named
   * colors are the template's intended customization points; the UI surfaces
   * them first and tucks the rest away.
   */
  named: boolean
}

type Rgb = [number, number, number]

/** A color the traversal can read and rewrite in place. */
interface ColorSlot {
  read: () => Rgb
  write: (rgb: Rgb) => void
  label: string
  /** True when `label` is the shape's own `nm` (not a generated fallback). */
  named: boolean
}

interface AnimatedValue {
  a?: unknown
  k?: unknown
  /** Slot reference — when set, the value is themed via the top-level `slots` table. */
  sid?: unknown
}
interface LottieShapeItem {
  ty?: unknown
  nm?: unknown
  c?: AnimatedValue // solid fill/stroke color
  it?: unknown // group children
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function channelToHex(c: number): string {
  return Math.round(clamp01(c) * 255)
    .toString(16)
    .padStart(2, '0')
}

/** Normalized `[r, g, b]` floats (0..1) → `#rrggbb`. */
export function lottieRgbToHex(k: readonly number[]): string {
  return `#${channelToHex(k[0] ?? 0)}${channelToHex(k[1] ?? 0)}${channelToHex(k[2] ?? 0)}`
}

/** `#rrggbb` → normalized `[r, g, b]` floats (0..1), or null if malformed. */
export function hexToLottieRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1] ?? '', 16)
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

function isRgbArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 3 && typeof v[0] === 'number'
}

function trimmedName(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

// After Effects / Lottie editors auto-name every fill/stroke "Fill", "Fill 1",
// "Stroke 2", etc. Those defaults are noise, not author intent, so they don't
// count as a "named" (customization-point) color.
const GENERATED_COLOR_NAME = /^(fill|stroke)(\s+\d+)?$/i

/** True when `name` is a real author name rather than an editor-generated default. */
function isAuthorColorName(name: string): boolean {
  return name.length > 0 && !GENERATED_COLOR_NAME.test(name)
}

/**
 * The color slot of one fill/stroke shape item, or none for non-color/gradient
 * shapes. Solid fills/strokes contribute one slot (static or animated).
 */
function slotsForShapeItem(item: LottieShapeItem, label: string, named: boolean): ColorSlot[] {
  // Solid fill / stroke.
  if (item.ty === 'fl' || item.ty === 'st') {
    const c = item.c
    if (!c || typeof c !== 'object') return []
    // Slot-bound color: exposed/patched via the top-level `slots` table instead.
    if (typeof c.sid === 'string') return []
    if (c.a === 1) {
      // Animated color: read the first keyframe, write every keyframe's value.
      const keyframes = c.k
      if (!Array.isArray(keyframes) || !isRgbArray((keyframes[0] as { s?: unknown })?.s)) return []
      return [
        {
          label,
          named,
          read: () => {
            const s = (keyframes[0] as { s: number[] }).s
            return [s[0]!, s[1]!, s[2]!]
          },
          write: (rgb) => {
            for (const kf of keyframes as Array<{ s?: unknown; e?: unknown }>) {
              if (isRgbArray(kf.s)) [kf.s[0], kf.s[1], kf.s[2]] = rgb
              if (isRgbArray(kf.e)) [kf.e[0], kf.e[1], kf.e[2]] = rgb
            }
          },
        },
      ]
    }
    if (!isRgbArray(c.k)) return []
    const k = c.k
    return [
      {
        label,
        named,
        read: () => [k[0]!, k[1]!, k[2]!],
        write: (rgb) => {
          ;[k[0], k[1], k[2]] = rgb
        },
      },
    ]
  }

  return []
}

/**
 * Visit every editable color in the animation in a deterministic depth-first
 * order, assigning each a stable ordinal `key` (`c0`, `c1`, …). Shared by
 * extraction and patching so keys line up between the two passes.
 */
function walkColorSlots(
  data: Record<string, unknown> | null,
  visit: (slot: ColorSlot, key: string) => void,
): void {
  const layers = data?.layers
  if (!Array.isArray(layers)) return

  let ordinal = 0
  const walkShapes = (shapes: unknown, layerName: string) => {
    if (!Array.isArray(shapes)) return
    for (const raw of shapes) {
      const item = raw as LottieShapeItem
      if (item?.ty === 'gr' && Array.isArray(item.it)) {
        walkShapes(item.it, layerName)
        continue
      }
      const kind = item?.ty === 'st' ? 'Stroke' : 'Fill'
      const shapeName = trimmedName(item?.nm)
      const label = shapeName || (layerName ? `${layerName} ${kind}` : kind)
      for (const slot of slotsForShapeItem(item, label, isAuthorColorName(shapeName))) {
        visit(slot, `c${ordinal}`)
        ordinal += 1
      }
    }
  }

  for (const raw of layers) {
    const layer = raw as { shapes?: unknown; nm?: unknown }
    if (!Array.isArray(layer?.shapes)) continue
    walkShapes(layer.shapes, trimmedName(layer.nm))
  }
}

// --- Lottie slots (the canonical theming mechanism) --------------------------
// A themeable Lottie defines colors once in a top-level `slots` table and points
// shape colors at them via `sid`. Those colors have no inline `c.k`, so the
// tree-walk above skips them; we surface and patch them here instead, keyed
// `s:<slotId>`. On write we also bake the value into every referencing fill/
// stroke so the change renders regardless of whether the renderer resolves slots.

interface SlotDef {
  p?: AnimatedValue
  nm?: unknown
}

/** Read a slot property's color, whether static (`p.k`) or animated (`p.k[0].s`). */
function slotColorValue(p: AnimatedValue | undefined): Rgb | null {
  if (!p || typeof p !== 'object') return null
  if (p.a === 1) {
    const first = Array.isArray(p.k) ? (p.k[0] as { s?: unknown } | undefined) : undefined
    return isRgbArray(first?.s) ? [first!.s[0]!, first!.s[1]!, first!.s[2]!] : null
  }
  return isRgbArray(p.k) ? [p.k[0]!, p.k[1]!, p.k[2]!] : null
}

function slotColorLayers(data: Record<string, unknown>): LottieColorLayer[] {
  const slots = data.slots
  if (!slots || typeof slots !== 'object') return []
  const result: LottieColorLayer[] = []
  for (const [id, def] of Object.entries(slots as Record<string, SlotDef>)) {
    const rgb = slotColorValue(def?.p)
    if (!rgb) continue
    // A slot is an explicit author theming point — always treated as named.
    result.push({
      key: `s:${id}`,
      color: lottieRgbToHex(rgb),
      label: trimmedName(def?.nm) || id,
      named: true,
    })
  }
  return result
}

/** Visit every fill/stroke shape item in document order (for slot baking). */
function forEachShapeItem(
  data: Record<string, unknown>,
  fn: (item: LottieShapeItem) => void,
): void {
  const layers = data.layers
  if (!Array.isArray(layers)) return
  const walk = (shapes: unknown) => {
    if (!Array.isArray(shapes)) return
    for (const raw of shapes) {
      const item = raw as LottieShapeItem
      if (item?.ty === 'gr' && Array.isArray(item.it)) walk(item.it)
      else fn(item)
    }
  }
  for (const raw of layers) {
    const layer = raw as { shapes?: unknown }
    if (Array.isArray(layer?.shapes)) walk(layer.shapes)
  }
}

/** Patch a color slot's value and bake it into every fill/stroke that references it. */
function applyColorSlot(data: Record<string, unknown>, slotId: string, rgb: Rgb): boolean {
  let changed = false
  const slots = data.slots as Record<string, SlotDef> | undefined
  const p = slots?.[slotId]?.p
  if (p && typeof p === 'object') {
    if (p.a === 1 && Array.isArray(p.k)) {
      for (const kf of p.k as Array<{ s?: unknown }>) {
        if (isRgbArray(kf.s)) {
          ;[kf.s[0], kf.s[1], kf.s[2]] = rgb
          changed = true
        }
      }
    } else if (isRgbArray(p.k)) {
      ;[p.k[0], p.k[1], p.k[2]] = rgb
      changed = true
    } else {
      p.a = 0
      p.k = [rgb[0], rgb[1], rgb[2], 1]
      changed = true
    }
  }
  // Bake into referencing fills/strokes so non-slot-aware renderers show it too.
  forEachShapeItem(data, (item) => {
    if (item.ty !== 'fl' && item.ty !== 'st') return
    const c = item.c
    if (!c || typeof c !== 'object' || c.sid !== slotId) return
    if (isRgbArray(c.k)) [c.k[0], c.k[1], c.k[2]] = rgb
    else c.k = [rgb[0], rgb[1], rgb[2], 1]
    changed = true
  })
  return changed
}

/**
 * List the editable colors of a Lottie animation object. Author-defined color
 * slots come first (keyed `s:<id>`), then every inline shape color in document
 * order (keyed `c<n>`). Returns an empty array for non-shape or unparseable input.
 */
export function extractLottieColorLayers(json: unknown): LottieColorLayer[] {
  const data = parseJson(json)
  if (!data) return []
  const result: LottieColorLayer[] = slotColorLayers(data)
  walkColorSlots(data, (slot, key) => {
    result.push({ key, color: lottieRgbToHex(slot.read()), label: slot.label, named: slot.named })
  })
  return result
}

/**
 * Apply per-color overrides to a Lottie animation object and return the patched
 * JSON string. Overrides are keyed by the color's stable ordinal key (see
 * {@link extractLottieColorLayers}) with `#rrggbb` hex values; unknown or
 * malformed values are ignored. Returns null when the input can't be parsed or
 * nothing changes.
 */
export function applyLottieColorOverrides(
  json: unknown,
  overrides: Record<string, string>,
): string | null {
  const data = parseJson(json)
  if (!data) return null
  if (Object.keys(overrides).length === 0) return null

  let changed = false
  // Slot overrides (keyed `s:<id>`): patch the slot value + bake references.
  for (const [key, hex] of Object.entries(overrides)) {
    if (!key.startsWith('s:')) continue
    const rgb = hexToLottieRgb(hex)
    if (rgb && applyColorSlot(data, key.slice(2), rgb)) changed = true
  }
  // Inline shape overrides (keyed `c<n>`).
  walkColorSlots(data, (slot, key) => {
    const hex = overrides[key]
    if (hex === undefined) return
    const rgb = hexToLottieRgb(hex)
    if (!rgb) return
    slot.write(rgb)
    changed = true
  })

  return changed ? JSON.stringify(data) : null
}
