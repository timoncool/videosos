/**
 * WASM-free helpers for reading and overriding text layers in a Lottie
 * animation object. Lottie text layers have `ty === 5` and store their string
 * at `layer.t.d.k[*].s.t`. Kept separate from the dotlottie renderer so the
 * import/editing path can inspect and patch text without loading the WASM.
 *
 * The extract/apply helpers take an already-parsed animation object; the source
 * may be a raw `.json` or a `.lottie` archive (see `extractLottieAnimation` /
 * `fetchLottieAnimation`). Author-defined text *slots* (a top-level `slots`
 * table referenced by `t.d.sid`) are surfaced and patched too (keyed `s:<id>`).
 * Only top-level text layers are handled — nested precomp assets are out of scope.
 */
import { applyLottieColorOverrides } from './lottie-color'
import { parseLottieJsonObject as parseJson } from './lottie-json'
import { fetchLottieAnimation, fetchLottieThemeData } from './lottie-metadata'

/** A single editable text layer discovered in a Lottie animation. */
export interface LottieTextLayer {
  /** Stable key (the layer's index) used to address the override. */
  key: string
  /** Current text content. */
  text: string
  /** Human-readable label (the layer name, or a positional fallback). */
  label: string
}

interface TextDocument {
  t?: unknown
}
interface LottieTextData {
  d?: { k?: Array<{ s?: TextDocument }>; sid?: unknown }
}
interface LottieLayer {
  ty?: unknown
  nm?: unknown
  t?: LottieTextData
}
interface SlotDef {
  p?: { a?: unknown; k?: unknown; p?: { t?: unknown } }
  nm?: unknown
}

function firstTextString(layer: LottieLayer): string | null {
  const keyframes = layer.t?.d?.k
  if (!Array.isArray(keyframes)) return null
  for (const kf of keyframes) {
    if (typeof kf?.s?.t === 'string') return kf.s.t
  }
  return null
}

// --- Lottie text slots -------------------------------------------------------
// A themeable Lottie keeps editable copy in a top-level `slots` table; text
// layers point at it via `t.d.sid`. The editable string lives at
// `slots[id].p.k[0].s.t` (plus an older `slots[id].p.p.t` fallback), and each
// bound layer carries its own `t.d.k[*].s.t` fallback. We surface these as
// entries keyed `s:<id>` and, on write, patch the slot document AND every bound
// layer so the change renders whether or not the renderer resolves slots.

function slotTextDocument(k: unknown): TextDocument | undefined {
  if (!Array.isArray(k)) return undefined
  return (k[0] as { s?: TextDocument } | undefined)?.s
}

function boundTextLayers(data: Record<string, unknown>, slotId: string): LottieLayer[] {
  const layers = data.layers
  if (!Array.isArray(layers)) return []
  return (layers as LottieLayer[]).filter((l) => l?.ty === 5 && l.t?.d?.sid === slotId)
}

function readSlotText(data: Record<string, unknown>, slotId: string): string | undefined {
  const p = (data.slots as Record<string, SlotDef> | undefined)?.[slotId]?.p
  const slotText = slotTextDocument(p?.k)?.t
  if (typeof slotText === 'string') return slotText
  if (typeof p?.p?.t === 'string') return p.p.t
  for (const layer of boundTextLayers(data, slotId)) {
    const layerText = slotTextDocument(layer.t?.d?.k)?.t
    if (typeof layerText === 'string') return layerText
  }
  return undefined
}

function writeSlotText(data: Record<string, unknown>, slotId: string, text: string): boolean {
  let changed = false
  const p = (data.slots as Record<string, SlotDef> | undefined)?.[slotId]?.p
  const slotDoc = slotTextDocument(p?.k)
  if (slotDoc) {
    slotDoc.t = text
    changed = true
  }
  if (p?.p && typeof p.p === 'object') {
    p.p.t = text
    changed = true
  }
  for (const layer of boundTextLayers(data, slotId)) {
    const layerDoc = slotTextDocument(layer.t?.d?.k)
    if (layerDoc) {
      layerDoc.t = text
      changed = true
    }
  }
  return changed
}

/** Editable text slots (only slots whose value resolves to a string). */
function slotTextLayers(data: Record<string, unknown>): LottieTextLayer[] {
  const slots = data.slots
  if (!slots || typeof slots !== 'object') return []
  const result: LottieTextLayer[] = []
  for (const [id, def] of Object.entries(slots as Record<string, SlotDef>)) {
    const text = readSlotText(data, id)
    if (typeof text !== 'string') continue
    const name = typeof def?.nm === 'string' && def.nm.trim() ? def.nm.trim() : ''
    result.push({ key: `s:${id}`, text, label: name || id })
  }
  return result
}

/**
 * List the editable text of a Lottie animation object. Author-defined text
 * slots come first (keyed `s:<id>`), then every unbound text layer in document
 * order (keyed by index). Slot-bound layers are omitted here — they're edited
 * through their slot. Returns an empty array for non-text or unparseable input.
 */
export function extractLottieTextLayers(json: unknown): LottieTextLayer[] {
  const data = parseJson(json)
  const layers = data?.layers
  if (!data || !Array.isArray(layers)) return []

  const result: LottieTextLayer[] = slotTextLayers(data)
  layers.forEach((raw, index) => {
    const layer = raw as LottieLayer
    if (layer?.ty !== 5) return
    if (typeof layer.t?.d?.sid === 'string') return // slot-bound; shown as a slot
    const text = firstTextString(layer)
    if (text === null) return
    const name = typeof layer.nm === 'string' && layer.nm.trim() ? layer.nm.trim() : ''
    result.push({ key: String(index), text, label: name || `Text ${index + 1}` })
  })
  return result
}

/**
 * Apply per-layer text overrides to a raw Lottie animation and return the
 * patched JSON string. Overrides are keyed by layer index (see
 * {@link extractLottieTextLayers}); unknown keys are ignored. Returns null when
 * the input can't be parsed or has no layers to patch.
 */
export function applyLottieTextOverrides(
  json: unknown,
  overrides: Record<string, string>,
): string | null {
  const data = parseJson(json)
  const layers = data?.layers
  if (!data || !Array.isArray(layers)) return null
  if (Object.keys(overrides).length === 0) return null

  let changed = false
  // Slot overrides (keyed `s:<id>`): patch the slot document + bound layers.
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith('s:')) continue
    if (writeSlotText(data, key.slice(2), value)) changed = true
  }
  layers.forEach((raw, index) => {
    const override = overrides[String(index)]
    if (override === undefined) return
    const layer = raw as LottieLayer
    if (layer?.ty !== 5) return
    if (typeof layer.t?.d?.sid === 'string') return // handled via its slot
    const keyframes = layer.t?.d?.k
    if (!Array.isArray(keyframes)) return
    for (const kf of keyframes) {
      if (kf?.s && typeof kf.s.t === 'string') {
        kf.s.t = override
        changed = true
      }
    }
  })

  return changed ? JSON.stringify(data) : null
}

/** The animation-level selections + overrides that shape a Lottie render. */
export interface LottieRenderInput {
  /** Selected animation id in a multi-animation `.lottie` (default: primary). */
  animationId?: string
  /** Selected dotLottie theme id, applied via `setThemeData` after load. */
  themeId?: string
  textOverrides?: Record<string, string>
  colorOverrides?: Record<string, string>
  /** Scalar/vector slot overrides applied natively after load (id → value). */
  slotOverrides?: Record<string, number | [number, number]>
}

/** Everything the renderer needs beyond `src` to reflect the item's edits. */
export interface LottieRenderSpec {
  /**
   * Patched/selected animation JSON to load as `data`, or null to load `src`
   * directly (nothing to patch and the primary animation is selected).
   */
  data: string | null
  /** Theme rule JSON to apply via `setThemeData` after load, or null. */
  themeData: string | null
  /** Scalar/vector slot overrides applied natively after load, or null. */
  slots: Record<string, number | [number, number]> | null
}

/**
 * Resolve a Lottie item's render spec from its source: the animation JSON to
 * load (patched with text/color overrides and/or a selected animation) and any
 * theme data to apply after load. Handles both raw `.json` and `.lottie` ZIP
 * archives (images are inlined so the patched JSON renders standalone). Shared
 * by the preview and export render paths so edits apply identically in both.
 *
 * `data` is null when nothing needs patching and the primary animation is
 * selected — the caller then loads `src` directly (cheapest path). A theme-only
 * edit keeps `data` null and just carries `themeData`, since a theme applies to
 * the src-loaded animation's slots without re-extraction.
 */
export async function resolveLottieRenderSpec(
  src: string,
  input: LottieRenderInput,
): Promise<LottieRenderSpec> {
  const hasText = !!input.textOverrides && Object.keys(input.textOverrides).length > 0
  const hasColor = !!input.colorOverrides && Object.keys(input.colorOverrides).length > 0
  // Extract/patch the animation JSON only when overrides apply or a specific
  // (non-primary) animation is selected; a theme alone rides on the src load.
  const needsData = hasText || hasColor || !!input.animationId

  let data: string | null = null
  if (needsData) {
    // Inline archive images so the patched JSON is self-contained for the renderer.
    const animation = await fetchLottieAnimation(src, true, input.animationId)
    if (animation) {
      // Appliers mutate the object in place; we re-serialize once at the end.
      if (hasText) applyLottieTextOverrides(animation, input.textOverrides!)
      if (hasColor) applyLottieColorOverrides(animation, input.colorOverrides!)
      data = JSON.stringify(animation)
    }
  }

  const themeData = input.themeId ? await fetchLottieThemeData(src, input.themeId) : null
  const slots =
    input.slotOverrides && Object.keys(input.slotOverrides).length > 0 ? input.slotOverrides : null
  return { data, themeData, slots }
}
