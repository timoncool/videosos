/**
 * Named caption/subtitle look-and-feel presets.
 *
 * Each preset is a *patch* of style fields shared between {@link TextItem}
 * and {@link SubtitleSegmentItem}. Applying a preset overlays these onto
 * the target item(s).
 *
 * `layout` carries canvas-relative tweaks (font size, vertical position,
 * box width). They're stored as ratios of the canvas so the same preset
 * looks right on a 720p edit, a 1080p edit, and a vertical 9:16 edit
 * without per-resolution tuning. Resolved into absolute pixels at apply
 * time by `resolveCaptionStylePatch`.
 */

import type { TransformProperties } from '@/types/transform'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

export type CaptionStylePatch = Pick<
  TextItem,
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'underline'
  | 'color'
  | 'backgroundColor'
  | 'backgroundRadius'
  | 'textAlign'
  | 'verticalAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textPadding'
  | 'textShadow'
  | 'stroke'
  | 'captionReveal'
  | 'captionHighlight'
> & { transform?: TransformProperties }

export interface CaptionStylePreset {
  id: string
  label: string
  /** i18n key for the one-line description shown as button tooltip. */
  hintKey: string
  patch: Omit<CaptionStylePatch, 'transform' | 'fontSize'>
  /** Canvas-relative layout overrides — see top-of-file comment. */
  layout?: {
    /** fontSize = round(canvasHeight * fontSizeRatio). */
    fontSizeRatio?: number
    /** transform.y = round(canvasHeight * yRatio). 0 = vertical center, +ve = below. */
    yRatio?: number
    /** transform.width = round(canvasWidth * widthRatio). */
    widthRatio?: number
    /** transform.height = round(canvasHeight * heightRatio). */
    heightRatio?: number
  }
}

const BASE_PRESETS: readonly CaptionStylePreset[] = [
  {
    id: 'netflix',
    label: 'Netflix',
    hintKey: 'editor.captionPresets.netflixHint',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      backgroundRadius: 4,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textPadding: 12,
      textShadow: { offsetX: 0, offsetY: 2, blur: 6, color: 'rgba(0, 0, 0, 0.6)' },
      stroke: undefined,
    },
    layout: { fontSizeRatio: 0.04, yRatio: 0.36, widthRatio: 0.7, heightRatio: 0.16 },
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hintKey: 'editor.captionPresets.youtubeHint',
    patch: {
      fontFamily: 'Roboto',
      fontWeight: 'medium',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 4, blur: 14, color: 'rgba(0, 0, 0, 0.85)' },
      stroke: undefined,
    },
    layout: { fontSizeRatio: 0.045, yRatio: 0.34, widthRatio: 0.85, heightRatio: 0.18 },
  },
  {
    id: 'bold-yellow',
    label: 'Bold Yellow',
    hintKey: 'editor.captionPresets.boldYellowHint',
    patch: {
      fontFamily: 'Roboto Slab',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      color: '#FFD400',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.1,
      letterSpacing: 0,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 3, blur: 5, color: 'rgba(0, 0, 0, 1)' },
      stroke: { width: 1.5, color: '#000000' },
    },
    layout: { fontSizeRatio: 0.05, yRatio: 0.38, widthRatio: 0.85, heightRatio: 0.18 },
  },
  {
    id: 'minimal-stroke',
    label: 'Outlined',
    hintKey: 'editor.captionPresets.outlinedHint',
    patch: {
      fontFamily: 'Manrope',
      fontWeight: 'medium',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      textPadding: 0,
      textShadow: undefined,
      stroke: { width: 1, color: '#000000' },
    },
    layout: { fontSizeRatio: 0.04, yRatio: 0.34, widthRatio: 0.85, heightRatio: 0.16 },
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hintKey: 'editor.captionPresets.tiktokHint',
    patch: {
      fontFamily: 'Anton',
      fontWeight: 'normal',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.05,
      letterSpacing: 1,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 4, blur: 8, color: 'rgba(0, 0, 0, 0.9)' },
      stroke: { width: 2, color: '#000000' },
    },
    layout: { fontSizeRatio: 0.075, yRatio: 0, widthRatio: 0.9, heightRatio: 0.22 },
  },
] as const

type LookReveal = 'whole' | 'karaoke' | 'word' | 'pop' | 'highlight'
type LookPlate = 'box' | 'rounded' | 'pill' | 'blob' | 'card' | 'glow' | 'none' | 'soft'
type LookGroup = 'Minimal' | 'Viral' | 'Karaoke' | 'Playful' | 'Neon' | 'Fresh'

/** Dub Studio's caption looks (`dub-captions/src/look.rs` TEMPLATES): reveal, plate, font, text, plate and accent colours. */
const DUB_LOOKS: ReadonlyArray<
  [id: string, label: string, group: LookGroup, LookReveal, LookPlate, font: string, base: string, plate: string, accent?: string]
> = [
  ['clean', 'Clean', 'Minimal', 'whole', 'pill', 'Montserrat', '#FFFFFF', '#1A1A1A'],
  ['minimal', 'Minimal', 'Minimal', 'whole', 'rounded', 'Roboto', '#FFFFFF', '#181818'],
  ['boxed', 'Boxed', 'Minimal', 'whole', 'box', 'Montserrat', '#FFFFFF', '#101010'],
  ['headline', 'Headline', 'Minimal', 'whole', 'box', 'Oswald', '#FFFFFF', '#0C0C0C'],
  ['serif', 'Serif', 'Minimal', 'whole', 'card', 'Playfair Display', '#FFFFFF', '#16110D'],
  ['card', 'Card', 'Minimal', 'whole', 'card', 'Montserrat', '#FFFFFF', '#16110D'],
  ['hormozi', 'Hormozi', 'Viral', 'highlight', 'box', 'Russo One', '#FFFFFF', '#0C0C0C', '#FFD400'],
  ['hormozi_green', 'Hormozi Green', 'Viral', 'highlight', 'box', 'Russo One', '#FFFFFF', '#0C0C0C', '#28E0A8'],
  ['mrbeast', 'MrBeast', 'Viral', 'pop', 'box', 'Russo One', '#FFFFFF', '#0C0C0C', '#FFE000'],
  ['impact', 'Impact', 'Viral', 'highlight', 'box', 'Russo One', '#FFFFFF', '#101010', '#FF3B30'],
  ['pop', 'Pop', 'Viral', 'pop', 'pill', 'Oswald', '#FFFFFF', '#141414'],
  ['karaoke', 'Karaoke', 'Karaoke', 'karaoke', 'pill', 'Oswald', '#FFFFFF', '#181818', '#28E0A8'],
  ['karaoke_gold', 'Karaoke Gold', 'Karaoke', 'karaoke', 'box', 'Montserrat', '#FFFFFF', '#101010', '#FFD400'],
  ['karaoke_neon', 'Karaoke Neon', 'Karaoke', 'karaoke', 'glow', 'Montserrat', '#FFFFFF', '#0A0A14', '#00E5FF'],
  ['bubble', 'Bubble', 'Playful', 'whole', 'blob', 'Caveat', '#201018', '#FF5DA2'],
  ['bubble_pop', 'Bubble Pop', 'Playful', 'pop', 'blob', 'Pacifico', '#201018', '#FFC857'],
  ['candy', 'Candy', 'Playful', 'word', 'pill', 'Pacifico', '#2A0E1E', '#FF6FB5'],
  ['neon', 'Neon', 'Neon', 'whole', 'glow', 'Montserrat', '#00E5FF', '#0A0A14', '#00E5FF'],
  ['neon_pink', 'Neon Pink', 'Neon', 'whole', 'glow', 'Oswald', '#FF54C8', '#100A14', '#FF54C8'],
  ['cyber', 'Cyber', 'Neon', 'word', 'glow', 'Oswald', '#7DF9FF', '#07101A', '#00E5FF'],
  ['fresh', 'Fresh', 'Fresh', 'whole', 'none', 'Montserrat', '#FFFFFF', '#101010'],
  ['fresh_bold', 'Fresh Bold', 'Fresh', 'pop', 'none', 'Russo One', '#FFFFFF', '#101010'],
  ['fresh_pop', 'Fresh Pop', 'Fresh', 'pop', 'none', 'Montserrat', '#FFFFFF', '#101010'],
  ['fresh_karaoke', 'Fresh Karaoke', 'Fresh', 'karaoke', 'none', 'Oswald', '#FFFFFF', '#101010', '#FFD400'],
  ['fresh_hormozi', 'Fresh Hormozi', 'Fresh', 'highlight', 'none', 'Russo One', '#FFFFFF', '#101010', '#FFD400'],
  ['fresh_soft', 'Fresh Soft', 'Fresh', 'whole', 'soft', 'Montserrat', '#FFFFFF', '#101010'],
]

/** The plate's corner radius in px at 1080p; none for the plates with no box. */
const PLATE_RADIUS: Record<LookPlate, number> = { box: 4, rounded: 12, pill: 40, blob: 28, card: 8, glow: 0, none: 0, soft: 10 }

/** A Dub look as a preset of this editor: its reveal mapped onto the three this one has (Dub's highlight lights the
 * spoken word as karaoke does here; word and pop show the words as they are spoken). */
function lookPreset([id, label, group, reveal, plate, font, base, plateColor, accent]: (typeof DUB_LOOKS)[number]): CaptionStylePreset {
  const boxed = plate !== 'glow' && plate !== 'none'
  return {
    id: `dub-${id}`,
    label,
    hintKey: `editor.captionPresets.look${group}Hint`,
    patch: {
      fontFamily: font,
      fontWeight: font === 'Montserrat' || font === 'Oswald' || font === 'Roboto' ? 'bold' : 'normal',
      fontStyle: 'normal',
      underline: false,
      color: base,
      backgroundColor: plate === 'soft' ? 'rgba(0, 0, 0, 0.35)' : boxed ? plateColor : undefined,
      backgroundRadius: PLATE_RADIUS[plate],
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textPadding: boxed ? (plate === 'card' ? 18 : 12) : 0,
      textShadow:
        plate === 'glow'
          ? { offsetX: 0, offsetY: 0, blur: 14, color: accent ?? base }
          : plate === 'none'
            ? { offsetX: 0, offsetY: 3, blur: 6, color: 'rgba(0, 0, 0, 0.85)' }
            : undefined,
      stroke: plate === 'none' ? { width: 2, color: '#000000' } : undefined,
      captionReveal: reveal === 'whole' ? 'whole' : reveal === 'karaoke' || reveal === 'highlight' ? 'karaoke' : 'words',
      captionHighlight: accent,
    },
    layout: { fontSizeRatio: 0.05, yRatio: 0.34, widthRatio: 0.85, heightRatio: 0.16 },
  }
}

export const CAPTION_STYLE_PRESETS: readonly CaptionStylePreset[] = [...BASE_PRESETS, ...DUB_LOOKS.map(lookPreset)]

/**
 * Heuristic match: pick the preset whose patch most closely matches the
 * given item's current style. Used to highlight the active preset chip in
 * the UI. Returns null when nothing matches well — the user has tweaked.
 */
export function detectActiveCaptionPreset(
  item: SubtitleSegmentItem | (TextItem & { textRole?: 'caption' }),
): CaptionStylePreset | null {
  for (const preset of CAPTION_STYLE_PRESETS) {
    if (matchesPreset(item, preset.patch)) return preset
  }
  return null
}

/**
 * Resolve a preset into a fully concrete patch for the given canvas. Layout
 * ratios become absolute fontSize / transform values; the user's existing
 * transform.x / rotation / opacity is preserved so applying a preset
 * doesn't reset position tweaks the user made by hand.
 */
export function resolveCaptionStylePatch(
  preset: CaptionStylePreset,
  canvasWidth: number,
  canvasHeight: number,
  baseTransform?: TransformProperties,
): CaptionStylePatch {
  const layout = preset.layout
  const patch: CaptionStylePatch = { ...preset.patch }

  if (layout?.fontSizeRatio !== undefined) {
    patch.fontSize = Math.max(8, Math.round(canvasHeight * layout.fontSizeRatio))
  }

  if (
    layout &&
    (layout.yRatio !== undefined ||
      layout.widthRatio !== undefined ||
      layout.heightRatio !== undefined)
  ) {
    patch.transform = {
      x: baseTransform?.x ?? 0,
      y:
        layout.yRatio !== undefined
          ? Math.round(canvasHeight * layout.yRatio)
          : (baseTransform?.y ?? 0),
      width:
        layout.widthRatio !== undefined
          ? Math.round(canvasWidth * layout.widthRatio)
          : (baseTransform?.width ?? canvasWidth * 0.82),
      height:
        layout.heightRatio !== undefined
          ? Math.round(canvasHeight * layout.heightRatio)
          : (baseTransform?.height ?? canvasHeight * 0.16),
      rotation: baseTransform?.rotation ?? 0,
      opacity: baseTransform?.opacity ?? 1,
    }
  }

  return patch
}

function matchesPreset(item: SubtitleSegmentItem | TextItem, patch: CaptionStylePatch): boolean {
  for (const key of Object.keys(patch) as Array<keyof CaptionStylePatch>) {
    const expected = patch[key]
    const actual = item[key]
    if (!equalShallow(expected, actual)) return false
  }
  return true
}

function equalShallow(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return a === b
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) {
      return false
    }
  }
  return true
}
